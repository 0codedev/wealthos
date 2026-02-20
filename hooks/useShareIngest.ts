/**
 * useShareIngest — A3 (Lane 7.1 of ULTIMATE_BREAKTHROUGH_FEATURES.md)
 *
 * React hook that drives the share ingest pipeline.
 *
 *   1. On mount, read `window.location.search` for `shared=1` and `sid`.
 *      If `shared=1` is present, this page was reached via the OS share
 *      sheet. The secondary SW at `/sw-share-target.js` has already
 *      stashed the form data in the `share-inbox` Cache API.
 *   2. Register the SW lazily (idempotent).
 *   3. Read the payload from the cache.
 *   4. If the payload is an image, run OCR via `services/ocrService`.
 *   5. Call `ingestShared` to decide TRADE / JOURNAL / NONE.
 *   6. On `savedAs: 'TRADE'`, fire a `window` `app:open-add-trade`
 *      CustomEvent carrying the `TradePrefill`. `App.tsx` listens for
 *      this event and opens `AddTradeModal` with the prefill.
 *   7. Strip the `?shared=1&ready=1&sid=…` query so a hard refresh
 *      doesn't re-trigger.
 *
 * Status moves through `idle → reading → ocr → saving → done` (or
 * `error` on any failure). The hook is unmount-safe: an AbortController
 * is checked at every await point.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
    ensureShareTargetSwRegistered,
    readSharePayload,
    recognizeIfImage,
    ingestShared,
    SharedPayload,
    IngestResult,
    TradePrefill,
} from '../services/shareIngestService';
import { logger } from '../utils/logger';

export type ShareIngestStatus =
    | 'idle'
    | 'reading'
    | 'ocr'
    | 'saving'
    | 'done'
    | 'error';

export interface UseShareIngestResult {
    status: ShareIngestStatus;
    result: IngestResult | null;
    prefill: TradePrefill | null;
    error: string | null;
    reset: () => void;
}

/**
 * Drives the share ingest pipeline. Returns the live status, the final
 * result, the trade prefill (if any), and a `reset` callback.
 *
 * Mount the hook once near the app root. The pipeline is a no-op if
 * the page wasn't reached via the share sheet.
 */
export function useShareIngest(): UseShareIngestResult {
    const [status, setStatus] = useState<ShareIngestStatus>('idle');
    const [result, setResult] = useState<IngestResult | null>(null);
    const [prefill, setPrefill] = useState<TradePrefill | null>(null);
    const [error, setError] = useState<string | null>(null);
    const aliveRef = useRef(true);

    const reset = useCallback(() => {
        setStatus('idle');
        setResult(null);
        setPrefill(null);
        setError(null);
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            // Detect the share query. We do this on the client only,
            // so SSR / prerender doesn't choke.
            if (typeof window === 'undefined') return;
            const params = new URLSearchParams(window.location.search);
            if (params.get('shared') !== '1') return;
            const sid = params.get('sid');

            try {
                // Register the SW lazily (idempotent).
                await ensureShareTargetSwRegistered();

                if (cancelled || !aliveRef.current) return;

                setStatus('reading');
                const payload: SharedPayload = await readSharePayload(sid);
                if (cancelled || !aliveRef.current) return;

                setStatus('ocr');
                const { ocrText, ocrConfidence } = await recognizeIfImage(payload);
                if (cancelled || !aliveRef.current) return;

                setStatus('saving');
                const ingestResult: IngestResult = await ingestShared(
                    payload,
                    ocrText
                );
                if (cancelled || !aliveRef.current) return;

                // Capture prefill (only on TRADE) before stripping the query.
                if (ingestResult.savedAs === 'TRADE') {
                    setPrefill(ingestResult.prefill);
                }

                setResult(ingestResult);
                setStatus('done');

                // Fire the open-add-trade event for `App.tsx` to pick up.
                if (ingestResult.savedAs === 'TRADE' && typeof window !== 'undefined') {
                    try {
                        window.dispatchEvent(
                            new CustomEvent('app:open-add-trade', {
                                detail: ingestResult.prefill,
                            })
                        );
                    } catch (err) {
                        logger.warn(
                            'useShareIngest',
                            'Failed to dispatch app:open-add-trade',
                            err instanceof Error ? err.message : String(err)
                        );
                    }
                }

                // Strip the share query so a refresh doesn't re-trigger.
                if (typeof window !== 'undefined' && window.history && window.history.replaceState) {
                    try {
                        const url = new URL(window.location.href);
                        url.searchParams.delete('shared');
                        url.searchParams.delete('ready');
                        url.searchParams.delete('sid');
                        const search = url.search ? url.search : '';
                        window.history.replaceState(
                            window.history.state,
                            '',
                            url.pathname + search + url.hash
                        );
                    } catch {
                        /* best-effort */
                    }
                }
            } catch (err) {
                if (cancelled || !aliveRef.current) return;
                logger.error(
                    'useShareIngest',
                    'Share ingest failed',
                    err instanceof Error ? err.message : String(err)
                );
                setError(err instanceof Error ? err.message : String(err));
                setStatus('error');
                setResult({
                    savedAs: 'NONE',
                    summary: 'Could not process the share. Try again.',
                });
            }
        };

        void run();

        return () => {
            cancelled = true;
        };
    }, []); // run once on mount

    return { status, result, prefill, error, reset };
}
