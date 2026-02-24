/**
 * CC111 — Last-viewed tab persistence.
 *
 * Tracks which tab the user last visited, both globally and per-hub, and
 * restores it on next mount. Production apps (Notion, Linear, Figma) all
 * remember the last open document / tab so the user lands back where they
 * left off after a refresh.
 *
 * The hook is split into two pieces:
 *   1. `useLastViewedTab(scope, defaultTab)` — set/get per-scope tab
 *   2. `getRecentlyViewedTabs()` — list of recently visited tabs across
 *      all scopes, for the "Recents" Command Palette section.
 *
 * State is persisted to localStorage via the CC102 `safeGet` / `safeSet`
 * helpers, so a quota error or schema migration doesn't crash the app.
 */
import { useCallback, useEffect, useState } from 'react';
import { safeGet, safeSet } from './safeDefaults';

const STORAGE_KEY_PREFIX = 'cc111.lastViewed.';

interface LastViewedRecord {
    scope: string;
    tab: string;
    ts: number;
}

function loadRecord(scope: string): LastViewedRecord | null {
    return safeGet<LastViewedRecord | null>(`${STORAGE_KEY_PREFIX}${scope}`, null);
}

function saveRecord(record: LastViewedRecord): boolean {
    return safeSet(`${STORAGE_KEY_PREFIX}${record.scope}`, record);
}

function loadAll(): LastViewedRecord[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const out: LastViewedRecord[] = [];
    try {
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue;
            const rec = safeGet<LastViewedRecord | null>(key, null);
            if (rec) out.push(rec);
        }
    } catch {
        // localStorage may throw in private mode; ignore.
    }
    return out;
}

/**
 * Per-scope last-viewed tab tracker.
 *
 * Example:
 *   const { tab, setTab } = useLastViewedTab('journal', 'analytics');
 *   // On mount, `tab` is the last value the user picked (or 'analytics').
 *   // When the user clicks a sub-tab, call `setTab('mistakes')` and the
 *   // new value is persisted.
 */
export function useLastViewedTab(scope: string, defaultTab: string): {
    tab: string;
    setTab: (next: string) => void;
} {
    const [tab, setTabState] = useState<string>(() => {
        const rec = loadRecord(scope);
        return rec?.tab ?? defaultTab;
    });

    // Keep state in sync if the scope changes (e.g. user navigates
    // between hubs with the same hook instance).
    useEffect(() => {
        const rec = loadRecord(scope);
        setTabState(rec?.tab ?? defaultTab);
        // We intentionally only re-run when the scope key changes —
        // tab updates are written through `setTab`, not via this effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    const setTab = useCallback(
        (next: string) => {
            setTabState(next);
            saveRecord({ scope, tab: next, ts: Date.now() });
        },
        [scope]
    );

    return { tab, setTab };
}

/**
 * Get a list of recently-viewed tabs across all scopes, sorted newest
 * first. Powers the "Recents" section in the Command Palette.
 */
export function getRecentlyViewedTabs(limit = 8): LastViewedRecord[] {
    return loadAll()
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);
}

/**
 * Subscribe to localStorage changes. Useful for the Command Palette
 * "Recents" section to auto-refresh when the user picks a tab in a
 * different surface.
 *
 * Example:
 *   useEffect(() => {
 *       const off = subscribeRecentlyViewed(() => setRecents(getRecentlyViewedTabs()));
 *       return off;
 *   }, []);
 */
export function subscribeRecentlyViewed(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const handler = (e: StorageEvent) => {
        if (e.key && e.key.startsWith(STORAGE_KEY_PREFIX)) listener();
    };
    window.addEventListener('storage', handler);
    // Custom event for in-tab updates (storage event only fires across tabs).
    const custom = () => listener();
    window.addEventListener('cc111.lastViewed', custom);
    return () => {
        window.removeEventListener('storage', handler);
        window.removeEventListener('cc111.lastViewed', custom);
    };
}

/**
 * Helper to fire the in-tab notification after a `setTab` call.
 * Exposed for use in stores / actions that bypass the hook.
 */
export function notifyLastViewedUpdated(): void {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('cc111.lastViewed'));
    }
}

export default useLastViewedTab;
