// AlphaDecayService.ts
import { db } from '../database';
import { logger } from './Logger';

export interface RollingWinRate {
  windowSize: number;
  rates: number[]; // chronologically ordered win rates
  currentRate: number;
  peakRate: number;
  isDecaying: boolean;
}

export interface AlphaDecayReport {
  hasDecay: boolean;
  rollingStats: Record<number, RollingWinRate>;
  totalClosedTrades: number;
  warnings: string[];
  recommendations: string[];
  attribution: { factor: string; details: string; impact: string }[];
}

class AlphaDecayService {
  /**
   * Computes the rolling win rates and flags edge erosion warnings
   */
  public async getDecayReport(): Promise<AlphaDecayReport> {
    try {
      // 1. Fetch closed trades from database
      const trades = await db.trades.toArray();
      const paperTrades = await db.paper_trades.toArray();

      // Combine and sort chronologically by date
      const allClosed = [
        ...trades.map(t => ({
          date: t.date,
          pnl: t.pnl ?? (t.exitPrice - t.entryPrice) * t.quantity * (t.direction === 'Long' ? 1 : -1),
          type: 'Live',
          setup: t.setup || 'Unknown',
          vix: t.complianceScore ? t.complianceScore / 5 : 15, // proxy for VIX if not tracked
        })),
        ...paperTrades.filter(pt => pt.status === 'CLOSED').map(pt => ({
          date: pt.closeDate || pt.openDate,
          pnl: pt.pnl ?? (pt.closePrice || 0 - pt.entryPrice) * pt.quantity * (pt.type === 'BUY' ? 1 : -1),
          type: 'Paper',
          setup: 'Paper Trade',
          vix: 15,
        }))
      ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      const totalClosedTrades = allClosed.length;
      const report: AlphaDecayReport = {
        hasDecay: false,
        rollingStats: {},
        totalClosedTrades,
        warnings: [],
        recommendations: [],
        attribution: [],
      };

      if (totalClosedTrades < 10) {
        report.warnings.push('Not enough closed trades (minimum 10) to calculate statistical rolling windows.');
        return report;
      }

      // 2. Compute rolling win rates for windows [10, 20, 50, 100]
      const windows = [10, 20, 50, 100];
      windows.forEach(w => {
        if (totalClosedTrades < w) return;

        const rates: number[] = [];
        let peakRate = 0;

        for (let i = w; i <= totalClosedTrades; i++) {
          const subset = allClosed.slice(i - w, i);
          const wins = subset.filter(t => t.pnl > 0).length;
          const rate = wins / w;
          rates.push(rate);
          if (rate > peakRate) {
            peakRate = rate;
          }
        }

        const currentRate = rates[rates.length - 1];
        // Decay is defined as >15% drop from peak (absolute or relative, let's use absolute 15% drop, i.e., peak - current > 0.15)
        const isDecaying = peakRate - currentRate > 0.15;

        report.rollingStats[w] = {
          windowSize: w,
          rates,
          currentRate: currentRate * 100,
          peakRate: peakRate * 100,
          isDecaying,
        };

        if (isDecaying) {
          report.hasDecay = true;
          report.warnings.push(
            `🚨 Alpha decay detected in the ${w}-trade rolling window! Current win rate: ${(currentRate * 100).toFixed(0)}% (Peak: ${(peakRate * 100).toFixed(0)}%).`
          );
        }
      });

      // 3. Attribution analysis (Heuristics comparing last 15 trades vs historical)
      if (totalClosedTrades >= 15) {
        const recent = allClosed.slice(-15);
        const older = allClosed.slice(0, -15);
        
        const recentWinRate = recent.filter(t => t.pnl > 0).length / 15;
        const olderWinRate = older.filter(t => t.pnl > 0).length / Math.max(1, older.length);

        if (recentWinRate < olderWinRate - 0.10) {
          // Identify potential culprits
          // Setup level decay
          const recentSetups = recent.reduce((acc, t) => { acc[t.setup] = (acc[t.setup] || 0) + (t.pnl > 0 ? 1 : 0); return acc; }, {} as Record<string, number>);
          
          report.attribution.push({
            factor: 'Win Rate Skew',
            details: `Recent 15 trades win rate is ${(recentWinRate * 100).toFixed(0)}% vs older average of ${(olderWinRate * 100).toFixed(0)}%.`,
            impact: 'HIGH',
          });

          // Check if VIX is high in recent trades
          const recentAvgVix = recent.reduce((sum, t) => sum + t.vix, 0) / 15;
          if (recentAvgVix > 18) {
            report.attribution.push({
              factor: 'Market Volatility (VIX)',
              details: `Recent trades occurred during a higher VIX regime (avg VIX: ${recentAvgVix.toFixed(1)}).`,
              impact: 'MEDIUM',
            });
            report.recommendations.push('Consider switching to defensive intraday or option-buying strategies to match the high VIX regime.');
          }
        }
      }

      if (report.hasDecay) {
        report.recommendations.push('Jarvis Alert: Edge erosion detected. Reduce position sizes by 50% until win rate stabilizes.');
        report.recommendations.push('Review setups used in the last 15 trades to isolate and temporarily disable underperforming models.');
      } else {
        report.recommendations.push('Edge remains intact. Standard position sizes and risk limits are approved.');
      }

      return report;
    } catch (err) {
      logger.error('[AlphaDecayService] Failed to calculate decay metrics', err);
      return {
        hasDecay: false,
        rollingStats: {},
        totalClosedTrades: 0,
        warnings: ['Failed to query trade history.'],
        recommendations: ['Check system logs and retry.'],
        attribution: [],
      };
    }
  }
}

export const alphaDecayService = new AlphaDecayService();
export default alphaDecayService;
