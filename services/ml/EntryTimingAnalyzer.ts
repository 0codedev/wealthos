/**
 * EntryTimingAnalyzer.ts
 * Bins trade entry times into 15-minute intra-session windows (09:15 to 15:30 IST)
 * and calculates win rates and average PnL to identify optimal entry time windows.
 */

import type { Trade } from '../../database';

export interface TimingWindowSlot {
  timeSlot: string; // e.g. "09:15-09:30"
  tradeCount: number;
  winRate: number;   // 0..1
  avgPnl: number;
  isOptimal: boolean;
}

export class EntryTimingAnalyzer {
  public static analyze(trades: Trade[]): TimingWindowSlot[] {
    const slotsMap = new Map<string, { totalPnl: number; wins: number; count: number }>();

    for (const trade of trades) {
      const entryTime = (trade as any).entryTime || this.extractTimeFromDate(trade.date);
      if (!entryTime) continue;

      const slotKey = this.getTimeSlotKey(entryTime);
      if (!slotKey) continue;

      const pnl = trade.pnl ?? (trade.exitPrice - trade.entryPrice) * trade.quantity;
      const isWin = pnl > 0;

      const current = slotsMap.get(slotKey) ?? { totalPnl: 0, wins: 0, count: 0 };
      current.count++;
      current.totalPnl += pnl;
      if (isWin) current.wins++;
      slotsMap.set(slotKey, current);
    }

    const results: TimingWindowSlot[] = [];
    for (const [timeSlot, data] of slotsMap.entries()) {
      const winRate = data.count > 0 ? data.wins / data.count : 0;
      const avgPnl = data.count > 0 ? data.totalPnl / data.count : 0;

      results.push({
        timeSlot,
        tradeCount: data.count,
        winRate: parseFloat(winRate.toFixed(2)),
        avgPnl: parseFloat(avgPnl.toFixed(2)),
        isOptimal: winRate >= 0.6 && avgPnl > 0 && data.count >= 2,
      });
    }

    // Sort chronologically by timeSlot
    return results.sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
  }

  private static getTimeSlotKey(timeStr: string): string | null {
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;

    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);

    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;

    const bucketMinute = Math.floor(minute / 15) * 15;
    const startStr = `${hour.toString().padStart(2, '0')}:${bucketMinute.toString().padStart(2, '0')}`;

    let endHour = hour;
    let endMin = bucketMinute + 15;
    if (endMin >= 60) {
      endMin = 0;
      endHour = (hour + 1) % 24;
    }
    const endStr = `${endHour.toString().padStart(2, '0')}:${endMin.toString().padStart(2, '0')}`;

    return `${startStr}-${endStr}`;
  }

  private static extractTimeFromDate(dateIso: string): string | null {
    if (!dateIso || !dateIso.includes('T')) return null;
    const timePart = dateIso.split('T')[1];
    return timePart ? timePart.substring(0, 5) : null;
  }
}
