import { useState, useEffect, useCallback } from 'react';
import { macroRegimeService, MacroRegimeResult, MacroWeights, MonthlyReport } from '../services/MacroRegimeService';

export function useMacroRegime() {
  const [regime, setRegime] = useState<MacroRegimeResult | null>(null);
  const [weights, setWeights] = useState<MacroWeights | null>(null);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMacroData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [regimeData, weightsData, reportData] = await Promise.all([
        macroRegimeService.getRegime(),
        macroRegimeService.getWeights(),
        macroRegimeService.getMonthlyReport(),
      ]);
      setRegime(regimeData);
      setWeights(weightsData);
      setReport(reportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMacroData();
    // Macro data is monthly — refresh every 6 hours
    const interval = setInterval(fetchMacroData, 6 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchMacroData]);

  return {
    regime,
    weights,
    report,
    isLoading,
    error,
    refresh: fetchMacroData,
  };
}
