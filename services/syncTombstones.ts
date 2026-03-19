/**
 * Tombstone Registry for Distributed Offline-First Deletion Synchronization.
 * Tracks deleted entity IDs with timestamps to prevent cloud pulls from resurrecting deleted records.
 */

const TOMBSTONE_STORAGE_KEY = 'wealthos_sync_tombstones';
const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days retention

export function getSyncTombstones(): Record<string, number> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(TOMBSTONE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

export function recordSyncTombstone(
    tableName: string,
    entityId: string | number,
    timestamp = Date.now()
): void {
    if (typeof window === 'undefined') return;
    try {
        const stones = getSyncTombstones();
        stones[`${tableName.toLowerCase()}:${String(entityId)}`] = timestamp;

        // Auto-prune very old tombstones
        const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
        for (const [k, ts] of Object.entries(stones)) {
            if (ts < cutoff) delete stones[k];
        }

        localStorage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(stones));
    } catch (e) {
        console.warn('[Tombstones] Failed to save tombstone:', e);
    }
}

export function isSyncTombstoned(
    tableName: string,
    entityId: string | number,
    updatedAt = 0
): boolean {
    const stones = getSyncTombstones();
    const deletedAt = stones[`${tableName.toLowerCase()}:${String(entityId)}`];
    if (!deletedAt) return false;
    // If the item was updated strictly AFTER the deletion, it was legitimately re-created
    if (updatedAt > deletedAt) return false;
    return true;
}
