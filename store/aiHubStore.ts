import { create } from 'zustand';

export type AIHubTab = 'coach' | 'insights' | 'market' | 'brain';

interface AIHubState {
  isOpen: boolean;
  activeTab: AIHubTab;
  open: (tab?: AIHubTab) => void;
  close: () => void;
  setTab: (tab: AIHubTab) => void;
}

export const useAIHubStore = create<AIHubState>((set) => ({
  isOpen: false,
  activeTab: 'coach',
  open: (tab) => set((state) => ({ isOpen: true, activeTab: tab || state.activeTab })),
  close: () => set({ isOpen: false }),
  setTab: (tab) => set({ activeTab: tab }),
}));
