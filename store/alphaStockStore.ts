import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AlphaStockData {
  Symbol: string;
  LTP: number;
  Change: number;
  "Strength Factor": number;
}

interface AlphaStockState {
  stocks: AlphaStockData[];
  setStocks: (stocks: AlphaStockData[]) => void;
  clearStocks: () => void;
}

export const useAlphaStockStore = create<AlphaStockState>()(
  persist(
    (set) => ({
      stocks: [],
      setStocks: (stocks) => set({ stocks }),
      clearStocks: () => set({ stocks: [] }),
    }),
    {
      name: 'wealthagg-alpha-stocks',
    }
  )
);
