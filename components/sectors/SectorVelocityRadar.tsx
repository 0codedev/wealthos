import React, { useState } from 'react';
import { sectorRotationVelocityService, SectorRotationSnapshot, SectorVelocityProfile } from '../../services/sectors/SectorRotationVelocityService';
import { Compass, Flame, ArrowUpRight, ArrowDownRight, Layers, Eye, EyeOff, ShieldCheck, Activity, Zap } from 'lucide-react';

export const SectorVelocityRadar: React.FC = () => {
  const [snapshot] = useState<SectorRotationSnapshot>(() => sectorRotationVelocityService.getSectorRotationSnapshot());
  const [showAllSectors, setShowAllSectors] = useState<boolean>(false);

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400">
            <Compass size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              09:30 AM SECTOR ROTATION VELOCITY & BREADTH RADAR
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-teal-950 border border-teal-700/50 text-teal-300 font-bold">
                DOMAIN 13
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Mansfield Relative Strength (RS) • 2-Day Velocity Oscillator • 09:30 AM Rule of Two Focus
            </p>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAllSectors(!showAllSectors)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition-all"
          >
            {showAllSectors ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>{showAllSectors ? 'Enforce Rule of Two (Top 2)' : 'View All Sectors (8)'}</span>
          </button>
        </div>
      </div>

      {/* Main Focus: The Top 2 Leading Sectors */}
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <span>The 09:30 AM Rule of Two Leaders</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40">
              CONCENTRATE 100% FOCUS
            </span>
          </span>
          {snapshot.zweigBreadthAlert && (
            <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 font-bold flex items-center gap-1 animate-pulse">
              <Flame size={12} /> ZWEIG BREADTH THRUST ACTIVE (&gt;70%)
            </span>
          )}
        </div>

        {/* Top 2 Highlight Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {snapshot.topTwoSectors.map((sector, idx) => (
            <div
              key={sector.sector}
              className="p-4 rounded-xl bg-gradient-to-br from-slate-950/80 to-slate-900/80 border border-emerald-500/40 shadow-lg shadow-emerald-500/5 relative overflow-hidden"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-black px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      LEAD #{idx + 1}
                    </span>
                    <h4 className="text-base font-black text-white">{sector.sector}</h4>
                  </div>
                  <span className="text-xs font-mono text-slate-400 mt-1 block">
                    ₹{sector.price.toLocaleString('en-IN')} (+{sector.changePct}%)
                  </span>
                </div>

                <div className="text-right font-mono">
                  <span className="text-[10px] text-slate-500 block uppercase">Mansfield RS</span>
                  <span className="text-base font-black text-emerald-400">+{sector.mansfieldRS}%</span>
                </div>
              </div>

              {/* Progress bars: Velocity & Breadth */}
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[9px] text-slate-500 block uppercase">2-Day Velocity</span>
                  <span className="font-bold text-teal-400">+{sector.velocity2D}% / 2D</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[9px] text-slate-500 block uppercase">Zweig Breadth</span>
                  <span className="font-bold text-emerald-400">{sector.breadthThrustPct}% &gt; 10 EMA</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Rule of Two Summary Banner */}
        <div className="p-3 rounded-xl bg-slate-950/40 border border-slate-800 text-xs font-mono text-slate-400 flex items-center justify-between">
          <span>{snapshot.ruleOfTwoSummary}</span>
          <span className="text-teal-400 font-bold shrink-0 ml-2">Locked at 09:30 AM IST</span>
        </div>

        {/* Expandable Table for All Sectors */}
        {showAllSectors && (
          <div className="mt-4 pt-4 border-t border-slate-800 overflow-x-auto">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Full Cross-Sector Velocity Matrix (8 Sectors)
            </span>
            <table className="w-full text-xs font-mono text-left">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500 uppercase text-[10px]">
                  <th className="py-2 px-2">Rank</th>
                  <th className="py-2 px-2">Sector</th>
                  <th className="py-2 px-2">Price</th>
                  <th className="py-2 px-2">Change %</th>
                  <th className="py-2 px-2">Mansfield RS</th>
                  <th className="py-2 px-2">2D Velocity</th>
                  <th className="py-2 px-2">Breadth Thrust</th>
                  <th className="py-2 px-2">Regime Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {snapshot.allSectors.map(s => (
                  <tr key={s.sector} className={s.isTop2Lead ? 'bg-emerald-950/10 font-bold text-white' : 'text-slate-400'}>
                    <td className="py-2 px-2 font-black">#{s.rank}</td>
                    <td className="py-2 px-2">{s.sector}</td>
                    <td className="py-2 px-2">₹{s.price.toLocaleString('en-IN')}</td>
                    <td className={`py-2 px-2 ${s.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {s.changePct >= 0 ? '+' : ''}{s.changePct}%
                    </td>
                    <td className={`py-2 px-2 ${s.mansfieldRS >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {s.mansfieldRS >= 0 ? '+' : ''}{s.mansfieldRS}%
                    </td>
                    <td className="py-2 px-2">{s.velocity2D > 0 ? '+' : ''}{s.velocity2D}</td>
                    <td className="py-2 px-2">{s.breadthThrustPct}%</td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded text-[9px] ${
                        s.status === 'LEADER'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : s.status === 'IMPROVING'
                          ? 'bg-teal-500/20 text-teal-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
