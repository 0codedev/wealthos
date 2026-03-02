
import { db, Trade } from '../database';
import { useCosmicGovernorStore } from '../store/cosmicGovernorStore';
import { useSettingsStore } from '../store/settingsStore';
import { AstroPsychologyService } from './AstroPsychologyService';

export const CosmicTradeGovernor = {
    /**
     * Synchronizes the governor store with today's actual journal data.
     * This handles the "missed sync" issue by recalculating from the DB.
     */
    async syncWithDatabase() {
        const today = new Date().toISOString().split('T')[0];
        const store = useCosmicGovernorStore.getState();
        
        try {
            const todayTrades = await db.trades
                .where('date')
                .startsWith(today)
                .toArray();

            const count = todayTrades.length;
            const fees = todayTrades.reduce((sum, t) => sum + (t.fees || 0), 0);
            
            // Calculate session tilt based on last 5 trades
            const recentTrades = todayTrades.slice(-5);
            let tiltScore = 0;
            if (recentTrades.length > 0) {
                const emotionalStates = ['Anxious', 'Revenge', 'Greedy', 'Panic', 'Regret', 'Euphoric'];
                const tiltTrades = recentTrades.filter(t => 
                    emotionalStates.includes(t.moodEntry || '') || 
                    emotionalStates.includes(t.moodExit || '')
                );
                tiltScore = (tiltTrades.length / recentTrades.length) * 100;
            }

            // Update store
            useCosmicGovernorStore.setState({
                dailyTradeCount: count,
                dailyFees: fees,
                tiltScore: Math.round(tiltScore)
            });

            // Re-run the circuit breaker logic
            store.checkCircuitBreaker();
            
        } catch (error) {
            console.error('[CosmicTradeGovernor] Sync failed:', error);
        }
    },

    /**
     * Analyzes if the user is showing "Compulsive Behavior" patterns.
     * e.g. clicking Execution Desk repeatedly without trading.
     */
    lastClickTime: 0,
    rapidClickCount: 0,

    detectCompulsion(deskClickCount: number) {
        const now = Date.now();
        const store = useCosmicGovernorStore.getState();
        
        // Detect rapid-fire opening of execution desk (impulsivity)
        if (now - this.lastClickTime < 60000) { // Within 1 minute
            this.rapidClickCount++;
        } else {
            this.rapidClickCount = 0;
        }
        
        this.lastClickTime = now;

        if (this.rapidClickCount > 4) {
            store.addTilt(25);
            store.setCircuitBreaker(true, 'Behavioral Pattern: High Impulsivity Detected. "Rahu Speed" opening desk too often.');
            return true;
        }

        // Global session clicks
        if (deskClickCount > 20) {
            store.setCircuitBreaker(true, 'Session Fatigue: You have opened the execution desk 20+ times. Saturn demands rest.');
            return true;
        }
        
        return false;
    },

    /**
     * Forces an immediate check of all limits.
     */
    checkAndLock() {
        const store = useCosmicGovernorStore.getState();
        store.checkCircuitBreaker();
    },

    /**
     * Applies Astro-Sensitivity: During Rahu dominant periods,
     * the Tilt Threshold is lowered significantly.
     */
    async updateSensitivity() {
        const astro = await AstroPsychologyService.getTodayAstroStats();
        const store = useCosmicGovernorStore.getState();
        
        if (astro.isInsideShadow || astro.rahuIntensity > 70) {
            // Rahu is active - lower the threshold for circuit breaker
            if (store.tiltScore > 50 && !store.isCircuitBreakerActive) { 
                store.setCircuitBreaker(true, 'Astro-Psych Alert: Rahu intensity is high. Your current tilt score (50%+) is dangerous in this window.');
            }
        }
    }
};
