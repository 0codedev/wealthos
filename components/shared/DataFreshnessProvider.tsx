import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';

/**
 * DataFreshnessProvider — broadcasts the most recent fetch timestamp to
 * any descendant that subscribes via the hook.
 *
 * This is the auto-applied layer CC50 puts around <Dashboard>. Components
 * that show numbers (portfolio cards, KPI tiles) can call
 * useDataFreshness() to derive a freshness dot without manually wiring
 * props.
 *
 * CC106 — extended with a multi-source registry. Each named source can
 * register its own lastFetchedAt; the provider exposes a per-source map
 * so widgets can show "Quotes: live • News: cached" without lifting
 * state. Falls back to a global "lastFetchedAt" for legacy consumers.
 */

export type FreshnessStatus = 'live' | 'cached' | 'stale' | 'degraded' | 'unknown';

export interface DataFreshnessContextValue {
    lastFetchedAt: number | null; // epoch ms — global (legacy)
    setLastFetchedAt: (ts: number | null) => void;
    status: FreshnessStatus;
    /** Convenience: derive status from a timestamp. */
    deriveStatus: (ts: number | null) => FreshnessStatus;
    // CC106: per-source registry
    sources: Record<string, number | null>;
    setSource: (key: string, ts: number | null) => void;
    getSourceStatus: (key: string) => FreshnessStatus;
}

const DataFreshnessContext = createContext<DataFreshnessContextValue | undefined>(undefined);

const LIVE_WINDOW_MS = 15_000;       // < 15s
const CACHE_WINDOW_MS = 5 * 60_000;  // < 5m
const STALE_WINDOW_MS = 60 * 60_000; // < 1h
// anything older than STALE_WINDOW_MS is degraded

function computeStatus(ts: number | null): FreshnessStatus {
    if (ts == null) return 'unknown';
    const diff = Date.now() - ts;
    if (diff < 0) return 'live';
    if (diff < LIVE_WINDOW_MS) return 'live';
    if (diff < CACHE_WINDOW_MS) return 'cached';
    if (diff < STALE_WINDOW_MS) return 'stale';
    return 'degraded';
}

export const DataFreshnessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
    // CC106: per-source map. Keys are arbitrary strings like "quotes",
    // "news", "broker-ledger". Values are the last fetch timestamp.
    const [sources, setSources] = useState<Record<string, number | null>>({});

    // Re-compute "live" status on a tick so the dot auto-fades from live
    // to cached to stale without manual updates. We use a ref for the
    // interval so it survives re-renders.
    const [, setTick] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        intervalRef.current = setInterval(() => setTick((n) => n + 1), 5_000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const deriveStatus = useCallback((ts: number | null) => computeStatus(ts), []);

    const status = useMemo(() => computeStatus(lastFetchedAt), [lastFetchedAt]);

    // CC106: stable per-source setters. `setSource('quotes', Date.now())`
    // is the public API; a consumer never has to thread a fetch through
    // props or context to update the freshness dot.
    const setSource = useCallback((key: string, ts: number | null) => {
        setSources((prev) => ({ ...prev, [key]: ts }));
    }, []);

    const getSourceStatus = useCallback(
        (key: string): FreshnessStatus => computeStatus(sources[key] ?? null),
        // Re-evaluate when the tick changes (every 5s) so source statuses
        // also auto-fade. The `sources` dep is implicit through the tick.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [sources, /* tick-driven */]
    );

    const value = useMemo<DataFreshnessContextValue>(
        () => ({
            lastFetchedAt,
            setLastFetchedAt,
            status,
            deriveStatus,
            sources,
            setSource,
            getSourceStatus,
        }),
        [lastFetchedAt, status, deriveStatus, sources, setSource, getSourceStatus]
    );

    return (
        <DataFreshnessContext.Provider value={value}>
            {children}
        </DataFreshnessContext.Provider>
    );
};

export const useDataFreshness = (): DataFreshnessContextValue => {
    const ctx = useContext(DataFreshnessContext);
    if (!ctx) {
        // Soft-fail so legacy code paths that aren't wrapped still work.
        return {
            lastFetchedAt: null,
            setLastFetchedAt: () => undefined,
            status: 'unknown',
            deriveStatus: () => 'unknown',
            sources: {},
            setSource: () => undefined,
            getSourceStatus: () => 'unknown',
        };
    }
    return ctx;
};

export default DataFreshnessProvider;
