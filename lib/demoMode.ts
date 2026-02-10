/**
 * demoMode — single source of truth for the side-effect gate.
 *
 * When the user has chosen "Try demo" in the FirstRunGate, demo rows
 * exist in Dexie and any external side-effect (broker order, cloud
 * sync, Telegram alert) must NOT fire. This module exposes:
 *
 *   - `isDemoMode()`         — sync read; safe to call from services
 *   - `gateSideEffect(fn)`   — runs fn only if NOT in demo mode; otherwise
 *                              emits a toast + returns a blocked sentinel
 *   - `useDemoMode()`        — React hook for components that want to
 *                              re-render when the gate flips
 *
 * Owned by: First-run demo + guided critical path (UX-Audit Top-10 #1).
 */
import { useFirstRunStore, isDemoModeSync } from '../store/firstRunStore';
import { useShallow } from 'zustand/react/shallow';
import { logger } from '../utils/logger';

export const DEMO_BLOCKED = Symbol('demo-blocked');

export function isDemoMode(): boolean {
  return isDemoModeSync();
}

/**
 * Wrap a side-effect in the demo gate.
 *
 *   const ok = gateSideEffect('dhan-order', () => dhan.placeOrder(...));
 *   if (ok === null) return; // blocked; toast already shown
 *
 * Returns the value of `fn()` when allowed, or `null` when blocked.
 * The `action` label appears in the warn log so dev tooling can show
 * the user *why* their action was blocked.
 */
export function gateSideEffect<T>(action: string, fn: () => T | Promise<T>): T | Promise<T> | null {
  if (!isDemoMode()) return fn();
  logger.warn('demoMode', `blocked side-effect "${action}" — demo data is active`);
  return null;
}

/**
 * Convenience wrapper that returns a boolean instead of the value.
 * Useful when the caller doesn't care about the return value, only
 * whether it ran.
 */
export function isSideEffectAllowed(action: string): boolean {
  if (!isDemoMode()) return true;
  logger.warn('demoMode', `blocked side-effect "${action}" — demo data is active`);
  return false;
}

/**
 * Reactive hook. Re-renders when `demoMode` or `demoRowCount` flips.
 * Use in components that show the DemoModePill or a "Demo active" banner.
 *
 * IMPORTANT: We use `useShallow` because Zustand's default referential
 * equality would treat this object as new on every render (the selector
 * returned a fresh `{...}` literal), which previously caused:
 *   - "The result of getSnapshot should be cached to avoid an infinite loop"
 *   - "Maximum update depth exceeded" inside <DemoModePill>
 * because the unstable object ref cascaded into a useEffect that called
 * setDemoRowCount → store update → re-render → loop.
 */
export function useDemoMode(): { demoMode: boolean; demoRowCount: number } {
  return useFirstRunStore(
    useShallow((s) => ({
      demoMode: s.demoMode,
      demoRowCount: s.demoRowCount,
    }))
  );
}
