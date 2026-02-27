import { db } from '../database';
import { useSettingsStore } from '../store/settingsStore';

export interface AstroStats {
    todayTradeCount: number;
    todayFees: number;
    rahuIntensity: number; // 0-100
    saturnStrength: number; // 0-100
    isInsideShadow: boolean;
}

export const AstroPsychologyService = {
    /**
     * Get trading stats for today to analyze planetary influence
     */
    async getTodayAstroStats(): Promise<AstroStats> {
        const today = new Date().toISOString().split('T')[0];
        const { astroProfile } = useSettingsStore.getState();
        
        try {
            const todayTrades = await db.trades
                .where('date')
                .startsWith(today)
                .toArray();

            const count = todayTrades.length;
            const fees = todayTrades.reduce((sum, t) => sum + (t.fees || 0), 0);
            
            // Calculate Rahu Intensity (Impulsivity)
            // Higher trade count + higher fees + short holding times = High Rahu
            const countFactor = Math.min(count / (astroProfile.maxTradesPerDay * 2), 1) * 60;
            const feeFactor = Math.min(fees / 1000, 1) * 40;
            const rahuIntensity = countFactor + feeFactor;

            // Calculate Saturn Strength (Discipline)
            // Low mistakes + high compliance scores = High Saturn
            const complianceAvg = todayTrades.length > 0 
                ? todayTrades.reduce((sum, t) => sum + (t.complianceScore || 0), 0) / count 
                : 100;
            const saturnStrength = Math.max(complianceAvg, 0);

            return {
                todayTradeCount: count,
                todayFees: fees,
                rahuIntensity: Math.round(rahuIntensity),
                saturnStrength: Math.round(saturnStrength),
                isInsideShadow: count > astroProfile.maxTradesPerDay
            };
        } catch (error) {
            console.error('[AstroPsychologyService] Failed to fetch stats:', error);
            return {
                todayTradeCount: 0,
                todayFees: 0,
                rahuIntensity: 0,
                saturnStrength: 100,
                isInsideShadow: false
            };
        }
    }
};
