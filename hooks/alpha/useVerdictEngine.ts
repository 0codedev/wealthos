import { useMemo } from 'react';
import { VerdictEngine, VerdictResult } from '../../services/alpha/VerdictEngine';

interface UseVerdictEngineProps {
  symbol: string;
  orbDataCache?: Record<string, any[]>;
  dailyCandleData?: any;
  valuationDataCache?: Record<string, any[]>;
  shareholdingDataCache?: Record<string, any[]>;
  qualityDataCache?: Record<string, any[]>;
  boosterStocksList?: any[];
  historicalDataCache?: Record<string, any[]>;
  fiiDiiPulseData?: any[];
  derivativeSummaryData?: any[];
  liveQuotes?: Record<string, any>;
  volumeAverages?: Record<string, number>;
}

export const useVerdictEngine = ({
  symbol,
  orbDataCache,
  dailyCandleData,
  valuationDataCache,
  shareholdingDataCache,
  qualityDataCache,
  boosterStocksList,
  historicalDataCache,
  fiiDiiPulseData,
  derivativeSummaryData,
  liveQuotes,
  volumeAverages
}: UseVerdictEngineProps): VerdictResult | null => {
  return useMemo(() => {
    if (!symbol) return null;

    return VerdictEngine.compute(
      symbol,
      {
        orbDataCache,
        dailyCandleData,
        valuationDataCache,
        shareholdingDataCache,
        qualityDataCache,
        boosterStocksList,
        historicalDataCache,
        fiiDiiPulseData,
        derivativeSummaryData
      },
      liveQuotes,
      volumeAverages
    );
  }, [
    symbol,
    orbDataCache,
    dailyCandleData,
    valuationDataCache,
    shareholdingDataCache,
    qualityDataCache,
    boosterStocksList,
    historicalDataCache,
    fiiDiiPulseData,
    derivativeSummaryData,
    liveQuotes,
    volumeAverages
  ]);
};
export default useVerdictEngine;
