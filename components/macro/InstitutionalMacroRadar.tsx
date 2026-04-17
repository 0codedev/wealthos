import React, { useState } from 'react';
import { institutionalFlowsService, InstitutionalFlowsSnapshot } from '../../services/macro/InstitutionalFlowsService';
import { Globe, ArrowUpRight, ArrowDownRight, Activity, ShieldCheck, Flame, AlertTriangle, Compass, Layers } from 'lucide-react';

export const InstitutionalMacroRadar: React.FC = () => {
  const [snapshot] = useState<InstitutionalFlowsSnapshot>(() => institutionalFlowsService.getLatestFlowSnapshot());

  const getVerdictColor = (verdict: InstitutionalFlowsSnapshot['biasVerdict']) => {
    switch (verdict) {
      case 'STRONG_BULLISH':
      case 'MILD_BULLISH':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'STRONG_BEARISH':
      case 'MILD_BEARISH':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <Globe size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              FII / DII INSTITUTIONAL MACRO RADAR
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-blue-950 border border-blue-700/50 text-blue-300 font-bold">
                DOMAIN 08
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              08:30 AM Bias Score • FII Futures Long/Short Squeeze • DII ₹26,500 Cr SIP Floor
            </p>
          </div>
        </div>

        {/* 08:30 AM Bias Score Badge */}
        <div className="flex items-center gap-2">
          <div className={`px-3 py-1 rounded-full text-xs font-mono font-bold border flex items-center gap-1.5 shadow-sm ${getVerdictColor(snapshot.biasVerdict)}`}>
            {snapshot.biasScore >= 60 ? <Flame size={14} className="text-emerald-400" /> : <Activity size={14} />}
            <span>08:30 AM BIAS: {snapshot.biasScore}/100 ({snapshot.biasVerdict.replace('_', ' ')})</span>
          </div>
        </div>
      </div>

      {/* Grid: 3 Pillars (FII Futures, DII SIP Floor, Macro Spillover) */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Pillar 1: FII Long/Short Futures Ratio */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                FII Index Futures Positioning
              </span>
              {snapshot.shortSqueezeAlert && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold animate-pulse">
                  ⚡ SQUEEZE ALERT
                </span>
              )}
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-black text-white font-mono">
                {snapshot.fiiLongShortRatio}%
              </span>
              <span className="text-xs text-slate-400 font-mono">Long Ratio</span>
            </div>

            {/* Ratio Progress Bar */}
            <div className="mt-3 space-y-1">
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden flex">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${snapshot.fiiLongShortRatio}%` }}
                />
                <div
                  className="h-full bg-rose-500 transition-all"
                  style={{ width: `${100 - snapshot.fiiLongShortRatio}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span className="text-emerald-400 font-bold">Long: {(snapshot.fiiLongContracts / 1000).toFixed(0)}k</span>
                <span className="text-rose-400 font-bold">Short: {(snapshot.fiiShortContracts / 1000).toFixed(0)}k</span>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
              FIIs are heavily net-short. When long ratio drops below 25%, any positive intraday spark triggers an explosive short-squeeze cascade.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex justify-between">
            <span>&lt;15% Short Squeeze</span>
            <span>40-60% Neutral</span>
            <span>&gt;80% Overbought</span>
          </div>
        </div>

        {/* Pillar 2: DII ₹26,500 Cr SIP Structural Cushion */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Domestic SIP Structural Floor
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold">
                ₹{snapshot.diiMonthlySipRunRateCr.toLocaleString('en-IN')} Cr/Mo
              </span>
            </div>

            <div className="mt-3 space-y-2 font-mono text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">FII Cash Net:</span>
                <span className="font-bold text-rose-400">₹{snapshot.fiiCashNetCr} Cr</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">DII Cash Net:</span>
                <span className="font-bold text-emerald-400">+₹{snapshot.diiCashNetCr} Cr</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Net Domestic Absorption:</span>
                <span className="font-bold text-emerald-300">+₹{snapshot.netInstitutionalCr} Cr</span>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
              DII daily SIP inflows completely absorb foreign selling, providing an impenetrable structural floor against deep macro crashes.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-emerald-400" />
            <span>Structural floor intact: Buy dips above 20 EMA.</span>
          </div>
        </div>

        {/* Pillar 3: Macro Spillover (Crude, Dollar, Yields) */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Global Macro Spillover
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Live Macro Tickers
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-center">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">USD/INR</span>
                <span className="text-xs font-bold text-slate-200">₹{snapshot.usdInr}</span>
                <span className="text-[9px] text-emerald-400 block mt-0.5">Stable</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Brent Crude</span>
                <span className="text-xs font-bold text-emerald-400">${snapshot.brentCrude}</span>
                <span className="text-[9px] text-emerald-400 block mt-0.5">&lt;$75 Favorable</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">US 10Y Yield</span>
                <span className="text-xs font-bold text-slate-200">{snapshot.us10yYield}%</span>
                <span className="text-[9px] text-indigo-400 block mt-0.5">&lt;4.0% EM Tailwind</span>
              </div>
            </div>

            <div className="mt-3 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 text-[11px] text-slate-300">
              <p className="font-bold text-white mb-0.5">Macro Synthesis:</p>
              <p className="text-slate-400 leading-snug">{snapshot.biasSummary}</p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex items-center justify-between">
            <span>Macro Weight: 20%</span>
            <span className="text-indigo-400 font-bold">EM Tailwinds Active</span>
          </div>
        </div>
      </div>
    </div>
  );
};
