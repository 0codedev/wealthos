// services/mce/types.ts
// Momentum Continuation Engine — shared types
// Spec: docs/superpowers/specs/2026-06-17-mcs-momentum-continuation-score-design.md

export type MceIntent = 'PRE_ENTRY' | 'HOLD';
export type McsVerdict = 'FIRE' | 'WAIT' | 'ABORT';
export type McsHoldVerdict = 'HOLD' | 'ADD_ELIGIBLE' | 'TRIM_WATCH' | 'EXIT_CANDIDATE';

export interface HtfFeatures {
  priorDayHigh: number | null;
  priorDayLow: number | null;
  priorWeekHigh: number | null;
  priorWeekLow: number | null;
  vwap: number | null;
  last4hSwingHigh: number | null;
  last4hSwingLow: number | null;
  ltp: number;
  abovePriorDayHigh: boolean | null;
  aboveVwap: boolean | null;
  nearLevelPct: number | null;
}

export interface IndicatorFeatures {
  rsi14: number | null;
  macdHist: number | null;
  emaStack: 'BULL' | 'BEAR' | 'MIXED' | null;
  adx14: number | null;
}

export interface FlowFeatures {
  obi: number | null;
  bidWall: { price: number; qty: number } | null;
  askWall: { price: number; qty: number } | null;
  absorption: number | null;
  oiDeltaPct: number | null;
  pcr: number | null;
}

export interface RegimeFeatures {
  sectorRs: number | null;
  niftyTrend: 'UP' | 'DOWN' | 'SIDEWAYS' | null;
  vixBucket: 'LOW' | 'NORMAL' | 'HIGH' | null;
}

export interface MceFeatureVector {
  symbol: string;
  asOf: number;
  intent: MceIntent;
  htf: HtfFeatures;
  indicators: IndicatorFeatures;
  flow: FlowFeatures;
  regime: RegimeFeatures;

  // CC68.31: Optional "extras" bundle — populated by the orchestrator when
  // the AlphaInputsBundle has the corresponding fields. The 5 sub-score
  // formulas accept this and add small bonuses. When absent, the sub-score
  // formula ignores it (preserves backward compatibility).
  extras?: MceExtras;
}

/**
 * Optional enrichment fields fed from the 17-card Shadow Screener caches.
 * Each field is direction-agnostic; the sub-score functions apply sign.
 */
export interface MceExtras {
  // Card #7 — Quality
  qualityTotalScore?: number | null;            // 0..100
  qualityMomentumScore?: number | null;         // 0..100
  qualityRiskScore?: number | null;             // 0..100

  // Card #4 — Valuation
  valuationUpsidePct?: number | null;           // (intrinsic - ltp) / ltp * 100

  // Card #12 — Delivery
  deliveryPct?: number | null;                  // %
  changePct?: number | null;                    // for delivery-on-green check

  // Card #14 — MF
  mfNetPctChange?: number | null;               // % change in MF holdings

  // Card #13 — Insider
  insiderNetValueCr?: number | null;            // signed ₹ Cr

  // Card #6 — Ownership momentum
  ownershipMomentumScore?: number | null;       // 0.4·FII + 0.3·DII + 0.3·Promoter
  ownershipMomentumSign?: 1 | -1 | null;        // direction-aware sign

  // Card #11 — FII/DII composite
  fiiDiiComposite?: number | null;             // -6..+6
  vixChangePct?: number | null;                 // India VIX day change %
  vixLevel?: number | null;                     // India VIX spot
}

export interface McsSubScore {
  value: number;       // 0..1
  weight: number;      // 0..1
  reason: string;
  dataAvailable: boolean;
}

export interface McsScore {
  total: number;             // 0..100
  confidence: number;        // 0..1
  verdict: McsVerdict;
  subScores: {
    htf:        McsSubScore;
    indicators: McsSubScore;
    flow:       McsSubScore;
    regime:     McsSubScore;
    gex:        McsSubScore;
  };
  weightsAreLearned: boolean;
}

export interface McsSnapshot {
  symbol: string;
  intent: MceIntent;
  asOf: number;
  features: MceFeatureVector;
  score: McsScore;
}

export type McsWeights = Record<'htf' | 'indicators' | 'flow' | 'regime' | 'gex', number>;

export const DEFAULT_WEIGHTS: McsWeights = {
  htf:        0.20,
  indicators: 0.20,
  flow:       0.20,
  regime:     0.20,
  gex:        0.20,
};

export interface HoldSnapshot {
  current: McsSnapshot;
  fillMcs: number | null;
  delta: number;
  holdVerdict: McsHoldVerdict;
}

// === GEX (Gamma Exposure) — added 2026-06-17 ===
// Spec: docs/superpowers/specs/2026-06-17-gex-lens-design.md §4

export interface GexStrikeData {
  strike: number;
  callOi: number;
  putOi: number;
  callGamma: number;
  putGamma: number;
  strikeGexCrores: number;
}

export interface GexFeatureVector {
  symbol: string;
  asOf: number;
  expiry: string | null;
  spot: number;
  lotSize: number;
  window: GexStrikeData[];
  netGexCrores: number;
  magnetStrike: number | null;
  magnetGexCrores: number | null;
  ivSkewAtm: number | null;
  distanceToMagnetPct: number | null;
  dataQuality: 'THIN' | 'NORMAL' | 'DEEP';
}

export interface GexSnapshot {
  symbol: string;
  asOf: number;
  features: GexFeatureVector;
  subScore: McsSubScore;
}

// === P2 ML Weights — added 2026-06-17 ===
// Spec: docs/superpowers/specs/2026-06-17-ml-weights-learning-design.md §7

export type RegimeBucket = 'TRENDING_UP' | 'TRENDING_DOWN' | 'CHOPPY' | 'HIGH_VIX';

export interface TrainingRow {
  symbol: string;
  asOf: number;
  features: MceFeatureVector;
  hitProb: number;          // 0..1
  mfeMaeRatio: number;      // continuous
  regime: RegimeBucket;
  pnl: number;
  holdingMinutes: number;
}

export interface MlTrainingResult {
  hitProbModelBlob: Blob;
  mfeMaeModelBlob: Blob;
  trainRows: number;
  valHitRate: number;
  valMfeMae: number;
  regimeWeights: Record<RegimeBucket, McsWeights>;
  fireCutoff: number;
  waitCutoff: number;
}
