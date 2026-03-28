import React, { useEffect, useState } from 'react';
import { Shield, TrendingUp, TrendingDown, RefreshCw, AlertCircle, Clock } from 'lucide-react';
import { signalFusionService, MarketRegime } from '../../../services/alpha/SignalFusionService';
import { logger } from '../../../services/Logger';
import { usePausedInterval } from '../../../hooks/usePausedInterval';

export const MarketRegimeWidget: React.FC = () => {
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRegime = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setError(null);
    try {
      const data = await signalFusionService.getMarketRegime(isManual);
      setRegime(data);
    } catch (err) {
      logger.error('MarketRegimeWidget: Fetch failed', err);
      setError('Unable to load market regime. Tap refresh to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRegime();
    // P0#2: interval is now visibility-paused
  }, []);

  usePausedInterval(
    () => fetchRegime(),
    180_000
  );

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[220px] animate-pulse">
        <RefreshCw className="h-8 w-8 text-indigo-400 animate-spin mb-2" />
        <span className="text-slate-500 text-xs font-mono">CALCULATING REGIME FUSION...</span>
      </div>
    );
  }

  const isClosed = regime?.isMarketClosed ?? true;
  const label = regime?.label ?? 'RANGE-BOUND';
  const colorClass = regime?.color ?? 'text-sky-400';

  return (
    <div className="relative overflow-hidden bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between min-h-[240px] shadow-2xl transition-all duration-300 hover:border-slate-700">
      
      {/* Closed Market Watermark */}
      {isClosed && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-[1px] pointer-events-none z-10">
          <div className="border border-amber-500/20 bg-amber-950/20 px-3 py-1 flex items-center gap-1.5 transform rotate-3 shadow-lg">
            <Clock className="h-3 w-3 text-amber-400" />
            <span className="text-[10px] font-black tracking-widest text-amber-400 uppercase font-mono">MARKET CLOSED (STATIC VIEW)</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start z-0">
        <div>
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">AI Signal Fusion</span>
          <h3 className="text-slate-200 text-sm font-bold mt-0.5">Market Regime Detector</h3>
        </div>
        <button
          onClick={() => fetchRegime(true)}
          disabled={refreshing}
          className="p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
          title="Recalculate Signals"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-indigo-400' : ''}`} />
        </button>
      </div>

      {/* Main Signal */}
      <div className="my-3 z-0">
        <div className="flex items-center gap-2">
          {label === 'TRENDING UP' && <TrendingUp className="h-6 w-6 text-emerald-400" />}
          {label === 'TRENDING DOWN' && <TrendingDown className="h-6 w-6 text-rose-400" />}
          {label !== 'TRENDING UP' && label !== 'TRENDING DOWN' && <Shield className="h-6 w-6 text-sky-400" />}
          <span className={`text-xl font-black tracking-wider uppercase font-mono ${colorClass}`}>
            {label}
          </span>
        </div>
        <p className="text-slate-400 text-xs mt-1.5 leading-relaxed font-sans">
          {regime?.description}
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-2 border-t border-b border-slate-800/80 py-2.5 my-2.5 text-center font-mono z-0">
        <div>
          <span className="text-[9px] text-slate-500 block">INDIA VIX</span>
          <span className="text-xs text-slate-300 font-bold">{regime?.vix != null ? regime.vix.toFixed(2) : '--'}</span>
        </div>
        <div>
          <span className="text-[9px] text-slate-500 block">NIFTY PCR</span>
          <span className="text-xs text-slate-300 font-bold">{regime?.pcr != null ? regime.pcr.toFixed(2) : '--'}</span>
        </div>
        <div>
          <span className="text-[9px] text-slate-500 block">AD RATIO</span>
          <span className="text-xs text-slate-300 font-bold">{regime?.adr != null ? `${regime.adr.toFixed(1)}x` : '--'}</span>
        </div>
        <div>
          <span className="text-[9px] text-slate-500 block">SEC BREADTH</span>
          <span className="text-xs text-slate-300 font-bold">{regime?.sectorBreadth != null ? `${regime.sectorBreadth}%` : '--'}</span>
        </div>
      </div>

      {/* Strategy Recommendations */}
      <div className="z-0">
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono flex items-center gap-1">
          <AlertCircle className="h-3 w-3 text-indigo-400" /> RECOMMENDED STRATEGIES
        </span>
        <ul className="mt-1.5 space-y-1">
          {regime?.recommendations.map((rec, i) => (
            <li key={i} className="text-slate-300 text-[10px] flex items-start gap-1">
              <span className="text-indigo-400 font-bold font-mono select-none">•</span>
              <span>{rec}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer Timestamp */}
      <div className="text-[9px] text-slate-600 font-mono mt-3 text-right">
        Refreshed: {regime?.asOf}
      </div>
    </div>
  );
};
