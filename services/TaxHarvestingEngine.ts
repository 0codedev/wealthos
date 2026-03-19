import { Investment, InvestmentType, HarvestOpportunity, HarvestPlan } from '../types';

// FY 2024-25 Indian tax parameters
const LTCG_TAX_RATE = 0.125; // 12.5%
const STCG_TAX_RATE = 0.15; // 15%
const DEBT_GOLD_SLAB_RATE = 0.30; // Conservatively assume 30% slab for debt/gold (unless LTCG with indexation is used)
const EQUITY_HOLDING_DAYS = 365;

// Static lookup mapping for equivalent park-in instruments
const EQUIVALENT_REPLACEMENTS: Record<string, { replacement: string; rationale: string }> = {
  // Common Large Cap stocks
  'RELIANCE': { replacement: 'NIFTYBEES ETF', rationale: 'Maintain exposure to India\'s largest conglomerate via the Nifty 50 Index ETF.' },
  'HDFCBANK': { replacement: 'BANKBEES ETF', rationale: 'Maintain exposure to the private banking sector via Bank Nifty Index ETF.' },
  'INFY': { replacement: 'NETFIT ETF', rationale: 'Maintain IT sector exposure via the Nifty IT ETF.' },
  'TCS': { replacement: 'NETFIT ETF', rationale: 'Maintain IT sector exposure via the Nifty IT ETF.' },
  'ICICIBANK': { replacement: 'BANKBEES ETF', rationale: 'Maintain exposure to the private banking sector via Bank Nifty Index ETF.' },
  // Default fallbacks based on types
  'default_equity_large': { replacement: 'NIFTYBEES ETF', rationale: 'Nifty 50 Index ETF keeps you fully invested in India\'s top 50 blue chips.' },
  'default_equity_mid': { replacement: 'JUNIORBEES ETF', rationale: 'Nifty Next 50 ETF maintains high-growth large/midcap exposure.' },
  'default_equity_small': { replacement: 'SETFNN50 ETF', rationale: 'Nifty Next 50 / Midcap ETF reduces small-cap volatility while remaining invested.' },
  'default_gold': { replacement: 'Sovereign Gold Bonds (SGB)', rationale: 'SGBs offer sovereign guarantee and interest yield while avoiding wash-sale tax impact.' },
  'default_debt': { replacement: 'Liquid ETF (LIQUIDBEES)', rationale: 'LIQUIDBEES maintains cash-like yields without exit loads or capital volatility.' },
};

export class TaxHarvestingEngine {
  /**
   * Determine the holding period in days.
   */
  private calculateDaysHeld(acquiredAt?: string, lastUpdated?: string): number {
    const start = acquiredAt ? new Date(acquiredAt) : new Date();
    if (!acquiredAt && lastUpdated) {
      // If acquiredAt is missing, fallback to 400 days ago so it counts as LTCG, 
      // or use lastUpdated to calculate days held.
      return Math.floor((new Date().getTime() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24));
    }
    return Math.floor((new Date().getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Scan portfolio for tax-loss harvesting candidates.
   * Opportunities are defined as assets with unrealized loss exceeding ₹10,000.
   */
  public scanOpportunities(investments: Investment[], minLossThreshold: number = 10000): HarvestOpportunity[] {
    const opportunities: HarvestOpportunity[] = [];

    for (const inv of investments) {
      const unrealizedLoss = inv.currentValue - inv.investedAmount;

      // Only scan candidates with negative PnL (losses)
      // Use the dynamic or default minLossThreshold
      if (unrealizedLoss > -minLossThreshold) {
        continue;
      }

      const daysHeld = this.calculateDaysHeld(inv.acquiredAt || inv.createdAt, inv.lastUpdated);
      const isEquityRelated = [
        InvestmentType.STOCKS,
        InvestmentType.MUTUAL_FUND,
        InvestmentType.ETF,
        InvestmentType.SMALLCASE
      ].includes(inv.type);

      let gainType: 'STCG' | 'LTCG' = 'STCG';
      let taxSection = 'Other';
      let taxRate = STCG_TAX_RATE;

      if (isEquityRelated) {
        const isLTCG = daysHeld >= EQUITY_HOLDING_DAYS;
        gainType = isLTCG ? 'LTCG' : 'STCG';
        taxSection = isLTCG ? '112A' : '111A';
        taxRate = isLTCG ? LTCG_TAX_RATE : STCG_TAX_RATE;
      } else {
        // Debt/Gold and others: 3 years (1095 days) threshold for long term
        const isLTCG = daysHeld >= 1095;
        gainType = isLTCG ? 'LTCG' : 'STCG';
        taxSection = isLTCG ? '112' : 'Other';
        taxRate = isLTCG ? 0.20 : DEBT_GOLD_SLAB_RATE; // 20% with indexation or slab rate
      }

      // Calculate estimated tax savings from booking this loss
      const taxSaving = Math.abs(unrealizedLoss) * taxRate;

      // Map to equivalent replacement
      const symbolKey = (inv.ticker || inv.name).toUpperCase();
      let replacementInfo = EQUIVALENT_REPLACEMENTS[symbolKey];

      if (!replacementInfo) {
        if (inv.type === InvestmentType.DIGITAL_GOLD || inv.type === InvestmentType.DIGITAL_SILVER) {
          replacementInfo = EQUIVALENT_REPLACEMENTS['default_gold'];
        } else if (inv.type === InvestmentType.FD || inv.type === InvestmentType.CASH) {
          replacementInfo = EQUIVALENT_REPLACEMENTS['default_debt'];
        } else {
          // Equity fallback based on sector/size heuristics
          if (inv.sector === 'Technology' || inv.investedAmount > 100000) {
            replacementInfo = EQUIVALENT_REPLACEMENTS['default_equity_large'];
          } else if (inv.sector === 'Small Cap') {
            replacementInfo = EQUIVALENT_REPLACEMENTS['default_equity_small'];
          } else {
            replacementInfo = EQUIVALENT_REPLACEMENTS['default_equity_mid'];
          }
        }
      }

      // Assign priority based on absolute tax savings
      let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (taxSaving >= 25000) {
        priority = 'HIGH';
      } else if (taxSaving >= 10000) {
        priority = 'MEDIUM';
      }

      opportunities.push({
        investmentId: inv.id,
        ticker: inv.ticker || inv.name,
        assetType: inv.type,
        unrealizedLoss,
        taxSaving,
        gainType,
        taxSection,
        suggestedReplacement: replacementInfo.replacement,
        replacementRationale: replacementInfo.rationale,
        lockInPeriod: 30, // 30-day wash-sale rule applies to buybacks
        priority,
      });
    }

    // Sort by tax saving descending (highest priority first)
    return opportunities.sort((a, b) => b.taxSaving - a.taxSaving);
  }

  /**
   * Generate a comprehensive tax harvesting report/plan.
   */
  public generateHarvestPlan(investments: Investment[], minLossThreshold: number = 10000): HarvestPlan {
    const opportunities = this.scanOpportunities(investments, minLossThreshold);
    const totalTaxSaving = opportunities.reduce((sum, opp) => sum + opp.taxSaving, 0);

    const warnings: string[] = [];
    if (opportunities.length > 0) {
      warnings.push('Under Indian IT law, booking a loss and immediately buying the same asset back violates the "wash-sale / business purpose" rule. Maintain the replacement holding for at least 30 days.');
      
      const hasLargeLtcgLoss = opportunities.some(o => o.gainType === 'LTCG');
      if (hasLargeLtcgLoss) {
        warnings.push('LTCG losses on equity can only be set off against taxable LTCG gains. Unabsorbed losses can be carried forward for 8 assessment years.');
      }
      
      const hasStcgLoss = opportunities.some(o => o.gainType === 'STCG');
      if (hasStcgLoss) {
        warnings.push('STCG losses can be set off against both STCG and LTCG gains. This provides higher immediate tax offsetting flexibility.');
      }
    }

    return {
      totalTaxSaving,
      opportunities,
      warnings,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const taxHarvestingEngine = new TaxHarvestingEngine();
export default taxHarvestingEngine;
