import React, { useState } from 'react';
import { playbookGateService, PlaybookType, PlaybookQualification } from '../../services/execution/PlaybookGateService';
import { Shield, Target, Zap, Activity, AlertOctagon, CheckCircle2, XCircle, ChevronRight, BookOpen, Layers } from 'lucide-react';

export interface TacticalArsenalProps {
  onSelectPlaybook?: (playbook: PlaybookType) => void;
}

export const TacticalArsenal: React.FC<TacticalArsenalProps> = ({ onSelectPlaybook }) => {
  const [selectedPlaybookKey, setSelectedPlaybookKey] = useState<PlaybookType>('INDEX_TREND_EXPANSION');

  // Audit sample market state (can be hooked to live stream)
  const audit = playbookGateService.auditPlaybooks({
    symbol: 'NIFTY',
    spot: 24850,
    vwap: 24810,
    openRangeHigh: 24820,
    openRangeLow: 24750,
    currentVolume: 140000,
    avgVolume20: 100000,
    callWall: 25000,
    putWall: 24600,
    zeroGammaLevel: 24800,
    isLongGamma: false,
    hasCvdAbsorption: false,
    vcpContractions: 3,
    volumeContractionPct: 65,
    rsRating: 88,
    isCashStock: false
  });

  const activeQualification: PlaybookQualification = audit.playbooks[selectedPlaybookKey];

  return (
    <div className="w-full bg-slate-900/90 rounded-2xl border border-slate-800 shadow-xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/60">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <BookOpen size={20} />
          </div>
          <div>
            <h3 className="text-base font-black text-white tracking-wide flex items-center gap-2">
              TACTICAL PLAYBOOK ARSENAL
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-purple-950 border border-purple-700/50 text-purple-300 font-bold">
                DOMAIN 03 & 06
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Hick-Hyman Noise Gate • Exactly 3 Institutional Playbooks • Zero Random Gambles
            </p>
          </div>
        </div>

        {/* Global Qualification Status */}
        <div className="flex items-center gap-2">
          {audit.isAllowedToTrade ? (
            <span className="px-3 py-1 rounded-full text-xs font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shadow-sm">
              <CheckCircle2 size={14} />
              ACTIVE PLAYBOOK: {audit.primaryPlaybook.title}
            </span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-bold font-mono bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1.5 shadow-sm">
              <AlertOctagon size={14} />
              NOISE GATE: NO TRADE QUALIFIES
            </span>
          )}
        </div>
      </div>

      {/* Grid: 3 Playbooks Cards */}
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-slate-800/60">
        {/* Playbook 1 */}
        <div
          onClick={() => {
            setSelectedPlaybookKey('INDEX_TREND_EXPANSION');
            if (onSelectPlaybook) onSelectPlaybook('INDEX_TREND_EXPANSION');
          }}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            selectedPlaybookKey === 'INDEX_TREND_EXPANSION'
              ? 'bg-indigo-950/40 border-indigo-500/60 ring-2 ring-indigo-500/30 shadow-lg'
              : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              PLAYBOOK 01
            </span>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
              audit.playbooks.INDEX_TREND_EXPANSION.isQualified
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-slate-800 text-slate-400'
            }`}>
              {audit.playbooks.INDEX_TREND_EXPANSION.isQualified ? 'QUALIFIED' : 'GATED'}
            </span>
          </div>
          <h4 className="mt-2 text-sm font-bold text-white">Index Trend Expansion</h4>
          <p className="mt-1 text-xs text-slate-400">
            ORB + VWAP Anchor in Short Gamma regime. High momentum directional thrusts.
          </p>
          <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60">
            <span>Score: <strong className="text-white">{audit.playbooks.INDEX_TREND_EXPANSION.score}%</strong></span>
            <span className="text-indigo-400 flex items-center">Inspect <ChevronRight size={12} /></span>
          </div>
        </div>

        {/* Playbook 2 */}
        <div
          onClick={() => {
            setSelectedPlaybookKey('GEX_WALL_MEAN_REVERSION');
            if (onSelectPlaybook) onSelectPlaybook('GEX_WALL_MEAN_REVERSION');
          }}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            selectedPlaybookKey === 'GEX_WALL_MEAN_REVERSION'
              ? 'bg-indigo-950/40 border-indigo-500/60 ring-2 ring-indigo-500/30 shadow-lg'
              : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
              PLAYBOOK 02
            </span>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
              audit.playbooks.GEX_WALL_MEAN_REVERSION.isQualified
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-slate-800 text-slate-400'
            }`}>
              {audit.playbooks.GEX_WALL_MEAN_REVERSION.isQualified ? 'QUALIFIED' : 'GATED'}
            </span>
          </div>
          <h4 className="mt-2 text-sm font-bold text-white">GEX Wall Mean Reversion</h4>
          <p className="mt-1 text-xs text-slate-400">
            Gamma Pinning Fade + CVD Absorption at Call/Put Wall. Reversion to S₀ line.
          </p>
          <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60">
            <span>Score: <strong className="text-white">{audit.playbooks.GEX_WALL_MEAN_REVERSION.score}%</strong></span>
            <span className="text-indigo-400 flex items-center">Inspect <ChevronRight size={12} /></span>
          </div>
        </div>

        {/* Playbook 3 */}
        <div
          onClick={() => {
            setSelectedPlaybookKey('CASH_VCP_BREAKOUT');
            if (onSelectPlaybook) onSelectPlaybook('CASH_VCP_BREAKOUT');
          }}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            selectedPlaybookKey === 'CASH_VCP_BREAKOUT'
              ? 'bg-indigo-950/40 border-indigo-500/60 ring-2 ring-indigo-500/30 shadow-lg'
              : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-start justify-between">
            <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
              PLAYBOOK 03
            </span>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
              audit.playbooks.CASH_VCP_BREAKOUT.isQualified
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-slate-800 text-slate-400'
            }`}>
              {audit.playbooks.CASH_VCP_BREAKOUT.isQualified ? 'QUALIFIED' : 'GATED'}
            </span>
          </div>
          <h4 className="mt-2 text-sm font-bold text-white">Cash VCP Breakout</h4>
          <p className="mt-1 text-xs text-slate-400">
            Minervini Volatility Contraction Pattern + Pocket Pivot with 50-70% volume dry-up.
          </p>
          <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/60">
            <span>Score: <strong className="text-white">{audit.playbooks.CASH_VCP_BREAKOUT.score}%</strong></span>
            <span className="text-indigo-400 flex items-center">Inspect <ChevronRight size={12} /></span>
          </div>
        </div>
      </div>

      {/* Selected Playbook Deep Dive */}
      <div className="p-5 bg-slate-950/40">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h4 className="text-sm font-black text-white flex items-center gap-2">
              <span>{activeQualification.title}</span>
              <span className="text-xs font-normal text-slate-400">({activeQualification.subtitle})</span>
            </h4>
            <span className="text-xs font-mono text-indigo-400">
              Ideal Regime: {activeQualification.regimeFit}
            </span>
          </div>
          <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-200">
            Qualification Score: {activeQualification.score}/100
          </span>
        </div>

        {/* Criteria Checklist */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {activeQualification.criteria.map(crit => (
            <div
              key={crit.id}
              className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                crit.isMet
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}
            >
              {crit.isMet ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5">
                <p className="font-bold text-slate-200">{crit.name}</p>
                <p className="text-[11px] font-mono text-slate-400">Actual: {crit.actual}</p>
                <p className="text-[10px] font-mono text-slate-500">Required: {crit.required}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Execution Rules Card */}
        <div className="mt-4 p-4 rounded-xl bg-slate-900/80 border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-500 uppercase tracking-wider block text-[10px]">Execution Vehicle</span>
            <span className="font-bold text-slate-200 mt-1 block">{activeQualification.recommendedExecution}</span>
          </div>
          <div>
            <span className="text-rose-400 uppercase tracking-wider block text-[10px]">Hard Stop Rule</span>
            <span className="font-bold text-rose-300 mt-1 block">{activeQualification.stopRule}</span>
          </div>
          <div>
            <span className="text-emerald-400 uppercase tracking-wider block text-[10px]">Target Rule</span>
            <span className="font-bold text-emerald-300 mt-1 block">{activeQualification.targetRule}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
