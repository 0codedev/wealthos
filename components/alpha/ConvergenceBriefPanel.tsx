import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ExternalLink, Plus, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { ScoredStock } from '../../services/alpha/ConvergenceEngine';
import { useAlphaToPortfolioWorkflow } from '../../hooks/useAlphaToPortfolioWorkflow';
import { openTradingView } from '../../utils/navigation';

interface ConvergenceBriefPanelProps {
  convergenceResults: ScoredStock[];
  perfectConvergenceAlerts: number;
}

export const ConvergenceBriefPanel: React.FC<ConvergenceBriefPanelProps> = ({
  convergenceResults,
  perfectConvergenceAlerts
}) => {
  const { sendToPortfolioWatchlist } = useAlphaToPortfolioWorkflow();
  const [isOpen, setIsOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);

  // Filter perfect convergence stocks
  const perfectSetups = React.useMemo(() => {
    return convergenceResults
      .filter((s) => s.tier === 'PERFECT')
      .slice(0, 5);
  }, [convergenceResults]);

  useEffect(() => {
    const isBriefDismissed = sessionStorage.getItem('alpha_brief_dismissed') === 'true';
    if (!isBriefDismissed && perfectConvergenceAlerts > 0 && perfectSetups.length > 0) {
      setIsOpen(true);
      setIsDismissed(false);
    }
  }, [perfectConvergenceAlerts, perfectSetups.length]);

  const handleDismiss = () => {
    sessionStorage.setItem('alpha_brief_dismissed', 'true');
    setIsDismissed(true);
    setIsOpen(false);
  };

  if (isDismissed || perfectSetups.length === 0) return null;

  return (
    <div className="bg-slate-900/60 border border-emerald-500/20 rounded-3xl p-5 backdrop-blur-md shadow-xl shadow-emerald-500/5 transition-all duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
            <Sparkles size={18} className="animate-pulse" />
          </div>
          <div>
            <h3 className="text-[13px] font-black uppercase tracking-wider text-slate-100 flex items-center gap-2">
              Perfect Convergence Detected
              <span className="bg-emerald-500/20 text-emerald-400 text-[9px] px-1.5 py-0.5 rounded-full font-mono">
                {perfectSetups.length} Setups
              </span>
            </h3>
            <p className="hidden sm:block text-[10px] text-slate-400 font-medium mt-0.5">
              Multi-factor sync aligns sentiment, volumes, and technical models.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 rounded-xl bg-slate-800/50 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={handleDismiss}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
          >
            <Check size={12} /> Noted
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mt-5 pt-4 border-t border-slate-800/60">
              {perfectSetups.map((stock) => {
                const changeSign = stock.change >= 0 ? '+' : '';
                const changeColor = stock.change >= 0 ? 'text-emerald-400' : 'text-rose-400';
                
                return (
                  <div
                    key={stock.symbol}
                    className="relative group flex flex-col justify-between bg-slate-950/40 hover:bg-slate-950/80 border border-slate-800 hover:border-emerald-500/30 p-4 rounded-2xl transition-all duration-200 shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div
                          className="flex items-center gap-1.5 cursor-pointer group/sym"
                          onClick={() => openTradingView(stock.symbol)}
                        >
                          <span className="font-bold text-[13px] text-slate-100 group-hover:text-indigo-400 transition-colors">
                            {stock.symbol}
                          </span>
                          <ExternalLink size={11} className="text-slate-600 group-hover/sym:text-indigo-400 transition-colors" />
                        </div>
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                          stock.direction === 'bullish' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {stock.direction}
                        </span>
                      </div>

                      <p className="text-[10px] text-slate-500 font-semibold truncate mt-1">
                        {stock.companyName} • <span className="text-[9px] bg-slate-850 px-1 py-0.5 rounded tracking-wide text-slate-400">{stock.sector}</span>
                      </p>

                      {/* Convergence Score bar */}
                      <div className="mt-3.5">
                        <div className="flex justify-between items-center text-[9px] text-slate-550 font-bold mb-1.5 font-mono">
                          <span>CONVERGENCE</span>
                          <span className="text-emerald-400">{stock.convictionScore}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 rounded-full transition-all duration-500"
                            style={{ width: `${stock.convictionScore}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3.5 border-t border-slate-900/30">
                      <div className="flex flex-col">
                        <span className="text-[11.5px] font-black text-slate-300 font-mono">₹{stock.ltp.toFixed(2)}</span>
                        <span className={`text-[9px] font-bold ${changeColor} font-mono mt-0.5`}>
                          {changeSign}{stock.change.toFixed(2)}%
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => sendToPortfolioWatchlist(stock.symbol, stock.ltp, stock.direction.toUpperCase())}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                        >
                          <Plus size={11} /> Track
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
