import { logger } from '../Logger';

export interface FundamentalVerdict {
  businessQuality: 'excellent' | 'good' | 'average' | 'weak';
  balanceSheetStrength: 'strong' | 'moderate' | 'leveraged' | 'distressed';
  cashFlowQuality: 'surplus' | 'adequate' | 'marginal' | 'negative';
  ownershipTrend: 'accumulation' | 'stable' | 'distribution';
  valuationVsPeers: 'cheap' | 'fair' | 'expensive' | 'premium';
  corporateRisk: 'low' | 'medium' | 'high';
  plainEnglishLabel: string;
  alphaConfirmation: boolean;
}

export class FundamentalVerdictEngine {
  /**
   * Generates a composite fundamental rating and verdict from various company data aspects.
   * Highly defensive: checks all possible data structures and fallback pathways.
   */
  static generateVerdict(aspects: Record<string, any>): FundamentalVerdict {
    const defaultVerdict: FundamentalVerdict = {
      businessQuality: 'average',
      balanceSheetStrength: 'moderate',
      cashFlowQuality: 'adequate',
      ownershipTrend: 'stable',
      valuationVsPeers: 'fair',
      corporateRisk: 'low',
      plainEnglishLabel: 'Insufficient fundamentals data to compile a complete verdict. Defaulting to neutral sector parameters.',
      alphaConfirmation: false
    };

    if (!aspects || Object.keys(aspects).length === 0) {
      return defaultVerdict;
    }

    try {
      const ratios = aspects['key-ratios'] || aspects['ratios'] || {};
      const profile = aspects['profile'] || {};
      const shareholding = aspects['shareholding'] || {};
      const balanceSheet = aspects['balance-sheet'] || aspects['balanceSheet'] || {};
      const cashFlow = aspects['cash-flow'] || aspects['cashFlow'] || {};
      const incomeStatement = aspects['income-statement'] || aspects['incomeStatement'] || {};
      const competitors = aspects['competitors'] || {};

      // Helper to extract nested numbers from varied API shapes
      const getNumValue = (obj: any, keys: string[], defaultValue: number = 0): number => {
        if (!obj) return defaultValue;
        for (const k of keys) {
          if (obj[k] !== undefined && obj[k] !== null) {
            const val = parseFloat(obj[k]);
            if (!isNaN(val)) return val;
          }
        }
        // Try searching inside nested arrays or objects if any
        if (typeof obj === 'object') {
          for (const k of Object.keys(obj)) {
            if (typeof obj[k] === 'object' && obj[k] !== null) {
              const res = getNumValue(obj[k], keys, -99999);
              if (res !== -99999) return res;
            }
          }
        }
        return defaultValue;
      };

      // 1. Business Quality: ROE, ROCE, Net Profit Margin
      const roe = getNumValue(ratios, ['roe', 'returnOnEquity', 'return_on_equity'], 12);
      const roce = getNumValue(ratios, ['roce', 'returnOnCapitalEmployed', 'return_on_capital_employed'], 12);
      const npm = getNumValue(ratios, ['netProfitMargin', 'net_profit_margin', 'npm'], 8);

      let businessQuality: 'excellent' | 'good' | 'average' | 'weak' = 'average';
      if (roe > 22 && roce > 25 && npm > 15) businessQuality = 'excellent';
      else if (roe > 15 || roce > 15 || npm > 10) businessQuality = 'good';
      else if (roe < 7 && npm < 4) businessQuality = 'weak';

      // 2. Balance Sheet Strength: Debt/Equity, Current Ratio
      const de = getNumValue(ratios, ['debtEquity', 'debt_equity', 'deRatio'], 0.5);
      const cr = getNumValue(ratios, ['currentRatio', 'current_ratio', 'cr'], 1.2);

      let balanceSheetStrength: 'strong' | 'moderate' | 'leveraged' | 'distressed' = 'moderate';
      if (de < 0.3 && cr > 1.8) balanceSheetStrength = 'strong';
      else if (de > 2.0) balanceSheetStrength = 'distressed';
      else if (de > 1.2 || cr < 1.0) balanceSheetStrength = 'leveraged';

      // 3. Cash Flow Quality: OCF vs Capex, or Net Cash Flow
      const ocf = getNumValue(cashFlow, ['operatingCashFlow', 'operating_cash_flow', 'ocf', 'cashFromOperations'], 100);
      const capex = getNumValue(cashFlow, ['capitalExpenditure', 'capex', 'capital_expenditures'], 50);

      let cashFlowQuality: 'surplus' | 'adequate' | 'marginal' | 'negative' = 'adequate';
      if (ocf > capex * 1.5 && ocf > 0) cashFlowQuality = 'surplus';
      else if (ocf < 0) cashFlowQuality = 'negative';
      else if (ocf < capex) cashFlowQuality = 'marginal';

      // 4. Ownership Trend: FII/DII purchases
      const fiiTrend = getNumValue(shareholding, ['fiiChange', 'fii_change', 'fiiHoldingChange'], 0);
      const promPledge = getNumValue(shareholding, ['promoterPledged', 'promoter_pledged', 'pledgedPercentage'], 0);

      let ownershipTrend: 'accumulation' | 'stable' | 'distribution' = 'stable';
      if (fiiTrend > 0.5) ownershipTrend = 'accumulation';
      else if (fiiTrend < -0.5) ownershipTrend = 'distribution';

      // 5. Valuation vs Competitors (PE vs industry avg)
      const pe = getNumValue(ratios, ['pe', 'priceToEarnings', 'pe_ratio'], 20);
      const compList = Array.isArray(competitors) ? competitors : (competitors.list || competitors.data || []);
      let totalCompPe = 0;
      let compCount = 0;
      
      if (Array.isArray(compList)) {
        compList.forEach(c => {
          const cPe = getNumValue(c, ['pe', 'peRatio', 'pe_ratio']);
          if (cPe > 0) {
            totalCompPe += cPe;
            compCount++;
          }
        });
      }
      const industryPe = compCount > 0 ? (totalCompPe / compCount) : 22;

      let valuationVsPeers: 'cheap' | 'fair' | 'expensive' | 'premium' = 'fair';
      if (pe < industryPe * 0.75) valuationVsPeers = 'cheap';
      else if (pe > industryPe * 1.4) valuationVsPeers = 'expensive';
      else if (pe > industryPe * 2.0 && businessQuality === 'excellent') valuationVsPeers = 'premium';

      // 6. Corporate Risk
      let corporateRisk: 'low' | 'medium' | 'high' = 'low';
      if (promPledge > 30) corporateRisk = 'high';
      else if (promPledge > 10 || de > 1.5) corporateRisk = 'medium';

      // 7. Plain English Verdict formulation
      const companyName = profile.companyName || profile.name || 'this security';
      const sector = profile.industry || profile.sector || 'its sector';
      
      let summaryText = `${companyName} exhibits a `;
      if (businessQuality === 'excellent') summaryText += 'superb operational efficiency profile';
      else if (businessQuality === 'good') summaryText += 'respectable commercial margin structure';
      else if (businessQuality === 'weak') summaryText += 'strained set of core operational returns';
      else summaryText += 'standard mid-tier operational return profile';

      summaryText += ` in the ${sector} industry. `;

      if (balanceSheetStrength === 'strong') summaryText += 'A highly liquid balance sheet with minimal debt leverage provides excellent margin of safety.';
      else if (balanceSheetStrength === 'distressed') summaryText += 'WARNING: Highly leveraged capital structure poses immediate systemic solvency risks.';
      else if (balanceSheetStrength === 'leveraged') summaryText += 'Elevated debt level requires close monitoring of interest coverage.';
      else summaryText += 'Capital leverage is well within normal parameters.';

      if (valuationVsPeers === 'cheap') summaryText += ` Trading at a discount relative to competitors (PE ${pe.toFixed(1)} vs Industry avg ${industryPe.toFixed(1)}).`;
      else if (valuationVsPeers === 'expensive') summaryText += ` Demanding a substantial pricing premium relative to industry peers.`;
      else if (valuationVsPeers === 'premium') summaryText += ` Premium pricing is supported by exceptional quality metrics.`;

      // 8. Alpha Confirmation criteria
      // We confirm positive alpha if:
      // - Business quality is good/excellent, AND balance sheet is strong/moderate, AND corporate risk is NOT high.
      const alphaConfirmation = (businessQuality === 'excellent' || businessQuality === 'good') &&
                               (balanceSheetStrength === 'strong' || balanceSheetStrength === 'moderate') &&
                               corporateRisk !== 'high';

      return {
        businessQuality,
        balanceSheetStrength,
        cashFlowQuality,
        ownershipTrend,
        valuationVsPeers,
        corporateRisk,
        plainEnglishLabel: summaryText,
        alphaConfirmation
      };
    } catch (err) {
      logger.error('Error generating Fundamental Verdict:', err);
      return defaultVerdict;
    }
  }
}
export default FundamentalVerdictEngine;
