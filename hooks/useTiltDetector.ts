import { create } from 'zustand';

export interface TiltEvent {
    id: string;
    timestamp: number;
    reason: 'CONSECUTIVE_LOSSES' | 'RAPID_OVERLEVERAGE' | 'MANUAL_HALT';
    lossStreakCount: number;
    coolingOffUntil: number; // timestamp
    postMortemNotes?: string;
    resolved: boolean;
}

interface TiltDetectorState {
    isLocked: boolean;
    activeTilt: TiltEvent | null;
    tiltHistory: TiltEvent[];
    recentLossCount: number;
    triggerCircuitBreaker: (reason: TiltEvent['reason'], lossCount?: number, durationMinutes?: number) => void;
    resolveCircuitBreaker: (notes?: string) => void;
    recordTradeResult: (pnl: number) => void;
    resetStreak: () => void;
}

const TILT_STORAGE_KEY = 'wealth_tilt_detector_state';

const loadSavedTiltState = () => {
    if (typeof window === 'undefined') return { isLocked: false, activeTilt: null, history: [] };
    try {
        const raw = localStorage.getItem(TILT_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.activeTilt && parsed.activeTilt.coolingOffUntil > Date.now()) {
                return { isLocked: true, activeTilt: parsed.activeTilt, history: parsed.history || [] };
            }
        }
    } catch { /* ignore */ }
    return { isLocked: false, activeTilt: null, history: [] };
};

export const useTiltDetectorStore = create<TiltDetectorState>((set, get) => {
    const initial = loadSavedTiltState();

    return {
        isLocked: initial.isLocked,
        activeTilt: initial.activeTilt,
        tiltHistory: initial.history,
        recentLossCount: 0,

        recordTradeResult: (pnl: number) => {
            const state = get();
            if (pnl < 0) {
                const newLossCount = state.recentLossCount + 1;
                if (newLossCount >= 3) {
                    state.triggerCircuitBreaker('CONSECUTIVE_LOSSES', newLossCount, 15);
                } else {
                    set({ recentLossCount: newLossCount });
                }
            } else {
                set({ recentLossCount: 0 });
            }
        },

        triggerCircuitBreaker: (reason, lossCount = 3, durationMinutes = 15) => {
            const coolingOffUntil = Date.now() + durationMinutes * 60 * 1000;
            const newTilt: TiltEvent = {
                id: `tilt_${Date.now()}`,
                timestamp: Date.now(),
                reason,
                lossStreakCount: lossCount,
                coolingOffUntil,
                resolved: false
            };

            set(state => {
                const nextHistory = [newTilt, ...state.tiltHistory].slice(0, 20);
                if (typeof window !== 'undefined') {
                    localStorage.setItem(TILT_STORAGE_KEY, JSON.stringify({ activeTilt: newTilt, history: nextHistory }));
                }
                return {
                    isLocked: true,
                    activeTilt: newTilt,
                    tiltHistory: nextHistory,
                    recentLossCount: 0
                };
            });
        },

        resolveCircuitBreaker: (notes) => {
            set(state => {
                const updatedActive = state.activeTilt ? { ...state.activeTilt, resolved: true, postMortemNotes: notes } : null;
                const updatedHistory = state.activeTilt 
                    ? state.tiltHistory.map(t => t.id === state.activeTilt?.id ? (updatedActive || t) : t)
                    : state.tiltHistory;

                if (typeof window !== 'undefined') {
                    localStorage.removeItem(TILT_STORAGE_KEY);
                }
                return {
                    isLocked: false,
                    activeTilt: null,
                    tiltHistory: updatedHistory,
                    recentLossCount: 0
                };
            });
        },

        resetStreak: () => set({ recentLossCount: 0 })
    };
});
