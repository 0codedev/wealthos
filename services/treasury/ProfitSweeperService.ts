/**
 * Sovereign Multi-Asset Fortress & Friday Profit Sweeper Service
 *
 * Implements Work Package 12:
 * - 70/30 Fortress Allocation (70-80% Sleep-Well Assets vs 20-30% Tactical Spear)
 * - Condition of Freedom Engine: Passive Yield Y_passive >= Living Costs C_living
 * - Friday 04:00 PM Profit Sweeper: Sweeping 50% of weekly trading profits into Fortress
 */

export interface FortressAsset {
  id: string;
  category: 'SOVEREIGN_GOLD_BONDS' | 'GOLD_ETFS' | 'GOVT_TREASURY_BILLS' | 'DIVIDEND_COMPOUNDERS';
  name: string;
  ticker: string;
  investedCr: number;
  currentValueCr: number;
  annualYieldPct: number; // e.g. 7.1% for T-Bills, 2.5% + gold for SGB
  monthlyPassiveIncome: number;
}

export interface FreedomConditionReport {
  totalFortressCapitalCr: number;
  totalTacticalCapitalCr: number;
  fortressRatioPct: number; // e.g. 76%
  tacticalRatioPct: number; // e.g. 24%
  isTargetAllocationMet: boolean; // fortressRatio >= 70%
  monthlyPassiveIncome: number;
  monthlyLivingCosts: number;
  freedomRatio: number; // Phi = Y_passive / C_living
  isFreedomAchieved: boolean; // Phi >= 1.0
  freedomVerdict: string;
}

export interface FridaySweepReport {
  weeklyGrossTradingGains: number;
  brokerageAndTaxes: number;
  weeklyNetTradingGains: number;
  sweepPercentage: number; // 50%
  recommendedSweepAmount: number;
  isFridayPostClose: boolean;
  targetFortressAllocation: 'GOLD_ETFS' | 'TREASURY_BILLS' | 'DIVIDEND_COMPOUNDERS';
  isSweepExecutedThisWeek: boolean;
  lastSweepDate?: string;
}

const STORAGE_KEY_SWEEP = 'wealth_friday_profit_sweep_log_v1';

export class ProfitSweeperService {
  private static instance: ProfitSweeperService;

  private constructor() {}

  public static getInstance(): ProfitSweeperService {
    if (!ProfitSweeperService.instance) {
      ProfitSweeperService.instance = new ProfitSweeperService();
    }
    return ProfitSweeperService.instance;
  }

  /**
   * Evaluates the 70/30 Fortress Allocation and Condition of Freedom
   */
  public evaluateFreedomCondition(monthlyLivingCosts: number = 150000): FreedomConditionReport {
    // Current sample sovereign assets (total ~₹1.85 Cr fortress, ₹50L tactical spear)
    const totalFortressCapital = 18500000; // ₹1.85 Cr
    const totalTacticalCapital = 5000000; // ₹50 L
    const totalNetWorth = totalFortressCapital + totalTacticalCapital;

    const fortressRatioPct = Number(((totalFortressCapital / totalNetWorth) * 100).toFixed(1));
    const tacticalRatioPct = Number(((totalTacticalCapital / totalNetWorth) * 100).toFixed(1));

    // Weighted passive yield (~7.8% annualized across T-Bills, SGBs, & Dividend Compounders)
    const annualPassiveIncome = totalFortressCapital * 0.078;
    const monthlyPassiveIncome = Math.round(annualPassiveIncome / 12); // ~₹1,20,250/mo

    const freedomRatio = Number((monthlyPassiveIncome / monthlyLivingCosts).toFixed(2));
    const isFreedomAchieved = freedomRatio >= 1.0;

    let freedomVerdict = '';
    if (freedomRatio >= 1.5) {
      freedomVerdict = 'Full Sovereign Independence (Φ ≥ 1.5): Sleep-Well fortress produces 150%+ of monthly expenses. Tactical trading is pure asymmetric surplus.';
    } else if (freedomRatio >= 1.0) {
      freedomVerdict = 'Baseline Freedom Condition Met (Φ ≥ 1.0): Living expenses are 100% funded by non-decaying fortress yields. Zero survival pressure on trading.';
    } else {
      freedomVerdict = `Building Sovereign Cushion (Φ = ${freedomRatio}): Passive yield covers ${(freedomRatio * 100).toFixed(0)}% of living expenses. Continue weekly profit sweeps into Fortress.`;
    }

    return {
      totalFortressCapitalCr: Number((totalFortressCapital / 1e7).toFixed(2)),
      totalTacticalCapitalCr: Number((totalTacticalCapital / 1e7).toFixed(2)),
      fortressRatioPct,
      tacticalRatioPct,
      isTargetAllocationMet: fortressRatioPct >= 70,
      monthlyPassiveIncome,
      monthlyLivingCosts,
      freedomRatio,
      isFreedomAchieved,
      freedomVerdict
    };
  }

  /**
   * Evaluates Friday 04:00 PM Profit Sweeper
   */
  public evaluateFridaySweep(weeklyNetGains: number = 84500): FridaySweepReport {
    const sweepPercentage = 50;
    const recommendedSweepAmount = weeklyNetGains > 0 ? Math.round(weeklyNetGains * 0.5) : 0;

    const now = new Date();
    const isFriday = now.getDay() === 5;
    const hour = now.getHours();
    const isFridayPostClose = isFriday && hour >= 16;

    let isSweepExecutedThisWeek = false;
    let lastSweepDate: string | undefined = undefined;

    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_SWEEP);
        if (raw) {
          const data = JSON.parse(raw);
          lastSweepDate = data.date;
          // Check if same week
          const lastDate = new Date(data.date);
          const diffDays = (now.getTime() - lastDate.getTime()) / (1000 * 3600 * 24);
          if (diffDays < 6) {
            isSweepExecutedThisWeek = true;
          }
        }
      } catch { /* non-fatal */ }
    }

    return {
      weeklyGrossTradingGains: weeklyNetGains + 3500,
      brokerageAndTaxes: 3500,
      weeklyNetTradingGains: weeklyNetGains,
      sweepPercentage,
      recommendedSweepAmount,
      isFridayPostClose,
      targetFortressAllocation: 'TREASURY_BILLS',
      isSweepExecutedThisWeek,
      lastSweepDate
    };
  }

  /**
   * Confirms and records weekly profit sweep
   */
  public recordProfitSweep(amount: number): void {
    if (typeof window === 'undefined') return;
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      localStorage.setItem(STORAGE_KEY_SWEEP, JSON.stringify({ date: todayStr, amount }));
      window.dispatchEvent(new CustomEvent('wealth-profit-sweep-recorded', { detail: { date: todayStr, amount } }));
    } catch { /* non-fatal */ }
  }
}

export const profitSweeperService = ProfitSweeperService.getInstance();
