/**
 * offlineStore — ephemeral session state for offline mode.
 *
 * Hydrated at boot from `navigator.onLine`. Updated by:
 *   1. The `online` / `offline` window events (immediate).
 *   2. A 30s background `HEAD /api/health` ping, with a 3-failure
 *      threshold to declare offline (~90s).
 *
 * NOT persisted — this is per-session state. A reload re-evaluates.
 *
 * Owned by: Offline mode (Top-10 #4).
 */
import { create } from 'zustand';

export interface OfflineState {
  isOffline: boolean;
  probeFailedCount: number;
  lastTransitionAt: number;
  // Actions
  setOffline: (offline: boolean) => void;
  recordProbe: (success: boolean) => void;
  reset: () => void;
}

const PROBE_THRESHOLD = 3;

export const useOfflineStore = create<OfflineState>((set, get) => ({
  isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,
  probeFailedCount: 0,
  lastTransitionAt: 0,

  setOffline: (offline) => {
    if (get().isOffline === offline) return;
    set({ isOffline: offline, lastTransitionAt: Date.now() });
  },

  recordProbe: (success) => {
    if (success) {
      if (get().probeFailedCount !== 0 || get().isOffline) {
        set({ probeFailedCount: 0, isOffline: false, lastTransitionAt: Date.now() });
      }
      return;
    }
    const next = get().probeFailedCount + 1;
    if (next >= PROBE_THRESHOLD) {
      set({ probeFailedCount: next, isOffline: true, lastTransitionAt: Date.now() });
    } else {
      set({ probeFailedCount: next });
    }
  },

  reset: () => set({ isOffline: false, probeFailedCount: 0, lastTransitionAt: 0 }),
}));

// ---- Test-only helpers ----
export function setOnlineFromProbe(success: boolean): void {
  useOfflineStore.getState().recordProbe(success);
}

export function _resetOfflineStore(): void {
  useOfflineStore.getState().reset();
}
