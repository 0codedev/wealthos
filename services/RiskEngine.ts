import { Investment, InvestmentType } from '../types';

export interface RiskProfile {
  bullionCap: number;       // Max % allocation for Gold/Silver
  profitThreshold: number;  // % Gain to trigger "Book Profit" alert
  silverBubbleLimit: number;// % Gain to trigger "Bubble" warning
}

const DEFAULT_PROFILE: RiskProfile = {
  bullionCap: 40,
  profitThreshold: 20,
  silverBubbleLimit: 90
};

export type MarketScenario = 'NORMAL' | 'HIGH_VOLATILITY' | 'SILVER_CRASH' | 'GOLD_RALLY' | 'CRYPTO_WINTER' | 'BULL_RUN';

export interface MarketContext {
  scenario: MarketScenario;
  vix: number; // Volatility Index
  goldSilverRatio: number;
  fiiDiiNet?: number; // Net flow in Cr
}

export const inferMarketContext = (
  investments: Investment[],
  vix: number,
  goldSilverRatio: number = 82,
  fiiDiiNet: number = 0
): MarketContext => {
  const totalAssets = investments.reduce((sum, investment) => sum + (investment.currentValue || 0), 0);
  const silverExposure = totalAssets > 0
    ? (investments
      .filter((investment) => investment.type === InvestmentType.DIGITAL_SILVER)
      .reduce((sum, investment) => sum + (investment.currentValue || 0), 0) / totalAssets) * 100
    : 0;
  const cryptoExposure = totalAssets > 0
    ? (investments
      .filter((investment) => investment.type === InvestmentType.CRYPTO)
      .reduce((sum, investment) => sum + (investment.currentValue || 0), 0) / totalAssets) * 100
    : 0;

  let scenario: MarketScenario = 'NORMAL';

  // Advanced logic: Multi-factor scenario detection
  if (silverExposure >= 12 && goldSilverRatio >= 88) {
    scenario = 'SILVER_CRASH';
  } else if (cryptoExposure >= 18 && vix >= 32) {
    scenario = 'CRYPTO_WINTER';
  } else if (vix >= 28 && fiiDiiNet > 2000) {
    // High VIX but FIIs are buying - potential Bear Trap
    scenario = 'BULL_RUN'; // Upgraded to Bull Run or similar positive state
  } else if (vix >= 30) {
    scenario = 'HIGH_VOLATILITY';
  } else if (vix <= 14) {
    scenario = 'BULL_RUN';
  }

  return {
    scenario,
    vix,
    goldSilverRatio,
    fiiDiiNet
  };
};

export interface RiskVerdict {
  score: number; // 0-100 (100 = Safe, 0 = Critical)
  level: 'SAFE' | 'CAUTION' | 'CRITICAL' | 'KILL_SWITCH';
  title: string;
  narrative: string;
  actionPlan: string[];
}

export interface HoldingVerdict {
  assetId: string;
  assetName: string;
  status: 'SAFE' | 'WARNING' | 'CRITICAL';
  issue: string; // "Overvalued", "Stop Loss Hit", "Silver Crash Risk", "No Issues"
  action: string; // "Hold", "Trim", "Sell", "Review"
}

export class RiskEngine {
  private baseRules: RiskProfile;
  private rules: RiskProfile;
  private marketContext: MarketContext = {
    scenario: 'NORMAL',
    vix: 15,
    goldSilverRatio: 75
  };

  constructor(customRules?: Partial<RiskProfile>) {
    this.baseRules = { ...DEFAULT_PROFILE, ...customRules };
    this.rules = { ...this.baseRules };
  }

  /**
   * Updates the internal market context.
   * In a real app, this would fetch from an API.
   * For now, we simulate the "Silver Crash" scenario.
   */
  public setContext(context: Partial<MarketContext>) {
    this.marketContext = { ...this.marketContext, ...context };

    // Reset to base rules
    this.rules = { ...this.baseRules };

    // Dynamic Rule Adjustment Logic
    // 1. Bullion Cap adjustments based on VIX (Higher VIX = higher Bullion allowance)
    if (this.marketContext.vix > 25) {
        this.rules.bullionCap = 50;
    } else if (this.marketContext.vix < 15) {
        this.rules.bullionCap = 30; // Rotate to equity
    }

    // 2. Profit Threshold adjustments (Book profits faster in high volatility)
    if (this.marketContext.vix > 22) {
        this.rules.profitThreshold = 12;
    }

    // 3. Scenario-specific overrides
    if (this.marketContext.scenario === 'SILVER_CRASH') {
      this.rules.silverBubbleLimit = 10;
      this.rules.bullionCap = Math.min(this.rules.bullionCap, 25);
    } else if (this.marketContext.scenario === 'CRYPTO_WINTER') {
        this.rules.profitThreshold = 5; // Exit anything that moves
    }
  }

  public getContext(): MarketContext {
    return this.marketContext;
  }

  /**
   * Infers the Beta (volatility relative to market) based on asset type and sector.
   * A Real Risk Engine would use historical covariance, but this is a heuristic model.
   */
  private getEstimatedBeta(inv: Investment): number {
    if (inv.type === InvestmentType.CASH || inv.type === InvestmentType.FD) return 0;
    if (inv.type === InvestmentType.DIGITAL_GOLD) return 0.2; // Uncorrelated/Defensive
    if (inv.type === InvestmentType.DIGITAL_SILVER) return 1.2; // Volatile Commodity
    if (inv.type === InvestmentType.CRYPTO) return 2.5; // Very High Beta
    if (inv.type === InvestmentType.STOCKS) {
      if (inv.sector === 'Technology' || inv.sector === 'Small Cap') return 1.5;
      if (inv.sector === 'Consumer Goods' || inv.sector === 'Utilities') return 0.7; // Defensive
      return 1.1; // Baseline Stock
    }
    if (inv.type === InvestmentType.MUTUAL_FUND) return 0.9; // Diversified
    return 1.0;
  }

  /**
   * Evaluates a single asset against the current market context and risk rules.
   * IMPROVED: Now implements the "Forbidden Protocols" (Flash Rally, Falling Knife, etc.)
   * PHASE 2: Added Sector Overload, High Beta, Liquidity Crisis logic.
   */
  public evaluateAsset(inv: Investment, totalPortfolioValue: number = 0, sectorAllocations: Record<string, number> = {}): HoldingVerdict {
    const profit = inv.currentValue - inv.investedAmount;
    const roi = inv.investedAmount > 0 ? (profit / inv.investedAmount) * 100 : 0;
    const allocation = totalPortfolioValue > 0 ? (inv.currentValue / totalPortfolioValue) * 100 : 0;

    let status: HoldingVerdict['status'] = 'SAFE';
    let issue = 'No Issues';
    let action = 'Hold';

    const beta = this.getEstimatedBeta(inv);

    // --- PROTOCOL 1: FLASH RALLY (FOMO GUARD) ---
    // Trigger: High ROI in volatile assets (Crypto/Silver/Stocks)
    // Note: Without exact 'daysHeld', we treat >15% ROI in 'HIGH_VOLATILITY' or 'SILVER_CRASH' context as potential Flash Rally.
    if ((inv.type === InvestmentType.CRYPTO || inv.type === InvestmentType.DIGITAL_SILVER || inv.type === InvestmentType.STOCKS) && roi > 15) {
      if (this.marketContext.scenario === 'HIGH_VOLATILITY' || this.marketContext.scenario === 'SILVER_CRASH' || this.marketContext.scenario === 'GOLD_RALLY') {
        status = 'WARNING';
        issue = `Flash Rally Detect (+${roi.toFixed(0)}%)`;
        action = 'Book Partial Profit (FOMO Guard)';
      }
    }

    // --- PROTOCOL 2: FALLING KNIFE PROTOCOL ---
    // Trigger: Significant negative ROI in a crash scenario
    if (this.marketContext.scenario === 'SILVER_CRASH' && inv.type === InvestmentType.DIGITAL_SILVER && roi < -8) {
      status = 'CRITICAL';
      issue = 'Falling Knife (Silver Crash)';
      action = 'HOLD - Do Not Panic Sell'; // Default rule: don't sell into a crash unless leverage (not handled here)

      // Exception: If Stop Loss breached deeply
      if (roi < -15) {
        action = 'Exit (Stop Loss Breached)';
      }
    }

    // --- PROTOCOL 3: CONCENTRATION TRAP ---
    // Trigger: Single asset > 25% of portfolio
    if (allocation > 25) {
      status = 'CRITICAL';
      issue = `Over-Concentrated (${allocation.toFixed(1)}%)`;
      action = 'Rebalance / Trim';
    }

    // --- PROTOCOL 4: FREE RIDE PROTOCOL ---
    // Trigger: ROI > 100% (Doubled money)
    else if (roi > 100) {
      status = 'SAFE'; // It's a good problem
      issue = 'Moonshot Achieved (>100%)';
      action = 'Harvest Principal (Free Ride)';
    }

    // --- PROTOCOL 5: SLOW BLEED (DEAD MONEY) ---
    else if (roi < -10 && this.marketContext.scenario === 'NORMAL') {
      status = 'WARNING';
      issue = 'Slow Bleed / Drawdown';
      action = 'Review Thesis';
    }

    // --- PROTOCOL 6: DEAD CAT BOUNCE (PHASE 2) ---
    // Trigger: Significant drawdown followed by a small rally
    // Heuristic: If ROI is deeply negative but Market is Rallying
    else if (roi < -30 && (this.marketContext.scenario === 'GOLD_RALLY' || this.marketContext.scenario === 'BULL_RUN')) {
      status = 'WARNING';
      issue = 'Dead Cat Bounce Detect';
      action = 'Sell into Strength';
    }

    // --- PROTOCOL 7: SECTOR OVERLOAD (PHASE 2) ---
    // If this asset belongs to a sector that is > 40% of portfolio
    if (inv.sector && sectorAllocations[inv.sector] > 40) {
      // Only flag the asset if it's contributing significantly to that overload
      status = 'CRITICAL';
      issue = `Sector Risk: ${inv.sector} (${sectorAllocations[inv.sector].toFixed(0)}%)`;
      action = 'Reduce Sector Exposure';
    }

    // --- PROTOCOL 8: HIGH BETA HAZARD (PHASE 2) ---
    if (this.marketContext.scenario === 'HIGH_VOLATILITY' && beta > 1.5) {
      status = 'WARNING';
      issue = `High Volatility Risk (Beta ${beta})`;
      action = 'Reduce Volatility / Hedge';
    }

    // --- PROTOCOL 9: BLUE CHIP STAGNATION (PHASE 2) ---
    // If Bull Run, but asset is flat/negative
    if (this.marketContext.scenario === 'BULL_RUN' && roi < 2 && roi > -5 && beta > 0.8) {
      status = 'WARNING';
      issue = 'Lagging / Dead Money';
      action = 'Rotate to Leaders';
    }

    // --- PROTOCOL 10: LIQUIDITY CRISIS (PHASE 2) ---
    // If this is CASH and allocation is low
    if (inv.type === InvestmentType.CASH) {
      if (allocation < 5) {
        status = 'CRITICAL';
        issue = `Low Liquidity Reserves (${allocation.toFixed(1)}%)`;
        action = 'Add Funds / Build Cash';
      } else {
        status = 'SAFE';
        issue = 'Dry Powder Ready';
        action = 'Deploy on Dips';
      }
    }

    // --- CONTEXT SPECIFIC OVERRIDES ---

    // Silver Crash Specifics (User Request)
    if (this.marketContext.scenario === 'SILVER_CRASH' && inv.type === InvestmentType.DIGITAL_SILVER) {
      // We already handled Falling Knife, check for "Trap" (small profit)
      if (roi > 0 && roi < 10) {
        status = 'WARNING';
        issue = 'Weak Rally in Crash';
        action = 'Trim Exposure';
      }
    }

    // Explicit "No Issue" for Safe Assets
    if (status === 'SAFE' && issue === 'No Issues') {
      issue = 'Safe • No Issues';
    }

    return {
      assetId: inv.id,
      assetName: inv.name,
      status,
      issue,
      action
    };
  }

  /**
   * Generates a comprehensive AI Verdict for the portfolio.
   */
  public generateVerdict(investments: Investment[], totalNetWorth: number): RiskVerdict {
    if (totalNetWorth === 0) {
      return {
        score: 100, level: 'SAFE',
        title: 'Portfolio Empty',
        narrative: 'No risk detected as portfolio is empty.',
        actionPlan: ['Start investing to see analysis.']
      };
    }

    // 1. Analyze Silver Exposure (Specific to User Request)
    const silverValue = investments.filter(i => i.type === InvestmentType.DIGITAL_SILVER).reduce((sum, i) => sum + i.currentValue, 0);
    const silverExposure = (silverValue / totalNetWorth) * 100;

    // 2. Analyze Overall Bullion
    const bullionValue = investments.filter(i => i.type === InvestmentType.DIGITAL_GOLD || i.type === InvestmentType.DIGITAL_SILVER).reduce((sum, i) => sum + i.currentValue, 0);
    const bullionExposure = (bullionValue / totalNetWorth) * 100;

    let score = 90;
    let level: RiskVerdict['level'] = 'SAFE';
    let title = 'Stable Portfolio';
    let narrative = 'Your portfolio is well-balanced and aligned with current market conditions.';
    const actionPlan: string[] = [];

    // --- LOGIC ENGINE ---

    // SCENARIO: SILVER CRASH
    if (this.marketContext.scenario === 'SILVER_CRASH') {
      if (silverExposure > 20) {
        score -= 40;
        level = 'KILL_SWITCH';
        title = 'CRITICAL: SILVER OVER-EXPOSURE';
        narrative = `MARKET ALERT: Silver is currently facing a global correction. Your exposure (${silverExposure.toFixed(1)}%) is DANGEROUSLY HIGH given the crash context. Recent volatility suggests further downside.`;
        actionPlan.push('IMMEDIATE: Halt all Silver SIPs.');
        actionPlan.push(`SELL: Reduce Silver by ${(silverExposure - 15).toFixed(1)}% to reach safe levels.`);
        actionPlan.push('HEDGE: Move liquidity to Fixed Income or Gold.');
      } else if (silverExposure > 10) {
        score -= 20;
        level = 'CAUTION';
        title = 'Caution: Silver Volatility';
        narrative = `Silver markets are unstable. Your exposure (${silverExposure.toFixed(1)}%) is moderate but requires close monitoring.`;
        actionPlan.push('Hold current Silver positions; do not add more.');
        actionPlan.push('Set tight Stop-Loss alerts.');
      } else {
        narrative += ' You are safely insulated from the Silver crash.';
      }
    }

    // GENERIC: CONCENTRATION RISK
    if (bullionExposure > this.rules.bullionCap && level !== 'KILL_SWITCH') {
      score -= 20;
      level = level === 'SAFE' ? 'CAUTION' : 'CRITICAL';
      if (title === 'Stable Portfolio') title = 'Concentration Risk';
      narrative = `Your Bullion allocation (${bullionExposure.toFixed(1)}%) exceeds the safe limit of ${this.rules.bullionCap}%.`;
      actionPlan.push(`Rebalance: Rotate profit from Bullion to Equity.`);
    }

    // Calc final score
    score = Math.max(0, Math.min(100, score));

    return { score, level, title, narrative, actionPlan };
  }

  /**
   * Adjusts risk parameters based on Market Volatility (VIX).
   * @param vix Current Volatility Index
   */
  public adaptToMarket(vix: number) {
    if (vix > 30) {
      // HIGH VOLATILITY PROTOCOL
      // 1. Allow higher allocation to safe havens (Gold/Silver)
      this.rules.bullionCap = 50;
      // 2. Tighten profit booking to secure cash faster
      this.rules.profitThreshold = 15;
      this.marketContext.scenario = 'HIGH_VOLATILITY';
    } else {
      // NORMAL MARKET PROTOCOL
      this.rules = { ...DEFAULT_PROFILE };
      this.marketContext.scenario = 'NORMAL';
    }
    this.marketContext.vix = vix;
  }

  /**
   * Analyzes the entire portfolio for allocation risks.
   */
  public analyzePortfolio(investments: Investment[], totalNetWorth: number) {
    const bullionValue = investments
      .filter(i =>
        i.type === InvestmentType.DIGITAL_GOLD ||
        i.type === InvestmentType.DIGITAL_SILVER
      )
      .reduce((acc, curr) => acc + curr.currentValue, 0);

    const exposure = totalNetWorth > 0 ? (bullionValue / totalNetWorth) * 100 : 0;

    return {
      isBullionOverweight: exposure > this.rules.bullionCap,
      bullionExposure: exposure,
      limit: this.rules.bullionCap,
      verdict: this.generateVerdict(investments, totalNetWorth)
    };
  }

  /**
   * Analyzes a single asset for specific risk signals (Greed/Bubble).
   */
  public analyzeAsset(inv: Investment) {
    const profit = inv.currentValue - inv.investedAmount;
    const roi = inv.investedAmount > 0 ? (profit / inv.investedAmount) * 100 : 0;

    // 1. The "Greed Killer"
    // Suggest booking profit if ROI exceeds threshold (for volatile assets)
    const shouldBookProfit = (
      (inv.type === InvestmentType.STOCKS || inv.type === InvestmentType.CRYPTO) &&
      roi >= this.rules.profitThreshold
    );

    // 2. The "Silver Trap" / Bubble Risk
    // Adjusted logic: If in SILVER_CRASH, any profit > 10% is good to take.
    const bubbleLimit = this.marketContext.scenario === 'SILVER_CRASH' ? 10 : this.rules.silverBubbleLimit;

    const isBubbleRisk = (
      inv.type === InvestmentType.DIGITAL_SILVER &&
      roi > bubbleLimit
    );

    return { shouldBookProfit, isBubbleRisk, roi };
  }
}
