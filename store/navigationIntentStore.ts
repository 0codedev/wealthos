import { create } from 'zustand';

export interface NavigationIntent {
  target: 'portfolio' | 'journal' | 'dashboard' | 'alpha' | 'backtester' | 'macro' | 'settings';
  action: string;
  createdAt: number;
  payload?: any;
}

interface NavigationIntentState {
  intent: NavigationIntent | null;
  setIntent: (intent: NavigationIntent) => void;
  clearIntent: () => void;
}

export const useNavigationIntentStore = create<NavigationIntentState>((set) => ({
  intent: null,
  setIntent: (intent) => set({ intent }),
  clearIntent: () => set({ intent: null }),
}));
