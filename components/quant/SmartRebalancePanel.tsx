import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Minus, Wallet, Receipt, Sparkles,
  CheckCircle2, Zap, Target
} from 'lucide-react';
import { Investment, RebalancePlan, LotRecommendation } from '../../types';
import { formatCurrency, formatCurrencyCompact } from '../../utils/helpers';
import { EmptyState } from '../shared/EmptyState';

interface SmartRebalancePanelProps {
  investments: Investment[];
  plan: RebalancePlan | null;
  profile: 'conservative' | 'balanced' | 'aggressive';
}

const profileColors = {
  conservative: { grad: 'from-sky-500/20 to-emerald-500/20', text: 'text-sky-300', border: 'border-sky-500/30', ring: 'ring-sky-500/40' },
  balanced:     { grad: 'from-indigo-500/20 to-violet-500/20', text: 'text-indigo-300', border: 'border-indigo-500/30', ring: 'ring-indigo-500/40' },
  aggressive:   { grad: 'from-rose-500/20 to-amber-500/20', text: 'text-rose-300', border: 'border-rose-500/30', ring: 'ring-rose-500/40' }
};

const actionStyles: Record<LotRecommendation['action'], { bg: string; border: string; text: string; icon: any; label: string }> = {
  BUY:  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', icon: TrendingUp,   label: 'BUY'  },
  SELL: { bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    text: 'text-rose-300',    icon: TrendingDown, label: 'SELL' },
  HOLD: { bg: 'bg-slate-700/20',   border: 'border-slate-600/30',   text: 'text-slate-400',   icon: Minus,        label: 'HOLD' }
};

export const SmartRebalancePanel: React.FC<SmartRebalancePanelProps> = ({ investments, plan }) => {
  const [appliedTickers, setAppliedTickers] = useState<Set<string>>(new Set());
  const [applyAll, setApplyAll] = useState(false);
  const palette = profileColors[plan?.profile ?? 'balanced'];

  if (!plan || plan.recommendations.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
        <EmptyState
          type="no-investments"
          title="No investments yet"
          message="No equity holdings detected — add stocks/ETFs to generate a rebalance plan."
        />
      </motion.div>
    );
  }

  const totalTax = plan.recommendations.reduce((s, r) => s + r.taxImpact, 0);
  const buys = plan.recommendations.filter(r => r.action === 'BUY').length;
  const sells = plan.recommendations.filter(r => r.action === 'SELL').length;
  const holds = plan.recommendations.filter(r => r.action === 'HOLD').length;
  const tradable = plan.recommendations.filter(r => r.action !== 'HOLD');

  const toggleApplied = (ticker: string) => {
    setAppliedTickers(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      return next;
    });
  };

  const applyAllHandler = () => {
    setApplyAll(true);
    setTimeout(() => {
      setAppliedTickers(new Set(tradable.map(r => r.ticker)));
    }, 100);
    setTimeout(() => setApplyAll(false), 1500);
  };

  return (
    <div className="space-y-4">
      {/* Top stats row */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 bg-gradient-to-br ${palette.grad} border ${palette.border} rounded-2xl p-4`}>
        <div className="text-center">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Expected Sharpe</span>
          <span className={`text-lg font-black ${palette.text}`}>{plan.expectedSharpe.toFixed(2)}</span>
        </div>
        <div className="text-center border-l border-slate-800/50">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Expected β</span>
          <span className={`text-lg font-black ${palette.text}`}>{plan.expectedBeta.toFixed(2)}</span>
        </div>
        <div className="text-center border-l border-slate-800/50">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Expected Vol</span>
          <span className={`text-lg font-black ${palette.text}`}>{plan.expectedVolatility.toFixed(1)}%</span>
        </div>
        <div className="text-center border-l border-slate-800/50">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Net Tax Impact</span>
          <span className={`text-lg font-black ${totalTax <= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalTax === 0 ? '₹0' : formatCurrencyCompact(totalTax)}
          </span>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{buys} BUY</span>
          <span className="px-2 py-1 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">{sells} SELL</span>
          <span className="px-2 py-1 rounded-md bg-slate-700/20 text-slate-400 border border-slate-600/30">{holds} HOLD</span>
        </div>
        <button
          onClick={applyAllHandler}
          disabled={tradable.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white shadow-lg shadow-indigo-500/20 transition-all"
        >
          {applyAll ? <Sparkles className="w-3 h-3 animate-pulse" /> : <Zap className="w-3 h-3" />}
          {applyAll ? 'Applying…' : `Apply All (${tradable.length})`}
        </button>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AnimatePresence>
          {plan.recommendations.map((rec, idx) => {
            const style = actionStyles[rec.action];
            const Icon = style.icon;
            const isApplied = appliedTickers.has(rec.ticker);
            const holding = investments.find(i => i.ticker === rec.ticker);

            return (
              <motion.div
                key={rec.ticker}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ delay: idx * 0.03, duration: 0.18 }}
                className={`relative overflow-hidden rounded-2xl border p-3.5 transition-all ${
                  isApplied
                    ? 'border-indigo-500/60 ring-2 ring-indigo-500/30 bg-indigo-500/5'
                    : `${style.border} ${style.bg} hover:scale-[1.01]`
                }`}
              >
                {/* Action badge */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`flex items-center justify-center w-7 h-7 rounded-lg ${style.bg} ${style.text} border ${style.border}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-black text-white truncate">{rec.ticker}</span>
                        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${style.bg} ${style.text} border ${style.border}`}>
                          {style.label}
                        </span>
                      </div>
                      {holding && (
                        <span className="text-[9px] text-slate-500 font-mono truncate block max-w-[180px]">
                          {holding.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Weight change chip */}
                  <div className="text-right shrink-0">
                    <span className={`text-base font-black font-mono ${
                      rec.weightChange > 0 ? 'text-emerald-400' : rec.weightChange < 0 ? 'text-rose-400' : 'text-slate-500'
                    }`}>
                      {rec.weightChange > 0 ? '+' : ''}{rec.weightChange.toFixed(1)}%
                    </span>
                    <div className="text-[8px] text-slate-500 uppercase tracking-widest">Δ weight</div>
                  </div>
                </div>

                {/* Body stats */}
                {rec.action !== 'HOLD' ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] font-mono">
                    <div className="bg-slate-950/60 border border-slate-800/60 rounded-lg p-2">
                      <span className="text-[8px] text-slate-500 uppercase block">Lots</span>
                      <span className="text-slate-200 font-bold">{rec.lots}</span>
                    </div>
                    <div className="bg-slate-950/60 border border-slate-800/60 rounded-lg p-2">
                      <span className="text-[8px] text-slate-500 uppercase block flex items-center gap-0.5">
                        <Receipt className="w-2 h-2" /> Tax
                      </span>
                      <span className={`font-bold ${rec.taxImpact <= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {rec.taxImpact === 0 ? '₹0' : formatCurrencyCompact(rec.taxImpact)}
                      </span>
                    </div>
                    <div className="bg-slate-950/60 border border-slate-800/60 rounded-lg p-2">
                      <span className="text-[8px] text-slate-500 uppercase block flex items-center gap-0.5">
                        <Target className="w-2 h-2" /> ΔSharpe
                      </span>
                      <span className={`font-bold ${rec.sharpeImpact >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {rec.sharpeImpact >= 0 ? '+' : ''}{rec.sharpeImpact.toFixed(3)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-[10px] text-slate-500 font-mono">
                    Within tolerance band (Δ &lt; 0.5 pp)
                  </div>
                )}

                {/* Rationale */}
                <p className="mt-2 text-[10px] text-slate-400 leading-snug">
                  {rec.rationale}
                </p>

                {/* Apply button */}
                {rec.action !== 'HOLD' && (
                  <button
                    onClick={() => toggleApplied(rec.ticker)}
                    className={`mt-3 w-full py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all ${
                      isApplied
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-200'
                        : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                    }`}
                  >
                    {isApplied ? (
                      <span className="flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Applied
                      </span>
                    ) : (
                      'Apply (UI only)'
                    )}
                  </button>
                )}

                {/* Accent stripe */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                  rec.action === 'BUY' ? 'bg-emerald-500' : rec.action === 'SELL' ? 'bg-rose-500' : 'bg-slate-700'
                }`} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Footer note */}
      <div className="text-[9px] text-slate-600 font-mono text-center">
        SELL lots sorted by tax-impact (long-term holdings sold first). UI-only — no broker call.
      </div>
    </div>
  );
};
export default SmartRebalancePanel;
