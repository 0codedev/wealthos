import React, { useState } from 'react';
import { cosmicFrictionService, CosmicFrictionReport } from '../../services/cosmic/CosmicFrictionService';
import { Moon, Sparkles, ShieldAlert, ShieldCheck, Calendar, Lock, AlertTriangle, Compass } from 'lucide-react';

export const CosmicGovernorCard: React.FC = () => {
  const [report] = useState<CosmicFrictionReport>(() => cosmicFrictionService.evaluateCosmicFriction());

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <Moon size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              VEDIC COSMIC RISK & BLACKOUT GOVERNOR
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-purple-950 border border-purple-700/50 text-purple-300 font-bold">
                DOMAIN 11
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Planetary Risk Multiplier P_risk • Rahu-Saturn Friction Throttling • Annual Blackout Calendar
            </p>
          </div>
        </div>

        {/* Global Multiplier Badge */}
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 flex items-center gap-1.5 shadow-sm">
            <Sparkles size={14} />
            <span>P_RISK: {(report.planetaryRiskMultiplier * 100).toFixed(0)}% SIZING MULTIPLIER</span>
          </div>
        </div>
      </div>

      {/* Grid: Planetary Nodes & Upcoming Blackouts */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Planetary Transits Status */}
        <div className="md:col-span-2 space-y-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
            Active Planetary Friction Nodes
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {report.transitFactors.map(t => (
              <div
                key={t.name}
                className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">{t.name.split('(')[0]}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      t.status === 'ALERT'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}>
                      {t.status}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400 leading-snug line-clamp-3">
                    {t.impact}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/60 text-[10px] font-mono text-slate-500 flex justify-between">
                  <span>Weight:</span>
                  <span className="text-indigo-400 font-bold">{(t.multiplier * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span className="font-mono">{report.frictionSummary}</span>
            <span className="text-indigo-400 font-bold shrink-0 ml-2">Phase: {report.activePhase}</span>
          </div>
        </div>

        {/* Blackout Calendar Preview */}
        <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Cosmic Blackout Calendar
              </span>
              <Calendar size={14} className="text-slate-400" />
            </div>

            <div className="mt-3 space-y-2.5">
              {report.upcomingBlackouts.map(b => (
                <div key={b.date} className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-purple-400 font-bold">{b.date}</span>
                    <span className="text-rose-400 font-black">{b.riskFactor.replace('_', ' ')}</span>
                  </div>
                  <p className="mt-1 font-bold text-slate-200 text-[11px]">{b.title}</p>
                  <p className="text-[10px] text-slate-400 line-clamp-1">{b.astronomicalEvent}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-slate-800/80 text-[10px] font-mono text-slate-500 flex items-center gap-1.5">
            <Lock size={12} className="text-rose-400" />
            <span>Blackout days auto-lock order entry to Sandbox.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
