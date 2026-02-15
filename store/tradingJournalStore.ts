import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TradingJournalState {
    activeStrategyFilter: string | null;
    filterType: 'ALL' | 'WIN' | 'LOSS';
    sortBy: 'date' | 'pnl';
    viewMode: 'list' | 'grid' | 'calendar';
    showBalances: boolean;

    // Actions
    setStrategyFilter: (strategy: string | null) => void;
    setFilterType: (type: 'ALL' | 'WIN' | 'LOSS') => void;
    setSortBy: (sort: 'date' | 'pnl') => void;
    setViewMode: (mode: 'list' | 'grid' | 'calendar') => void;
    toggleBalances: () => void;
}

export const useTradingJournalStore = create<TradingJournalState>()(
    persist(
        (set) => ({
            activeStrategyFilter: null,
            filterType: 'ALL',
            sortBy: 'date',
            viewMode: 'list',
            showBalances: true,

            setStrategyFilter: (strategy) => set({ activeStrategyFilter: strategy }),
            setFilterType: (type) => set({ filterType: type }),
            setSortBy: (sort) => set({ sortBy: sort }),
            setViewMode: (mode) => set({ viewMode: mode }),
            toggleBalances: () => set((state) => ({ showBalances: !state.showBalances })),
        }),
        {
            name: 'trading-journal-prefs',
        }
    )
);
