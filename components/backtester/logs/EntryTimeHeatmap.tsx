import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { SimulatedTrade } from '../../../types/backtester.types';
import { formatCurrency } from '../../../utils/helpers';

interface EntryTimeHeatmapProps {
  trades: SimulatedTrade[];
}

export const EntryTimeHeatmap: React.FC<EntryTimeHeatmapProps> = ({ trades }) => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const hours = [9, 10, 11, 12, 13, 14, 15]; // Market hours roughly

  const heatmapData = useMemo(() => {
    const data: Record<string, { sumPnL: number, count: number }> = {};
    
    trades.forEach(t => {
      if (!t.entryTime) return;
      const date = new Date(t.date);
      const dayIdx = date.getDay();
      if (dayIdx === 0 || dayIdx === 6) return; // Skip weekends
      
      const hour = parseInt(t.entryTime.split(':')[0]);
      const key = `${dayIdx}-${hour}`;
      
      if (!data[key]) data[key] = { sumPnL: 0, count: 0 };
      data[key].sumPnL += t.netPnL;
      data[key].count++;
    });
    
    return data;
  }, [trades]);

  const getCellData = (dayIdx: number, hour: number) => {
    const key = `${dayIdx}-${hour}`;
    return heatmapData[key] || { sumPnL: 0, count: 0 };
  };

  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] flex items-center gap-2">
          <Clock size={14} className="text-indigo-400" /> Entry Time Performance Matrix
        </h4>
        <div className="flex gap-4">
           <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-rose-500/60"></div>
              <span className="text-[8px] font-bold text-slate-500 uppercase">Avg Loss</span>
           </div>
           <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-sm bg-emerald-500/60"></div>
              <span className="text-[8px] font-bold text-slate-500 uppercase">Avg Profit</span>
           </div>
        </div>
      </div>

      <div className="space-y-2">
        {/* Header Row */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-2">
          <div className="text-[9px] font-black text-slate-600 uppercase text-center">Day / Hr</div>
          {hours.map(h => (
            <div key={h} className="text-[9px] font-black text-slate-600 uppercase text-center">{h}:00</div>
          ))}
        </div>

        {/* Rows */}
        {days.map((day, idx) => {
          const dayIdx = idx + 1; // Mon is 1
          return (
            <div key={day} className="grid grid-cols-[60px_repeat(7,1fr)] gap-2">
              <div className="flex items-center justify-center text-[10px] font-black text-slate-400 bg-slate-800/20 rounded-lg py-2 uppercase">{day}</div>
              {hours.map(h => {
                const { sumPnL, count } = getCellData(dayIdx, h);
                const avgPnL = count > 0 ? sumPnL / count : 0;
                const isPositive = avgPnL > 0;
                const opacity = count > 0 ? Math.min(Math.abs(avgPnL) / 5000, 1) : 0;

                return (
                  <motion.div
                    key={h}
                    whileHover={{ scale: 1.1, zIndex: 10 }}
                    className={`rounded-lg py-2 flex items-center justify-center border border-white/5 relative group cursor-default transition-all
                      ${count === 0 ? 'bg-slate-950/20 opacity-20' : ''}
                    `}
                    style={{ 
                      backgroundColor: count > 0 
                        ? (isPositive ? `rgba(16, 185, 129, ${opacity * 0.4 + 0.1})` : `rgba(244, 63, 94, ${opacity * 0.4 + 0.1})`) 
                        : 'transparent'
                    }}
                  >
                    {count > 0 && (
                      <>
                        <span className={`text-[8px] font-black ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {count}
                        </span>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20">
                          <div className="bg-slate-950 text-white text-[9px] font-bold px-2 py-1 rounded border border-slate-800 whitespace-nowrap shadow-2xl">
                             Avg: {isPositive ? '+' : ''}{formatCurrency(Math.round(avgPnL))}
                          </div>
                        </div>
                      </>
                    )}
                  </motion.div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
