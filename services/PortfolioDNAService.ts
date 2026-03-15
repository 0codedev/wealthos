import { Investment, InvestmentType, FactorExposure, CorrelationMatrix, DNAReport, MultiFactorResult, FrontierPoint, LotRecommendation, RiskProfile, RebalancePlan } from '../types';
import { logger } from './Logger';

// 6.5% annualized risk-free rate divided by 252 trading days
const DAILY_RISK_FREE_RATE = 0.065 / 252;

// 5-minute cache TTL (DNA heavy regression takes a few hundred ms)
const DNA_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  computedAt: number;
  signature: string;
  result: DNAReport;
}

export class PortfolioDNAService {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Helper to fetch historical price series from Yahoo Finance proxy
   */
  public async fetchHistoricalPrices(ticker: string): Promise<number[]> {
    try {
      // Map Nifty or Vix if needed, otherwise append .NS for Indian stocks
      let yahooSymbol = ticker.toUpperCase();
      if (!yahooSymbol.startsWith('^') && !yahooSymbol.includes('.')) {
        yahooSymbol = `${yahooSymbol}.NS`;
      }

      const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1y`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Yahoo Finance returns HTTP ${response.status}`);
      }

      const data = await response.json();
      const closePrices: number[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];

      // Filter out null values (market holidays, gaps)
      return closePrices.filter(p => p !== null && p !== undefined && p > 0);
    } catch (e) {
      logger.warn(`PortfolioDNAService: Failed to fetch prices for ${ticker}`, e);
      return [];
    }
  }

  /**
   * Compute daily returns from a price series
   */
  private computeDailyReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1];
      const curr = prices[i];
      returns.push((curr - prev) / prev);
    }
    return returns;
  }

  /**
   * Simple Ordinary Least Squares (OLS) linear regression
   * y = alpha + beta * x
   */
  private computeOLSRegression(y: number[], x: number[]): { alpha: number; beta: number; rSquared: number } {
    const n = Math.min(y.length, x.length);
    if (n < 5) return { alpha: 0, beta: 0, rSquared: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
    for (let i = 0; i < n; i++) {
      const xi = x[i];
      const yi = y[i];
      sumX += xi;
      sumY += yi;
      sumXY += xi * yi;
      sumXX += xi * xi;
      sumYY += yi * yi;
    }

    const meanX = sumX / n;
    const meanY = sumY / n;

    // Beta = Covariance(X,Y) / Variance(X)
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (x[i] - meanX) * (y[i] - meanY);
      den += (x[i] - meanX) ** 2;
    }

    const beta = den === 0 ? 0 : num / den;
    const alpha = meanY - beta * meanX;

    // R-Squared calculation
    let totalSS = 0; // Total sum of squares
    let residualSS = 0; // Residual sum of squares
    for (let i = 0; i < n; i++) {
      const actual = y[i];
      const predicted = alpha + beta * x[i];
      totalSS += (actual - meanY) ** 2;
      residualSS += (actual - predicted) ** 2;
    }

    const rSquared = totalSS === 0 ? 0 : 1 - (residualSS / totalSS);

    return { alpha, beta, rSquared };
  }

  /**
   * Compute standard deviation (volatility) of returns
   */
  private computeVolatility(returns: number[]): number {
    const n = returns.length;
    if (n < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / n;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (n - 1);
    return Math.sqrt(variance) * Math.sqrt(252); // Annualized volatility
  }

  /**
   * Compute Pearson correlation coefficient between two series
   */
  private computePearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;

    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;

    for (let i = 0; i < n; i++) {
      const diffX = x[i] - meanX;
      const diffY = y[i] - meanY;
      num += diffX * diffY;
      denX += diffX ** 2;
      denY += diffY ** 2;
    }

    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  // ============================================================
  // CC30 — Phase 1: Multi-Factor OLS Extension
  // ============================================================

  /**
   * 4×4 Gauss-Jordan matrix inversion with partial pivoting.
   * Returns null if matrix is singular (det ≈ 0).
   */
  private invertMatrix4x4(m: number[][]): number[][] | null {
    const n = 4;
    // Build augmented matrix [M | I]
    const aug: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) row.push(m[i][j]);
      for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
      aug.push(row);
    }

    for (let i = 0; i < n; i++) {
      // Find pivot (partial pivoting for stability)
      let pivotRow = i;
      let maxVal = Math.abs(aug[i][i]);
      for (let k = i + 1; k < n; k++) {
        const v = Math.abs(aug[k][i]);
        if (v > maxVal) {
          maxVal = v;
          pivotRow = k;
        }
      }
      if (maxVal < 1e-10) return null; // singular
      // Swap rows i and pivotRow
      if (pivotRow !== i) {
        const tmp = aug[i];
        aug[i] = aug[pivotRow];
        aug[pivotRow] = tmp;
      }
      // Scale pivot row
      const pivot = aug[i][i];
      for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
      // Eliminate other rows
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const factor = aug[k][i];
        if (factor === 0) continue;
        for (let j = 0; j < 2 * n; j++) {
          aug[k][j] -= factor * aug[i][j];
        }
      }
    }

    // Extract right half
    const inv: number[][] = [];
    for (let i = 0; i < n; i++) {
      inv.push(aug[i].slice(n));
    }
    return inv;
  }

  /**
   * 4-factor OLS regression
   *   R = α + β_m·Mkt + β_s·SMB + β_h·HML + β_mom·MOM + ε
   * Solved via normal equations:  β = (XᵀX)⁻¹XᵀY
   *
   * Returns CAPM-only fallback with `warning` if n < 10.
   */
  public computeMultiFactorOLS(
    returns: number[],
    marketReturns: number[],
    smbReturns: number[],
    hmlReturns: number[],
    momReturns: number[]
  ): MultiFactorResult {
    const n = Math.min(returns.length, marketReturns.length, smbReturns.length, hmlReturns.length, momReturns.length);

    if (n < 10) {
      // Graceful CAPM-only fallback
      const capm = this.computeOLSRegression(
        returns.map(r => r - DAILY_RISK_FREE_RATE),
        marketReturns.slice(0, n).map(r => r - DAILY_RISK_FREE_RATE)
      );
      return {
        alpha: capm.alpha,
        betaMarket: capm.beta,
        betaSMB: 0,
        betaHML: 0,
        betaMOM: 0,
        rSquared: capm.rSquared,
        adjRSquared: capm.rSquared,
        residualStd: 0,
        warning: 'Insufficient samples (<10) — CAPM-only result returned'
      };
    }

    // Build X matrix [1, M, S, H, Mo] (n × 5) — we solve the 5x5 normal equations
    //   but extract just the 4 factor loadings.  Include intercept column.
    const k = 5; // intercept + 4 factors
    const XtX: number[][] = Array(k).fill(0).map(() => Array(k).fill(0));
    const XtY: number[] = Array(k).fill(0);

    for (let t = 0; t < n; t++) {
      const yi = returns[t] - DAILY_RISK_FREE_RATE;
      const row = [1, marketReturns[t], smbReturns[t], hmlReturns[t], momReturns[t]];
      for (let i = 0; i < k; i++) {
        XtY[i] += row[i] * yi;
        for (let j = 0; j < k; j++) {
          XtX[i][j] += row[i] * row[j];
        }
      }
    }

    // 5×5 Gauss-Jordan invert
    const inv = this.invert5x5(XtX);
    if (!inv) {
      // Singular — return zeros with warning
      return {
        alpha: 0, betaMarket: 0, betaSMB: 0, betaHML: 0, betaMOM: 0,
        rSquared: 0, adjRSquared: 0, residualStd: 0,
        warning: 'Singular XᵀX matrix — factors collinear'
      };
    }

    // β = inv(XtX) · XtY
    const beta: number[] = Array(k).fill(0);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) beta[i] += inv[i][j] * XtY[j];
    }

    // Compute R² and residuals
    let totalSS = 0;
    let residualSS = 0;
    const meanY = returns.reduce((a, b) => a + b, 0) / n;
    let residualSum = 0;
    for (let t = 0; t < n; t++) {
      const yi = returns[t] - DAILY_RISK_FREE_RATE;
      const predicted = beta[0] + beta[1] * marketReturns[t] + beta[2] * smbReturns[t]
        + beta[3] * hmlReturns[t] + beta[4] * momReturns[t];
      const resid = yi - predicted;
      residualSS += resid * resid;
      residualSum += resid;
      totalSS += (returns[t] - meanY) ** 2;
    }
    const rSquared = totalSS === 0 ? 0 : Math.max(0, Math.min(1, 1 - residualSS / totalSS));
    const adjRSquared = 1 - (1 - rSquared) * (n - 1) / (n - k);
    const residualStd = Math.sqrt(residualSS / (n - k));

    return {
      alpha: beta[0],
      betaMarket: beta[1],
      betaSMB: beta[2],
      betaHML: beta[3],
      betaMOM: beta[4],
      rSquared,
      adjRSquared,
      residualStd
    };
  }

  /**
   * 5×5 Gauss-Jordan invert (re-uses the 4×4 logic via dynamic size).
   */
  private invert5x5(m: number[][]): number[][] | null {
    const n = 5;
    const aug: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) row.push(m[i][j]);
      for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
      aug.push(row);
    }

    for (let i = 0; i < n; i++) {
      let pivotRow = i;
      let maxVal = Math.abs(aug[i][i]);
      for (let k = i + 1; k < n; k++) {
        const v = Math.abs(aug[k][i]);
        if (v > maxVal) { maxVal = v; pivotRow = k; }
      }
      if (maxVal < 1e-10) return null;
      if (pivotRow !== i) {
        const tmp = aug[i]; aug[i] = aug[pivotRow]; aug[pivotRow] = tmp;
      }
      const pivot = aug[i][i];
      for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const factor = aug[k][i];
        if (factor === 0) continue;
        for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
      }
    }

    const inv: number[][] = [];
    for (let i = 0; i < n; i++) inv.push(aug[i].slice(n));
    return inv;
  }

  /**
   * Compute momentum factor: 1-month return per asset.
   * lookback default = 21 trading days
   */
  public computeMomentumFactor(returns: number[], lookback: number = 21): number {
    if (returns.length < lookback) {
      // Use all available history
      return returns.reduce((a, b) => a + b, 0);
    }
    let sum = 0;
    for (let i = returns.length - lookback; i < returns.length; i++) {
      sum += returns[i];
    }
    return sum;
  }

  /**
   * Markowitz mean-variance optimization.
   * Returns the optimal weights (sum=1) for the given target annualized return.
   * Falls back to equal-weight if covariance matrix is singular.
   */
  public computeOptimalFrontier(
    holdings: Investment[],
    targetReturn: number,
    returnsMatrix: number[][] // [n_periods][n_assets]
  ): { weights: number[]; variance: number; expectedReturn: number } {
    const n = holdings.length;
    if (n === 0 || returnsMatrix.length < 5) {
      return { weights: [], variance: 0, expectedReturn: 0 };
    }

    // Means (annualized)
    const means: number[] = [];
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let t = 0; t < returnsMatrix.length; t++) s += returnsMatrix[t][j] || 0;
      means.push((s / returnsMatrix.length) * 252);
    }

    // Covariance matrix (annualized) — sample covariance
    const T = returnsMatrix.length;
    const cov: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let s = 0;
        for (let t = 0; t < T; t++) {
          s += ((returnsMatrix[t][i] || 0) - means[i] / 252)
            * ((returnsMatrix[t][j] || 0) - means[j] / 252);
        }
        cov[i][j] = cov[j][i] = (s / (T - 1)) * 252;
      }
    }

    // Solve min wᵀΣw  s.t.  μᵀw = target, 1ᵀw = 1
    // Use Lagrangian with KKT: [Σ μ; μᵀ 0; 1ᵀ 0] · [w; λ1; λ2] = [0; target; 1]
    const dim = n + 2;
    const KKT: number[][] = Array(dim).fill(0).map(() => Array(dim).fill(0));
    const rhs: number[] = Array(dim).fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) KKT[i][j] = cov[i][j];
      KKT[i][n] = means[i];
      KKT[i][n + 1] = 1;
      KKT[n][i] = means[i];
      KKT[n + 1][i] = 1;
    }
    rhs[n] = targetReturn;
    rhs[n + 1] = 1;

    // Solve via Gauss-Jordan
    const sol = this.solveLinearSystem(KKT, rhs, dim);
    if (!sol) {
      // Fallback to equal-weight
      const w = Array(n).fill(1 / n);
      let var_ = 0;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) var_ += w[i] * w[j] * cov[i][j];
      }
      return { weights: w, variance: var_, expectedReturn: targetReturn };
    }

    const w = sol.slice(0, n);
    // Clip negative weights to 0 and renormalize (long-only constraint)
    const clipped = w.map(x => Math.max(0, x));
    const sum = clipped.reduce((a, b) => a + b, 0);
    const finalW = sum > 0 ? clipped.map(x => x / sum) : Array(n).fill(1 / n);

    let var_ = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) var_ += finalW[i] * finalW[j] * cov[i][j];
    }
    let er = 0;
    for (let i = 0; i < n; i++) er += finalW[i] * means[i];

    return { weights: finalW, variance: var_, expectedReturn: er };
  }

  /**
   * Generic n×n linear system solver (Gauss-Jordan with partial pivot).
   */
  private solveLinearSystem(A: number[][], b: number[], n: number): number[] | null {
    // Build augmented [A | b]
    const aug: number[][] = A.map((row, i) => [...row, b[i]]);

    for (let i = 0; i < n; i++) {
      let pivotRow = i;
      let maxVal = Math.abs(aug[i][i]);
      for (let k = i + 1; k < n; k++) {
        const v = Math.abs(aug[k][i]);
        if (v > maxVal) { maxVal = v; pivotRow = k; }
      }
      if (maxVal < 1e-10) return null;
      if (pivotRow !== i) {
        const tmp = aug[i]; aug[i] = aug[pivotRow]; aug[pivotRow] = tmp;
      }
      const pivot = aug[i][i];
      for (let j = 0; j <= n; j++) aug[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const factor = aug[k][i];
        if (factor === 0) continue;
        for (let j = 0; j <= n; j++) aug[k][j] -= factor * aug[i][j];
      }
    }

    return aug.map(row => row[n]);
  }

  /**
   * Generate the full Markowitz efficient frontier (50 points from min to max return).
   * Used for the live Sharpe frontier mini-chart.
   */
  public computeFullFrontier(
    holdings: Investment[],
    returnsMatrix: number[][]
  ): FrontierPoint[] {
    if (holdings.length === 0) return [];
    const n = holdings.length;
    const T = returnsMatrix.length;
    if (T < 5) return [];

    // Compute means and covariance once
    const means: number[] = [];
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += returnsMatrix[t][j] || 0;
      means.push((s / T) * 252);
    }

    const cov: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let s = 0;
        for (let t = 0; t < T; t++) {
          s += ((returnsMatrix[t][i] || 0) - means[i] / 252)
            * ((returnsMatrix[t][j] || 0) - means[j] / 252);
        }
        cov[i][j] = cov[j][i] = (s / (T - 1)) * 252;
      }
    }

    const minR = Math.min(...means);
    const maxR = Math.max(...means);
    const points: FrontierPoint[] = [];
    const STEPS = 30;
    for (let s = 0; s <= STEPS; s++) {
      const target = minR + (maxR - minR) * (s / STEPS);
      const result = this.computeOptimalFrontier(holdings, target, returnsMatrix);
      const vol = Math.sqrt(result.variance);
      const sharpe = vol === 0 ? 0 : (result.expectedReturn - 0.065) / vol;
      points.push({
        variance: result.variance,
        volatility: vol,
        expectedReturn: result.expectedReturn,
        sharpe,
        weights: result.weights
      });
    }
    return points;
  }

  // ============================================================
  // CC30 — Phase 2: Smart Rebalancing Recommendations
  // ============================================================

  /**
   * Generate a tax-aware rebalance plan for the given risk profile.
   * Prefers selling long-term lots (>365 days) first to minimize tax.
   */
  public generateRebalancePlan(
    current: Investment[],
    target: RiskProfile,
    report?: DNAReport | null
  ): RebalancePlan {
    const profile: RiskProfile = target;
    const equityHoldings = current.filter(inv =>
      inv.ticker &&
      [InvestmentType.STOCKS, InvestmentType.MUTUAL_FUND, InvestmentType.ETF].includes(inv.type)
    );

    if (equityHoldings.length === 0) {
      return {
        profile,
        recommendations: [],
        expectedSharpe: 0,
        expectedVolatility: 0,
        expectedBeta: 0,
        targetVolatility: 0,
        generatedAt: new Date().toISOString()
      };
    }

    // Define target beta range and weights per profile
    const profileConfig: Record<RiskProfile, { targetBeta: number; betaMin: number; betaMax: number; targetVol: number; tilt: 'value' | 'core' | 'momentum' }> = {
      conservative: { targetBeta: 0.7, betaMin: 0.6, betaMax: 0.8, targetVol: 0.10, tilt: 'value' },
      balanced:     { targetBeta: 1.0, betaMin: 0.9, betaMax: 1.1, targetVol: 0.15, tilt: 'core' },
      aggressive:   { targetBeta: 1.35, betaMin: 1.2, betaMax: 1.5, targetVol: 0.22, tilt: 'momentum' }
    };
    const cfg = profileConfig[profile];

    // Map ticker -> exposure
    const exposureMap: Record<string, FactorExposure> = {};
    if (report) {
      for (const e of report.factorExposures) exposureMap[e.ticker] = e;
    }

    // Current weights
    const totalVal = equityHoldings.reduce((s, h) => s + h.currentValue, 0) || 1;
    const currentWeights: Record<string, number> = {};
    equityHoldings.forEach(h => {
      currentWeights[h.ticker as string] = (h.currentValue / totalVal) * 100;
    });

    // Compute current portfolio beta (weighted avg of exposure betas)
    let currentBeta = 0;
    for (const h of equityHoldings) {
      const e = exposureMap[h.ticker as string];
      const b = e?.beta ?? 1;
      currentBeta += b * (h.currentValue / totalVal);
    }

    // Target weights via score-based tilt + beta-drift adjustment
    const tickers = equityHoldings.map(h => h.ticker as string);
    const rawScores: Record<string, number> = {};
    for (const t of tickers) {
      const e = exposureMap[t];
      let score = 1;
      if (e) {
        if (cfg.tilt === 'value') {
          score += (e.hmlLoading + 1) * 0.6; // value tilt
          score += Math.max(0, 1.2 - e.beta) * 0.3; // low beta
        } else if (cfg.tilt === 'momentum') {
          score += Math.max(0, e.beta - 1) * 0.4;
          score += e.sharpe * 0.3; // high sharpe
        } else {
          score += 0.5; // neutral
        }
      } else {
        score = 1;
      }
      rawScores[t] = score;
    }
    const scoreSum = Object.values(rawScores).reduce((a, b) => a + b, 0) || 1;
    const targetWeights: Record<string, number> = {};
    for (const t of tickers) targetWeights[t] = (rawScores[t] / scoreSum) * 100;

    // Build recommendations
    const recs: LotRecommendation[] = [];
    for (const h of equityHoldings) {
      const t = h.ticker as string;
      const curr = currentWeights[t] || 0;
      const tgt = targetWeights[t] || 0;
      const delta = tgt - curr;
      const absDelta = Math.abs(delta);

      if (absDelta < 0.5) {
        recs.push({
          ticker: t,
          action: 'HOLD',
          weightChange: 0,
          lots: 0,
          taxImpact: 0,
          sharpeImpact: 0,
          rationale: 'Within tolerance band (Δ < 0.5 pp)'
        });
        continue;
      }

      // Compute lot size
      const pricePerUnit = h.quantity && h.quantity > 0 ? h.currentValue / h.quantity : 0;
      const totalTradeValue = (absDelta / 100) * totalVal;
      const lots = pricePerUnit > 0 ? Math.max(1, Math.round(totalTradeValue / pricePerUnit)) : 0;

      // Tax-aware: prefer long-term lots (>365d) — capital gains logic
      let taxImpact = 0;
      if (delta < 0) {
        const isLongTerm = h.acquiredAt
          ? (Date.now() - new Date(h.acquiredAt).getTime()) > 365 * 24 * 60 * 60 * 1000
          : false;
        const gain = h.currentValue - h.investedAmount;
        const gainPerLot = lots > 0 ? (gain * (absDelta / 100) * totalVal) / h.currentValue : 0;
        // LTCG > ₹1L @ 10% (India); STCG @ 15%
        if (isLongTerm) {
          taxImpact = Math.max(0, (gainPerLot - 100000) * 0.10);
        } else {
          taxImpact = Math.max(0, gainPerLot * 0.15);
        }
      }

      // Sharpe impact estimate — heuristic
      const e = exposureMap[t];
      const sharpeImpact = e
        ? (delta > 0 ? e.sharpe * 0.05 : -e.sharpe * 0.02)
        : (delta > 0 ? 0.02 : -0.01);

      const rationale = delta > 0
        ? cfg.tilt === 'value'
          ? `Underweight value/quality name vs ${profile} target`
          : cfg.tilt === 'momentum'
            ? `Underweight high-beta/momentum tilt vs ${profile} target`
            : `Re-balance to ${profile} market-cap weight`
        : cfg.tilt === 'value'
          ? `Trim high-beta to lower portfolio β toward ${cfg.targetBeta}`
          : `Trim to ${profile} risk profile`;

      recs.push({
        ticker: t,
        action: delta > 0 ? 'BUY' : 'SELL',
        weightChange: parseFloat(delta.toFixed(2)),
        lots,
        taxImpact: parseFloat((-taxImpact).toFixed(0)),
        sharpeImpact: parseFloat(sharpeImpact.toFixed(3)),
        rationale
      });
    }

    // Sort: SELL first (tax-aware — long-term lots first by largest gain)
    recs.sort((a, b) => {
      if (a.action === 'SELL' && b.action !== 'SELL') return -1;
      if (a.action !== 'SELL' && b.action === 'SELL') return 1;
      if (a.action === 'SELL' && b.action === 'SELL') {
        return a.taxImpact - b.taxImpact; // least-tax-impact first (long-term sold)
      }
      return Math.abs(b.weightChange) - Math.abs(a.weightChange);
    });

    // Portfolio expected stats
    let expectedBeta = 0, expectedVol = 0, expectedSharpe = 0;
    for (const t of tickers) {
      const e = exposureMap[t];
      const w = (targetWeights[t] || 0) / 100;
      if (e) {
        expectedBeta += e.beta * w;
        expectedVol += e.volatility * w;
        expectedSharpe += e.sharpe * w;
      }
    }

    return {
      profile,
      recommendations: recs,
      expectedSharpe: parseFloat(expectedSharpe.toFixed(2)),
      expectedVolatility: parseFloat(expectedVol.toFixed(2)),
      expectedBeta: parseFloat(expectedBeta.toFixed(2)),
      targetVolatility: cfg.targetVol * 100,
      generatedAt: new Date().toISOString()
    };
  }

  // ============================================================
  // Cache helpers
  // ============================================================

  private signatureFor(investments: Investment[]): string {
    // Cache key = sorted (id+value) — invalidated on any change
    return investments
      .filter(i => i.ticker)
      .map(i => `${i.id}:${Math.round(i.currentValue)}:${Math.round(i.investedAmount)}`)
      .sort()
      .join('|');
  }

  /**
   * Public helper to expose the current portfolio signature.
   */
  public getCacheSignature(investments: Investment[]): string {
    return this.signatureFor(investments);
  }

  /**
   * Drop the entire cache (useful when ticker set changes).
   */
  public invalidateCache(): void {
    this.cache.clear();
  }

  // ============================================================
  // Main entry point
  // ============================================================

  public async generateDNAReport(investments: Investment[]): Promise<DNAReport> {
    const signature = this.signatureFor(investments);
    const cached = this.cache.get(signature);
    if (cached && Date.now() - cached.computedAt < DNA_CACHE_TTL_MS) {
      return cached.result;
    }

    const equityHoldings = investments.filter(inv =>
      inv.ticker &&
      [InvestmentType.STOCKS, InvestmentType.MUTUAL_FUND, InvestmentType.ETF].includes(inv.type)
    );

    const result: DNAReport = {
      generatedAt: new Date().toISOString(),
      factorExposures: [],
      correlationMatrix: { tickers: [], matrix: [] },
      concentrationScore: 0,
      diversificationScore: 100,
      riskInsights: []
    };

    if (equityHoldings.length === 0) {
      result.riskInsights.push('No equity/ETF holdings found. Add assets with valid tickers to run Portfolio DNA.');
      this.cache.set(signature, { computedAt: Date.now(), signature, result });
      return result;
    }

    // 1. Fetch Market Benchmark (Nifty 50) prices
    const marketClosePrices = await this.fetchHistoricalPrices('^NSEI');
    if (marketClosePrices.length < 10) {
      result.riskInsights.push('Failed to download NIFTY 50 benchmark data. Analysis fallback applied.');
      this.cache.set(signature, { computedAt: Date.now(), signature, result });
      return result;
    }
    const marketReturns = this.computeDailyReturns(marketClosePrices);

    // 2. Fetch prices for each holding in parallel
    const holdingsData: Record<string, { returns: number[]; prices: number[] }> = {};
    const tickers = equityHoldings.map(h => h.ticker as string);

    await Promise.all(tickers.map(async (ticker) => {
      const prices = await this.fetchHistoricalPrices(ticker);
      if (prices.length >= 10) {
        holdingsData[ticker] = {
          prices,
          returns: this.computeDailyReturns(prices)
        };
      }
    }));

    const validTickers = Object.keys(holdingsData);
    if (validTickers.length === 0) {
      result.riskInsights.push('Failed to load historical data for portfolio assets. Check internet or API logs.');
      this.cache.set(signature, { computedAt: Date.now(), signature, result });
      return result;
    }

    // 3. Compute factor metrics & regressions
    // We compute SMB/HML proxies by sorting the portfolio's assets
    const avgInvested = equityHoldings.reduce((sum, h) => sum + h.investedAmount, 0) / equityHoldings.length;
    const largeCaps = equityHoldings.filter(h => h.investedAmount >= avgInvested).map(h => h.ticker as string);
    const smallCaps = equityHoldings.filter(h => h.investedAmount < avgInvested).map(h => h.ticker as string);

    // Create synthetic SMB (Small minus Big returns proxy)
    const smbReturns: number[] = [];
    const hmlReturns: number[] = []; // Value minus Growth returns proxy
    const len = marketReturns.length;

    for (let i = 0; i < len; i++) {
      // Average return of small caps in daily step
      let smallSum = 0, smallCount = 0;
      let largeSum = 0, largeCount = 0;

      for (const t of validTickers) {
        const ret = holdingsData[t].returns[i] || 0;
        if (smallCaps.includes(t)) {
          smallSum += ret;
          smallCount++;
        } else {
          largeSum += ret;
          largeCount++;
        }
      }

      const avgSmall = smallCount > 0 ? smallSum / smallCount : 0;
      const avgLarge = largeCount > 0 ? largeSum / largeCount : 0;

      // SMB = small return - large return
      smbReturns.push(avgSmall - avgLarge);

      // Value vs Growth: assume small caps / lower price volatility are value-skewed, high volatility are growth-skewed
      hmlReturns.push(avgLarge * 0.5 - avgSmall * 0.2); // synthetic tilt
    }

    // 4. Calculate Factor Exposures per Asset (using 4-factor OLS)
    const exposures: FactorExposure[] = [];
    for (const ticker of validTickers) {
      const assetReturns = holdingsData[ticker].returns;
      const vol = this.computeVolatility(assetReturns);

      // excess returns for OLS
      const excessAsset = assetReturns.map(r => r - DAILY_RISK_FREE_RATE);
      const excessMarket = marketReturns.map(r => r - DAILY_RISK_FREE_RATE);

      // 1. Single Index OLS for Beta & Alpha (CAPM) — kept for backward compat
      const regression = this.computeOLSRegression(excessAsset, excessMarket);

      // 2. Compute momentum factor (1-month return)
      const mom = this.computeMomentumFactor(assetReturns, 21);

      // 3. 4-factor OLS: Mkt + SMB + HML + MOM
      const len4 = Math.min(assetReturns.length, marketReturns.length, smbReturns.length, hmlReturns.length);
      const ols4 = this.computeMultiFactorOLS(
        assetReturns.slice(0, len4),
        marketReturns.slice(0, len4),
        smbReturns.slice(0, len4),
        hmlReturns.slice(0, len4),
        // Build momentum series: shift a 21-day window return into each row
        this.buildMomentumSeries(assetReturns, 21).slice(0, len4)
      );

      // Use 4-factor beta + alpha if multi-factor succeeded, else CAPM fallback
      const finalBeta = ols4.warning ? regression.beta : ols4.betaMarket;
      const finalAlpha = ols4.warning ? regression.alpha * 252 * 100 : ols4.alpha * 252 * 100;

      // Annualized Sharpe Ratio
      const meanDailyReturn = assetReturns.reduce((a, b) => a + b, 0) / assetReturns.length;
      const annualizedReturn = meanDailyReturn * 252;
      const sharpe = vol === 0 ? 0 : (annualizedReturn - 0.065) / vol;

      // Use 4-factor loadings for SMB/HML/MOM
      exposures.push({
        ticker,
        alpha: parseFloat(finalAlpha.toFixed(2)),
        beta: parseFloat(finalBeta.toFixed(2)),
        smbLoading: parseFloat(ols4.betaSMB.toFixed(2)),
        hmlLoading: parseFloat(ols4.betaHML.toFixed(2)),
        rSquared: parseFloat((ols4.warning ? regression.rSquared : ols4.rSquared).toFixed(2)),
        volatility: parseFloat((vol * 100).toFixed(2)),
        sharpe: parseFloat(sharpe.toFixed(2))
      });
    }

    result.factorExposures = exposures;

    // 5. Build Pairwise Correlation Matrix
    const matrixSize = validTickers.length;
    const matrix: number[][] = Array(matrixSize).fill(0).map(() => Array(matrixSize).fill(0));

    for (let i = 0; i < matrixSize; i++) {
      for (let j = 0; j < matrixSize; j++) {
        if (i === j) {
          matrix[i][j] = 1.0;
        } else {
          const t1 = validTickers[i];
          const t2 = validTickers[j];
          matrix[i][j] = parseFloat(this.computePearsonCorrelation(
            holdingsData[t1].returns,
            holdingsData[t2].returns
          ).toFixed(2));
        }
      }
    }

    result.correlationMatrix = {
      tickers: validTickers,
      matrix
    };

    // 6. Diversification & Concentration Scores
    const totalCurrentVal = equityHoldings.reduce((sum, h) => sum + h.currentValue, 0) || 1;
    let hhi = 0;
    equityHoldings.forEach(h => {
      const weight = (h.currentValue / totalCurrentVal) * 100;
      hhi += weight ** 2;
    });

    const concentrationScore = Math.min(100, Math.round((hhi / 10000) * 100));
    result.concentrationScore = concentrationScore;

    let sumCorrelation = 0;
    let correlationPairsCount = 0;
    for (let i = 0; i < matrixSize; i++) {
      for (let j = i + 1; j < matrixSize; j++) {
        sumCorrelation += matrix[i][j];
        correlationPairsCount++;
      }
    }

    const avgCorr = correlationPairsCount > 0 ? sumCorrelation / correlationPairsCount : 0.2;
    const diversificationFactor = Math.max(0, 1 - avgCorr);
    const divScore = Math.round((100 - concentrationScore) * diversificationFactor);
    result.diversificationScore = Math.max(10, Math.min(100, divScore));

    // 7. Formulate NL Insights
    const highBetaHolding = exposures.reduce((max, e) => e.beta > max.beta ? e : max, exposures[0]);
    if (highBetaHolding && highBetaHolding.beta > 1.3) {
      result.riskInsights.push(`⚠️ ${highBetaHolding.ticker} is highly sensitive to market movements (Beta = ${highBetaHolding.beta}). Consider adding low-beta or cash alternatives to cushion drawdowns.`);
    }

    const negativeAlphaHolding = exposures.filter(e => e.alpha < -2).sort((a, b) => a.alpha - b.alpha)[0];
    if (negativeAlphaHolding) {
      result.riskInsights.push(`📉 ${negativeAlphaHolding.ticker} is underperforming its risk-adjusted benchmark (Alpha = ${negativeAlphaHolding.alpha.toFixed(1)}%). Review its core thesis or exit.`);
    }

    const highlyCorrelatedPairs: string[] = [];
    for (let i = 0; i < matrixSize; i++) {
      for (let j = i + 1; j < matrixSize; j++) {
        if (matrix[i][j] > 0.80) {
          highlyCorrelatedPairs.push(`${validTickers[i]} ↔ ${validTickers[j]} (${(matrix[i][j] * 100).toFixed(0)}%)`);
        }
      }
    }

    if (highlyCorrelatedPairs.length > 0) {
      result.riskInsights.push(`🚨 Highly correlated pairs detected: ${highlyCorrelatedPairs.slice(0, 2).join(', ')}. These assets move together, reducing diversification benefits.`);
    }

    if (concentrationScore > 40) {
      result.riskInsights.push(`⚠️ High portfolio concentration detected (HHI skew). Your performance is overly dependent on your top 2 holdings.`);
    } else {
      result.riskInsights.push('✅ Excellent portfolio weight distribution. Concentration risks are low.');
    }

    const valueSkew = exposures.reduce((sum, e) => sum + e.hmlLoading, 0) / exposures.length;
    if (valueSkew > 0.3) {
      result.riskInsights.push('💼 Portfolio shows a strong Value tilt (defensive, low P/E preference). Tends to outperform during inflationary or rate-hiking cycles.');
    } else if (valueSkew < -0.1) {
      result.riskInsights.push('🚀 Portfolio tilts towards Growth (high Beta, momentum skew). Offers high upside during bull regimes but volatile in downturns.');
    }

    // Persist in cache
    this.cache.set(signature, { computedAt: Date.now(), signature, result });
    return result;
  }

  /**
   * Helper: build a rolling 21-day momentum series from returns.
   * series[t] = sum(returns[t-21..t-1])
   */
  private buildMomentumSeries(returns: number[], lookback: number): number[] {
    const out: number[] = [];
    let rolling = 0;
    for (let i = 0; i < returns.length; i++) {
      if (i < lookback) {
        rolling += returns[i];
        out.push(rolling);
      } else {
        rolling = rolling - returns[i - lookback] + returns[i];
        out.push(rolling);
      }
    }
    return out;
  }

  /**
   * Optimizes portfolio weights using deep reinforcement learning via FinRL (or local fallback).
   */
  public async optimizeWeightsWithRL(
    assets: string[],
    weights: number[],
    riskTolerance: string = 'medium'
  ): Promise<any> {
    try {
      const BRIDGE_URL = 'http://127.0.0.1:8765/api/portfolio/rebalance';
      const res = await fetch(BRIDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assets,
          weights,
          risk_tolerance: riskTolerance
        })
      });
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error('[FinRL Optimizer] Failed:', err);
      // Equal allocation fallback
      const n = assets.length;
      const targetWeights: Record<string, number> = {};
      for (const asset of assets) {
        targetWeights[asset] = n > 0 ? 1 / n : 0;
      }
      return {
        status: 'fallback',
        optimized_weights: targetWeights,
        recommendations: assets.map((asset, idx) => ({
          asset,
          current_weight: weights[idx],
          target_weight: n > 0 ? 1 / n : 0,
          action: 'HOLD',
          difference: 0
        }))
      };
    }
  }
}

export const portfolioDNAService = new PortfolioDNAService();
export default portfolioDNAService;

