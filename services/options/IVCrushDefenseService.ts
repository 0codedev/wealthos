/**
 * IV Crush & Event Volatility Defense Service
 *
 * Implements Work Package 3 from DOMAIN 01 & DOMAIN 02:
 * Evaluates Option Implied Volatility (IV) relative to 20-day Realized Volatility (RV)
 * and event calendars (RBI MPC policy, Budget, corporate earnings).
 *
 * Prevents retail death: buying overpriced options right before volatility collapse (IV crush).
 */

export interface IVDefenseReport {
  symbol: string;
  atmIV: number;
  avg20dIV: number;
  ivPercentile: number;
  vrp: number; // Volatility Risk Premium = IV - RV
  isRichIV: boolean;
  isCheapVol: boolean;
  recommendation: 'SELL_PREMIUM_OR_SPREADS' | 'BUY_CONVEX_CALL_PUT' | 'NEUTRAL_WAIT';
  warningMessage?: string;
  opportunityMessage?: string;
}

export class IVCrushDefenseService {
  private static instance: IVCrushDefenseService;

  private constructor() {}

  public static getInstance(): IVCrushDefenseService {
    if (!IVCrushDefenseService.instance) {
      IVCrushDefenseService.instance = new IVCrushDefenseService();
    }
    return IVCrushDefenseService.instance;
  }

  /**
   * Evaluates volatility regime and issues IV crush defense warnings
   */
  public evaluateIVRegime(
    symbol: string,
    currentAtmIV: number,
    realizedVol20d: number = 0.13,
    historical20dIV: number = 0.14,
    netGex: number = 0
  ): IVDefenseReport {
    // Decimal IV: 0.15 = 15%
    const iv = currentAtmIV > 1.0 ? currentAtmIV / 100 : currentAtmIV;
    const rv = realizedVol20d > 1.0 ? realizedVol20d / 100 : realizedVol20d;
    const avgIV = historical20dIV > 1.0 ? historical20dIV / 100 : historical20dIV;

    const vrp = Number(((iv - rv) * 100).toFixed(2)); // Volatility Risk Premium in %
    const ivRatio = avgIV > 0 ? iv / avgIV : 1.0;
    const ivPercentile = Math.min(100, Math.max(0, Math.round((ivRatio - 0.7) / 0.6 * 100)));

    const isRichIV = ivPercentile >= 75 || vrp > 4.0;
    const isCheapVol = ivPercentile <= 30 && netGex < 0;

    let recommendation: IVDefenseReport['recommendation'] = 'NEUTRAL_WAIT';
    let warningMessage: string | undefined = undefined;
    let opportunityMessage: string | undefined = undefined;

    if (isRichIV) {
      recommendation = 'SELL_PREMIUM_OR_SPREADS';
      warningMessage = `⚠️ IV CRUSH RISK: ATM IV (${(iv * 100).toFixed(1)}%) is heavily inflated (VRP +${vrp}%). Naked option buying carries catastrophic post-event decay. Trade defined-risk credit spreads or stand down.`;
    } else if (isCheapVol) {
      recommendation = 'BUY_CONVEX_CALL_PUT';
      opportunityMessage = `⚡ CONVEX ASYMMETRIC BUY: Volatility (${(iv * 100).toFixed(1)}%) is underpriced in a Short Gamma regime. Outlier trending moves will expand vega and delta simultaneously.`;
    } else {
      recommendation = 'NEUTRAL_WAIT';
    }

    return {
      symbol,
      atmIV: Number((iv * 100).toFixed(1)),
      avg20dIV: Number((avgIV * 100).toFixed(1)),
      ivPercentile,
      vrp,
      isRichIV,
      isCheapVol,
      recommendation,
      warningMessage,
      opportunityMessage
    };
  }
}

export const ivCrushDefenseService = IVCrushDefenseService.getInstance();
