// hooks/useMlWeights.ts
// Reactive lookup of learned lens weights for a symbol+regime.

import { useEffect, useState } from 'react';
import { lookupWeights, type LookupResult } from '../services/ml/MlWeightsService';
import { classifyRegime } from '../services/ml/RegimeClassifier';
import type { MceFeatureVector, RegimeBucket } from '../services/mce/types';
import { useMLModelStore } from '../store/mlModelStore';

const FALLBACK: LookupResult = {
  weights: { htf: 0.20, indicators: 0.20, flow: 0.20, regime: 0.20, gex: 0.20 },
  fireCutoff: 70,
  waitCutoff: 45,
  source: 'HARD_DEFAULT',
};

export function useMlWeights(symbol: string | null, features: MceFeatureVector | null): LookupResult {
  const currentVersion = useMLModelStore((s: any) => s.currentVersion);
  const [result, setResult] = useState<LookupResult>(FALLBACK);

  useEffect(() => {
    if (!symbol) {
      setResult(FALLBACK);
      return;
    }
    const regime: RegimeBucket = features ? classifyRegime(features.regime) : 'CHOPPY';
    let cancelled = false;
    void lookupWeights(symbol, regime).then(r => {
      if (!cancelled) setResult(r);
    });
    return () => { cancelled = true; };
  }, [symbol, currentVersion, features?.regime.sectorRs, features?.regime.niftyTrend, features?.regime.vixBucket]);

  return result;
}
