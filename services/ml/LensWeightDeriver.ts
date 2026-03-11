// services/ml/LensWeightDeriver.ts
// Map gradient booster feature importance → 5-lens McsWeights, normalized to sum=1.

import type { McsWeights } from '../mce/types';
import { DEFAULT_WEIGHTS } from '../mce/types';

const HTF_COLS  = ['htf.ltp', 'htf.abovePriorDayHigh', 'htf.aboveVwap', 'htf.nearLevelPct', 'htf.vwapDistPct'];
const IND_COLS  = ['ind.rsi14', 'ind.macdHist', 'ind.adx14', 'ind.emaBull'];
const FLOW_COLS = ['flow.obi', 'flow.bidWallSize', 'flow.askWallSize', 'flow.absorption', 'flow.oiDeltaPct'];
const REG_COLS  = ['regime.sectorRs', 'regime.niftyTrendUp', 'regime.niftyTrendDown', 'regime.vixHigh'];
const GEX_COLS  = ['gex.netGexCrores', 'gex.distanceToMagnetPct', 'gex.ivSkewAtm', 'gex.magnetGexSign'];

export function deriveLensWeights(importance: number[]): McsWeights {
  if (!Array.isArray(importance) || importance.length < 22) {
    return { ...DEFAULT_WEIGHTS };
  }
  const sumLens = (cols: string[]): number => {
    const start = HTF_COLS.length + IND_COLS.length + FLOW_COLS.length + REG_COLS.length + GEX_COLS.length;
    // importance is keyed by FEATURE_COLUMNS order
    const offsetMap: Record<string, number> = {
      'htf.ltp': 0, 'htf.abovePriorDayHigh': 1, 'htf.aboveVwap': 2, 'htf.nearLevelPct': 3, 'htf.vwapDistPct': 4,
      'ind.rsi14': 5, 'ind.macdHist': 6, 'ind.adx14': 7, 'ind.emaBull': 8,
      'flow.obi': 9, 'flow.bidWallSize': 10, 'flow.askWallSize': 11, 'flow.absorption': 12, 'flow.oiDeltaPct': 13,
      'regime.sectorRs': 14, 'regime.niftyTrendUp': 15, 'regime.niftyTrendDown': 16, 'regime.vixHigh': 17,
      'gex.netGexCrores': 18, 'gex.distanceToMagnetPct': 19, 'gex.ivSkewAtm': 20, 'gex.magnetGexSign': 21,
    };
    return cols.reduce((s, c) => s + Math.abs(importance[offsetMap[c]] ?? 0), 0);
  };
  const htf  = sumLens(HTF_COLS);
  const ind  = sumLens(IND_COLS);
  const flow = sumLens(FLOW_COLS);
  const reg  = sumLens(REG_COLS);
  const gex  = sumLens(GEX_COLS);
  const total = htf + ind + flow + reg + gex;
  if (total === 0) return { ...DEFAULT_WEIGHTS };
  return {
    htf:        htf  / total,
    indicators: ind  / total,
    flow:       flow / total,
    regime:     reg  / total,
    gex:        gex  / total,
  };
}
