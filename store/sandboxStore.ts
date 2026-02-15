import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SandboxState {
    isSandboxMode: boolean;
    toggleSandboxMode: () => void;
    setSandboxMode: (enabled: boolean) => void;
}

export const useSandboxStore = create<SandboxState>()(
    persist(
        (set) => ({
            isSandboxMode: false,
            toggleSandboxMode: () => set((state) => {
                const next = !state.isSandboxMode;
                if (typeof window !== 'undefined') {
                    window.localStorage.setItem('isSandboxMode', next ? 'true' : 'false');
                }
                return { isSandboxMode: next };
            }),
            setSandboxMode: (enabled: boolean) => {
                if (typeof window !== 'undefined') {
                    window.localStorage.setItem('isSandboxMode', enabled ? 'true' : 'false');
                }
                set({ isSandboxMode: enabled });
            },
        }),
        {
            name: 'wealthos-sandbox-mode',
        }
    )
);
