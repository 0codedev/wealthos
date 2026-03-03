/**
 * Institutional Playbook Gate Service (Hick-Hyman Noise Defense)
 *
 * Implements DOMAIN 03 & DOMAIN 06:
 * Eliminates decision fatigue and cognitive overload by strictly limiting active trading
 * to exactly 3 institutional edge playbooks:
 *
 * 1. INDEX_TREND_EXPANSION (ORB + VWAP Anchor in Short Gamma / Trend Regime)
 * 2. GEX_WALL_MEAN_REVERSION (Gamma Wall Pinning & CVD Absorption in Long Gamma Regime)
 * 3. CASH_VCP_BREAKOUT (Minervini Volatility Contraction Pattern + Volume Dry-Up)
 *
 * Any trade that fails to qualify under one of these 3 is flagged as 'NOISE_CHOP'
 * and the execution terminal is hard-locked.
 */

export type PlaybookType =
  | 'INDEX_TREND_EXPANSION'
  | 'GEX_WALL_MEAN_REVERSION'
  | 'CASH_VCP_BREAKOUT'
  | 'NOISE_CHOP';

export interface PlaybookCriteria {
  id: string;
  name: string;
  isMet: boolean;
  actual: string;
  required: string;
}

export interface PlaybookQualification {
  playbook: PlaybookType;
  title: string;
  subtitle: string;
  regimeFit: string;
  isQualified: boolean;
  score: number; // 0 - 100
  criteria: PlaybookCriteria[];
  recommendedExecution: string;
  stopRule: string;
  targetRule: string;
  warningAlert?: string;
}

export interface PlaybookAuditResult {
  symbol: string;
  selectedPlaybook: PlaybookType;
  isAllowedToTrade: boolean;
  lockoutReason?: string;
  playbooks: Record<PlaybookType, PlaybookQualification>;
  primaryPlaybook: PlaybookQualification;
}

export class PlaybookGateService {
  private static instance: PlaybookGateService;

  private constructor() {}

  public static getInstance(): PlaybookGateService {
    if (!PlaybookGateService.instance) {
      PlaybookGateService.instance = new PlaybookGateService();
    }
    return PlaybookGateService.instance;
  }

  /**
   * Evaluates the 3 Institutional Playbooks for any symbol and market telemetry
   */
  public auditPlaybooks(params: {
    symbol: string;
    spot: number;
    vwap: number;
    openRangeHigh: number;
    openRangeLow: number;
    currentVolume: number;
    avgVolume20: number;
    callWall: number;
    putWall: number;
    zeroGammaLevel: number;
    isLongGamma: boolean;
    hasCvdAbsorption: boolean;
    vcpContractions?: number;
    volumeContractionPct?: number; // e.g. 60 for 60% drop
    rsRating?: number; // 1-99
    isCashStock?: boolean;
  }): PlaybookAuditResult {
    const {
      symbol,
      spot,
      vwap,
      openRangeHigh,
      openRangeLow,
      currentVolume,
      avgVolume20,
      callWall,
      putWall,
      zeroGammaLevel,
      isLongGamma,
      hasCvdAbsorption,
      vcpContractions = 0,
      volumeContractionPct = 0,
      rsRating = 50,
      isCashStock = false
    } = params;

    const volRatio = avgVolume20 > 0 ? currentVolume / avgVolume20 : 1.0;

    // ──────────────────────────────────────────────────────────────────────────
    // PLAYBOOK 1: INDEX TREND EXPANSION (ORB + VWAP Hold)
    // ──────────────────────────────────────────────────────────────────────────
    const isAboveORB = spot > openRangeHigh;
    const isBelowORB = spot < openRangeLow;
    const isAboveVwap = spot > vwap;
    const isBelowVwap = spot < vwap;
    const isVolExpanding = volRatio >= 1.25;
    const isShortGammaOrBreakout = !isLongGamma || Math.abs(spot - zeroGammaLevel) > 50;

    const pb1Criteria: PlaybookCriteria[] = [
      {
        id: 'orb_break',
        name: 'Opening Range Breakout (15m/30m High/Low)',
        isMet: isAboveORB || isBelowORB,
        actual: isAboveORB ? `Broke High (+${(spot - openRangeHigh).toFixed(1)} pts)` : isBelowORB ? `Broke Low (-${(openRangeLow - spot).toFixed(1)} pts)` : 'Inside Range',
        required: `Spot outside [${openRangeLow.toFixed(0)} - ${openRangeHigh.toFixed(0)}]`
      },
      {
        id: 'vwap_polarity',
        name: 'VWAP Polarity Confirmation',
        isMet: (isAboveORB && isAboveVwap) || (isBelowORB && isBelowVwap),
        actual: isAboveVwap ? `Above VWAP (+${(spot - vwap).toFixed(1)} pts)` : `Below VWAP (-${(vwap - spot).toFixed(1)} pts)`,
        required: 'Bullish above VWAP / Bearish below VWAP'
      },
      {
        id: 'volume_expansion',
        name: 'Volume Expansion (≥1.25x 20-MA)',
        isMet: isVolExpanding,
        actual: `${volRatio.toFixed(2)}x of 20-MA`,
        required: '≥ 1.25x baseline'
      },
      {
        id: 'gamma_acceleration',
        name: 'Gamma Regime Compatibility',
        isMet: isShortGammaOrBreakout,
        actual: isLongGamma ? 'Long Gamma (Mean Reverting)' : 'Short Gamma (High Momentum)',
        required: 'Short Gamma or >50pts past S₀ Flip'
      }
    ];

    const pb1Score = Math.round((pb1Criteria.filter(c => c.isMet).length / pb1Criteria.length) * 100);
    const pb1Qualified = pb1Score >= 75 && (isAboveORB || isBelowORB);

    const pb1: PlaybookQualification = {
      playbook: 'INDEX_TREND_EXPANSION',
      title: 'Index Trend Expansion',
      subtitle: 'ORB Breakout + VWAP Anchor in Accelerating Gamma',
      regimeFit: 'Short Gamma / High Volatility / Trending Days',
      isQualified: pb1Qualified,
      score: pb1Score,
      criteria: pb1Criteria,
      recommendedExecution: isAboveORB ? 'Buy ATM/Slight ITM Call or Long Future' : 'Buy ATM/Slight ITM Put or Short Future',
      stopRule: 'Trailing VWAP or breach of 15m pullback swing pivot',
      targetRule: '1:2 R:R minimum or +1.5x Daily ATR'
    };

    // ──────────────────────────────────────────────────────────────────────────
    // PLAYBOOK 2: GEX WALL MEAN REVERSION (Gamma Pinning & Fade)
    // ──────────────────────────────────────────────────────────────────────────
    const nearCallWall = callWall > 0 && Math.abs(spot - callWall) / callWall <= 0.0035; // within 0.35%
    const nearPutWall = putWall > 0 && Math.abs(spot - putWall) / putWall <= 0.0035;
    const isAtWall = nearCallWall || nearPutWall;
    const wallType = nearCallWall ? 'Call Wall (Ceiling)' : nearPutWall ? 'Put Wall (Floor)' : 'None';

    const pb2Criteria: PlaybookCriteria[] = [
      {
        id: 'gex_wall_proximity',
        name: 'Proximity to Dealer Major GEX Wall (≤0.35%)',
        isMet: isAtWall,
        actual: isAtWall ? `Near ${wallType} at ₹${nearCallWall ? callWall : putWall}` : 'Spot mid-range',
        required: 'Within 0.35% of Call/Put Wall'
      },
      {
        id: 'long_gamma_regime',
        name: 'Long Gamma Stabilizing Regime (Dealers Dampen)',
        isMet: isLongGamma,
        actual: isLongGamma ? '🟢 Long Gamma (Pinning active)' : '🔴 Short Gamma (Risk of wall breach)',
        required: 'Aggregate Net GEX > 0'
      },
      {
        id: 'orderflow_absorption',
        name: 'CVD Order Flow Absorption Divergence',
        isMet: hasCvdAbsorption,
        actual: hasCvdAbsorption ? '🟢 Delta Absorption Detected' : 'No Divergence',
        required: 'Tails absorbing aggressively at wall'
      },
      {
        id: 'mean_reversion_headroom',
        name: 'Headroom to S₀ Zero Gamma Level',
        isMet: zeroGammaLevel > 0 && Math.abs(spot - zeroGammaLevel) >= 30,
        actual: zeroGammaLevel > 0 ? `${Math.abs(spot - zeroGammaLevel).toFixed(0)} pts to S₀` : 'N/A',
        required: '≥ 30 points to Zero Gamma line'
      }
    ];

    const pb2Score = Math.round((pb2Criteria.filter(c => c.isMet).length / pb2Criteria.length) * 100);
    const pb2Qualified = pb2Score >= 75 && isAtWall && isLongGamma;

    const pb2: PlaybookQualification = {
      playbook: 'GEX_WALL_MEAN_REVERSION',
      title: 'GEX Wall Mean Reversion',
      subtitle: 'Dealer Gamma Pinning Fade + CVD Absorption',
      regimeFit: 'Long Gamma / Low Volatility / Rangebound Expiries',
      isQualified: pb2Qualified,
      score: pb2Score,
      criteria: pb2Criteria,
      recommendedExecution: nearCallWall
        ? 'Sell OTM Call Spread or Enter Short Fade to S₀'
        : 'Sell OTM Put Spread or Enter Long Fade to S₀',
      stopRule: 'Hard stop 25 points past Wall strike',
      targetRule: 'Mean reversion to S₀ (Zero Gamma) or Session VWAP'
    };

    // ──────────────────────────────────────────────────────────────────────────
    // PLAYBOOK 3: CASH VCP BREAKOUT (Minervini Volatility Contraction)
    // ──────────────────────────────────────────────────────────────────────────
    const hasTightContraction = vcpContractions >= 2;
    const hasVolumeDryUp = volumeContractionPct >= 40;
    const hasLeadingRS = rsRating >= 70;

    const pb3Criteria: PlaybookCriteria[] = [
      {
        id: 'cash_vcp_stages',
        name: 'Volatility Contraction Stages (≥ 2 Contractions)',
        isMet: hasTightContraction,
        actual: `${vcpContractions} Contractions identified`,
        required: '≥ 2 tightening wave contractions (T, T-1, T-2)'
      },
      {
        id: 'volume_dryup',
        name: 'Volume Dry-Up in Pocket Pivot (≥40% contraction)',
        isMet: hasVolumeDryUp,
        actual: `${volumeContractionPct}% Volume Contraction`,
        required: '≥ 40% below 50-day average volume'
      },
      {
        id: 'relative_strength',
        name: 'Relative Strength vs Benchmark (RS Rating ≥ 70)',
        isMet: hasLeadingRS,
        actual: `RS Rating: ${rsRating}/99`,
        required: '≥ 70 RS vs NIFTY 50'
      },
      {
        id: 'instrument_type',
        name: 'Cash Equity / Non-Decaying Instrument',
        isMet: isCashStock,
        actual: isCashStock ? 'Cash Stock' : 'Index Derivative',
        required: 'Cash Equity or Swing Instrument'
      }
    ];

    const pb3Score = Math.round((pb3Criteria.filter(c => c.isMet).length / pb3Criteria.length) * 100);
    const pb3Qualified = pb3Score >= 75 && isCashStock;

    const pb3: PlaybookQualification = {
      playbook: 'CASH_VCP_BREAKOUT',
      title: 'Cash VCP Breakout',
      subtitle: 'Minervini Volatility Contraction Pattern + Pocket Pivot',
      regimeFit: 'Bull Market / Sector Leadership Momentum',
      isQualified: pb3Qualified,
      score: pb3Score,
      criteria: pb3Criteria,
      recommendedExecution: 'Buy breakout above pivot resistance with stop below final contraction low',
      stopRule: 'Below swing low of narrowest contraction (3-5%)',
      targetRule: '1:3 Risk-to-Reward / 20 EMA Trailing Ride'
    };

    // ──────────────────────────────────────────────────────────────────────────
    // NOISE / CHOP GATE EVALUATION
    // ──────────────────────────────────────────────────────────────────────────
    const allPlaybooks: Record<PlaybookType, PlaybookQualification> = {
      INDEX_TREND_EXPANSION: pb1,
      GEX_WALL_MEAN_REVERSION: pb2,
      CASH_VCP_BREAKOUT: pb3,
      NOISE_CHOP: {
        playbook: 'NOISE_CHOP',
        title: 'Unqualified Noise & Chop',
        subtitle: 'Pattern does not meet institutional criteria',
        regimeFit: 'Random Market Walk',
        isQualified: !pb1Qualified && !pb2Qualified && !pb3Qualified,
        score: 0,
        criteria: [],
        recommendedExecution: 'STAND DOWN: Capital Preservation Mode Active',
        stopRule: 'N/A',
        targetRule: 'N/A',
        warningAlert: 'Hick-Hyman Noise Gate Active: Only 3 approved institutional playbooks permitted. Random setups lead to 95% retail drawdown.'
      }
    };

    // Determine primary playbook based on highest score and qualification
    let selectedPlaybook: PlaybookType = 'NOISE_CHOP';
    let primaryPlaybook = allPlaybooks.NOISE_CHOP;

    if (pb1Qualified && pb1Score >= pb2Score && pb1Score >= pb3Score) {
      selectedPlaybook = 'INDEX_TREND_EXPANSION';
      primaryPlaybook = pb1;
    } else if (pb2Qualified && pb2Score >= pb3Score) {
      selectedPlaybook = 'GEX_WALL_MEAN_REVERSION';
      primaryPlaybook = pb2;
    } else if (pb3Qualified) {
      selectedPlaybook = 'CASH_VCP_BREAKOUT';
      primaryPlaybook = pb3;
    }

    const isAllowedToTrade = selectedPlaybook !== 'NOISE_CHOP';
    const lockoutReason = !isAllowedToTrade
      ? 'Hick-Hyman Gate Locked: Setup fails institutional playbook criteria. Do not gamble on mid-range noise.'
      : undefined;

    return {
      symbol,
      selectedPlaybook,
      isAllowedToTrade,
      lockoutReason,
      playbooks: allPlaybooks,
      primaryPlaybook
    };
  }
}

export const playbookGateService = PlaybookGateService.getInstance();
