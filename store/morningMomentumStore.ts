/**
 * CC68.39 / CC68.43 — Morning Momentum / Focus Mode session state.
 *
 * Shared store so the Trade Sniper "🎯 Focus Mode" toggle, the Alpha hub
 * "🎯 Morning Momentum" shortcut, and the active pick (for the 3 PM exit
 * reminder) stay in sync. Also holds the Clean-Trend filter thresholds +
 * toggles (editable in the ⚙ Filters popover), persisted across reloads.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_CLEAN_TREND_THRESHOLDS,
  DEFAULT_CLEAN_TREND_TOGGLES,
  type CleanTrendThresholds,
  type CleanTrendToggles,
} from '../services/alpha/CleanTrendEngine';

interface MorningMomentumState {
    /** When true, Trade Sniper renders the minimal curated Morning Momentum view. */
    focusMode: boolean;
    /** The symbol the user is currently riding (for the 3 PM exit reminder). */
    activePickSymbol: string | null;

    /** CC68.43 — Clean-Trend filter config (editable, persisted). */
    cleanTrendThresholds: CleanTrendThresholds;
    cleanTrendToggles: CleanTrendToggles;

    setFocusMode: (on: boolean) => void;
    toggleFocusMode: () => void;
    setActivePick: (symbol: string | null) => void;
    setCleanTrendThreshold: <K extends keyof CleanTrendThresholds>(key: K, value: number) => void;
    setCleanTrendToggle: <K extends keyof CleanTrendToggles>(key: K, value: boolean) => void;
    resetCleanTrend: () => void;
}

export const useMorningMomentumStore = create<MorningMomentumState>()(
    persist(
        (set) => ({
            focusMode: false,
            activePickSymbol: null,
            cleanTrendThresholds: { ...DEFAULT_CLEAN_TREND_THRESHOLDS },
            cleanTrendToggles: { ...DEFAULT_CLEAN_TREND_TOGGLES },

            setFocusMode: (on) => set({ focusMode: on }),
            toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
            setActivePick: (symbol) => set({ activePickSymbol: symbol }),
            setCleanTrendThreshold: (key, value) =>
                set((s) => ({ cleanTrendThresholds: { ...s.cleanTrendThresholds, [key]: value } })),
            setCleanTrendToggle: (key, value) =>
                set((s) => ({ cleanTrendToggles: { ...s.cleanTrendToggles, [key]: value } })),
            resetCleanTrend: () =>
                set({
                    cleanTrendThresholds: { ...DEFAULT_CLEAN_TREND_THRESHOLDS },
                    cleanTrendToggles: { ...DEFAULT_CLEAN_TREND_TOGGLES },
                }),
        }),
        {
            name: 'wealth-morning-momentum-storage',
            partialize: (s) => ({
                // PERSISTENCE FIX (production hardening): focusMode and
                // activePickSymbol were memory-only, so the focus view and the
                // 3 PM exit reminder pick reset on every reload. Persist them
                // alongside the Clean-Trend config.
                focusMode: s.focusMode,
                activePickSymbol: s.activePickSymbol,
                cleanTrendThresholds: s.cleanTrendThresholds,
                cleanTrendToggles: s.cleanTrendToggles,
            }),
        },
    ),
);
