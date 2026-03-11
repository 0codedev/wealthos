// services/ml/features.ts
// Fixed 22-column feature schema. Order is LOCKED — gradient booster reads by column index.

export const FEATURE_COLUMNS: readonly string[] = [
  // HTF (5)
  'htf.ltp', 'htf.abovePriorDayHigh', 'htf.aboveVwap', 'htf.nearLevelPct', 'htf.vwapDistPct',
  // Indicators (4)
  'ind.rsi14', 'ind.macdHist', 'ind.adx14', 'ind.emaBull',
  // Flow (6)
  'flow.obi', 'flow.bidWallSize', 'flow.askWallSize', 'flow.absorption', 'flow.oiDeltaPct', 'flow.mlProb',
  // Regime (4)
  'regime.sectorRs', 'regime.niftyTrendUp', 'regime.niftyTrendDown', 'regime.vixHigh',
  // GEX (4)
  'gex.netGexCrores', 'gex.distanceToMagnetPct', 'gex.ivSkewAtm', 'gex.magnetGexSign',
];

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const bool01 = (v: boolean | null | undefined): number =>
  v === true ? 1 : v === false ? -1 : 0;

export function encodeFeatures(vector: any): number[] {
  const h = vector.htf ?? {};
  const i = vector.indicators ?? {};
  const f = vector.flow ?? {};
  const r = vector.regime ?? {};
  const g = vector.gex ?? {};
  const vwapDistPct = h.vwap != null && h.ltp > 0 ? (h.ltp - h.vwap) / h.vwap * 100 : 0;
  const bidWallSize = f.bidWall?.qty ?? 0;
  const askWallSize = f.askWall?.qty ?? 0;

  return [
    // HTF (5)
    num(h.ltp),
    bool01(h.abovePriorDayHigh),
    bool01(h.aboveVwap),
    num(h.nearLevelPct),
    num(vwapDistPct),
    // Indicators (4)
    num(i.rsi14),
    num(i.macdHist),
    num(i.adx14),
    i.emaStack === 'BULL' ? 1 : i.emaStack === 'BEAR' ? -1 : 0,
    // Flow (6)
    num(f.obi),
    num(bidWallSize),
    num(askWallSize),
    num(f.absorption),
    num(f.oiDeltaPct),
    num(f.mlProb, 0.5),
    // Regime (4)
    num(r.sectorRs, 1.0),
    r.niftyTrend === 'UP' ? 1 : 0,
    r.niftyTrend === 'DOWN' ? 1 : 0,
    r.vixBucket === 'HIGH' ? 1 : 0,
    // GEX (4)
    num(g.netGexCrores),
    num(g.distanceToMagnetPct),
    num(g.ivSkewAtm),
    g.magnetGexCrores != null ? Math.sign(g.magnetGexCrores) : 0,
  ];
}

export function decodeFeatures(arr: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  FEATURE_COLUMNS.forEach((col, i) => { out[col] = arr[i]; });
  return out;
}
