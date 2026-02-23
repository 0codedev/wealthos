/**
 * storageVersion.ts
 * -----------------------------------------------------------------------------
 * Local-storage version-migration helper.
 *
 * Replaces the ad-hoc "read from localStorage.getItem('foo-v9')" pattern that
 * was sprinkled across the codebase. The migrator:
 *
 *   1. Reads the *current* key first.
 *   2. Falls back to each legacy versioned key (e.g. `foo-v9`, `foo-v8`,
 *      `foo-v7`) in priority order.
 *   3. Migrates the surviving value to the current key.
 *   4. Returns the default value if nothing was found.
 *
 * All parsing is wrapped in try/catch so a single corrupted entry can't take
 * down the host component.
 * -----------------------------------------------------------------------------
 */

const VERSION_RE = /^(.*)-v(\d+)$/;

export interface MigratorOptions<T> {
    /** The current (un-versioned) key. */
    currentKey: string;
    /** Legacy versioned keys, newest first. E.g. ['foo-v9', 'foo-v8']. */
    legacyKeys?: string[];
    /** Default value if nothing is found in any key. */
    defaultValue: T;
    /**
     * Optional validator / transformer. If it throws or returns `null`, the
     * value is treated as missing.
     */
    validate?: (raw: unknown) => T | null;
    /**
     * If true (default), the helper will also try the un-versioned `currentKey`
     * before looking at legacy keys.
     */
    includeUnversioned?: boolean;
}

/**
 * Try to read a value from localStorage, falling back through legacy versioned
 * keys, then return the default. On success, the value is re-written under
 * the current key for future reads.
 */
export function migrateStorageKey<T>(options: MigratorOptions<T>): T {
    if (typeof window === 'undefined' || !window.localStorage) {
        return options.defaultValue;
    }
    const {
        currentKey,
        legacyKeys = [],
        defaultValue,
        validate,
        includeUnversioned = true,
    } = options;

    const candidates: string[] = [];
    if (includeUnversioned) candidates.push(currentKey);
    candidates.push(...legacyKeys);

    for (const candidate of candidates) {
        let raw: string | null = null;
        try {
            raw = window.localStorage.getItem(candidate);
        } catch {
            raw = null;
        }
        if (raw === null) continue;

        // Strings pass through; everything else is JSON-parsed.
        let parsed: unknown = raw;
        if (raw.length > 0 && (raw[0] === '{' || raw[0] === '[' || raw[0] === '"')) {
            try {
                parsed = JSON.parse(raw);
            } catch {
                // Not JSON; treat the raw string as the value.
                parsed = raw;
            }
        }

        if (validate) {
            let safe: T | null = null;
            try {
                safe = validate(parsed);
            } catch {
                safe = null;
            }
            if (safe === null) continue;
            // Re-write under the current key for future reads.
            try {
                window.localStorage.setItem(currentKey, raw);
            } catch { /* ignore */ }
            return safe;
        }

        // No validator — accept the parsed value as-is.
        try {
            window.localStorage.setItem(currentKey, raw);
        } catch { /* ignore */ }
        return parsed as T;
    }

    return defaultValue;
}

/**
 * Purge all keys that match `prefix-v\d+` except the most-recent
 * `currentVersion`. Useful on app boot to keep localStorage tidy.
 */
export function cleanLegacyVersionedKeys(prefix: string, currentVersion: number): number {
    if (typeof window === 'undefined' || !window.localStorage) return 0;
    const pattern = new RegExp(`^${escapeRegExp(prefix)}-v(\\d+)$`);
    let removed = 0;
    try {
        const toRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            const match = key.match(pattern);
            if (match && Number(match[1]) < currentVersion) {
                toRemove.push(key);
            }
        }
        toRemove.forEach(k => {
            window.localStorage.removeItem(k);
            removed++;
        });
    } catch {
        /* ignore */
    }
    return removed;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Try to extract a version suffix from a key, e.g. `'foo-v9'` → `9`.
 * Returns 0 if the key has no `-v\d+` suffix.
 */
export function getStorageKeyVersion(key: string): number {
    const match = key.match(VERSION_RE);
    if (!match) return 0;
    const n = Number(match[2]);
    return Number.isFinite(n) ? n : 0;
}
