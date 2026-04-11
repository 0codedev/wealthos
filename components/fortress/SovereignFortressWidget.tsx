import React, { useState } from 'react';
import { profitSweeperService, FreedomConditionReport, FridaySweepReport } from '../../services/treasury/ProfitSweeperService';
import { Shield, Sparkles, ArrowRight, Lock, CheckCircle2, TrendingUp, DollarSign, Wallet, Landmark } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

export const SovereignFortressWidget: React.FC = () => {
  const { toast } = useToast();
  const [freedom, setFreedom] = useState<FreedomConditionReport>(() => profitSweeperService.evaluateFreedomCondition());
  const [sweep, setSweep] = useState<FridaySweepReport>(() => profitSweeperService.evaluateFridaySweep());

  const handleExecuteSweep = () => {
    profitSweeperService.recordProfitSweep(sweep.recommendedSweepAmount);
    setSweep(profitSweeperService.evaluateFridaySweep());
    toast.success(`⚡ 50% PROFIT SWEEP CONFIRMED: ₹${sweep.recommendedSweepAmount.toLocaleString('en-IN')} swept into Sovereign Fortress!`);
  };

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Landmark size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              SOVEREIGN MULTI-ASSET FORTRESS & PROFIT SWEEPER
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-amber-950 border border-amber-700/50 text-amber-300 font-bold">
                DOMAIN 12
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              70/30 Sleep-Well vs Tactical Spear • Condition of Freedom (Φ) • Friday 04:00 PM Profit Sweeper
            </p>
          </div>
        </div>

        {/* Freedom Status Badge */}
        <div className="flex items-center gap-2">
          <div className={`px-3 py-1 rounded-full text-xs font-mono font-bold border flex items-center gap-1.5 shadow-sm ${
            freedom.isFreedomAchieved
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          }`}>
            <Sparkles size={14} />
            <span>FREEDOM RATIO (Φ): {freedom.freedomRatio} {freedom.isFreedomAchieved ? 'SOVEREIGN' : 'BUILDING'}</span>
          </div>
        </div>
      </div>

      {/* Grid: 70/30 Fortress Allocation, Condition of Freedom, Friday Sweeper */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Pillar 1: 70/30 Fortress Allocation */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Fortress Allocation
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400">
                {freedom.fortressRatioPct}% / {freedom.tacticalRatioPct}%
              </span>
            </div>

            <div className="mt-3 space-y-2">
              <div className="w-full h-3 rounded-full bg-slate-800 overflow-hidden flex">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all"
                  style={{ width: `${freedom.fortressRatioPct}%` }}
                />
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${freedom.tacticalRatioPct}%` }}
                />
              </div>

              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-amber-400 font-bold">
                  Sleep-Well: ₹{freedom.totalFortressCapitalCr} Cr ({freedom.fortressRatioPct}%)
                </span>
                <span className="text-indigo-400 font-bold">
                  Spear: ₹{freedom.totalTacticalCapitalCr} Cr ({freedom.tacticalRatioPct}%)
                </span>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
              70–80% locked in Sovereign Gold Bonds, Physical Gold ETFs, Treasury Bills, and dividend cash cows. Capital cannot be destroyed in market turbulence.
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex justify-between">
            <span>Target: ≥70% Sleep-Well</span>
            <span className="text-emerald-400 font-bold">Pact Compliant</span>
          </div>
        </div>

        {/* Pillar 2: Condition of Freedom Engine */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Condition of Freedom (Φ)
              </span>
              <span className="text-xs font-mono font-bold text-slate-300">
                Φ = Y_pass / C_live
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Monthly Passive</span>
                <span className="font-bold text-emerald-400">₹{freedom.monthlyPassiveIncome.toLocaleString('en-IN')}</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-500 block uppercase">Living Costs</span>
                <span className="font-bold text-slate-200">₹{freedom.monthlyLivingCosts.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="mt-3 p-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 text-[11px] text-slate-300">
              <p className="font-bold text-white mb-0.5">Freedom Diagnosis:</p>
              <p className="text-slate-400 leading-snug">{freedom.freedomVerdict}</p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex justify-between">
            <span>Living Cost Coverage:</span>
            <span className="text-emerald-400 font-bold">{(freedom.freedomRatio * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Pillar 3: Friday 04:00 PM Profit Sweeper */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Friday 04:00 PM Profit Sweeper
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                50% SWEEP RULE
              </span>
            </div>

            <div className="mt-3 space-y-1.5 font-mono text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Weekly Net Gains:</span>
                <span className="font-bold text-emerald-400">₹{sweep.weeklyNetTradingGains.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">50% Sweep Target:</span>
                <span className="font-bold text-amber-300">₹{sweep.recommendedSweepAmount.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Destination:</span>
                <span className="font-bold text-indigo-300">Sovereign Treasury Bills</span>
              </div>
            </div>

            <p className="mt-2 text-[11px] text-slate-400 leading-relaxed">
              Every Friday at 4 PM, 50% of weekly trading profits are permanently swept into the Fortress. Never give back profits to the market over the weekend.
            </p>
          </div>

          <div className="mt-3">
            <button
              onClick={handleExecuteSweep}
              disabled={sweep.isSweepExecutedThisWeek || sweep.recommendedSweepAmount <= 0}
              className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                sweep.isSweepExecutedThisWeek
                  ? 'bg-slate-900 border border-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 font-black shadow-md shadow-amber-500/20 active:scale-95 cursor-pointer'
              }`}
            >
              {sweep.isSweepExecutedThisWeek ? (
                <>
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <span>SWEEP EXECUTED THIS WEEK</span>
                </>
              ) : (
                <>
                  <ArrowRight size={14} />
                  <span>SWEEP ₹{sweep.recommendedSweepAmount.toLocaleString('en-IN')} TO FORTRESS</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
