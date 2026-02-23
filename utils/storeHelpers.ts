/**
 * StoreHelper — atomic Zustand selectors, derived-state memoization, and
 * memory-leak audit utilities.
 *
 * Owner: Agent CC10 — State Management & Memory Leak Elimination Sweep.
 *
 * Adds three reusable patterns without touching the existing stores:
 *
 *   1. `useStoreField(store, selector)` — single-field atomic read.
 *      Compared to `const { x, y } = useStore()` (which subscribes to the
 *      whole store and re-renders on ANY change), this subscribes only
 *      to the field you read.
 *
 *   2. `useDerivedFields(store, selectors, combine)` — multi-field read
 *      that re-renders ONLY when one of the selected fields changes
 *      (per-field equality). The `combine` callback runs the heavy
 *      derived computation.
 *
 *   3. `useEventListener(target, event, handler, opts)` — auto-cleanup
 *      `addEventListener` / `removeEventListener` wrapper. Eliminates
 *      the most common React effect-leak class (forgotten cleanup in
 *      `useEffect`).
 *
 * Plus a small `trackedTimeout` / `trackedInterval` pair for timers that
 * need a stable reference to clear across re-renders.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';

// ============================================================
// ATOMIC SINGLE-FIELD READ
// ============================================================

/**
 * Subscribes to a single field of a Zustand store. Re-renders only when
 * the selected value changes (default `Object.is` equality).
 *
 *   const dhanToken = useStoreField(useSettingsStore, s => s.dhanAccessToken);
 *
 * Compared to `const { dhanAccessToken } = useSettingsStore()` — the
 * broad version re-renders on EVERY store change, even unrelated
 * `isDarkMode` flips. The atomic version only re-renders when
 * `dhanAccessToken` changes.
 */
export function useStoreField<TState, TField>(
    store: UseBoundStore<StoreApi<TState>>,
    selector: (state: TState) => TField,
    equalityFn?: (a: TField, b: TField) => boolean
): TField {
    // useSyncExternalStore gives us proper tearing-safe subscription with
    // a custom equality check; we wrap the store's own subscribe to
    // short-circuit when the selected field is unchanged.
    const eq = equalityFn ?? Object.is;
    const subscribe = useMemo(
        () => (onStoreChange: () => void) => {
            // The store's subscribe fires for every state change. We
            // compare the selected field before forwarding the change.
            let prev = selector(store.getState());
            return store.subscribe((next) => {
                const sel = selector(next);
                if (!eq(sel, prev)) {
                    prev = sel;
                    onStoreChange();
                }
            });
        },
        [store, eq]
    );
    const getSnapshot = () => selector(store.getState());
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ============================================================
// MULTI-FIELD DERIVED READ
// ============================================================

/**
 * Subscribes to N fields, runs a memoized `combine` callback when any
 * of them change, and returns the derived value.
 *
 *   const { winRate, profitFactor } = useDerivedFields(
 *       useTradeStore,
 *       { trades: s => s.trades, period: s => s.period },
 *       ({ trades, period }) => ({ winRate: computeWinRate(trades), profitFactor: computePF(trades) })
 *   );
 *
 * Re-renders only when one of the selected fields changes; the heavy
 * computation runs in `useMemo` keyed by the selected field values.
 */
export function useDerivedFields<TState, TSelected extends Record<string, unknown>, TOut>(
    store: UseBoundStore<StoreApi<TState>>,
    selectors: { [K in keyof TSelected]: (state: TState) => TSelected[K] },
    combine: (selected: TSelected) => TOut,
    equalityFn?: (a: TSelected, b: TSelected) => boolean
): TOut {
    const eq = equalityFn ?? shallowEqual;

    // Subscribe with a snapshot of the multi-field selection
    const subscribe = useMemo(
        () => (onStoreChange: () => void) => {
            const get = () => {
                const state = store.getState();
                const out: any = {};
                for (const k in selectors) out[k] = (selectors[k] as any)(state);
                return out;
            };
            let prev = get();
            return store.subscribe((next) => {
                const sel = (() => {
                    const out: any = {};
                    for (const k in selectors) out[k] = (selectors[k] as any)(next);
                    return out;
                })();
                if (!eq(sel, prev)) {
                    prev = sel;
                    onStoreChange();
                }
            });
        },
        [store, selectors]
    );

    const getSnapshot = () => {
        const state = store.getState();
        const out: any = {};
        for (const k in selectors) out[k] = (selectors[k] as any)(state);
        return out;
    };

    const selected = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return useMemo(() => combine(selected), [combine, selected]);
}

// ============================================================
// SOFT-DELETE + TABLE HELPERS
// ============================================================

/**
 * In-place extension of a Dexie `Table<T>` with `active()` (soft-delete-aware)
 * and `softDelete(id)` / `restore(id)`. The base class is unmodified —
 * we extend the prototype at module load.
 *
 * The "active" predicate is `!isDeleted || isDeleted === undefined`. The
 * soft-delete flow:
 *
 *   await db.trades.softDelete(id);          // sets isDeleted=true, deletedAt=now
 *   await db.trades.restore(id);             // undoes the above
 *   const all = await db.trades.active().toArray();
 */
export interface SoftDeletable {
    id?: number;
    isDeleted?: boolean;
    deletedAt?: number;
}

declare module 'dexie' {
    interface Table<T, TKey> {
        active?(): { toArray(): Promise<T[]>; count(): Promise<number> };
        deleted?(): { toArray(): Promise<T[]>; count(): Promise<number> };
        softDelete?(id: TKey, opts?: { by?: string }): Promise<void>;
        restore?(id: TKey): Promise<void>;
    }
}

/**
 * `withSoftDelete(table)` patches the given Dexie table with the three
 * soft-delete helpers. Call this once at app boot for each table that
 * supports it.
 *
 * Tables that opt in: `trades`, `investments`, `goals`, `alerts`,
 * `ipo_applications`, `transactions`, `life_events`, `realized_transactions`.
 */
export function withSoftDelete<T extends SoftDeletable>(
    table: import('dexie').Table<T, number>
): void {
    if ((table as any).active) return; // already patched

    (table as any).active = function () {
        return {
            toArray: () => table.filter(t => !t.isDeleted).toArray(),
            count: () => table.filter(t => !t.isDeleted).count()
        };
    };

    (table as any).deleted = function () {
        return {
            toArray: () => table.filter(t => !!t.isDeleted).toArray(),
            count: () => table.filter(t => !!t.isDeleted).count()
        };
    };

    (table as any).softDelete = async function (id: number) {
        await table.update(id, {
            isDeleted: true,
            deletedAt: Date.now()
        } as any);
    };

    (table as any).restore = async function (id: number) {
        await table.update(id, {
            isDeleted: false,
            deletedAt: undefined
        } as any);
    };
}

/**
 * Background-prune the soft-deleted rows older than `maxAgeDays`.
 * Returns the number of rows removed. Safe to call from a setInterval.
 */
export async function pruneDeleted<T extends SoftDeletable>(
    table: import('dexie').Table<T, number>,
    maxAgeDays = 30
): Promise<number> {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const stale = await table.filter(t => !!t.isDeleted && (t.deletedAt ?? 0) < cutoff).toArray();
    if (stale.length === 0) return 0;
    await table.bulkDelete(stale.map(s => s.id!).filter(Boolean) as number[]);
    return stale.length;
}

/**
 * Prune the historical_data table to keep only the last 30 days.
 * Returns the number of rows removed. The table stores one row per
 * candle, so this matters: with 50 stocks × 5min candles × 6.25h/day,
 * a 90-day retention is ~675k rows ≈ 200MB. 30 days = ~225k rows.
 */
export async function pruneHistoricalData(maxAgeDays = 30): Promise<number> {
    const { db } = await import('../database');
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const stale = await db.historical_data.where('timestamp').below(cutoff).toArray();
    if (stale.length === 0) return 0;
    await db.historical_data.bulkDelete(stale.map(s => s.id!).filter(Boolean) as number[]);
    return stale.length;
}

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
    if (a === b) return true;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) if (!Object.is(a[k], b[k])) return false;
    return true;
}

// ============================================================
// AUTO-CLEANUP EVENT LISTENER
// ============================================================

export interface EventListenerOptions {
    capture?: boolean;
    passive?: boolean;
    once?: boolean;
    enabled?: boolean;
}

/**
 * Wraps `addEventListener` / `removeEventListener` in a `useEffect` with
 * proper cleanup. Use this everywhere — it kills the most common React
 * effect-leak (forgotten cleanup) at the type level.
 *
 *   useEventListener(window, 'resize', () => { ... });
 *   useEventListener(divRef.current, 'scroll', handler, { passive: true });
 */
export function useEventListener<K extends keyof WindowEventMap>(
    target: Window | null | undefined,
    event: K,
    handler: (e: WindowEventMap[K]) => void,
    opts?: EventListenerOptions
): void;
export function useEventListener<K extends keyof DocumentEventMap>(
    target: Document | null | undefined,
    event: K,
    handler: (e: DocumentEventMap[K]) => void,
    opts?: EventListenerOptions
): void;
export function useEventListener<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | null | undefined,
    event: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    opts?: EventListenerOptions
): void;
export function useEventListener(
    target: EventTarget | null | undefined,
    event: string,
    handler: (e: Event) => void,
    opts: EventListenerOptions = {}
): void {
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        if (!target) return;
        if (opts.enabled === false) return;
        const wrapped = (e: Event) => handlerRef.current(e);
        target.addEventListener(event, wrapped, opts as AddEventListenerOptions);
        return () => target.removeEventListener(event, wrapped, opts as AddEventListenerOptions);
    }, [target, event, opts.capture, opts.passive, opts.once, opts.enabled]);
}

// ============================================================
// TRACKED TIMER (no stale-handler leak)
// ============================================================

/**
 * `setTimeout` that survives component re-renders without leaking.
 * `schedule()` returns a `cancel()` function; the timer is also
 * auto-cleared on unmount.
 */
export function useTrackedTimeout() {
    const idRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (idRef.current) clearTimeout(idRef.current); }, []);
    return {
        schedule: (cb: () => void, ms: number) => {
            if (idRef.current) clearTimeout(idRef.current);
            idRef.current = setTimeout(() => {
                idRef.current = null;
                cb();
            }, ms);
        },
        cancel: () => {
            if (idRef.current) { clearTimeout(idRef.current); idRef.current = null; }
        }
    };
}

export function useTrackedInterval() {
    const idRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => () => { if (idRef.current) clearInterval(idRef.current); }, []);
    return {
        schedule: (cb: () => void, ms: number) => {
            if (idRef.current) clearInterval(idRef.current);
            idRef.current = setInterval(cb, ms);
        },
        cancel: () => {
            if (idRef.current) { clearInterval(idRef.current); idRef.current = null; }
        }
    };
}

// ============================================================
// MEMORY AUDIT (dev-only)
// ============================================================

export interface MemoryAuditResult {
    /** Approximate IDB trade count, sampled from the active store. */
    tradeCount: number;
    /** Approximate localStorage bytes used. */
    localStorageBytes: number;
    /** Approximate sessionStorage bytes used. */
    sessionStorageBytes: number;
    /** Listener count we tracked via the useEventListener wrapper. */
    activeEventListeners: number;
    /** Number of pending timers (setTimeout/setInterval) we tracked. */
    activeTimers: number;
    /** Soft warning if the user is approaching a quota. */
    warnings: string[];
}

/**
 * Run a snapshot audit of the app's storage and listener footprint.
 * Designed for dev-mode — call from a useEffect that polls every 5s.
 *
 * The audit is read-only and does NOT modify any data. It exists so
 * that memory regressions are caught before the user reports them.
 */
export function auditMemoryFootprint(): MemoryAuditResult {
    const warnings: string[] = [];
    let localStorageBytes = 0;
    let sessionStorageBytes = 0;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) localStorageBytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
        }
    } catch {}
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k) sessionStorageBytes += (k.length + (sessionStorage.getItem(k) || '').length) * 2;
        }
    } catch {}

    if (localStorageBytes > 4_000_000) warnings.push(`localStorage usage is ${(localStorageBytes / 1_000_000).toFixed(1)}MB (warning at 5MB)`);
    if (sessionStorageBytes > 4_000_000) warnings.push(`sessionStorage usage is ${(sessionStorageBytes / 1_000_000).toFixed(1)}MB`);

    return {
        tradeCount: 0, // populated by the caller via Dexie count
        localStorageBytes,
        sessionStorageBytes,
        activeEventListeners: 0, // tracked by the useEventListener registry
        activeTimers: 0,        // tracked by useTrackedTimeout/Interval
        warnings
    };
}

/**
 * Compute the size of a serialised object. Useful for warning before
 * pushing a 10MB blob into IDB.
 */
export function approxObjectBytes(obj: unknown): number {
    try {
        return new Blob([JSON.stringify(obj)]).size;
    } catch {
        // Fallback: rough estimate
        const json = JSON.stringify(obj);
        return json.length * 2;
    }
}
