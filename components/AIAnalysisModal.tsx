import React, { useState } from 'react';
import {
  Brain, Sparkles, RefreshCw, AlertCircle, ShieldCheck, CheckCircle2,
  TrendingUp, TrendingDown, DollarSign, X, MessageSquare, Award
} from 'lucide-react';

interface AIAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
}

export const AIAnalysisModal: React.FC<AIAnalysisModalProps> = ({ isOpen, onClose, symbol }) => {
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'google'>('openai');
  const [horizonDate, setHorizonDate] = useState('2024-01-01');
  const [loading, setLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRunAnalysis = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/agents/analyze/${encodeURIComponent(symbol)}?date=${horizonDate}&provider=${provider}`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Multi-agent analysis failed');
      }

      const data = await res.json();
      setAnalysisResult(data);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl p-6 space-y-6 text-slate-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
              <Brain className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                TradingAgents AI Multi-Agent Research - {symbol.toUpperCase()}
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/40">
                  Port 8090
                </span>
              </h2>
              <p className="hidden sm:block text-xs text-slate-400 line-clamp-1">
                Multi-agent LLM consensus graph: Fundamentals • News • Bull/Bear Debate • Risk Manager
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* LLM Provider & Date Controls */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div>
            <label className="text-slate-400 uppercase font-semibold block mb-1">LLM Provider Engine</label>
            <select
              value={provider}
              onChange={(e: any) => setProvider(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white"
            >
              <option value="openai">OpenAI (GPT-4o)</option>
              <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
              <option value="google">Google (Gemini 1.5 Pro)</option>
            </select>
          </div>

          <div>
            <label className="text-slate-400 uppercase font-semibold block mb-1">Analysis Horizon Date</label>
            <input
              type="date"
              value={horizonDate}
              onChange={(e) => setHorizonDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleRunAnalysis}
              disabled={loading}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/30"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Orchestrating LLM Debate...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Trigger Multi-Agent Debate
                </>
              )}
            </button>
          </div>
        </div>

        {/* Cost & Cache Indicator */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 font-mono">
          <span className="flex items-center gap-1.5 text-indigo-300">
            <DollarSign className="w-3.5 h-3.5" /> Estimated LLM Token Cost: ~$0.02 / run
          </span>
          <span className="text-slate-500">Result cached for 24h per symbol horizon</span>
        </div>

        {errorMsg && (
          <div className="p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-red-300 text-xs flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Main Analysis Display */}
        {analysisResult && (
          <div className="space-y-6">
            {/* Consensus Decision Badge */}
            <div className="bg-slate-950 border border-indigo-500/40 p-5 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 uppercase font-mono block">Multi-Agent Consensus Recommendation</span>
                <span className={`text-2xl font-bold font-mono mt-1 inline-block ${
                  analysisResult.decision?.action === 'BUY' ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {analysisResult.decision?.action || 'BUY / ACCUMULATE'}
                </span>
              </div>
              <div className="text-right font-mono text-xs space-y-0.5">
                <div className="text-indigo-300 font-bold">Confidence: {analysisResult.decision?.confidence_score || 85}%</div>
                <div className="text-slate-400">Target Horizon: {analysisResult.decision?.target_price_horizon || '3-6 Months'}</div>
              </div>
            </div>

            {/* Bull vs Bear Debate Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Bull Case */}
              <div className="bg-slate-950 border border-emerald-500/30 p-5 rounded-xl space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Bull Researcher Thesis
                </h4>
                <div className="text-xs text-slate-300 leading-relaxed font-mono whitespace-pre-line">
                  {analysisResult.bull_thesis}
                </div>
              </div>

              {/* Bear Case */}
              <div className="bg-slate-950 border border-rose-500/30 p-5 rounded-xl space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
                  <TrendingDown className="w-4 h-4" /> Bear Researcher Counter-Thesis
                </h4>
                <div className="text-xs text-slate-300 leading-relaxed font-mono whitespace-pre-line">
                  {analysisResult.bear_thesis}
                </div>
              </div>
            </div>

            {/* Risk Assessment & Final Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-2">
                <h4 className="text-xs font-bold uppercase text-indigo-400 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> Risk Manager Allocation Guidelines
                </h4>
                <div className="text-xs text-slate-300 font-mono whitespace-pre-line leading-relaxed">
                  {analysisResult.risk_assessment}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-5 rounded-xl space-y-2">
                <h4 className="text-xs font-bold uppercase text-purple-400 flex items-center gap-2">
                  <Award className="w-4 h-4" /> Trader Agent Final Verdict
                </h4>
                <div className="text-xs text-slate-300 font-mono leading-relaxed">
                  {analysisResult.final_analysis}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default AIAnalysisModal;
