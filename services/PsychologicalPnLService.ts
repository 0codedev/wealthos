import { Investment } from '../types';
import { db, calculatePnL } from '../database';
import { logger } from './Logger';

export interface PsychologicalStats {
    actualPnL: number;
    behavioralTax: number;
    psychologicalPnL: number;
    efficiencyScore: number; // 0-100 (Actual / Potential)
    topMistakeType: string;
    mistakeCount: number;
    winRate: number;
    avgRR: number;
    totalTrades: number;
    trades: any[];
    psychologyPrediction?: import('./ml/PsychologyPredictor').PsychologyPrediction;
}

class PsychologicalPnLService {
    private static instance: PsychologicalPnLService;

    private constructor() {}

    static getInstance(): PsychologicalPnLService {
        if (!PsychologicalPnLService.instance) {
            PsychologicalPnLService.instance = new PsychologicalPnLService();
        }
        return PsychologicalPnLService.instance;
    }

    /**
     * Calculate stats directly from the database
     */
    async calculateFromDb(): Promise<PsychologicalStats> {
        try {
            const trades = await db.trades.toArray();
            const investments = await db.investments.toArray();
            
            let actualPnL = 0;
            let behavioralTax = 0;
            let mistakeCount = 0;
            const mistakeImpacts: Record<string, number> = {};
            let wins = 0;
            let rrSum = 0;
            let rrCount = 0;

            // 1. Process Journaled Trades
            trades.forEach(t => {
                const pnl = calculatePnL(t);
                actualPnL += pnl;
                if (pnl > 0) wins++;
                if (t.riskRewardRatio && t.riskRewardRatio > 0) {
                    rrSum += t.riskRewardRatio;
                    rrCount++;
                }

                if (t.mistakes && t.mistakes.length > 0 && pnl < 0) {
                    const tax = Math.abs(pnl);
                    behavioralTax += tax;
                    mistakeCount++;
                    
                    t.mistakes.forEach(m => {
                        mistakeImpacts[m] = (mistakeImpacts[m] || 0) + tax;
                    });
                }
            });

            // 2. Process General Investments (fall back)
            investments.forEach(inv => {
                // If it's a trading asset and has mistake tags
                const pnl = inv.currentValue - inv.investedAmount;
                const hasMistakeTag = inv.tags?.some(tag => 
                    ['FOMO', 'REVENGE', 'MISTAKE', 'EMOTIONAL'].includes(tag.toUpperCase())
                );

                if (hasMistakeTag && pnl < 0) {
                    const tax = Math.abs(pnl);
                    behavioralTax += tax;
                    mistakeCount++;
                }
            });

            const psychologicalPnL = actualPnL + behavioralTax;
            const efficiencyScore = psychologicalPnL > 0 
                ? Math.max(0, Math.min(100, (actualPnL / psychologicalPnL) * 100))
                : 100;

            let topMistakeType = 'None';
            let maxTax = 0;
            Object.entries(mistakeImpacts).forEach(([type, tax]) => {
                if (tax > maxTax) {
                    maxTax = tax;
                    topMistakeType = type;
                }
            });

            const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
            const avgRR = rrCount > 0 ? rrSum / rrCount : 0;
            let psychologyPrediction = undefined;
            try {
              const { psychologyPredictor } = await import('./ml/PsychologyPredictor');
              // Compute loss streak from recent trades
              let lossStreak = 0;
              for (let i = trades.length - 1; i >= 0; i--) {
                const p = calculatePnL(trades[i]);
                if (p < 0) lossStreak++;
                else break;
              }
              psychologyPrediction = psychologyPredictor.predict({
                recentLossStreak: lossStreak,
                fomoLevel: 5,
                stressLevel: 5,
                tiltScore: Math.min(100, lossStreak * 25),
                timeSinceLastTradeMin: 30,
                sessionPnlPct: actualPnL / 100000,
                winRate7d: winRate / 100,
                sleepHours: 7,
                forcedTrade: 0,
              });
            } catch {
              /* swallow */
            }
            const totalTrades = trades.length;

            return {
                actualPnL,
                behavioralTax,
                psychologicalPnL,
                efficiencyScore,
                topMistakeType,
                mistakeCount,
                winRate,
                avgRR,
                totalTrades,
                trades,
                psychologyPrediction,
            };
        } catch (err) {
            logger.error('Failed to calculate Psychological PnL:', err);
            return {
                actualPnL: 0,
                behavioralTax: 0,
                psychologicalPnL: 0,
                efficiencyScore: 100,
                topMistakeType: 'None',
                mistakeCount: 0,
                winRate: 0,
                avgRR: 0,
                totalTrades: 0,
                trades: []
            };
        }
    }
}


export const psychologicalPnLService = PsychologicalPnLService.getInstance();
