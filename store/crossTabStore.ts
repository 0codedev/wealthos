import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { secureZustandStorage } from '../utils/Encryption';

export interface CrossTabSignal {
  type: string;
  message: string;
  severity: 'critical' | 'warning' | 'positive' | 'info';
  affectedTabs: string[];
}

export interface CrossTabState {
  signals: CrossTabSignal[];
  lastRunTimestamp: number;
  isCorrelating: boolean;
  setSignals: (signals: CrossTabSignal[]) => void;
  setCorrelating: (isCorrelating: boolean) => void;
  setLastRunTimestamp: (ts: number) => void;
}

export const useCrossTabStore = create<CrossTabState>()(
  persist(
    (set) => ({
      signals: [],
      lastRunTimestamp: 0,
      isCorrelating: false,
      setSignals: (signals) => set({ signals }),
      setCorrelating: (isCorrelating) => set({ isCorrelating }),
      setLastRunTimestamp: (lastRunTimestamp) => set({ lastRunTimestamp })
    }),
    {
      name: 'wealth-aggregator-crosstab-signals',
      storage: createJSONStorage(() => secureZustandStorage),
    }
  )
);
