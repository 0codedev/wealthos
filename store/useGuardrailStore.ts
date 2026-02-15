import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { notificationService } from '../services/NotificationService';

export type BreakerType = 'warning' | 'cooldown' | 'lockout' | 'none';

interface GuardrailState {
    // Thresholds (User Configurable)
    thresholds: {
        maxDailyLoss: number;
        maxLossVelocity: number; // losses per 30 mins
        maxLegsPerDay: number;
        revengeTradeDelay: number; // seconds
        highStressCooldown: number; // minutes
    };
    
    // Active State
    activeBreaker: BreakerType;
    breakerExpiry: number | null;
    breakerReason: string | null;
    
    // Metrics
    recentLosses: number[]; // Timestamps of losses in the last 30 mins
    lastTradeTimestamp: number | null;
    lastLossTimestamp: number | null;
    dailyLossTotal: number;

    // Consecutive streak tracking (P1)
    consecutiveLosses: number;
    consecutiveWins: number;
    consecutiveLossHistory: number[]; // timestamps of the last 10 consecutive losses (cross-day)
    streakLockoutUntil: number | null; // 24h lockout when consecutiveLosses hits 3
    streakLockoutReason: string | null;

    // Actions
    setThresholds: (thresholds: Partial<GuardrailState['thresholds']>) => void;
    recordTrade: (isLoss: boolean, pnl: number) => void;
    recordEmotionalRisk: (score: number, reason: string) => void;
    checkBreakers: () => void;
    clearBreaker: () => void;
    clearStreakLockout: () => void;
    emergencyOverride: () => void;
}

export const useGuardrailStore = create<GuardrailState>()(
    persist(
        (set, get) => ({
            thresholds: {
                maxDailyLoss: 5000, // Default $5000
                maxLossVelocity: 3, // 3 losses
                maxLegsPerDay: 20,
                revengeTradeDelay: 60, // 60 seconds
                highStressCooldown: 15, // 15 mins
            },
            
            activeBreaker: 'none',
            breakerExpiry: null,
            breakerReason: null,
            
            recentLosses: [],
            lastTradeTimestamp: null,
            lastLossTimestamp: null,
            dailyLossTotal: 0,
            consecutiveLosses: 0,
            consecutiveWins: 0,
            consecutiveLossHistory: [],
            streakLockoutUntil: null,
            streakLockoutReason: null,

            setThresholds: (newThresholds) => set((state) => ({
                thresholds: { ...state.thresholds, ...newThresholds }
            })),

            recordTrade: (isLoss, pnl) => {
                const now = Date.now();
                const { thresholds, recentLosses, lastLossTimestamp } = get();
                
                // 1. Check for Revenge Trade (Trade within X seconds of a loss)
                if (lastLossTimestamp && (now - lastLossTimestamp) < (thresholds.revengeTradeDelay * 1000)) {
                    const reason = 'Revenge Trade Detected: Forced 5-minute pause to reset.';
                    set({
                        activeBreaker: 'cooldown',
                        breakerExpiry: now + (5 * 60 * 1000), // 5 min forced pause
                        breakerReason: reason
                    });
                    notificationService.sendToNervousSystem('CIRCUIT_BREAKER', { type: 'cooldown', reason });
                }


                // 2. Update Metrics
                const updatedLosses = isLoss ? [...recentLosses, now].filter(t => now - t < 30 * 60 * 1000) : recentLosses;
                const newDailyLoss = isLoss ? get().dailyLossTotal + Math.abs(pnl) : get().dailyLossTotal;

                // 2a. Consecutive-streak tracking (P1: 3-Loss Auto-Pause lockout)
                const prevConsecutiveLosses = get().consecutiveLosses;
                const prevConsecutiveWins = get().consecutiveWins;
                const newConsecutiveLosses = isLoss ? prevConsecutiveLosses + 1 : 0;
                const newConsecutiveWins = isLoss ? 0 : prevConsecutiveWins + 1;
                const updatedHistory = isLoss
                    ? [...get().consecutiveLossHistory, now].slice(-10)
                    : get().consecutiveLossHistory;

                // 2b. If we just hit 3 consecutive losses, activate a 24h soft lockout
                let streakLockoutUntil = get().streakLockoutUntil;
                let streakLockoutReason = get().streakLockoutReason;
                let streakLockoutActive = false;
                if (isLoss && newConsecutiveLosses === 3 && prevConsecutiveLosses < 3) {
                    streakLockoutUntil = now + 24 * 60 * 60 * 1000;
                    streakLockoutReason = '3-Loss Auto-Pause: 24h soft lockout. Reflect and document what went wrong before resuming.';
                    streakLockoutActive = true;
                    notificationService.sendToNervousSystem('STREAK_LOCKOUT', { count: 3, reason: streakLockoutReason });
                }

                set({
                    recentLosses: updatedLosses,
                    lastTradeTimestamp: now,
                    lastLossTimestamp: isLoss ? now : get().lastLossTimestamp,
                    dailyLossTotal: newDailyLoss,
                    consecutiveLosses: newConsecutiveLosses,
                    consecutiveWins: newConsecutiveWins,
                    consecutiveLossHistory: updatedHistory,
                    streakLockoutUntil: streakLockoutActive ? streakLockoutUntil : streakLockoutUntil,
                    streakLockoutReason: streakLockoutActive ? streakLockoutReason : streakLockoutReason,
                });

                // 3. Re-evaluate Breakers
                get().checkBreakers();
            },

            recordEmotionalRisk: (score, reason) => {
                if (score >= 8) {
                    const now = Date.now();
                    const duration = get().thresholds.highStressCooldown * 60 * 1000;
                    const alertReason = `Emotional Guardrail: ${reason}. Taking a ${get().thresholds.highStressCooldown}m breather.`;
                    set({
                        activeBreaker: 'cooldown',
                        breakerExpiry: now + duration,
                        breakerReason: alertReason
                    });
                    notificationService.sendToNervousSystem('EMOTIONAL_ALERT', { score, reason: alertReason });
                }
            },

            checkBreakers: () => {
                const now = Date.now();
                const { thresholds, recentLosses, dailyLossTotal, activeBreaker } = get();

                // Hard Lockout: Daily Loss Limit
                if (dailyLossTotal >= thresholds.maxDailyLoss) {
                    const reason = `Critical Loss Limit Reached ($${dailyLossTotal}). Trading disabled for the session.`;
                    set({
                        activeBreaker: 'lockout',
                        breakerExpiry: null, // Indefinite until reset
                        breakerReason: reason
                    });
                    notificationService.sendToNervousSystem('CIRCUIT_BREAKER', { type: 'lockout', reason });
                    return;
                }

                // Cooldown: Velocity Breaker (3 losses in 30 mins)
                if (recentLosses.length >= thresholds.maxLossVelocity) {
                    const reason = `${thresholds.maxLossVelocity} losses in 30 minutes. Velocity Breaker active.`;
                    set({
                        activeBreaker: 'cooldown',
                        breakerExpiry: now + (15 * 60 * 1000), // 15 min cooldown
                        breakerReason: reason
                    });
                    notificationService.sendToNervousSystem('CIRCUIT_BREAKER', { type: 'cooldown', reason });
                    return;
                }

                // Check for expired breakers
                const { breakerExpiry } = get();
                if (activeBreaker !== 'lockout' && breakerExpiry && now > breakerExpiry) {
                    set({ activeBreaker: 'none', breakerExpiry: null, breakerReason: null });
                }
            },

            clearBreaker: () => set({
                activeBreaker: 'none',
                breakerExpiry: null,
                breakerReason: null,
                recentLosses: [],
                dailyLossTotal: 0 // Reset daily loss on manual clear
            }),

            /**
             * Clear the 24h 3-Loss Auto-Pause lockout. This is intentionally a
             * SEPARATE action from `clearBreaker` so that an emergency override
             * of one breaker doesn't accidentally wipe a discipline lockout.
             */
            clearStreakLockout: () => set({
                streakLockoutUntil: null,
                streakLockoutReason: null,
            }),

            emergencyOverride: () => {
                // This will be called after a countdown in the UI
                set({ activeBreaker: 'none', breakerExpiry: null, breakerReason: null });
            }
        }),
        {
            name: 'wealth-guardrail-storage',
        }
    )
);
