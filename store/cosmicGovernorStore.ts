
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSettingsStore } from './settingsStore';

export interface CosmicGovernorState {
    // Current State
    dailyTradeCount: number;
    dailyFees: number;
    tiltScore: number; // 0-100
    isCircuitBreakerActive: boolean;
    blockReason: string | null;
    lastTradeTimestamp: number | null;
    
    // Cooldown State
    cooldownEndsAt: number | null;
    isCooldownActive: boolean;

    // Actions
    incrementTradeCount: (fees?: number) => void;
    updateFees: (fees: number) => void;
    addTilt: (amount: number) => void;
    updateTiltScore: (score: number) => void;
    setCircuitBreaker: (active: boolean, reason?: string | null) => void;
    checkCircuitBreaker: () => void;
    resetDailyStats: () => void;
    startCooldown: (minutes: number) => void;
    checkCooldown: () => boolean;
}

export const useCosmicGovernorStore = create<CosmicGovernorState>()(
    persist(
        (set, get) => ({
            dailyTradeCount: 0,
            dailyFees: 0,
            tiltScore: 0,
            isCircuitBreakerActive: false,
            blockReason: null,
            lastTradeTimestamp: null,
            cooldownEndsAt: null,
            isCooldownActive: false,

            incrementTradeCount: (fees = 20) => {
                const newCount = get().dailyTradeCount + 1;
                const newFees = get().dailyFees + fees;
                set({ 
                    dailyTradeCount: newCount, 
                    dailyFees: newFees,
                    lastTradeTimestamp: Date.now()
                });
                get().checkCircuitBreaker();
            },

            updateFees: (fees) => {
                set({ dailyFees: get().dailyFees + fees });
                get().checkCircuitBreaker();
            },

            addTilt: (amount) => {
                const newScore = Math.min(100, get().tiltScore + amount);
                set({ tiltScore: newScore });
                get().checkCircuitBreaker();
            },

            updateTiltScore: (score) => {
                set({ tiltScore: score });
                get().checkCircuitBreaker();
            },

            setCircuitBreaker: (active, reason = null) => {
                set({ isCircuitBreakerActive: active, blockReason: reason });
            },

            checkCircuitBreaker: () => {
                const state = get();
                const { astroProfile } = useSettingsStore.getState();
                
                // Determine current day context
                const today = new Date();
                const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
                
                // Law 3: Dynamic Limits (Tuesday = 5, Mars Mudda = 3)
                let maxTrades = astroProfile.baseMaxTrades;
                let maxFees = astroProfile.baseMaxFees;

                if (dayName === 'Tuesday') {
                    maxTrades = astroProfile.tuesdayMaxTrades;
                }

                // If in Mars Mudda (simulated by checking phase string for now)
                if (astroProfile.currentLifePhase?.includes('Mars-Mudda')) {
                    maxTrades = Math.min(maxTrades, astroProfile.marsMuddaMaxTrades);
                    maxFees = Math.min(maxFees, astroProfile.marsRahuMuddaMaxFees);
                }

                if (state.dailyTradeCount >= maxTrades) {
                    const reason = dayName === 'Tuesday' 
                        ? `Tuesday Law: Limit is ${maxTrades} trades. Stop now.` 
                        : `Daily trade limit (${maxTrades}) reached. Saturn demands rest.`;
                    set({ isCircuitBreakerActive: true, blockReason: reason });
                    return;
                }

                if (state.dailyFees >= maxFees) {
                    set({ isCircuitBreakerActive: true, blockReason: `Daily fee burn (${state.dailyFees}) too high. Rahu is draining you.` });
                    return;
                }

                const TILT_THRESHOLD = 70;
                if (state.tiltScore >= TILT_THRESHOLD) {
                    set({ isCircuitBreakerActive: true, blockReason: 'Extreme Tilt detected. Cognitive functions compromised.' });
                    return;
                }

                // If none of the above, check cooldown
                if (get().checkCooldown()) {
                    set({ isCircuitBreakerActive: true, blockReason: 'Cool-down protocol active. Re-center your energy.' });
                    return;
                }

                set({ isCircuitBreakerActive: false, blockReason: null });
            },

            resetDailyStats: () => {
                set({ 
                    dailyTradeCount: 0, 
                    dailyFees: 0, 
                    tiltScore: 0, 
                    isCircuitBreakerActive: false, 
                    blockReason: null,
                    lastTradeTimestamp: null,
                    cooldownEndsAt: null,
                    isCooldownActive: false
                });
            },

            startCooldown: (minutes) => {
                const endsAt = Date.now() + minutes * 60 * 1000;
                set({ cooldownEndsAt: endsAt, isCooldownActive: true });
                get().checkCircuitBreaker();
            },

            checkCooldown: () => {
                const endsAt = get().cooldownEndsAt;
                if (!endsAt) return false;
                if (Date.now() > endsAt) {
                    set({ isCooldownActive: false, cooldownEndsAt: null });
                    return false;
                }
                return true;
            }
        }),
        {
            name: 'cosmic-governor-state',
        }
    )
);
