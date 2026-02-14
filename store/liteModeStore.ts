import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LiteModeState {
    isLiteMode: boolean;
    toggleLiteMode: () => void;
    setLiteMode: (enabled: boolean) => void;
}

export const useLiteModeStore = create<LiteModeState>()(
    persist(
        (set) => ({
            isLiteMode: false,
            toggleLiteMode: () => set((state) => ({ isLiteMode: !state.isLiteMode })),
            setLiteMode: (enabled) => set({ isLiteMode: enabled }),
        }),
        {
            name: 'wealthagg-lite-mode',
        }
    )
);
