/**
 * A4 — useDailyDigest
 *
 * Owns the "is it past 9 AM IST and we have no record for today?" check.
 * Triggers `generateForToday()` on:
 *   - first mount
 *   - `document.visibilitychange → 'visible'`
 *
 * Exposes a manual `refresh()` that forces a regen (bypasses dedupe).
 * Survives unmount via `aliveRef` — late async returns are ignored.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getStoredDigestForToday,
    generateForToday,
    type GenerateResult
} from '../services/dailyDigestService';
import type { DailyDigestRecord } from '../database';
import { logger } from '../utils/logger';

export interface UseDailyDigestResult {
    digest: DailyDigestRecord | undefined;
    isGenerating: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useDailyDigest(): UseDailyDigestResult {
    const [digest, setDigest] = useState<DailyDigestRecord | undefined>(undefined);
    const [isGenerating, setIsGenerating] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const aliveRef = useRef<boolean>(true);

    const runGeneration = useCallback(async (force: boolean) => {
        if (!aliveRef.current) return;
        setIsGenerating(true);
        setError(null);
        try {
            const result: GenerateResult | null = await generateForToday(force);
            if (!aliveRef.current) return;
            if (result) {
                setDigest(result.record);
            } else {
                const stored = await getStoredDigestForToday();
                if (!aliveRef.current) return;
                setDigest(stored);
            }
        } catch (err) {
            if (!aliveRef.current) return;
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn('useDailyDigest', `generateForToday failed: ${msg}`);
            setError(msg);
        } finally {
            if (aliveRef.current) setIsGenerating(false);
        }
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        (async () => {
            const stored = await getStoredDigestForToday();
            if (!aliveRef.current) return;
            setDigest(stored);
            await runGeneration(false);
        })();

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                void runGeneration(false);
            }
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            aliveRef.current = false;
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [runGeneration]);

    const refresh = useCallback(async () => {
        await runGeneration(true);
    }, [runGeneration]);

    return { digest, isGenerating, error, refresh };
}
