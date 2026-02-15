import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VoiceLog {
    id: string;
    timestamp: number;
    transcript: string;
    emotion: string;
    risk_level: string;
    sentiment: string;
    coach_tip: string;
    command?: string;
}

interface VoiceStore {
    logs: VoiceLog[];
    addLog: (log: Omit<VoiceLog, 'id' | 'timestamp'>) => void;
    clearLogs: () => void;
}

export const useVoiceStore = create<VoiceStore>()(
    persist(
        (set) => ({
            logs: [],
            addLog: (log) => set((state) => ({
                logs: [
                    {
                        ...log,
                        id: Math.random().toString(36).substring(7),
                        timestamp: Date.now()
                    },
                    ...state.logs
                ].slice(0, 100) // Keep last 100 logs
            })),
            clearLogs: () => set({ logs: [] })
        }),
        {
            name: 'wealth-voice-memory'
        }
    )
);
