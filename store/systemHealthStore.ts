import { create } from 'zustand';

interface SystemHealthState {
    isTelegramReady: boolean;
    isDhanConnected: boolean;
    lastPing: Date | null;

    // Actions
    setTelegramStatus: (status: boolean) => void;
    setDhanStatus: (status: boolean) => void;
    updatePing: () => void;
}

export const useSystemHealthStore = create<SystemHealthState>((set) => ({
    isTelegramReady: false,
    isDhanConnected: false,
    lastPing: null,

    setTelegramStatus: (status) => set({ isTelegramReady: status }),
    setDhanStatus: (status) => set({ isDhanConnected: status }),
    updatePing: () => set({ lastPing: new Date() }),
}));
