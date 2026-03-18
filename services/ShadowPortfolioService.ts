import { db, Trade, PaperTrade } from '../database';
import { logger } from './Logger';

export interface ShadowStats {
    actualPnL: number;
    shadowPnL: number;
    gap: number;
    sizingEfficiency: number; // Percentage
}

class ShadowPortfolioService {
    private static instance: ShadowPortfolioService;
    private SHADOW_CAPITAL = 1000000; // 10 Lakh Virtual Capital
    private RISK_PER_TRADE_PERCENT = 1; // 1% Risk

    private constructor() {}

    static getInstance(): ShadowPortfolioService {
        if (!ShadowPortfolioService.instance) {
            ShadowPortfolioService.instance = new ShadowPortfolioService();
        }
        return ShadowPortfolioService.instance;
    }

    /**
     * Create a shadow trade based on a real trade attempt
     */
    async syncShadowTrade(realTrade: Trade): Promise<void> {
        try {
            // Check if shadow trade already exists for this real trade ID
            const existing = await db.paper_trades
                .where('notes')
                .equals(`SHADOW_OF_${realTrade.id}`)
                .first();

            if (existing && realTrade.exitPrice) {
                // Update exit price if real trade is closed
                await db.paper_trades.update(existing.id!, {
                    closePrice: realTrade.exitPrice,
                    status: 'CLOSED',
                    closeDate: new Date().toISOString(),
                    pnl: (realTrade.exitPrice - existing.entryPrice) * existing.quantity * (realTrade.direction === 'Long' ? 1 : -1)
                });
                return;
            }

            if (!existing && realTrade.entryPrice) {
                // Calculate Shadow Quantity based on 1% Risk
                // Assuming Stop Loss is provided, else use 2% fixed price risk
                const stopLossDist = realTrade.stopLoss 
                    ? Math.abs(realTrade.entryPrice - realTrade.stopLoss)
                    : realTrade.entryPrice * 0.02;

                const riskAmount = this.SHADOW_CAPITAL * (this.RISK_PER_TRADE_PERCENT / 100);
                const shadowQty = Math.floor(riskAmount / stopLossDist);

                const shadowTrade: PaperTrade = {
                    ticker: realTrade.ticker,
                    type: realTrade.direction.toUpperCase() as 'BUY' | 'SELL',
                    entryPrice: realTrade.entryPrice,
                    quantity: shadowQty,
                    openDate: realTrade.date || new Date().toISOString(),
                    status: 'OPEN',
                    notes: `SHADOW_OF_${realTrade.id}`
                };

                await db.paper_trades.add(shadowTrade);
                logger.info(`Shadow Trade synced for ${realTrade.ticker} with qty ${shadowQty}`);
            }
        } catch (err) {
            logger.error('Failed to sync shadow trade:', err);
        }
    }

    /**
     * Calculate comparison stats
     */
    async getComparisonStats(): Promise<ShadowStats> {
        const realTrades = await db.trades.toArray();
        const shadowTrades = await db.paper_trades
            .where('notes')
            .startsWith('SHADOW_OF_')
            .toArray();

        let actualPnL = 0;
        realTrades.forEach(t => {
            if (t.pnl) actualPnL += t.pnl;
        });

        let shadowPnL = 0;
        shadowTrades.forEach(st => {
            if (st.pnl) shadowPnL += st.pnl;
        });

        const gap = actualPnL - shadowPnL;
        const sizingEfficiency = shadowPnL !== 0 
            ? (actualPnL / Math.abs(shadowPnL)) * 100 
            : 100;

        return {
            actualPnL,
            shadowPnL,
            gap,
            sizingEfficiency
        };
    }
}

export const shadowPortfolioService = ShadowPortfolioService.getInstance();
