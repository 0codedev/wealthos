/**
 * MoodPerformanceAnalyzer.ts
 * Analyzes psychological state vs trade performance (win rates and avg PnL per mood label).
 */

import type { Trade } from '../../database';

export interface MoodStat {
  mood: string;
  tradeCount: number;
  winRate: number;
  avgPnl: number;
  recommendation?: string;
}

export class MoodPerformanceAnalyzer {
  public static analyze(trades: Trade[]): MoodStat[] {
    const moodMap = new Map<string, { count: number; wins: number; totalPnl: number }>();

    for (const trade of trades) {
      const mood = trade.moodEntry || 'Neutral';
      const pnl = trade.pnl ?? (trade.exitPrice - trade.entryPrice) * trade.quantity;
      const isWin = pnl > 0;

      const current = moodMap.get(mood) ?? { count: 0, wins: 0, totalPnl: 0 };
      current.count++;
      current.totalPnl += pnl;
      if (isWin) current.wins++;
      moodMap.set(mood, current);
    }

    const results: MoodStat[] = [];
    for (const [mood, data] of moodMap.entries()) {
      const winRate = data.count > 0 ? data.wins / data.count : 0;
      const avgPnl = data.count > 0 ? data.totalPnl / data.count : 0;

      let recommendation: string | undefined;
      if (winRate < 0.4 && data.count >= 3) {
        recommendation = `Trades entered when feeling ${mood} perform poorly (${(winRate * 100).toFixed(0)}% win rate). Consider pausing.`;
      } else if (winRate >= 0.65 && data.count >= 3) {
        recommendation = `Optimal state! ${mood} trades achieve ${(winRate * 100).toFixed(0)}% win rate.`;
      }

      results.push({
        mood,
        tradeCount: data.count,
        winRate: parseFloat(winRate.toFixed(2)),
        avgPnl: parseFloat(avgPnl.toFixed(2)),
        recommendation,
      });
    }

    return results.sort((a, b) => b.winRate - a.winRate);
  }
}
