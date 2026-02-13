/**
 * firstRunStore — Zustand store backing the FirstRunGate + DemoModePill.
 *
 * Persisted to localStorage under `wealth_aggregator_first_run` so the gate
 * survives reloads without a Dexie round-trip on every render. The durable
 * record (DB rows + `first_run_meta`) is the source of truth; this store
 * is a *view* of that state.
 *
 * Owned by: First-run demo + guided critical path (UX-Audit Top-10 #1).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { logger } from '../utils/logger';

export interface FirstRunState {
  /** True until the user picks one of the 3 gate buttons. */
  firstRunComplete: boolean;
  /** True if the user picked "Try demo" (or restored demo rows). */
  demoMode: boolean;
  /** Cached count of demo rows across the 5 demo tables. */
  demoRowCount: number;
  /** True until the user has completed the 4 critical-path steps. */
  criticalPathComplete: boolean;

  // Actions
  dismissFirstRun: (path: 'import' | 'demo' | 'empty') => void;
  enterDemoMode: () => void;
  setDemoRowCount: (n: number) => void;
  exitDemoMode: () => void;
  markCriticalPathComplete: () => void;
  resetAll: () => void; // for Settings → "Replay first-run"
}

const STORAGE_KEY = 'wealth_aggregator_first_run';

export const useFirstRunStore = create<FirstRunState>()(
  persist(
    (set) => ({
      firstRunComplete: false,
      demoMode: false,
      demoRowCount: 0,
      criticalPathComplete: false,

      dismissFirstRun: (path) => {
        logger.log('firstRun', `dismissFirstRun: ${path}`);
        set({
          firstRunComplete: true,
          demoMode: path === 'demo',
        });
      },

      enterDemoMode: () => set({ demoMode: true, firstRunComplete: true }),

      exitDemoMode: () =>
        set({
          demoMode: false,
          // Note: do NOT reset firstRunComplete — once dismissed, stays dismissed.
        }),

      setDemoRowCount: (n) => set({ demoRowCount: n }),

      markCriticalPathComplete: () => set({ criticalPathComplete: true }),

      resetAll: () =>
        set({
          firstRunComplete: false,
          demoMode: false,
          demoRowCount: 0,
          criticalPathComplete: false,
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => {
        // localStorage is mocked in tests/setup.ts so this is safe in both
        // jsdom and the browser.
        if (typeof window === 'undefined' || !window.localStorage) {
          // SSR/test fallback: provide the minimum Storage surface Zustand needs.
          const fallback = {
            getItem: () => null as string | null,
            setItem: () => {},
            removeItem: () => {},
            clear: () => {},
            key: () => null as string | null,
            length: 0,
          };
          return fallback as unknown as Storage;
        }
        return window.localStorage;
      }),
      partialize: (state) => ({
        firstRunComplete: state.firstRunComplete,
        demoMode: state.demoMode,
        demoRowCount: state.demoRowCount,
        criticalPathComplete: state.criticalPathComplete,
      }),
      version: 1,
    }
  )
);

// ---- Synchronous read helpers (for non-React callers like the
// ---- gateSideEffect function in lib/demoMode.ts) ----

export function isFirstRunComplete(): boolean {
  return useFirstRunStore.getState().firstRunComplete;
}

export function isDemoModeSync(): boolean {
  return useFirstRunStore.getState().demoMode;
}
