import React, { useState } from 'react';
import { sovereignFortressService, VIXRegimeStatus, DrawdownStatus, SandboxIncubationStatus } from '../../services/risk/SovereignFortressService';
import { ShieldCheck, ShieldAlert, AlertOctagon, Activity, Flame, Lock, CheckCircle2, TrendingDown, Gauge } from 'lucide-react';

export const CapitalDefensePact: React.FC = () => {
  const [vix] = useState<number>(14.2); // Current India VIX
  const [tacticalCapital] = useState<number>(500000); // ₹5,00,000 Tactical Capital
  const [dailyPnL] = useState<number>(-2400); // -₹2,400 (-0.48%)
  const [weeklyPnL] = useState<number>(-4500); // -₹4,500 (-0.90%)

  const [sandboxTrades] = useState<number>(44);
  const [sandboxSharpe] = useState<number>(2.15);
  const [sandboxSortino] = useState<number>(2.85);

  const vixStatus: VIXRegimeStatus = sovereignFortressService.evaluateVIXRegime(vix);
  const drawdown: DrawdownStatus = sovereignFortressService.evaluateDrawdown(tacticalCapital, dailyPnL, weeklyPnL);
  const incubation: SandboxIncubationStatus = sovereignFortressService.evaluateSandboxIncubation(
    sandboxTrades,
    sandboxSharpe,
    sandboxSortino
  );

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              SOVEREIGN CAPITAL FORTRESS & DRAWDOWN ARCHITECTURE
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-rose-950 border border-rose-700/50 text-rose-300 font-bold">
                DOMAIN 08
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              India VIX 4-Regime Multiplier • -1.5% Daily Breaker • 100% Sandbox Incubation Gate
            </p>
          </div>
        </div>

        {/* Global Protection Badge */}
        <div className="flex items-center gap-2">
          {drawdown.isDailyBreakerTripped || drawdown.isWeeklyBreakerTripped ? (
            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 animate-pulse">
              <AlertOctagon size={14} /> CIRCUIT BREAKER TRIPPED
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5">
              <ShieldCheck size={14} /> FORTRESS ACTIVE (SAFE)
            </span>
          )}
        </div>
      </div>

      {/* Grid: VIX Regime, Drawdown Breakers, Incubation Gate */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: India VIX 4-Regime Sizing */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                India VIX Sizing Multiplier
              </span>
              <span className="text-xs font-mono font-bold text-amber-400">
                VIX {vixStatus.vixValue.toFixed(1)}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="text-3xl font-black text-white font-mono">
                {(vixStatus.sizeMultiplier * 100).toFixed(0)}%
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {vixStatus.regime}
              </span>
            </div>

            <h5 className="mt-2 text-xs font-bold text-slate-200">{vixStatus.regimeTitle}</h5>
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              {vixStatus.description}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex justify-between">
            <span>Regime 1: &lt;12 (75%)</span>
            <span className="text-emerald-400 font-bold">Regime 2: 12-18 (100%)</span>
            <span>Regime 3: 18-24 (50%)</span>
          </div>
        </div>

        {/* Card 2: Drawdown Circuit Breakers */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Drawdown Breakers
              </span>
              <span className="text-xs font-mono text-slate-400">
                Cap: ₹{(tacticalCapital / 1e5).toFixed(1)}L
              </span>
            </div>

            {/* Daily Drawdown Progress */}
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Daily P&L:</span>
                <span className={`font-bold ${drawdown.dailyDrawdownPct < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {drawdown.dailyDrawdownPct}% (Limit: -1.5%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${Math.min(100, (Math.abs(drawdown.dailyDrawdownPct) / 1.5) * 100)}%` }}
                />
              </div>
            </div>

            {/* Weekly Drawdown Progress */}
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-400">Weekly P&L:</span>
                <span className={`font-bold ${drawdown.weeklyDrawdownPct < 0 ? 'text-indigo-300' : 'text-emerald-400'}`}>
                  {drawdown.weeklyDrawdownPct}% (Limit: -3.0%)
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.min(100, (Math.abs(drawdown.weeklyDrawdownPct) / 3.0) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center gap-1.5">
            <Lock size={12} className="text-rose-400" />
            <span>-1.5% Breaker = Day Lock | -3.0% Breaker = 48h Cool-off</span>
          </div>
        </div>

        {/* Card 3: 100% Sandbox Incubation Gate */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Sandbox Incubation Gate
              </span>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                incubation.isLiveAllowed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
              }`}>
                {incubation.isLiveAllowed ? 'LIVE CAPITAL UNLOCKED' : 'INCUBATING'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center font-mono">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Trades</span>
                <span className="text-xs font-bold text-white">{incubation.completedTrades}/40</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Sharpe</span>
                <span className="text-xs font-bold text-emerald-400">{incubation.sharpeRatio} (&gt;1.8)</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Sortino</span>
                <span className="text-xs font-bold text-emerald-400">{incubation.sortinoRatio} (&gt;2.5)</span>
              </div>
            </div>

            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-slate-400">
                <span>Incubation Progress</span>
                <span className="text-white font-bold">{incubation.incubationProgressPct}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${incubation.incubationProgressPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-emerald-400" />
            <span>Incubation passed: Live capital trading authorized.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
