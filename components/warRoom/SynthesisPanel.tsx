import React from 'react';
import { JudgeConsensus } from '../../services/warRoom/AgentOrchestrator';
import {
  Sparkles, CheckCircle2, AlertOctagon, HelpCircle, AlertCircle
} from 'lucide-react';

interface SynthesisPanelProps {
  consensus: JudgeConsensus | null;
  isThinking: boolean;
}

export const SynthesisPanel: React.FC<SynthesisPanelProps> = ({ consensus, isThinking }) => {
  if (isThinking) {
    return (
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center py-12 space-y-3">
        <Sparkles size={24} className="text-indigo-400 animate-pulse" />
        <p className="text-xs text-slate-400 italic">Judge is weighing sub-agent arguments and generating synthesis...</p>
      </div>
    );
  }

  if (!consensus) {
    return null;
  }

  const getVerdictBadge = () => {
    switch (consensus.verdict) {
      case 'BULLISH':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-black uppercase tracking-wider">
            <CheckCircle2 size={12} /> Bullish Consensus
          </span>
        );
      case 'BEARISH':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-black uppercase tracking-wider">
            <AlertOctagon size={12} /> Bearish Warning
          </span>
        );
      case 'NEUTRAL':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-700/30 text-slate-300 border border-slate-700/50 text-xs font-black uppercase tracking-wider">
            <HelpCircle size={12} /> Neutral Balance
          </span>
        );
      case 'WAIT':
        return (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-black uppercase tracking-wider">
            <AlertCircle size={12} /> Watch & Wait
          </span>
        );
    }
  };

  const getConfidenceColor = () => {
    if (consensus.confidence >= 75) return 'text-emerald-400';
    if (consensus.confidence >= 50) return 'text-amber-400';
    return 'text-rose-400';
  };

  return (
    <div className="bg-slate-900 border border-indigo-500/20 rounded-2xl p-6 shadow-md space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Swarm Consensus Verdict</h3>
        </div>
        <div className="flex items-center gap-4">
          {getVerdictBadge()}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500 font-mono">CONFIDENCE:</span>
            <span className={`text-xs font-black font-mono ${getConfidenceColor()}`}>
              {consensus.confidence}%
            </span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Summary</span>
        <p className="text-sm text-slate-200 leading-relaxed font-sans">
          {consensus.summary}
        </p>
      </div>

      {/* Synthesis Bullet Points */}
      <div className="space-y-3 pt-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Key Takeaways</span>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {consensus.synthesisPoints.map((point, i) => (
            <div key={i} className="bg-slate-950/60 p-4 rounded-xl border border-slate-850 space-y-1 hover:border-slate-800 transition-colors">
              <span className="text-[9px] font-bold text-indigo-400 uppercase font-mono">0{i + 1} / POINT</span>
              <p className="text-[11.5px] text-slate-300 leading-relaxed">
                {point}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
export default SynthesisPanel;
