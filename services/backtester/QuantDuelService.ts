import { db, ForwardDuel } from '../../database';
import { YahooHistoricalService } from './YahooHistoricalService';

export interface DuelScorecard {
  userWinRate: number;
  systemWinRate: number;
  userTotalPnL: number;
  systemTotalPnL: number;
  userTrades: number;
  systemTrades: number;
  leader: 'USER' | 'SYSTEM' | 'TIE';
}

export class QuantDuelService {
  private static instance: QuantDuelService;

  private constructor() {}

  static getInstance(): QuantDuelService {
    if (!QuantDuelService.instance) {
      QuantDuelService.instance = new QuantDuelService();
    }
    return QuantDuelService.instance;
  }

  /**
   * Helper to get date string in YYYY-MM-DD format based on local time
   */
  getTodayDateStr(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Calculates PnL using the proportional R-multiple option model.
   * Capped at +40% (2R target hit) and -20% (1R stop hit).
   */
  calculateDuelPnL(entry: number, exit: number, stop: number, target: number): number {
    const isLong = target > entry;
    if (isLong) {
      if (exit >= target) return 40;
      if (exit <= stop) return -20;
      const risk = entry - stop;
      if (risk <= 0) return 0;
      const pnl = ((exit - entry) / risk) * 20;
      return Math.max(-20, Math.min(40, parseFloat(pnl.toFixed(2))));
    } else {
      if (exit <= target) return 40;
      if (exit >= stop) return -20;
      const risk = stop - entry;
      if (risk <= 0) return 0;
      const pnl = ((entry - exit) / risk) * 20;
      return Math.max(-20, Math.min(40, parseFloat(pnl.toFixed(2))));
    }
  }

  /**
   * Fetches today's active duel or returns null if none exists yet.
   */
  async getTodayDuel(): Promise<ForwardDuel | null> {
    const today = this.getTodayDateStr();
    const records = await db.forward_duels.where('date').equals(today).toArray();
    return records.length > 0 ? records[0] : null;
  }

  /**
   * Initializes today's duel.
   */
  async initializeTodayDuel(
    systemTicker: string,
    systemEntryPrice: number,
    systemStopLoss?: number,
    systemTarget?: number,
    modelRunTime: string = '09:50'
  ): Promise<ForwardDuel> {
    const today = this.getTodayDateStr();
    const existing = await this.getTodayDuel();
    if (existing) return existing;

    const newDuel: ForwardDuel = {
      date: today,
      systemTicker: systemTicker.toUpperCase(),
      systemEntryPrice,
      systemPeakPrice: systemEntryPrice,
      systemTroughPrice: systemEntryPrice,
      systemStatus: 'PENDING',
      systemPnL: 0,
      systemStopLoss,
      systemTarget,
      userTicker: '',
      userEntryPrice: 0,
      userPeakPrice: 0,
      userTroughPrice: 0,
      userStatus: 'PENDING',
      userPnL: 0,
      modelRunTime
    };

    const id = await db.forward_duels.add(newDuel);
    newDuel.id = id;
    return newDuel;
  }

  /**
   * Locks the user's manual selection for today's duel.
   */
  async lockUserSelection(
    ticker: string,
    entryPrice: number,
    userStopLoss?: number,
    userTarget?: number
  ): Promise<ForwardDuel> {
    const today = this.getTodayDateStr();
    let duel = await this.getTodayDuel();

    if (!duel) {
      // If system hasn't initialized yet, initialize with default system stock
      const defaultStop = entryPrice * 0.992;
      const defaultTarget = entryPrice * 1.015;
      duel = await this.initializeTodayDuel('RELIANCE', entryPrice, defaultStop, defaultTarget, '09:50');
    }

    duel.userTicker = ticker.toUpperCase();
    duel.userEntryPrice = entryPrice;
    duel.userPeakPrice = entryPrice;
    duel.userTroughPrice = entryPrice;
    duel.userStatus = 'PENDING';
    duel.userPnL = 0;
    duel.userStopLoss = userStopLoss;
    duel.userTarget = userTarget;

    await db.forward_duels.put(duel);
    return duel;
  }

  /**
   * Updates today's duel with current live prices.
   */
  async updateLivePrices(systemPrice: number, userPrice: number): Promise<ForwardDuel | null> {
    const duel = await this.getTodayDuel();
    if (!duel) return null;

    // 1. Update System Pick
    if (duel.systemStatus === 'PENDING' && systemPrice > 0) {
      if (systemPrice > duel.systemPeakPrice) duel.systemPeakPrice = systemPrice;
      if (systemPrice < duel.systemTroughPrice) duel.systemTroughPrice = systemPrice;

      const targetPrice = duel.systemTarget || parseFloat((duel.systemEntryPrice * 1.015).toFixed(2));
      const stopPrice = duel.systemStopLoss || parseFloat((duel.systemEntryPrice * 0.992).toFixed(2));

      const isLong = targetPrice > duel.systemEntryPrice;
      if (isLong) {
        if (systemPrice >= targetPrice) {
          duel.systemStatus = 'TARGET_HIT';
          duel.systemExitPrice = targetPrice;
          duel.systemPnL = 40;
        } else if (systemPrice <= stopPrice) {
          duel.systemStatus = 'STOP_HIT';
          duel.systemExitPrice = stopPrice;
          duel.systemPnL = -20;
        }
      } else {
        if (systemPrice <= targetPrice) {
          duel.systemStatus = 'TARGET_HIT';
          duel.systemExitPrice = targetPrice;
          duel.systemPnL = 40;
        } else if (systemPrice >= stopPrice) {
          duel.systemStatus = 'STOP_HIT';
          duel.systemExitPrice = stopPrice;
          duel.systemPnL = -20;
        }
      }
    }

    // 2. Update User Pick
    if (duel.userTicker && duel.userStatus === 'PENDING' && userPrice > 0) {
      if (userPrice > duel.userPeakPrice) duel.userPeakPrice = userPrice;
      if (userPrice < duel.userTroughPrice) duel.userTroughPrice = userPrice;

      const targetPrice = duel.userTarget || parseFloat((duel.userEntryPrice * 1.015).toFixed(2));
      const stopPrice = duel.userStopLoss || parseFloat((duel.userEntryPrice * 0.992).toFixed(2));

      const isLong = targetPrice > duel.userEntryPrice;
      if (isLong) {
        if (userPrice >= targetPrice) {
          duel.userStatus = 'TARGET_HIT';
          duel.userExitPrice = targetPrice;
          duel.userPnL = 40;
        } else if (userPrice <= stopPrice) {
          duel.userStatus = 'STOP_HIT';
          duel.userExitPrice = stopPrice;
          duel.userPnL = -20;
        }
      } else {
        if (userPrice <= targetPrice) {
          duel.userStatus = 'TARGET_HIT';
          duel.userExitPrice = targetPrice;
          duel.userPnL = 40;
        } else if (userPrice >= stopPrice) {
          duel.userStatus = 'STOP_HIT';
          duel.userExitPrice = stopPrice;
          duel.userPnL = -20;
        }
      }
    }

    await db.forward_duels.put(duel);
    return duel;
  }

  /**
   * Resolves a pending stock's outcome using manually entered day high/low.
   */
  async resolveDuelManually(
    systemHigh: number,
    systemLow: number,
    systemClose: number,
    userHigh: number,
    userLow: number,
    userClose: number
  ): Promise<ForwardDuel | null> {
    const duel = await this.getTodayDuel();
    if (!duel) return null;

    const sysTargetVal = duel.systemTarget || parseFloat((duel.systemEntryPrice * 1.015).toFixed(2));
    const sysStopVal = duel.systemStopLoss || parseFloat((duel.systemEntryPrice * 0.992).toFixed(2));

    // Resolve System
    if (duel.systemStatus === 'PENDING') {
      duel.systemPeakPrice = systemHigh;
      duel.systemTroughPrice = systemLow;

      const isLong = sysTargetVal > duel.systemEntryPrice;
      if (isLong) {
        if (systemLow <= sysStopVal) {
          duel.systemStatus = 'STOP_HIT';
          duel.systemExitPrice = sysStopVal;
          duel.systemPnL = -20;
        } else if (systemHigh >= sysTargetVal) {
          duel.systemStatus = 'TARGET_HIT';
          duel.systemExitPrice = sysTargetVal;
          duel.systemPnL = 40;
        } else {
          duel.systemStatus = 'EOD_EXIT';
          duel.systemExitPrice = systemClose;
          duel.systemPnL = this.calculateDuelPnL(duel.systemEntryPrice, systemClose, sysStopVal, sysTargetVal);
        }
      } else {
        if (systemHigh >= sysStopVal) {
          duel.systemStatus = 'STOP_HIT';
          duel.systemExitPrice = sysStopVal;
          duel.systemPnL = -20;
        } else if (systemLow <= sysTargetVal) {
          duel.systemStatus = 'TARGET_HIT';
          duel.systemExitPrice = sysTargetVal;
          duel.systemPnL = 40;
        } else {
          duel.systemStatus = 'EOD_EXIT';
          duel.systemExitPrice = systemClose;
          duel.systemPnL = this.calculateDuelPnL(duel.systemEntryPrice, systemClose, sysStopVal, sysTargetVal);
        }
      }
    }

    // Resolve User
    if (duel.userTicker && duel.userStatus === 'PENDING') {
      const usrTargetVal = duel.userTarget || parseFloat((duel.userEntryPrice * 1.015).toFixed(2));
      const usrStopVal = duel.userStopLoss || parseFloat((duel.userEntryPrice * 0.992).toFixed(2));

      duel.userPeakPrice = userHigh;
      duel.userTroughPrice = userLow;

      const isLong = usrTargetVal > duel.userEntryPrice;
      if (isLong) {
        if (userLow <= usrStopVal) {
          duel.userStatus = 'STOP_HIT';
          duel.userExitPrice = usrStopVal;
          duel.userPnL = -20;
        } else if (userHigh >= usrTargetVal) {
          duel.userStatus = 'TARGET_HIT';
          duel.userExitPrice = usrTargetVal;
          duel.userPnL = 40;
        } else {
          duel.userStatus = 'EOD_EXIT';
          duel.userExitPrice = userClose;
          duel.userPnL = this.calculateDuelPnL(duel.userEntryPrice, userClose, usrStopVal, usrTargetVal);
        }
      } else {
        if (userHigh >= usrStopVal) {
          duel.userStatus = 'STOP_HIT';
          duel.userExitPrice = usrStopVal;
          duel.userPnL = -20;
        } else if (userLow <= usrTargetVal) {
          duel.userStatus = 'TARGET_HIT';
          duel.userExitPrice = usrTargetVal;
          duel.userPnL = 40;
        } else {
          duel.userStatus = 'EOD_EXIT';
          duel.userExitPrice = userClose;
          duel.userPnL = this.calculateDuelPnL(duel.userEntryPrice, userClose, usrStopVal, usrTargetVal);
        }
      }
    }

    await db.forward_duels.put(duel);
    return duel;
  }

  /**
   * Post-Market Auto-Resolution.
   * Fetches today's intraday 5m data from Yahoo Finance to find exactly whether target or stop was hit first.
   * Scans sequentially starting from the model selection runtime.
   */
  async resolveDuelWithYahoo(): Promise<ForwardDuel | null> {
    const duel = await this.getTodayDuel();
    if (!duel) return null;

    const runTime = duel.modelRunTime || '09:50';

    // 1. Resolve System
    if (duel.systemStatus === 'PENDING') {
      const trades = await YahooHistoricalService.getSyntheticTrades(duel.systemTicker, '5m', '1d');
      if (trades && trades.length > 0) {
        const sorted = [...trades].sort((a, b) => (a.entryTime || '').localeCompare(b.entryTime || '')) as any[];
        const activeCandles = sorted.filter(t => (t.entryTime || '') >= runTime);
        const candles = activeCandles.length > 0 ? activeCandles : sorted;

        let systemStatus: 'PENDING' | 'TARGET_HIT' | 'STOP_HIT' | 'EOD_EXIT' = 'PENDING';
        let peak = duel.systemEntryPrice;
        let trough = duel.systemEntryPrice;
        let exitPrice = candles[candles.length - 1].exitPrice || duel.systemEntryPrice;

        const targetVal = duel.systemTarget || parseFloat((duel.systemEntryPrice * 1.015).toFixed(2));
        const stopVal = duel.systemStopLoss || parseFloat((duel.systemEntryPrice * 0.992).toFixed(2));
        const isLong = targetVal > duel.systemEntryPrice;

        for (const t of candles) {
          const high = t.metadata?.high || t.entryPrice || duel.systemEntryPrice;
          const low = t.metadata?.low || t.entryPrice || duel.systemEntryPrice;

          if (high > peak) peak = high;
          if (low < trough) trough = low;

          if (isLong) {
            if (low <= stopVal && systemStatus === 'PENDING') {
              systemStatus = 'STOP_HIT';
              exitPrice = stopVal;
            } else if (high >= targetVal && systemStatus === 'PENDING') {
              systemStatus = 'TARGET_HIT';
              exitPrice = targetVal;
            }
          } else {
            if (high >= stopVal && systemStatus === 'PENDING') {
              systemStatus = 'STOP_HIT';
              exitPrice = stopVal;
            } else if (low <= targetVal && systemStatus === 'PENDING') {
              systemStatus = 'TARGET_HIT';
              exitPrice = targetVal;
            }
          }
        }

        duel.systemPeakPrice = peak;
        duel.systemTroughPrice = trough;
        duel.systemExitPrice = exitPrice;
        duel.systemStatus = systemStatus === 'PENDING' ? 'EOD_EXIT' : systemStatus;
        duel.systemPnL = this.calculateDuelPnL(duel.systemEntryPrice, exitPrice, stopVal, targetVal);
      }
    }

    // 2. Resolve User
    if (duel.userTicker && duel.userStatus === 'PENDING') {
      const trades = await YahooHistoricalService.getSyntheticTrades(duel.userTicker, '5m', '1d');
      if (trades && trades.length > 0) {
        const sorted = [...trades].sort((a, b) => (a.entryTime || '').localeCompare(b.entryTime || '')) as any[];
        const activeCandles = sorted.filter(t => (t.entryTime || '') >= runTime);
        const candles = activeCandles.length > 0 ? activeCandles : sorted;

        let userStatus: 'PENDING' | 'TARGET_HIT' | 'STOP_HIT' | 'EOD_EXIT' = 'PENDING';
        let peak = duel.userEntryPrice;
        let trough = duel.userEntryPrice;
        let exitPrice = candles[candles.length - 1].exitPrice || duel.userEntryPrice;

        const targetVal = duel.userTarget || parseFloat((duel.userEntryPrice * 1.015).toFixed(2));
        const stopVal = duel.userStopLoss || parseFloat((duel.userEntryPrice * 0.992).toFixed(2));
        const isLong = targetVal > duel.userEntryPrice;

        for (const t of candles) {
          const high = t.metadata?.high || t.entryPrice || duel.userEntryPrice;
          const low = t.metadata?.low || t.entryPrice || duel.userEntryPrice;

          if (high > peak) peak = high;
          if (low < trough) trough = low;

          if (isLong) {
            if (low <= stopVal && userStatus === 'PENDING') {
              userStatus = 'STOP_HIT';
              exitPrice = stopVal;
            } else if (high >= targetVal && userStatus === 'PENDING') {
              userStatus = 'TARGET_HIT';
              exitPrice = targetVal;
            }
          } else {
            if (high >= stopVal && userStatus === 'PENDING') {
              userStatus = 'STOP_HIT';
              exitPrice = stopVal;
            } else if (low <= targetVal && userStatus === 'PENDING') {
              userStatus = 'TARGET_HIT';
              exitPrice = targetVal;
            }
          }
        }

        duel.userPeakPrice = peak;
        duel.userTroughPrice = trough;
        duel.userExitPrice = exitPrice;
        duel.userStatus = userStatus === 'PENDING' ? 'EOD_EXIT' : userStatus;
        duel.userPnL = this.calculateDuelPnL(duel.userEntryPrice, exitPrice, stopVal, targetVal);
      }
    }

    await db.forward_duels.put(duel);
    return duel;
  }

  /**
   * Calculates scorecard leaderboard statistics over all completed duels.
   */
  async getScorecard(): Promise<DuelScorecard> {
    const all = await db.forward_duels.toArray();
    
    let userWins = 0;
    let systemWins = 0;
    let userTotalPnL = 0;
    let systemTotalPnL = 0;
    let userTrades = 0;
    let systemTrades = 0;

    all.forEach(d => {
      // System
      if (d.systemStatus !== 'PENDING') {
        systemTrades++;
        systemTotalPnL += d.systemPnL;
        if (d.systemPnL > 0) systemWins++;
      }
      
      // User
      if (d.userTicker && d.userStatus !== 'PENDING') {
        userTrades++;
        userTotalPnL += d.userPnL;
        if (d.userPnL > 0) userWins++;
      }
    });

    const userWinRate = userTrades > 0 ? (userWins / userTrades) * 100 : 0;
    const systemWinRate = systemTrades > 0 ? (systemWins / systemTrades) * 100 : 0;

    let leader: 'USER' | 'SYSTEM' | 'TIE' = 'TIE';
    if (systemTotalPnL > userTotalPnL) leader = 'SYSTEM';
    else if (userTotalPnL > systemTotalPnL) leader = 'USER';

    return {
      userWinRate,
      systemWinRate,
      userTotalPnL,
      systemTotalPnL,
      userTrades,
      systemTrades,
      leader
    };
  }

  /**
   * Fetches all past completed duel history for log visualization.
   */
  async getDuelHistory(): Promise<ForwardDuel[]> {
    return await db.forward_duels.orderBy('date').reverse().toArray();
  }
}

export const quantDuelService = QuantDuelService.getInstance();
