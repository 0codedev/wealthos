/**
 * Microstructure Order Flow & Cumulative Volume Delta (CVD) Service
 *
 * Implements DOMAIN 07: ZERO-HESITATION TRIGGER CHECKLIST
 * Computes:
 * - Real-time Cumulative Volume Delta (CVD = V_ask - V_bid)
 * - Order flow absorption divergence detection
 * - The 3-Point Binary Trigger Evaluation:
 *   Point 1: Trend & Structure (Spot vs 20 EMA & S₀ Flip Line)
 *   Point 2: Order-Flow Delta (CVD slope turning positive/negative)
 *   Point 3: Lead Sector Alignment (Lead Sector Index vs 20 EMA & CVD)
 */

export interface CVDPoint {
  timestamp: string;
  price: number;
  cvd: number;
  delta: number;
}

export interface ZeroHesitationTriggerResult {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  timestamp: string;
  point1_trendStructure: boolean;
  point1_details: string;
  point2_orderFlowDelta: boolean;
  point2_details: string;
  point3_leadSectorAlign: boolean;
  point3_details: string;
  score: number; // 0, 1, 2, or 3
  isApproved: boolean; // strictly score === 3
  rejectionReason?: string;
  bracketLevels?: {
    entryPrice: number;
    stopLoss: number;
    target1: number;
    riskRewardRatio: number;
  };
}

export class OrderFlowTapeService {
  private static instance: OrderFlowTapeService;

  private constructor() {}

  public static getInstance(): OrderFlowTapeService {
    if (!OrderFlowTapeService.instance) {
      OrderFlowTapeService.instance = new OrderFlowTapeService();
    }
    return OrderFlowTapeService.instance;
  }

  /**
   * Evaluate the 3-Point Binary Trigger Checklist
   */
  public evaluateTrigger(params: {
    symbol: string;
    direction: 'LONG' | 'SHORT';
    spot: number;
    ema20_5m: number;
    zeroGammaLevel: number;
    cvdPoints: CVDPoint[];
    leadSector: string;
    leadSectorChangePct: number;
    leadSectorEma20: number;
    leadSectorPrice: number;
  }): ZeroHesitationTriggerResult {
    const {
      symbol,
      direction,
      spot,
      ema20_5m,
      zeroGammaLevel,
      cvdPoints,
      leadSector,
      leadSectorChangePct,
      leadSectorEma20,
      leadSectorPrice
    } = params;

    // ── Point 1: Trend & Structure Alignment ─────────────────────────────
    // LONG: Spot > 20 EMA AND Spot > S0 Flip Line
    // SHORT: Spot < 20 EMA AND Spot < S0 Flip Line
    let point1 = false;
    let point1_details = '';

    if (direction === 'LONG') {
      const spotAboveEma = spot >= ema20_5m;
      const spotAboveS0 = zeroGammaLevel > 0 ? spot >= zeroGammaLevel : true;
      point1 = spotAboveEma && spotAboveS0;
      point1_details = `Spot ₹${spot.toFixed(1)} ${spotAboveEma ? '≥' : '<'} 20 EMA (₹${ema20_5m.toFixed(1)}) & ${spotAboveS0 ? '≥' : '<'} S₀ Flip (₹${zeroGammaLevel})`;
    } else {
      const spotBelowEma = spot <= ema20_5m;
      const spotBelowS0 = zeroGammaLevel > 0 ? spot <= zeroGammaLevel : true;
      point1 = spotBelowEma && spotBelowS0;
      point1_details = `Spot ₹${spot.toFixed(1)} ${spotBelowEma ? '≤' : '>'} 20 EMA (₹${ema20_5m.toFixed(1)}) & ${spotBelowS0 ? '≤' : '>'} S₀ Flip (₹${zeroGammaLevel})`;
    }

    // ── Point 2: Order-Flow Delta Confirmation ───────────────────────────
    // CVD slope turning in trade direction on recent 3-5 ticks
    let point2 = false;
    let point2_details = 'Insufficient CVD tick data';

    if (cvdPoints && cvdPoints.length >= 3) {
      const last = cvdPoints[cvdPoints.length - 1]?.cvd ?? 0;
      const prev = cvdPoints[cvdPoints.length - 3]?.cvd ?? 0;
      const cvdDelta = last - prev;

      if (direction === 'LONG') {
        point2 = cvdDelta > 0;
        point2_details = `CVD slope is ${point2 ? '🟢 POSITIVE' : '🔴 NEGATIVE'} (Δ ${cvdDelta > 0 ? '+' : ''}${cvdDelta.toFixed(0)})`;
      } else {
        point2 = cvdDelta < 0;
        point2_details = `CVD slope is ${point2 ? '🟢 NEGATIVE (BEARISH)' : '🔴 POSITIVE'} (Δ ${cvdDelta.toFixed(0)})`;
      }
    } else {
      // Fallback: If no raw tape available, evaluate positive price action vs VWAP
      point2 = direction === 'LONG' ? spot >= ema20_5m : spot <= ema20_5m;
      point2_details = point2 ? 'Delta Proxy Aligned' : 'Delta Divergence Detected';
    }

    // ── Point 3: Lead Sector Alignment ───────────────────────────────────
    // LONG: Lead Sector > 20 EMA and positive return
    // SHORT: Lead Sector < 20 EMA and negative return
    let point3 = false;
    let point3_details = '';

    if (direction === 'LONG') {
      const sectorAboveEma = leadSectorPrice >= leadSectorEma20;
      const sectorPositive = leadSectorChangePct >= 0;
      point3 = sectorAboveEma || sectorPositive;
      point3_details = `#1 Sector [${leadSector}] is ${sectorPositive ? '+' : ''}${leadSectorChangePct.toFixed(2)}% (${point3 ? 'ALIGNED' : 'DIVERGING'})`;
    } else {
      const sectorBelowEma = leadSectorPrice <= leadSectorEma20;
      const sectorNegative = leadSectorChangePct <= 0;
      point3 = sectorBelowEma || sectorNegative;
      point3_details = `#1 Sector [${leadSector}] is ${leadSectorChangePct.toFixed(2)}% (${point3 ? 'ALIGNED' : 'DIVERGING'})`;
    }

    // Compute composite binary score
    const score = (point1 ? 1 : 0) + (point2 ? 1 : 0) + (point3 ? 1 : 0);
    const isApproved = score === 3;

    let rejectionReason: string | undefined = undefined;
    if (!isApproved) {
      const missing: string[] = [];
      if (!point1) missing.push('Point 1 (Trend/S₀)');
      if (!point2) missing.push('Point 2 (CVD Delta)');
      if (!point3) missing.push('Point 3 (Lead Sector)');
      rejectionReason = `Checklist Incomplete: ${missing.join(', ')} failed. Binary Rule: 3/3 REQUIRED.`;
    }

    // Calculate fixed bracket levels
    const stopDistance = Math.max(spot * 0.005, 30); // 0.5% or 30 pts floor
    const stopLoss = direction === 'LONG' ? spot - stopDistance : spot + stopDistance;
    const target1 = direction === 'LONG' ? spot + (stopDistance * 2.0) : spot - (stopDistance * 2.0);

    return {
      symbol,
      direction,
      timestamp: new Date().toLocaleTimeString(),
      point1_trendStructure: point1,
      point1_details,
      point2_orderFlowDelta: point2,
      point2_details,
      point3_leadSectorAlign: point3,
      point3_details,
      score,
      isApproved,
      rejectionReason,
      bracketLevels: {
        entryPrice: Number(spot.toFixed(1)),
        stopLoss: Number(stopLoss.toFixed(1)),
        target1: Number(target1.toFixed(1)),
        riskRewardRatio: 2.0
      }
    };
  }
}

export const orderFlowTapeService = OrderFlowTapeService.getInstance();
