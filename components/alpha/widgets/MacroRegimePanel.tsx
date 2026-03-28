import React from 'react';
import { useMacroRegime } from '../../../hooks/useMacroRegime';
import { Globe, TrendingUp, TrendingDown, ShieldAlert, Activity, RefreshCw } from 'lucide-react';

export const MacroRegimePanel: React.FC = () => {
  const { regime, report, isLoading, error, refresh } = useMacroRegime();

  if (isLoading && !regime) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 animate-pulse flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-slate-800 rounded-xl w-10 h-10" />
          <div className="space-y-2">
            <div className="h-4 w-32 bg-slate-800 rounded" />
            <div className="h-3 w-48 bg-slate-800/60 rounded" />
          </div>
        </div>
        <div className="h-8 w-24 bg-slate-800 rounded-xl" />
      </div>
    );
  }

  const regimeName = regime?.regime || 'NEUTRAL';
  const isBullish = regimeName.includes('BULL');
  const isBearish = regimeName.includes('BEAR');

  const badgeColor = isBullish
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : isBearish
    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
    : 'bg-amber-500/15 text-amber-400 border-amber-500/30';

  const probPct = regime ? Math.round(regime.probability_positive * 100) : 50;

  return (
    <div className="bg-slate-900/70 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-xl shadow-xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
            <Globe size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide">Monthly Macro Regime Intelligence</h3>
            <p className="text-[10px] text-slate-400">
              43 Global Indicators ML Model (GB + RF + Student-t) · Updated Monthly
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-xl text-xs font-black tracking-wider border uppercase ${badgeColor}`}>
            {regimeName.replace('_', ' ')}
          </span>
          <button
            onClick={refresh}
            className="p-2 text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 rounded-xl border border-slate-700/40 transition-all"
            title="Refresh Macro State"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Win Probability */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">P(Bullish Month)</span>
          <div className="flex items-center justify-between mt-1">
            <span className={`text-xl font-black ${probPct > 55 ? 'text-emerald-400' : probPct < 45 ? 'text-rose-400' : 'text-amber-400'}`}>
              {probPct}%
            </span>
            {isBullish ? <TrendingUp size={16} className="text-emerald-400" /> : <TrendingDown size={16} className="text-rose-400" />}
          </div>
          <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
            <div className={`h-full ${probPct > 55 ? 'bg-emerald-400' : probPct < 45 ? 'bg-rose-400' : 'bg-amber-400'}`} style={{ width: `${probPct}%` }} />
          </div>
        </div>

        {/* Expected Return */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Expected Return</span>
          <div className="text-xl font-black mt-1 text-white">
            {regime ? `${regime.expected_return_pct > 0 ? '+' : ''}${regime.expected_return_pct}%` : 'N/A'}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            95% CI: [{regime?.confidence_interval_95[0]}%, {regime?.confidence_interval_95[1]}%]
          </span>
        </div>

        {/* 5% VaR */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Monthly VaR (95%)</span>
          <div className="text-xl font-black mt-1 text-amber-400">
            {regime ? `-${regime.var_95_pct}%` : 'N/A'}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Max loss 95 out of 100 months
          </span>
        </div>

        {/* 95% CVaR (Expected Shortfall) */}
        <div className="bg-slate-950/60 border border-slate-800/60 rounded-xl p-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Monthly CVaR (Tail Risk)</span>
          <div className="text-xl font-black mt-1 text-rose-400 flex items-center gap-1">
            <ShieldAlert size={14} className="shrink-0" />
            {regime ? `-${regime.cvar_95_pct}%` : 'N/A'}
          </div>
          <span className="text-[10px] text-slate-400 block mt-1">
            Average loss in worst 5% tail
          </span>
        </div>
      </div>

      {/* Top Macro Drivers Visual Progress Bars */}
      {report?.top_macro_drivers && report.top_macro_drivers.length > 0 && (
        <div className="pt-2 border-t border-slate-800/60 space-y-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Top Macro Feature Importances (Gradient Boosting)</span>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {report.top_macro_drivers.slice(0, 5).map((driver) => {
              const impPct = Math.round(driver.importance * 100);
              return (
                <div key={driver.feature} className="bg-slate-950/60 border border-slate-800/60 p-2 rounded-lg">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-300">
                    <span>{driver.feature}</span>
                    <span className="text-indigo-400">{impPct}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1 mt-1.5 overflow-hidden">
                    <div className="h-full bg-indigo-400" style={{ width: `${Math.max(impPct, 5)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>

  );
};
