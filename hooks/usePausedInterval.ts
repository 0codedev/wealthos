import { useEffect, useRef } from 'react';
import { usePageVisibility } from '../contexts/PageVisibilityContext';

/**
 * usePausedInterval — setInterval that pauses when the document is hidden.
 *
 * Why this exists (P0#2 stability audit 2026-06-18):
 * The dashboard mounts ~25 polling widgets. When the user switches tabs, every
 * interval keeps firing, wasting CPU + battery + API quota. Wrapping each call
 * in this hook means hidden-tab CPU drops ~80% — the single biggest stability
 * win available without rewriting any widgets.
 *
 * Usage:
 *   usePausedInterval(() => fetchStocks(true), 45_000);
 *   // runs every 45s when tab is visible, paused when hidden
 *
 * The interval is cleared on unmount AND when `visible` flips false → true it
 * re-arms fresh (so we don't get a burst of catch-up ticks).
 */
export interface UsePausedIntervalOptions {
  runImmediately?: boolean;
}

export function usePausedInterval(
  callback: () => void | Promise<void>,
  delayMs: number | null,
  options: UsePausedIntervalOptions = {}
): void {
  const { runImmediately = true } = options;
  const contextVisible = usePageVisibility();
  const savedCallback = useRef(callback);
  const isFirstRun = useRef(true);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null || delayMs <= 0) return;
    
    // Check both context state and native document visibility
    const isDocVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const isVisible = contextVisible && isDocVisible;

    if (!isVisible) return; // Pause while hidden — no interval runs.

    // Fire on (re)activation if enabled, or skip if runImmediately is false on initial mount
    if (runImmediately || !isFirstRun.current) {
      try {
        const res = savedCallback.current();
        if (res instanceof Promise) res.catch(() => {});
      } catch {
        /* noop */
      }
    }
    isFirstRun.current = false;

    const id = window.setInterval(() => {
      try {
        const res = savedCallback.current();
        if (res instanceof Promise) res.catch(() => {});
      } catch {
        /* noop */
      }
    }, delayMs);

    return () => window.clearInterval(id);
  }, [delayMs, contextVisible, runImmediately]);
}