import { db, calculatePnL, Trade } from '../database';
import { logger } from './Logger';

export interface BacktestRule {
    id: string;
    name: string;
    description: string;
    filter: (trade: Trade) => boolean;
}

export interface BacktestResult {
    ruleName: string;
    originalPnL: number;
    simulatedPnL: number;
    difference: number;
    tradesRemoved: number;
    successRateChange: number;
    verdict: 'ADOPT' | 'REJECT' | 'NEUTRAL';
    fitResult?: import('./ml/BacktestFitDetector').BacktestFitResult;
}

class BacktestingService {
    private static instance: BacktestingService;

    private constructor() {}

    static getInstance(): BacktestingService {
        if (!BacktestingService.instance) {
            BacktestingService.instance = new BacktestingService();
        }
        return BacktestingService.instance;
    }

    /**
     * Run a backtest scenario against historical trades
     */
    async runBacktest(rule: BacktestRule): Promise<BacktestResult> {
        try {
            const allTrades = await db.trades.toArray();
            let originalPnL = 0;
            let simulatedPnL = 0;
            let originalWins = 0;
            let simulatedWins = 0;
            let removedCount = 0;
            const simulatedReturns: number[] = [];

            allTrades.forEach(t => {
                const pnl = calculatePnL(t);
                originalPnL += pnl;
                if (pnl > 0) originalWins++;

                // Apply the rule: Should we have taken this trade?
                if (rule.filter(t)) {
                    simulatedPnL += pnl;
                    if (pnl > 0) simulatedWins++;
                    simulatedReturns.push(pnl / Math.max(1000, t.entryPrice || 1000));
                } else {
                    removedCount++;
                }
            });

            const originalWinRate = allTrades.length > 0 ? (originalWins / allTrades.length) * 100 : 0;
            const simulatedCount = allTrades.length - removedCount;
            const simulatedWinRate = simulatedCount > 0 ? (simulatedWins / simulatedCount) * 100 : 0;

            const difference = simulatedPnL - originalPnL;
            let verdict: 'ADOPT' | 'REJECT' | 'NEUTRAL' = 'NEUTRAL';
            
            if (difference > (Math.abs(originalPnL) * 0.1)) verdict = 'ADOPT';
            else if (difference < -(Math.abs(originalPnL) * 0.1)) verdict = 'REJECT';

            const { BacktestFitDetector } = await import('./ml/BacktestFitDetector');
            const fitResult = BacktestFitDetector.test(simulatedReturns);

            return {
                ruleName: rule.name,
                originalPnL,
                simulatedPnL,
                difference,
                tradesRemoved: removedCount,
                successRateChange: simulatedWinRate - originalWinRate,
                verdict,
                fitResult,
            };
        } catch (err) {
            logger.error('Backtest failed:', err);
            throw err;
        }
    }

    /**
     * Preset Rules for quick backtesting
     */
    getPresetRules(): BacktestRule[] {
        return [
            {
                id: 'no_late_trading',
                name: 'No Trades After 2:30 PM',
                description: 'Filters out trades placed in the final hour of the market.',
                filter: (t) => {
                    if (!t.entryTime) return true;
                    const [hours, minutes] = t.entryTime.split(':').map(Number);
                    return hours < 14 || (hours === 14 && minutes < 30);
                }
            },
            {
                id: 'nifty_only',
                name: 'NIFTY Only Strategy',
                description: 'What if you ignored all other tickers and only traded NIFTY?',
                filter: (t) => t.ticker.toUpperCase().includes('NIFTY') && !t.ticker.toUpperCase().includes('BANK')
            },
            {
                id: 'no_revenge',
                name: 'Eliminate Revenge Trades',
                description: 'Filters out all trades tagged with the "Revenge" mistake.',
                filter: (t) => !t.mistakes?.includes('Revenge Trade')
            }
        ];
    }
}

export const backtestingService = BacktestingService.getInstance();
