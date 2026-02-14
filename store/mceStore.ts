// store/mceStore.ts
// In-memory (NOT persisted — rebuilt on page load).
// Spec: §5.2

import { create } from 'zustand';
import { McsSnapshot, HoldSnapshot, McsWeights, GexSnapshot } from '../services/mce/types';

interface MceState {
  preEntrySnapshots: Map<string, McsSnapshot>;
  holdSnapshots:      Map<string, HoldSnapshot>;
  gexSnapshots:       Map<string, GexSnapshot>;
  learnedWeights:     McsWeights | null;
  // CC68.33: When true, the MCS orchestrator computes per-stock GEX for
  // every F&O stock in the watchlist. Default false to keep the per-stock
  // path dark (avoids hammering PNSEA / Upstox). Toggle from the hub
  // header or from `useMceStore.getState().setGexPerStockEnabled(true)`.
  gexPerStockEnabled: boolean;
  setPreEntrySnapshot: (symbol: string, snapshot: McsSnapshot) => void;
  setHoldSnapshot: (symbol: string, hold: HoldSnapshot) => void;
  removeHoldSnapshot: (symbol: string) => void;
  setGexSnapshot: (symbol: string, snapshot: GexSnapshot) => void;
  setLearnedWeights: (w: McsWeights | null) => void;
  setGexPerStockEnabled: (enabled: boolean) => void;
}

export const useMceStore = create<MceState>((set) => ({
  preEntrySnapshots: new Map(),
  holdSnapshots:      new Map(),
  gexSnapshots:       new Map(),
  learnedWeights:     null,
  gexPerStockEnabled: false,

  setPreEntrySnapshot: (symbol, snapshot) =>
    set(state => {
      const next = new Map(state.preEntrySnapshots);
      next.set(symbol, snapshot);
      return { preEntrySnapshots: next };
    }),

  setHoldSnapshot: (symbol, hold) =>
    set(state => {
      const next = new Map(state.holdSnapshots);
      next.set(symbol, hold);
      return { holdSnapshots: next };
    }),

  removeHoldSnapshot: (symbol) =>
    set(state => {
      const next = new Map(state.holdSnapshots);
      next.delete(symbol);
      return { holdSnapshots: next };
    }),

  setGexSnapshot: (symbol, snapshot) =>
    set(state => {
      const next = new Map(state.gexSnapshots);
      next.set(symbol, snapshot);
      return { gexSnapshots: next };
    }),

  setLearnedWeights: (w) => set({ learnedWeights: w }),

  setGexPerStockEnabled: (enabled) => set({ gexPerStockEnabled: enabled }),
}));