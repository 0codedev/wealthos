/**
 * useRbiPolicy — A2 (Lane 3.1)
 *
 * Thin React hook around `RbiPolicyService.fetchRepoRate`. The widget
 * re-fetches on a 10-minute interval (same cadence as
 * `MacroRegimeBanner.tsx:55`) and exposes a `refresh` callback that
 * the widget wires to its refresh button.
 *
 * The hook is stateless across mounts — there is no Zustand store for
 * repo rate, intentionally. The repo rate changes 8 times a year; a
 * Zustand store would be over-engineering.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RbiPolicySnapshot } from '../services/rbiRepoRateSeed';
import { fetchRepoRate, isStale } from '../services/RbiPolicyService';

export interface UseRbiPolicyResult {
    snapshot: RbiPolicySnapshot | null;
    loading: boolean;
    isStale: boolean;
    lastFetchedAt: Date | null;
    refresh: () => Promise<void>;
}

export function useRbiPolicy(refreshIntervalMs: number = 10 * 60 * 1000): UseRbiPolicyResult {
    const [snapshot, setSnapshot] = useState<RbiPolicySnapshot | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
    // Guard against late-resolving fetches that would set state after
    // unmount. Standard React pattern; the ref is the abort flag.
    const aliveRef = useRef<boolean>(true);

    const doFetch = useCallback(async () => {
        setLoading(true);
        try {
            const next = await fetchRepoRate();
            if (!aliveRef.current) return;
            setSnapshot(next);
            setLastFetchedAt(new Date());
        } catch {
            // Swallow — the widget renders an empty-state in this case.
            if (!aliveRef.current) return;
            setSnapshot(null);
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        doFetch();
        const id = window.setInterval(() => { doFetch(); }, refreshIntervalMs);
        return () => {
            aliveRef.current = false;
            window.clearInterval(id);
        };
    }, [doFetch, refreshIntervalMs]);

    return {
        snapshot,
        loading,
        isStale: snapshot ? isStale(snapshot) : false,
        lastFetchedAt,
        refresh: doFetch,
    };
}

export default useRbiPolicy;
