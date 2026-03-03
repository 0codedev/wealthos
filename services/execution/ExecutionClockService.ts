/**
 * Execution Clock & Prop-Desk Discipline Service
 *
 * Implements DOMAIN 02 (Golden Execution Windows) & DOMAIN 08:
 * - 09:15 - 10:00 AM IST: The Retail Trap Zone (Hands Off, Predatory Stop Hunts)
 * - 10:00 - 10:30 AM IST: Price Discovery & Opening Range Formation
 * - 10:30 - 10:45 AM IST: The Golden Execution Window (Peak R:R, The 1 Strike)
 * - 10:45 - 11:00 AM IST: Order Completion Buffer
 * - 11:00 - 14:00 PM IST: Midday Theta Annihilation / Hard Lockout (No new entries)
 * - 14:00 - 14:45 PM IST: Afternoon Harvest & Profit Trailing
 * - 14:45 - 15:30 PM IST: Mandatory Square-Off (Exit before 3:00 PM theta cliff)
 *
 * Enforces the 1-Trade Per Day Cap to immunize against overtrading and tilt.
 */

export type ExecutionPhase =
  | 'PRE_MARKET'
  | 'RETAIL_TRAP_HANDS_OFF'
  | 'PRICE_DISCOVERY_RECON'
  | 'GOLDEN_WINDOW'
  | 'EXECUTION_BUFFER'
  | 'HARD_LOCKOUT_THETA_CHOP'
  | 'PROFIT_HARVEST'
  | 'MANDATORY_EXIT'
  | 'POST_MARKET_AUTOPSY'
  | 'MARKET_CLOSED';

export interface ExecutionClockState {
  istTimeStr: string;
  phase: ExecutionPhase;
  phaseTitle: string;
  phaseBadgeColor: 'red' | 'yellow' | 'green' | 'amber' | 'slate' | 'indigo';
  canEnterNewTrade: boolean;
  lockoutReason?: string;
  dailyTradeCount: number;
  maxDailyTrades: number;
  secondsToNextPhase: number;
  nextPhaseTitle: string;
  isSquareOffRequired: boolean;
}

const STORAGE_KEY_TRADES = 'wealth_execution_clock_daily_trades_v1';
const MAX_DAILY_TRADES = 1;

export class ExecutionClockService {
  private static instance: ExecutionClockService;

  private constructor() {}

  public static getInstance(): ExecutionClockService {
    if (!ExecutionClockService.instance) {
      ExecutionClockService.instance = new ExecutionClockService();
    }
    return ExecutionClockService.instance;
  }

  /**
   * Get current time converted to IST (UTC+5:30)
   */
  public getISTDate(date: Date = new Date()): Date {
    // Convert to UTC ms, then add 5.5 hours
    const utcTime = date.getTime() + date.getTimezoneOffset() * 60000;
    return new Date(utcTime + 5.5 * 3600000);
  }

  /**
   * Format time in HH:MM:SS format
   */
  public formatTime(date: Date): string {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  /**
   * Reads or initializes the daily trade count for today's IST date
   */
  public getDailyTradeCount(): number {
    if (typeof window === 'undefined') return 0;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TRADES);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      const istToday = this.getISTDate().toISOString().split('T')[0];
      if (data.date === istToday && typeof data.count === 'number') {
        return data.count;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Increments the daily trade count when a fill is confirmed
   */
  public recordTradeExecution(): number {
    if (typeof window === 'undefined') return 1;
    try {
      const istToday = this.getISTDate().toISOString().split('T')[0];
      const current = this.getDailyTradeCount();
      const updated = current + 1;
      localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify({ date: istToday, count: updated }));
      window.dispatchEvent(new CustomEvent('wealth-daily-trade-recorded', { detail: { count: updated } }));
      return updated;
    } catch {
      return 1;
    }
  }

  /**
   * Discretionary override / reset for authorized manual resets
   */
  public resetDailyTradeCount(): void {
    if (typeof window === 'undefined') return;
    try {
      const istToday = this.getISTDate().toISOString().split('T')[0];
      localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify({ date: istToday, count: 0 }));
      window.dispatchEvent(new CustomEvent('wealth-daily-trade-recorded', { detail: { count: 0 } }));
    } catch { /* non-fatal */ }
  }

  /**
   * Evaluate the complete real-time clock state according to IST session boundaries
   */
  public getClockState(customNow?: Date): ExecutionClockState {
    const ist = this.getISTDate(customNow || new Date());
    const day = ist.getDay(); // 0 = Sun, 6 = Sat
    const h = ist.getHours();
    const m = ist.getMinutes();
    const s = ist.getSeconds();
    const timeVal = h * 100 + m; // e.g. 1030 for 10:30 AM
    const totalSecondsToday = h * 3600 + m * 60 + s;

    const dailyTradeCount = this.getDailyTradeCount();
    const isWeekend = day === 0 || day === 6;

    let phase: ExecutionPhase = 'MARKET_CLOSED';
    let phaseTitle = 'Market Closed';
    let phaseBadgeColor: ExecutionClockState['phaseBadgeColor'] = 'slate';
    let canEnterNewTrade = false;
    let lockoutReason: string | undefined = undefined;
    let secondsToNextPhase = 0;
    let nextPhaseTitle = 'Pre-Market (08:30)';
    let isSquareOffRequired = false;

    if (isWeekend) {
      phase = 'MARKET_CLOSED';
      phaseTitle = 'Weekend / Market Closed';
      phaseBadgeColor = 'slate';
      lockoutReason = 'Market closed for the weekend';
    } else if (timeVal < 830) {
      phase = 'MARKET_CLOSED';
      phaseTitle = 'Pre-Session Hibernation';
      phaseBadgeColor = 'slate';
      lockoutReason = 'Trading starts at 09:15 AM IST';
      secondsToNextPhase = (8 * 3600 + 30 * 60) - totalSecondsToday;
      nextPhaseTitle = 'Pre-Market Recon (08:30)';
    } else if (timeVal < 915) {
      phase = 'PRE_MARKET';
      phaseTitle = 'Pre-Market Recon (GEX / Bias)';
      phaseBadgeColor = 'indigo';
      lockoutReason = 'Pre-market order matching phase only';
      secondsToNextPhase = (9 * 3600 + 15 * 60) - totalSecondsToday;
      nextPhaseTitle = 'Opening Bell (09:15)';
    } else if (timeVal < 1000) {
      phase = 'RETAIL_TRAP_HANDS_OFF';
      phaseTitle = '🔴 Hands-Off: Retail Trap Zone';
      phaseBadgeColor = 'red';
      lockoutReason = 'Predatory stop-hunting and opening auction absorption in progress. Hands off!';
      secondsToNextPhase = (10 * 3600) - totalSecondsToday;
      nextPhaseTitle = 'Recon & Range Setup (10:00)';
    } else if (timeVal < 1030) {
      phase = 'PRICE_DISCOVERY_RECON';
      phaseTitle = '🟡 Recon & Range Setup';
      phaseBadgeColor = 'yellow';
      lockoutReason = 'Waiting for Golden Execution Window (10:30 AM)';
      secondsToNextPhase = (10 * 3600 + 30 * 60) - totalSecondsToday;
      nextPhaseTitle = 'The Golden Window (10:30)';
    } else if (timeVal < 1045) {
      phase = 'GOLDEN_WINDOW';
      phaseTitle = '🟢 The Golden Strike Window';
      phaseBadgeColor = 'green';
      canEnterNewTrade = dailyTradeCount < MAX_DAILY_TRADES;
      if (dailyTradeCount >= MAX_DAILY_TRADES) {
        lockoutReason = 'Daily 1-Trade Cap Reached. Capital preserved.';
      }
      secondsToNextPhase = (10 * 3600 + 45 * 60) - totalSecondsToday;
      nextPhaseTitle = 'Execution Buffer (10:45)';
    } else if (timeVal < 1100) {
      phase = 'EXECUTION_BUFFER';
      phaseTitle = '🟡 Execution Buffer (Final Entries)';
      phaseBadgeColor = 'yellow';
      canEnterNewTrade = dailyTradeCount < MAX_DAILY_TRADES;
      if (dailyTradeCount >= MAX_DAILY_TRADES) {
        lockoutReason = 'Daily 1-Trade Cap Reached. Capital preserved.';
      }
      secondsToNextPhase = (11 * 3600) - totalSecondsToday;
      nextPhaseTitle = 'Hard Midday Lockout (11:00)';
    } else if (timeVal < 1400) {
      phase = 'HARD_LOCKOUT_THETA_CHOP';
      phaseTitle = '🔒 Midday Hard Lockout (Theta Chop)';
      phaseBadgeColor = 'red';
      lockoutReason = 'Midday theta decay & chop zone. Order entry locked to prevent overtrading.';
      secondsToNextPhase = (14 * 3600) - totalSecondsToday;
      nextPhaseTitle = 'Afternoon Harvest (14:00)';
    } else if (timeVal < 1445) {
      phase = 'PROFIT_HARVEST';
      phaseTitle = '🟡 Afternoon Harvest & Trailing';
      phaseBadgeColor = 'amber';
      lockoutReason = 'No new entries. Manage active position with aggressive trailing stops.';
      secondsToNextPhase = (14 * 3600 + 45 * 60) - totalSecondsToday;
      nextPhaseTitle = 'Mandatory Square-Off (14:45)';
    } else if (timeVal < 1530) {
      phase = 'MANDATORY_EXIT';
      phaseTitle = '🚨 Mandatory Square-Off (Exit Cliff)';
      phaseBadgeColor = 'red';
      isSquareOffRequired = true;
      lockoutReason = 'Mandatory exit: Do not hold intraday options past 02:45 PM into the theta cliff.';
      secondsToNextPhase = (15 * 3600 + 30 * 60) - totalSecondsToday;
      nextPhaseTitle = 'Post-Market AI Autopsy (15:30)';
    } else if (timeVal < 1600) {
      phase = 'POST_MARKET_AUTOPSY';
      phaseTitle = '🧠 Post-Market AI Autopsy & Debrief';
      phaseBadgeColor = 'indigo';
      lockoutReason = 'Market closed. Complete 3-question debrief and receive process grade.';
      secondsToNextPhase = (16 * 3600) - totalSecondsToday;
      nextPhaseTitle = 'Evening Catalyst Screener';
    } else {
      phase = 'MARKET_CLOSED';
      phaseTitle = 'Evening Catalyst Discovery (VCP)';
      phaseBadgeColor = 'slate';
      lockoutReason = 'Session concluded. Run cash segment screeners for next trading day.';
    }

    return {
      istTimeStr: this.formatTime(ist),
      phase,
      phaseTitle,
      phaseBadgeColor,
      canEnterNewTrade,
      lockoutReason,
      dailyTradeCount,
      maxDailyTrades: MAX_DAILY_TRADES,
      secondsToNextPhase: Math.max(0, secondsToNextPhase),
      nextPhaseTitle,
      isSquareOffRequired
    };
  }
}

export const executionClockService = ExecutionClockService.getInstance();
