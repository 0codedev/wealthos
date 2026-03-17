/**
 * Sovereign Capital Fortress & Drawdown Architecture Service
 *
 * Implements Work Package 7:
 * - India VIX 4-Regime Position Sizing (Complacent 75%, Goldilocks 100%, Elevated 50%, Panic 25%/Lock)
 * - Daily Loss Circuit Breaker (-1.5% tactical capital = session lockout)
 * - Weekly Loss Circuit Breaker (-3.0% tactical capital = 48h cool-off)
 * - 100% Sandbox Incubation Gate (Minimum 40 trades, Sharpe > 1.8, Sortino > 2.5)
 */

export type VIXRegime = 'COMPLACENT' | 'GOLDILOCKS' | 'ELEVATED' | 'PANIC';

export interface VIXRegimeStatus {
  vixValue: number;
  regime: VIXRegime;
  regimeTitle: string;
  sizeMultiplier: number; // e.g. 0.75, 1.0, 0.50, 0.25
  description: string;
  isLockoutRequired: boolean;
}

export interface DrawdownStatus {
  tacticalCapital: number;
  dailyPnL: number;
  dailyDrawdownPct: number; // e.g. -0.8%
  dailyLimitPct: number; // -1.5%
  isDailyBreakerTripped: boolean;
  weeklyPnL: number;
  weeklyDrawdownPct: number; // e.g. -1.8%
  weeklyLimitPct: number; // -3.0%
  isWeeklyBreakerTripped: boolean;
  coolOffHoursRemaining: number;
}

export interface SandboxIncubationStatus {
  isIncubated: boolean; // true if 40 trades + Sharpe > 1.8 + Sortino > 2.5
  completedTrades: number;
  requiredTrades: number;
  sharpeRatio: number;
  requiredSharpe: number;
  sortinoRatio: number;
  requiredSortino: number;
  isLiveAllowed: boolean;
  incubationProgressPct: number;
}

export class SovereignFortressService {
  private static instance: SovereignFortressService;

  private constructor() {}

  public static getInstance(): SovereignFortressService {
    if (!SovereignFortressService.instance) {
      SovereignFortressService.instance = new SovereignFortressService();
    }
    return SovereignFortressService.instance;
  }

  /**
   * Evaluate India VIX 4-Regime Multiplier
   */
  public evaluateVIXRegime(vix: number): VIXRegimeStatus {
    if (vix < 12.0) {
      return {
        vixValue: vix,
        regime: 'COMPLACENT',
        regimeTitle: 'Regime 1: Complacent Volatility (<12)',
        sizeMultiplier: 0.75,
        description: 'Compressed option premiums and mean-reverting chop. Position sizing throttled to 75% to prevent premium decay erosion.',
        isLockoutRequired: false
      };
    } else if (vix < 18.0) {
      return {
        vixValue: vix,
        regime: 'GOLDILOCKS',
        regimeTitle: 'Regime 2: Goldilocks Sweet Spot (12-18)',
        sizeMultiplier: 1.0,
        description: 'Optimal directional trend expansion, healthy gamma velocity, and clean institutional order flow. Full 100% position sizing authorized.',
        isLockoutRequired: false
      };
    } else if (vix < 24.0) {
      return {
        vixValue: vix,
        regime: 'ELEVATED',
        regimeTitle: 'Regime 3: Elevated Volatility (18-24)',
        sizeMultiplier: 0.5,
        description: 'Wide intraday whipsaws and high gamma volatility. Position sizing throttled to 50% to absorb wide stops safely.',
        isLockoutRequired: false
      };
    } else {
      return {
        vixValue: vix,
        regime: 'PANIC',
        regimeTitle: 'Regime 4: Panic Volatility (≥24)',
        sizeMultiplier: 0.25,
        description: 'Circuit breaker volatility regime. Naked option buying prohibited; size strictly capped at 25% with defined-risk spreads.',
        isLockoutRequired: true
      };
    }
  }

  /**
   * Evaluates Daily & Weekly Drawdown Breakers
   */
  public evaluateDrawdown(tacticalCapital: number, dailyPnL: number, weeklyPnL: number): DrawdownStatus {
    const dailyDrawdownPct = tacticalCapital > 0 ? (dailyPnL / tacticalCapital) * 100 : 0;
    const weeklyDrawdownPct = tacticalCapital > 0 ? (weeklyPnL / tacticalCapital) * 100 : 0;

    const DAILY_LIMIT = -1.5;
    const WEEKLY_LIMIT = -3.0;

    const isDailyBreakerTripped = dailyDrawdownPct <= DAILY_LIMIT;
    const isWeeklyBreakerTripped = weeklyDrawdownPct <= WEEKLY_LIMIT;

    return {
      tacticalCapital,
      dailyPnL,
      dailyDrawdownPct: Number(dailyDrawdownPct.toFixed(2)),
      dailyLimitPct: DAILY_LIMIT,
      isDailyBreakerTripped,
      weeklyPnL,
      weeklyDrawdownPct: Number(weeklyDrawdownPct.toFixed(2)),
      weeklyLimitPct: WEEKLY_LIMIT,
      isWeeklyBreakerTripped,
      coolOffHoursRemaining: isWeeklyBreakerTripped ? 48 : isDailyBreakerTripped ? 12 : 0
    };
  }

  /**
   * Evaluates Sandbox Incubation Gate (Minimum 40 trades, Sharpe > 1.8, Sortino > 2.5)
   */
  public evaluateSandboxIncubation(completedTrades: number, sharpe: number, sortino: number): SandboxIncubationStatus {
    const requiredTrades = 40;
    const requiredSharpe = 1.8;
    const requiredSortino = 2.5;

    const tradesMet = completedTrades >= requiredTrades;
    const sharpeMet = sharpe >= requiredSharpe;
    const sortinoMet = sortino >= requiredSortino;

    const isIncubated = tradesMet && sharpeMet && sortinoMet;
    const progress = Math.min(
      100,
      Math.round(
        ((Math.min(completedTrades, requiredTrades) / requiredTrades) * 0.4 +
          (Math.min(sharpe, requiredSharpe) / requiredSharpe) * 0.3 +
          (Math.min(sortino, requiredSortino) / requiredSortino) * 0.3) *
          100
      )
    );

    return {
      isIncubated,
      completedTrades,
      requiredTrades,
      sharpeRatio: Number(sharpe.toFixed(2)),
      requiredSharpe,
      sortinoRatio: Number(sortino.toFixed(2)),
      requiredSortino,
      isLiveAllowed: isIncubated,
      incubationProgressPct: progress
    };
  }
}

export const sovereignFortressService = SovereignFortressService.getInstance();
