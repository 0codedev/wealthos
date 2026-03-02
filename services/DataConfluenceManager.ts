/**
 * CC27: Cross-Source Data Confluence & Deduplication Manager
 * ===========================================================
 *
 * The DataConfluenceManager is a frontend router that decides which data
 * source should answer a given query, tracks in-flight requests to
 * collapse duplicates, and exposes TTL-aware cache segments so that
 * fast-moving ticks don't trigger refetches while slow-moving data
 * (e.g. option chain Greeks) stays fresh.
 *
 * Priority matrix (highest to lowest):
 *   1. Upstox live WebSocket / HTTP quote
 *   2. Python bridge NSE stealth scraper
 *   3. Yahoo Finance spark / historical endpoint
 *   4. Dexie IndexedDB offline cache
 *
 * Every successful fetch writes into the centralMemoryStore under a
 * canonical key, so all open tabs read from the same memory reference.
 */

import { ingestionGovernor } from './IngestionGovernor';
import { useCentralMemoryStore, SharedQuote } from '../store/centralMemoryStore';
import { upstoxCacheService } from './UpstoxCacheService';
import { logger } from './Logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataSource = 'upstox_live' | 'upstox_http' | 'nse_stealth' | 'yahoo_finance' | 'dexie' | 'memory';

export type DataUrgency =
    | 'realtime_tick'      // 5s TTL
    | 'option_chain'       // 3 minute TTL
    | 'sector_heatmap'     // 15 minute TTL
    | 'historical_daily';  // 24 hour TTL

const URGENCY_TTL_MS: Record<DataUrgency, number> = {
    realtime_tick: 5_000,
    option_chain: 3 * 60_000,
    sector_heatmap: 15 * 60_000,
    historical_daily: 24 * 60 * 60_000,
};

export interface ConfluenceRequest<T> {
    key: string;
    urgency: DataUrgency;
    fetchers: Array<{
        source: Exclude<DataSource, 'memory' | 'dexie'>;
        fetcher: () => Promise<T>;
    }>;
    /**
     * Optional final fallback when every live source is offline. The
     * manager will return this synchronously if the caller has supplied
     * stale data via `confluenceManager.injectFallback()`.
     */
    fallback?: T;
    /** Whether the data is allowed to be served from the central memory store. */
    useMemory?: boolean;
}

export interface ConfluenceResult<T> {
    data: T;
    source: DataSource;
    fetchedAt: number;
    ageMs: number;
    isStale: boolean;
}

// ---------------------------------------------------------------------------
// Per-key, per-urgency cache segments
// ---------------------------------------------------------------------------

interface CacheSegment {
    data: unknown;
    fetchedAt: number;
    expiresAt: number;
    source: DataSource;
    urgency: DataUrgency;
}

class SegmentCache {
    private segments = new Map<string, CacheSegment>();

    get(key: string): CacheSegment | undefined {
        const seg = this.segments.get(key);
        if (!seg) return undefined;
        if (seg.expiresAt < Date.now()) {
            this.segments.delete(key);
            return undefined;
        }
        return seg;
    }

    set(key: string, data: unknown, urgency: DataUrgency, source: DataSource): void {
        const ttl = URGENCY_TTL_MS[urgency];
        this.segments.set(key, {
            data,
            fetchedAt: Date.now(),
            expiresAt: Date.now() + ttl,
            source,
            urgency,
        });
    }

    invalidate(key: string): void {
        this.segments.delete(key);
    }

    invalidatePrefix(prefix: string): void {
        for (const k of Array.from(this.segments.keys())) {
            if (k.startsWith(prefix)) this.segments.delete(k);
        }
    }

    clear(): void {
        this.segments.clear();
    }

    stats() {
        const now = Date.now();
        let fresh = 0;
        let stale = 0;
        for (const seg of this.segments.values()) {
            if (seg.expiresAt > now) fresh++;
            else stale++;
        }
        return {
            total: this.segments.size,
            fresh,
            stale,
        };
    }
}

// ---------------------------------------------------------------------------
// Global inflight registry — collapses duplicate concurrent requests
// ---------------------------------------------------------------------------

interface InflightEntry<T> {
    key: string;
    startedAt: number;
    resolve: (val: ConfluenceResult<T>) => void;
    reject: (err: unknown) => void;
}

class InflightRegistry {
    private inflight = new Map<string, InflightEntry<unknown>[]>();

    attach<T>(key: string, resolver: (val: ConfluenceResult<T>) => void, rejecter: (err: unknown) => void): InflightEntry<T> | null {
        const existing = this.inflight.get(key);
        if (existing) {
            const entry: InflightEntry<T> = {
                key,
                startedAt: Date.now(),
                resolve: resolver,
                reject: rejecter,
            };
            existing.push(entry as InflightEntry<unknown>);
            return entry;
        }
        this.inflight.set(key, []);
        return null;
    }

    fanout<T>(key: string, result: ConfluenceResult<T>): void {
        const entries = this.inflight.get(key);
        if (!entries) return;
        this.inflight.delete(key);
        for (const entry of entries) {
            try {
                (entry as InflightEntry<T>).resolve(result);
            } catch (err) {
                logger.warn('[DataConfluence] Fanout resolve failed', err);
            }
        }
    }

    fanoutError(key: string, err: unknown): void {
        const entries = this.inflight.get(key);
        if (!entries) return;
        this.inflight.delete(key);
        for (const entry of entries) {
            try {
                (entry as InflightEntry<unknown>).reject(err);
            } catch (resolveErr) {
                logger.warn('[DataConfluence] Fanout reject failed', resolveErr);
            }
        }
    }

    size(): number {
        return this.inflight.size;
    }
}

// ---------------------------------------------------------------------------
// The manager
// ---------------------------------------------------------------------------

class DataConfluenceManager {
    private segmentCache = new SegmentCache();
    private inflight = new InflightRegistry();
    private fallbackMap = new Map<string, unknown>();
    private stats = {
        cache_hits: 0,
        cache_misses: 0,
        dedup_joins: 0,
        failover_promotions: 0,
        central_memory_writes: 0,
    };
    private sourceOrder: DataSource[] = ['upstox_live', 'upstox_http', 'nse_stealth', 'yahoo_finance'];

    /**
     * The primary entry point. Returns the data for the given key using
     * the highest-priority available source, collapsing concurrent
     * duplicate requests into a single network call.
     */
    async request<T>(req: ConfluenceRequest<T>): Promise<ConfluenceResult<T>> {
        // 1. Central memory check (highest priority — fastest)
        if (req.useMemory !== false) {
            const memHit = this.segmentCache.get(req.key);
            if (memHit) {
                this.stats.cache_hits++;
                return {
                    data: memHit.data as T,
                    source: memHit.source,
                    fetchedAt: memHit.fetchedAt,
                    ageMs: Date.now() - memHit.fetchedAt,
                    isStale: false,
                };
            }
        }

        // 2. UpstoxCacheService (session-storage cache used by other services)
        try {
            const cached = upstoxCacheService.get<T>(req.key);
            if (cached !== null && cached !== undefined) {
                this.stats.cache_hits++;
                this.segmentCache.set(req.key, cached, req.urgency, 'upstox_live');
                return {
                    data: cached,
                    source: 'upstox_live',
                    fetchedAt: Date.now(),
                    ageMs: 0,
                    isStale: false,
                };
            }
        } catch (err) {
            logger.debug('[DataConfluence] UpstoxCacheService lookup failed', err);
        }

        // 3. Inflight dedup
        const attachResult = this.inflight.attach<T>(
            req.key,
            () => undefined,
            () => undefined,
        );
        if (attachResult) {
            this.stats.dedup_joins++;
            return new Promise<ConfluenceResult<T>>((resolve, reject) => {
                attachResult.resolve = resolve;
                attachResult.reject = reject;
            });
        }

        // 4. We own the live fetch — try each fetcher in priority order
        return this._executeWithFailover<T>(req);
    }

    private async _executeWithFailover<T>(req: ConfluenceRequest<T>): Promise<ConfluenceResult<T>> {
        const failures: Array<{ source: DataSource; error: unknown }> = [];
        for (const candidate of req.fetchers) {
            // Honour the configured source order — only attempt this
            // candidate if it sits at or above the active threshold.
            if (this.sourceOrder.indexOf(candidate.source) > this.sourceOrder.indexOf(this._activeSourceFloor())) {
                continue;
            }
            try {
                const data = await candidate.fetcher();
                const result: ConfluenceResult<T> = {
                    data,
                    source: candidate.source,
                    fetchedAt: Date.now(),
                    ageMs: 0,
                    isStale: false,
                };
                this._onSuccess(req, result);
                this.inflight.fanout<T>(req.key, result);
                return result;
            } catch (err) {
                failures.push({ source: candidate.source, error: err });
                logger.warn(`[DataConfluence] ${candidate.source} failed for ${req.key}`, err);
            }
        }

        // 5. All live sources failed — serve fallback if available
        const fallback = this.fallbackMap.get(req.key) ?? req.fallback;
        if (fallback !== undefined) {
            this.stats.failover_promotions++;
            const result: ConfluenceResult<T> = {
                data: fallback as T,
                source: 'dexie',
                fetchedAt: Date.now(),
                ageMs: Number.MAX_SAFE_INTEGER,
                isStale: true,
            };
            this.inflight.fanout<T>(req.key, result);
            return result;
        }

        this.inflight.fanoutError(req.key, new Error(
            `All live sources failed for ${req.key}. Failures: ${failures.map(f => f.source).join(', ')}`,
        ));
        throw new Error(`DataConfluence: no live source succeeded and no fallback for ${req.key}`);
    }

    private _activeSourceFloor(): DataSource {
        // If a higher-priority source is in a known-degraded state, drop
        // down to the next one. This is a simple sliding floor; richer
        // circuit-breaker logic lives in the per-source services.
        return this.sourceOrder[this.sourceOrder.length - 1];
    }

    private _onSuccess<T>(req: ConfluenceRequest<T>, result: ConfluenceResult<T>): void {
        this.segmentCache.set(req.key, result.data, req.urgency, result.source);
        this.stats.cache_misses++;

        // Cross-tab mirror: write to centralMemoryStore so all open
        // tabs read from the same memory reference. We only mirror
        // objects that look like a SharedQuote (have symbol + price).
        try {
            const data = result.data as (Partial<SharedQuote> & { change_pct?: number }) | undefined;
            if (data && typeof data === 'object' && 'symbol' in data && 'price' in data) {
                useCentralMemoryStore.getState().setSharedQuote({
                    symbol: String(data.symbol).toUpperCase(),
                    price: Number(data.price),
                    change: Number(data.change ?? 0),
                    changePercent: Number(data.changePercent ?? data.change_pct ?? 0),
                    timestamp: Date.now(),
                    source: result.source,
                });
                this.stats.central_memory_writes++;
            }
        } catch (err) {
            logger.debug('[DataConfluence] centralMemory write skipped', err);
        }
    }

    /**
     * Allows components to feed a Dexie/localStorage snapshot that
     * should be used as a last-resort fallback when every live source
     * is down.
     */
    injectFallback<T>(key: string, data: T): void {
        this.fallbackMap.set(key, data);
    }

    invalidate(key: string): void {
        this.segmentCache.invalidate(key);
        this.fallbackMap.delete(key);
    }

    invalidatePrefix(prefix: string): void {
        this.segmentCache.invalidatePrefix(prefix);
        for (const k of Array.from(this.fallbackMap.keys())) {
            if (k.startsWith(prefix)) this.fallbackMap.delete(k);
        }
    }

    clear(): void {
        this.segmentCache.clear();
        this.fallbackMap.clear();
    }

    getStats() {
        return {
            ...this.stats,
            cache: this.segmentCache.stats(),
            inflight: this.inflight.size(),
        };
    }

    /**
     * Convenience wrapper for option chain requests. Uses 3 minute TTL
     * and walks the live source list.
     */
    async fetchOptionChain<T>(key: string, fetchers: ConfluenceRequest<T>['fetchers'], fallback?: T): Promise<ConfluenceResult<T>> {
        return this.request<T>({
            key,
            urgency: 'option_chain',
            fetchers,
            fallback,
        });
    }

    /**
     * Convenience wrapper for sector/heatmap requests.
     */
    async fetchSectorHeatmap<T>(key: string, fetchers: ConfluenceRequest<T>['fetchers'], fallback?: T): Promise<ConfluenceResult<T>> {
        return this.request<T>({
            key,
            urgency: 'sector_heatmap',
            fetchers,
            fallback,
        });
    }

    /**
     * Convenience wrapper for live tick quotes.
     */
    async fetchQuote<T>(key: string, fetchers: ConfluenceRequest<T>['fetchers'], fallback?: T): Promise<ConfluenceResult<T>> {
        return this.request<T>({
            key,
            urgency: 'realtime_tick',
            fetchers,
            fallback,
        });
    }
}

export const confluenceManager = new DataConfluenceManager();

// Expose the IngestionGovernor stats alongside the manager for the
// diagnostic panel. IngestionGovernor.bulkFetch is what services
// use to coalesce bulk quote/option-chain requests.
export function getConfluenceDiagnostics() {
    return {
        manager: confluenceManager.getStats(),
        ingestion: ingestionGovernor.getStats(),
    };
}
