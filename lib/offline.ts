/**
 * offline — single source of truth for the network-availability gate.
 *
 * Mirrors the shape of `lib/demoMode.ts`. Read-side callers use
 * `isOffline()` for sync access; components use `useOffline()`; side-
 * effects wrap their hot paths in `gateNetworkAction()`.
 *
 * Detection is owned by `store/offlineStore.ts` (navigator.onLine +
 * 30s probe with 3-failure threshold).
 *
 * Owned by: Offline mode (Top-10 #4).
 */
import { useShallow } from 'zustand/react/shallow';
import { useOfflineStore } from '../store/offlineStore';
import { logger } from '../utils/logger';
import { COPY } from '../utils/appCopy';

export class OfflineNoCacheError extends Error {
  public readonly key: string;
  constructor(key: string) {
    super(`No cached data for key "${key}" while offline`);
    this.name = 'OfflineNoCacheError';
    this.key = key;
  }
}

export function isOffline(): boolean {
  return useOfflineStore.getState().isOffline;
}

export interface OfflineSnapshot {
  isOffline: boolean;
  probeFailedCount: number;
  lastTransitionAt: number;
}

export function useOffline(): OfflineSnapshot {
  return useOfflineStore(
    useShallow((s) => ({
      isOffline: s.isOffline,
      probeFailedCount: s.probeFailedCount,
      lastTransitionAt: s.lastTransitionAt,
    }))
  );
}

/**
 * Show a global toast via the `app-toast` window event (see
 * `components/shared/ToastProvider.tsx`). Kept here so this file
 * doesn't import the React ToastProvider.
 */
function showOfflineToast(action: string): void {
  if (typeof window === 'undefined') return;
  const detail = {
    message: COPY.network.offlineBlocked(action),
    type: 'warning' as const,
    options: { duration: 5000 },
  };
  window.dispatchEvent(new CustomEvent('app-toast', { detail }));
}

export function gateNetworkAction<T>(
  action: string,
  fn: () => T | Promise<T>
): T | Promise<T> | null {
  if (!isOffline()) return fn();
  logger.warn(
    'offline',
    `blocked network action "${action}" — will retry when online`
  );
  showOfflineToast(action);
  return null;
}

/**
 * Convenience predicate that returns boolean whether a network action is allowed.
 * Mirrors `isSideEffectAllowed` from `lib/demoMode.ts`.
 */
export function isNetworkActionAllowed(action: string): boolean {
  if (!isOffline()) return true;
  logger.warn(
    'offline',
    `blocked network action "${action}" — will retry when online`
  );
  showOfflineToast(action);
  return false;
}

