import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Sparkles, AlertTriangle, Lightbulb, CheckCircle2, XCircle, RefreshCcw } from 'lucide-react';
import { AIStrategyAdvisorService, AIStrategyVerdict } from '../../services/backtester/AIStrategyAdvisorService';
import { BacktestResult } from '../../types/backtester.types';
import { MonteCarloResult } from '../../services/backtester/MonteCarloSimulator';
import { WalkForwardResult } from '../../services/backtester/WalkForwardOptimizer';

interface AIStrategyAdvisorProps {
  result: BacktestResult;
  mcResult: MonteCarloResult | null;
  wfResult: WalkForwardResult | null;
}

export const AIStrategyAdvisor: React.FC<AIStrategyAdvisorProps> = ({ result, mcResult, wfResult }) => {
  const [verdict, setVerdict] = useState<AIStrategyVerdict | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const analysis = await AIStrategyAdvisorService.analyzeStrategy(result, mcResult, wfResult);
      setVerdict(analysis);
    } catch (err) {
      console.error(err);
      setError('AI analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };



  if (loading) {
    return (
      <div className="bg-slate-900/40 rounded-3xl p-8 border border-slate-800 flex flex-col items-center justify-center min-h-[300px]">
        <div className="relative mb-6">
          <div className="w-16 h-16 border-4 border-indigo-500/20 rounded-full"></div>
          <div className="absolute top-0 w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <Brain className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-400" size={24} />
        </div>
        <h3 className="text-sm font-black text-white uppercase tracking-widest animate-pulse">Consulting AI Strategist</h3>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2">Synthesizing performance & psychology data</p>
      </div>
    );
  }

  if (!verdict) {
    return (
      <div className="bg-slate-900/40 rounded-3xl p-8 border border-slate-800 flex flex-col items-center justify-center min-h-[300px] text-center">
        <div className="p-4 bg-indigo-500/5 rounded-2xl mb-6">
          <Brain className="text-indigo-400 opacity-40" size={48} />
        </div>
        <h3 className="text-sm font-black text-white uppercase tracking-[0.2em] mb-2">Ready for Strategy Audit</h3>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest max-w-[200px] mb-8 leading-relaxed">
          The engine has compiled the data. Trigger the AI deep dive to audit the strategy.
        </p>
        <button 
          onClick={generateAnalysis}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-widest text-[10px] px-8 py-3 rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2 group"
        >
          <Sparkles size={12} className="group-hover:animate-pulse" />
          Run AI Analysis
        </button>
      </div>
    );
  }

  const VerdictIcon = verdict.verdict === 'ADOPT' ? CheckCircle2 : verdict.verdict === 'REJECT' ? XCircle : RefreshCcw;
  const verdictColor = verdict.verdict === 'ADOPT' ? 'text-emerald-400' : verdict.verdict === 'REJECT' ? 'text-rose-400' : 'text-amber-400';
  const verdictBg = verdict.verdict === 'ADOPT' ? 'bg-emerald-500/10 border-emerald-500/20' : verdict.verdict === 'REJECT' ? 'bg-rose-500/10 border-rose-500/20' : 'bg-amber-500/10 border-amber-500/20';

  return (
    <div className="bg-slate-900/40 rounded-3xl overflow-hidden border border-slate-800 flex flex-col h-full shadow-2xl shadow-black/50">
      {/* Header */}
      <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/60">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl">
            <Brain className="text-indigo-400" size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-widest">AI Strategy Advisor</h3>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Hedge Fund Grade Analysis</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-violet-500/10 rounded-full border border-violet-500/20">
          <Sparkles className="text-violet-400" size={12} />
          <span className="text-[9px] font-black text-violet-400 uppercase tracking-tighter">Gemini 1.5 Pro</span>
        </div>
      </div>

      <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar max-h-[600px]">
        {/* Verdict Hero */}
        <div className={`p-4 rounded-xl border ${verdictBg} flex items-center gap-4`}>
          <div className={`p-3 rounded-full bg-black/20 ${verdictColor}`}>
            <VerdictIcon size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Final Verdict</span>
              <div className="h-px flex-1 bg-slate-800"></div>
            </div>
            <h4 className={`text-xl font-black italic tracking-tighter uppercase ${verdictColor}`}>
              {verdict.verdict}
            </h4>
            <p className="text-[10px] text-slate-300 font-bold leading-relaxed mt-1 italic">
              "{verdict.reasoning}"
            </p>
          </div>
        </div>

        {/* Psychological Fit Score */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800/50">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Psychological Fit</span>
              <span className={`text-xs font-black ${verdict.psychologicalFitScore > 70 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {verdict.psychologicalFitScore}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${verdict.psychologicalFitScore}%` }}
                className={`h-full ${verdict.psychologicalFitScore > 70 ? 'bg-emerald-500' : 'bg-amber-500'}`}
              ></motion.div>
            </div>
            <p className="text-[9px] text-slate-600 font-bold mt-2 uppercase tracking-tight">Based on drawdown tolerance & trade frequency</p>
          </div>

          <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800/50">
             <div className="flex items-center gap-2 mb-2">
                <Lightbulb size={14} className="text-amber-400" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Identified Edge</span>
             </div>
             <p className="text-xs text-slate-300 font-bold leading-tight">{verdict.identifiedEdge}</p>
          </div>
        </div>

        {/* Risks & Suggestions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="text-rose-400" size={14} />
              <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Key Risks</h5>
            </div>
            {verdict.riskWarnings.map((risk, i) => (
              <div key={i} className="flex gap-2 text-xs font-bold text-slate-400 leading-tight">
                <span className="text-rose-500/50">•</span>
                {risk}
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="text-emerald-400" size={14} />
              <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Optimization Tips</h5>
            </div>
            {verdict.suggestions.map((tip, i) => (
              <div key={i} className="flex gap-2 text-xs font-bold text-slate-400 leading-tight">
                <span className="text-emerald-500/50">•</span>
                {tip}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="p-4 bg-slate-950/50 border-t border-slate-800">
        <button 
          className="w-full bg-white text-black font-black uppercase tracking-widest text-[10px] py-3 rounded-xl hover:bg-slate-200 transition-colors shadow-lg shadow-white/5"
        >
          Apply This Strategy to Live Dashboard
        </button>
      </div>
    </div>
  );
};
