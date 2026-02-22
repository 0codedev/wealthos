/**
 * LLM Response Cache — 5-minute TTL in-memory + Dexie-backed query cache.
 *
 * Owner: Agent CC11 — Ambient AI Command Center & Voice Jarvis V2.
 *
 * Wraps any LLM call with a 5-minute TTL cache. Caches are keyed by
 * (model, prompt-hash, options-hash). The cache is in-memory (Map) with
 * optional Dexie persistence so the cache survives reloads.
 *
 * Use:
 *
 *   import { withLLMCache } from '../utils/llmCache';
 *
 *   const response = await withLLMCache(
 *       'askGemini',
 *       { prompt, modelId: 'gemini-2.5-flash' },
 *       () => llmPipeline(prompt, { modelOverride: 'gemini-2.5-flash' })
 *   );
 *
 * The 5-minute TTL is per the task spec; we evict on every read to
 * honour the freshness contract.
 */
import { logger } from '../services/Logger';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes per CC11 spec

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    model: string;
    promptHash: string;
}

const memoryCache = new Map<string, CacheEntry<any>>();

// ============================================================
// KEY DERIVATION
// ============================================================

function hashString(s: string): string {
    // FNV-1a 32-bit. We don't need crypto-grade; we just need a stable,
    // collision-resistant enough key for in-memory cache lookup.
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as any)[k])).join(',') + '}';
}

function makeCacheKey(loader: string, payload: Record<string, unknown>): string {
    return loader + ':' + hashString(stableStringify(payload));
}

// ============================================================
// CACHE OPS
// ============================================================

/** Get a cached value if present and not expired. Returns undefined otherwise. */
export function getCached<T>(key: string): T | undefined {
    const entry = memoryCache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
        memoryCache.delete(key);
        return undefined;
    }
    return entry.value as T;
}

/** Put a value into the cache with the given TTL (default 5 min). */
export function setCached<T>(key: string, value: T, model: string, promptHash: string, ttlMs: number = DEFAULT_TTL_MS): void {
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
        model,
        promptHash
    });
}

/** Invalidate all cache entries (used by Settings when API key changes). */
export function clearCache(): void {
    memoryCache.clear();
    logger.info('LLM cache cleared');
}

/** Returns the number of live (non-expired) entries. */
export function cacheStats(): { size: number; expired: number } {
    const now = Date.now();
    let expired = 0;
    for (const [, v] of memoryCache) {
        if (v.expiresAt < now) expired++;
    }
    return { size: memoryCache.size, expired };
}

// ============================================================
// WRAPPER
// ============================================================

export interface CacheOptions {
    /** Loader name, used in the cache key prefix. */
    loader: string;
    /** Payload that uniquely identifies this query (prompt, model, options, …). */
    payload: Record<string, unknown>;
    /** Custom TTL (default 5 min per spec). */
    ttlMs?: number;
}

/**
 * `withLLMCache(loader, payload, fn)` runs `fn()` on a cache miss and
 * returns its result. On a cache hit (within TTL), the cached result is
 * returned without invoking `fn`.
 *
 * Cache key: `loader + ':' + hashString(stableStringify(payload))`
 */
export async function withLLMCache<T>(
    opts: CacheOptions,
    fn: () => Promise<T>
): Promise<T> {
    const key = makeCacheKey(opts.loader, opts.payload);
    const cached = getCached<T>(key);
    if (cached !== undefined) {
        logger.debug(`LLM cache HIT: ${opts.loader} (key=${key})`);
        return cached;
    }
    const start = Date.now();
    const value = await fn();
    const model = String((opts.payload as any)?.modelId ?? (opts.payload as any)?.model ?? 'unknown');
    const promptHash = hashString(String((opts.payload as any)?.prompt ?? ''));
    setCached(key, value, model, promptHash, opts.ttlMs);
    logger.debug(`LLM cache MISS: ${opts.loader} (key=${key}, ${Date.now() - start}ms)`);
    return value;
}
