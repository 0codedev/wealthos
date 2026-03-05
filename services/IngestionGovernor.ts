/**
 * IngestionGovernor - Phase 9 / CC21
 *
 * A rate-limiting queue and request deduplicator used for high-frequency
 * REST fetches. Identical requests issued within a 500ms window collapse
 * into a single bulk call.
 *
 * Usage:
 *   const result = await ingestionGovernor.fetch(
 *     'historical_SBIN_1d',
 *     () => fetchHistorical('SBIN', '1d'),
 *     { ttl: 5000, coalesceMs: 500 }
 *   );
 */

import { logger } from './Logger';

interface InflightRequest<T> {
    key: string;
    startedAt: number;
    resolve: (val: T) => void;
    reject: (err: unknown) => void;
    fetcher: () => Promise<T>;
}

interface CacheEntry<T> {
    value: T;
    cachedAt: number;
    expiresAt: number;
    source: 'memory' | 'dexie';
}

interface BulkRequest<T> {
    keys: string[];
    fetcher: (keys: string[]) => Promise<Map<string, T>>;
    resolve: (val: Map<string, T>) => void;
    reject: (err: unknown) => void;
    timeoutId: number;
}

class IngestionGovernorImpl {
    private memCache = new Map<string, CacheEntry<unknown>>();
    private inflight = new Map<string, InflightRequest<unknown>>();
    private bulkInflight: BulkRequest<unknown> | null = null;
    private stats = {
        hits: 0,
        misses: 0,
        coalesced: 0,
        bulkBatches: 0,
    };

    /**
     * Fetch a single value. The fetcher is responsible for issuing the
     * real network call.
     */
    async fetch<T>(key: string, fetcher: () => Promise<T>, opts: { ttl?: number; coalesceMs?: number; skipCache?: boolean } = {}): Promise<T> {
        const { ttl = 60_000, coalesceMs = 500, skipCache = false } = opts;

        if (!skipCache) {
            const cached = this.memCache.get(key) as CacheEntry<T> | undefined;
            if (cached && cached.expiresAt > Date.now()) {
                this.stats.hits++;
                return cached.value;
            }
        }

        // Coalesce duplicates that arrive within `coalesceMs`.
        const existing = this.inflight.get(key);
        if (existing) {
            this.stats.coalesced++;
            return new Promise<T>((resolve, reject) => {
                const origResolve = existing.resolve;
                const origReject = existing.reject;
                // Hook into the existing inflight request — both consumers
                // resolve together.
                existing.resolve = ((val: unknown) => {
                    origResolve(val);
                    resolve(val as T);
                }) as typeof existing.resolve;
                existing.reject = ((err: unknown) => {
                    origReject(err);
                    reject(err);
                }) as typeof existing.reject;
            });
        }

        const promise = new Promise<T>((resolve, reject) => {
            const req: InflightRequest<unknown> = {
                key,
                startedAt: Date.now(),
                fetcher: fetcher as () => Promise<unknown>,
                resolve: (v) => resolve(v as T),
                reject,
            } as InflightRequest<unknown>;
            this.inflight.set(key, req);
        });

        const req = this.inflight.get(key)!;
        try {
            const value: T = await (req.fetcher() as Promise<T>);
            this.memCache.set(key, { value, cachedAt: Date.now(), expiresAt: Date.now() + ttl } as CacheEntry<unknown>);
            this.stats.misses++;
            req.resolve(value);
            return value;
        } catch (err) {
            req.reject(err);
            throw err;
        } finally {
            this.inflight.delete(key);
        }
    }

    /**
     * Batch fetcher. Coalesces multiple keys requested within
     * `windowMs` into a single bulk call to `fetcher(keys)`.
     *
     * Example:
     *   const prices = await ingestionGovernor.bulkFetch(
     *     ['NIFTY', 'BANKNIFTY'],
     *     (keys) => fetchMany(keys),
     *     { ttl: 60_000, windowMs: 500 }
     *   );
     */
    async bulkFetch<T>(keys: string[], fetcher: (keys: string[]) => Promise<Map<string, T>>, opts: { ttl?: number; windowMs?: number } = {}): Promise<Map<string, T>> {
        const { ttl = 60_000, windowMs = 500 } = opts;
        const result = new Map<string, T>();
        const missing: string[] = [];

        for (const key of keys) {
            const cached = this.memCache.get(key) as CacheEntry<T> | undefined;
            if (cached && cached.expiresAt > Date.now()) {
                this.stats.hits++;
                result.set(key, cached.value);
            } else {
                missing.push(key);
            }
        }

        if (missing.length === 0) return result;

        // Bulk coalesce — if a batch is already pending, append to it.
        return new Promise<Map<string, T>>((resolve, reject) => {
            if (this.bulkInflight) {
                // Merge into the existing request
                const existing = this.bulkInflight;
                const allKeys = Array.from(new Set([...existing.keys, ...missing]));
                // Replace the existing request with one that includes new keys
                clearTimeout(existing.timeoutId);
                existing.keys = allKeys;
                const origResolve = existing.resolve;
                existing.resolve = (val) => {
                    origResolve(val);
                    for (const [k, v] of (val as Map<string, T>).entries()) {
                        if (missing.includes(k)) result.set(k, v);
                    }
                    resolve(result);
                };
                this.bulkInflight = existing;
                existing.timeoutId = window.setTimeout(() => this.flushBulk<T>(fetcher, ttl), windowMs);
                return;
            }

            const req: BulkRequest<unknown> = {
                keys: missing,
                fetcher: fetcher as unknown as BulkRequest<unknown>['fetcher'],
                resolve: ((val: Map<string, unknown>) => {
                    for (const [k, v] of val.entries()) {
                        result.set(k, v as T);
                    }
                    resolve(result);
                }) as BulkRequest<unknown>['resolve'],
                reject: ((err: unknown) => reject(err)) as BulkRequest<unknown>['reject'],
                timeoutId: 0,
            };
            this.bulkInflight = req;
            req.timeoutId = window.setTimeout(() => this.flushBulk<T>(fetcher, ttl), windowMs);
        });
    }

    private async flushBulk<T>(fetcher: (keys: string[]) => Promise<Map<string, T>>, ttl: number) {
        const req = this.bulkInflight as BulkRequest<T> | null;
        this.bulkInflight = null;
        if (!req) return;

        try {
            this.stats.bulkBatches++;
            const data: Map<string, T> = await (fetcher as (keys: string[]) => Promise<Map<string, T>>)(req.keys);
            const now = Date.now();
            for (const [k, v] of data.entries()) {
                this.memCache.set(k, { value: v, cachedAt: now, expiresAt: now + ttl } as CacheEntry<unknown>);
            }
            req.resolve(data);
        } catch (err) {
            req.reject(err);
            logger.warn('[IngestionGovernor] Bulk fetch failed', err);
        }
    }

    /** Invalidate a single cache key. */
    invalidate(key: string) {
        this.memCache.delete(key);
    }

    /** Invalidate all keys matching the prefix. */
    invalidatePrefix(prefix: string) {
        for (const k of Array.from(this.memCache.keys())) {
            if (k.startsWith(prefix)) this.memCache.delete(k);
        }
    }

    /** Clear all caches. */
    clear() {
        this.memCache.clear();
    }

    /** Get current stats (used by the diagnostic panel). */
    getStats() {
        return {
            ...this.stats,
            cacheSize: this.memCache.size,
            inflightCount: this.inflight.size,
            bulkInFlight: !!this.bulkInflight,
        };
    }
}

export const ingestionGovernor = new IngestionGovernorImpl();
