/**
 * RbiPolicyService — A2 (Lane 3.1)
 *
 * Fetches the current RBI repo rate. Three-tier source ladder, with
 * explicit freshness semantics:
 *
 *   1. IndexedDB cache (`db.cache['rbi_repo_rate']`, 7-day TTL).
 *   2. Operator-seeded constant (`RBI_REPO_SEED`).
 *   3. (Optional, currently disabled) AI grounding.
 *
 * The function is *side-effect-friendly* on the cache: every successful
 * seed read writes through to the cache, so a session that reads N times
 * only pays the seed-parse cost once. The cache miss path is exactly the
 * cache-write path — there is no separate "fetch" call because the seed
 * is a constant.
 *
 * The service also exports `classifyDirection` (pure) and `isStale`
 * (pure) so consumers can do their own thresholding.
 *
 * Zero new dependencies. Mirrors the `getCache`/`setCache` pattern
 * already used by `fetchCommodityPrice` in `RealDataService.ts:579`.
 */
import {
    RBI_REPO_SEED,
    RbiPolicySnapshot,
    RBI_REPO_CACHE_KEY,
    RBI_REPO_CACHE_TTL_MS,
    RBI_STALE_THRESHOLD_MS,
    DIRECTION_FLOOR_BPS,
} from './rbiRepoRateSeed';

// Dexie import is dynamic to keep this module usable in the test
// environment (where the DB may be mocked via `vi.mock('../../database', …)`).
type DbCache = { where: (...a: unknown[]) => { equals: (k: string) => { first: () => Promise<any> } }; update?: (...a: unknown[]) => Promise<unknown>; add?: (...a: unknown[]) => Promise<unknown>; delete?: (...a: unknown[]) => Promise<unknown> };

let _dbPromise: Promise<DbCache> | null = null;
async function getDb(): Promise<DbCache> {
    if (!_dbPromise) {
        // Lazy require so test files that mock the database module
        // can intercept the lookup at module-load time.
        _dbPromise = import('../database').then(m => (m as any).db.cache as DbCache);
    }
    return _dbPromise;
}

export type RepoDirection = 'HAWKISH' | 'DOVISH' | 'NEUTRAL';

/**
 * Pure. Classify a rate move vs the prior rate into hawkish / dovish /
 * neutral, with a 10-bps floor. Indian MPC moves in 25 bps increments;
 * sub-10 bps moves are treated as no-change to avoid mislabelling
 * transcription-noise from upstream sources.
 */
export function classifyDirection(current: number, previous: number): RepoDirection {
    const bps = (current - previous) * 100; // 1.00% = 100 bps
    if (bps > DIRECTION_FLOOR_BPS) return 'HAWKISH';
    if (bps < -DIRECTION_FLOOR_BPS) return 'DOVISH';
    return 'NEUTRAL';
}

/** Pure. Is the snapshot older than the stale threshold? */
export function isStale(snapshot: RbiPolicySnapshot, now: number = Date.now()): boolean {
    const t = Date.parse(snapshot.effectiveDate);
    if (!Number.isFinite(t)) return true;
    return now - t > RBI_STALE_THRESHOLD_MS;
}

/** Cached read. Mirrors `getCache` in `RealDataService.ts:161`. */
async function readCache(): Promise<RbiPolicySnapshot | null> {
    try {
        const cache = await getDb();
        const entry = await cache.where('key').equals(RBI_REPO_CACHE_KEY).first();
        if (entry && entry.timestamp && entry.data) {
            const age = Date.now() - entry.timestamp;
            if (age < RBI_REPO_CACHE_TTL_MS) {
                // Always serve from cache as a hit; relabel the source so
                // the widget can show "cached" if it cares to.
                return { ...(entry.data as RbiPolicySnapshot), source: 'cache' };
            }
            if (entry.id != null && cache.delete) {
                try { await cache.delete(entry.id); } catch { /* ignore */ }
            }
        }
    } catch { /* ignore — fall through to seed */ }
    return null;
}

/** Cached write. Mirrors `setCache` in `RealDataService.ts:178`. */
async function writeCache(snapshot: RbiPolicySnapshot): Promise<void> {
    try {
        const cache = await getDb();
        const existing = await cache.where('key').equals(RBI_REPO_CACHE_KEY).first();
        const entry = {
            key: RBI_REPO_CACHE_KEY,
            data: snapshot,
            timestamp: Date.now(),
            ttl: RBI_REPO_CACHE_TTL_MS,
        };
        if (existing?.id != null && cache.update) {
            await cache.update(existing.id, entry);
        } else if (cache.add) {
            await cache.add(entry);
        }
    } catch { /* best-effort */ }
}

/**
 * Fetch the current RBI repo rate. Tries cache → seed (and writes seed
 * through to cache on miss). Returns a fresh object each call.
 */
export async function fetchRepoRate(): Promise<RbiPolicySnapshot> {
    const cached = await readCache();
    if (cached) return cached;

    // Cache miss. Recompute direction from numbers (defensive — if
    // someone hand-edits the seed and forgets to flip `direction`,
    // the runtime classification still matches the math).
    const recomputed: RbiPolicySnapshot = {
        ...RBI_REPO_SEED,
        direction: classifyDirection(RBI_REPO_SEED.repoRate, RBI_REPO_SEED.previousRepoRate),
        source: 'seed',
    };
    await writeCache(recomputed);
    return recomputed;
}

/**
 * Best-effort AI grounding hook. Currently a no-op; the wiring exists
 * so that when `fetchViaAI` is re-enabled in `RealDataService.ts:200`,
 * this becomes the natural call site.
 *
 * Returns `null` to indicate "no AI value available" — callers should
 * fall through to the seed.
 */
export async function fetchRepoRateViaAI(): Promise<RbiPolicySnapshot | null> {
    // Intentionally a no-op for now. See plan §5.
    return null;
}
