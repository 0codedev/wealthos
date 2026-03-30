import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { BacktestResult, SimulatedTrade } from '../../../types/backtester.types';

interface MonthlyPnLHeatmapProps {
  trades: SimulatedTrade[];
  initialCapital: number;
}

export const MonthlyPnLHeatmap: React.FC<MonthlyPnLHeatmapProps> = ({ trades, initialCapital }) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const heatmapData = useMemo(() => {
    const data: Record<number, number[]> = {};
    const monthlyPnL: Record<string, number> = {};
    
    // Group trades by month/year
    trades.forEach(trade => {
      const date = new Date(trade.date);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      monthlyPnL[key] = (monthlyPnL[key] || 0) + trade.netPnL;
    });

    const years = Array.from(new Set(trades.map(t => new Date(t.date).getFullYear()))).sort((a, b) => b - a);

    return { years, monthlyPnL };
  }, [trades]);

  const getPnLPct = (year: number, monthIdx: number) => {
    const key = `${year}-${monthIdx}`;
    const pnl = heatmapData.monthlyPnL[key] || 0;
    // This is a simplification: using initial capital for all % calcs.
    // In a more complex engine, we'd use the equity at the start of that month.
    return (pnl / initialCapital) * 100;
  };

  if (heatmapData.years.length === 0) return null;

  return (
    <div className="bg-slate-900/40 rounded-3xl p-8 border border-slate-800/60 shadow-2xl">
      <div className="flex justify-between items-center mb-8">
        <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] flex items-center gap-2">
          <Zap size={14} className="text-amber-400" /> Monthly Return Heatmap (%)
        </h4>
        <div className="flex gap-2">
           <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-rose-500"></div>
              <span className="text-[8px] font-bold text-slate-600 uppercase">Loss</span>
           </div>
           <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-emerald-500"></div>
              <span className="text-[8px] font-bold text-slate-600 uppercase">Profit</span>
           </div>
        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <div className="min-w-[800px]">
          {/* Header */}
          <div className="grid grid-cols-[60px_repeat(12,1fr)] gap-2 mb-4">
            <div className="text-[10px] font-black text-slate-600 uppercase text-center bg-slate-950/30 py-2 rounded-lg">Year</div>
            {months.map(m => (
              <div key={m} className="text-[10px] font-black text-slate-600 uppercase text-center py-2">{m}</div>
            ))}
          </div>
          
          {/* Rows */}
          <div className="space-y-2">
            {heatmapData.years.map(year => (
              <div key={year} className="grid grid-cols-[60px_repeat(12,1fr)] gap-2">
                <div className="flex items-center justify-center text-[11px] font-black text-slate-400 bg-slate-800/30 rounded-xl py-3 border border-slate-700/30">{year}</div>
                {months.map((m, idx) => {
                  const pnlPct = getPnLPct(year, idx);
                  if (pnlPct === 0) {
                     return <div key={m} className="bg-slate-950/20 rounded-xl py-3 border border-slate-800/10"></div>;
                  }
                  const isPositive = pnlPct > 0;
                  const opacity = Math.min(Math.abs(pnlPct) / 5, 1); // 5% is full color
                  return (
                    <motion.div 
                      key={m}
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      whileHover={{ scale: 1.05, zIndex: 10, backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)' }}
                      className={`flex items-center justify-center text-[10px] font-black rounded-xl py-3 cursor-pointer transition-all border border-white/5 shadow-lg
                        ${isPositive ? 'text-emerald-400' : 'text-rose-400'}
                      `}
                      style={{ backgroundColor: isPositive ? `rgba(16, 185, 129, ${opacity * 0.4 + 0.1})` : `rgba(244, 63, 94, ${opacity * 0.4 + 0.1})` }}
                    >
                      {pnlPct > 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                    </motion.div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
