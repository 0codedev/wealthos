import React from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';
import { formatCurrency } from '../../../utils/helpers';

interface StreakTrackerProps {
  trades: SimulatedTrade[];
}

export const StreakTracker: React.FC<StreakTrackerProps> = ({ trades }) => {
  if (trades.length === 0) return null;

  // Show only the last 100 trades for the visual streak bar
  const displayTrades = trades.slice(-100);

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" /> Sequential Streak Visualizer
        </h4>
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Last {displayTrades.length} Trades</p>
      </div>
      
      <div className="flex gap-1 h-12 w-full">
        {displayTrades.map((trade, i) => (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            animate={{ height: '100%' }}
            transition={{ delay: i * 0.01 }}
            className={`flex-1 rounded-sm relative group cursor-pointer ${trade.netPnL > 0 ? 'bg-emerald-500/40 hover:bg-emerald-400' : 'bg-rose-500/40 hover:bg-rose-400'}`}
          >
            {/* Tooltip on hover */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20">
              <div className="bg-slate-950 text-white text-[10px] font-bold px-2 py-1 rounded border border-slate-800 whitespace-nowrap shadow-2xl">
                {trade.netPnL > 0 ? '+' : ''}{formatCurrency(trade.netPnL)}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      
      <div className="flex justify-between mt-4">
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Win</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"></div>
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Loss</span>
          </div>
        </div>
        <p className="text-[9px] font-bold text-slate-600 uppercase tracking-widest italic">Timeline (Left to Right)</p>
      </div>
    </div>
  );
};
