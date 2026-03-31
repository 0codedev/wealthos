import React from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Zap, AlertTriangle } from 'lucide-react';

interface TailRiskPanelProps {
  var95: number;
  cvar: number;
}

export const TailRiskPanel: React.FC<TailRiskPanelProps> = ({ var95, cvar }) => {
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl relative overflow-hidden group hover:border-rose-500/30 transition-all">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
           <AlertTriangle size={80} />
        </div>
        <div className="flex items-center gap-3 mb-6">
           <div className="p-2 bg-rose-500/10 rounded-xl">
              <ShieldAlert className="text-rose-400" size={20} />
           </div>
           <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em]">Value-at-Risk (VaR 95%)</h4>
        </div>
        <div className="space-y-4">
           <div>
              <p className="text-4xl font-black text-white tracking-tighter">-{Math.abs(var95).toFixed(2)}%</p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2 leading-relaxed">
                Statistical 95% confidence that your max single-trade loss will not exceed this threshold.
              </p>
           </div>
           <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(Math.abs(var95) * 5, 100)}%` }}
                className="h-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]"
              ></motion.div>
           </div>
        </div>
      </div>

      <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl relative overflow-hidden group hover:border-amber-500/30 transition-all">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
           <Zap size={80} />
        </div>
        <div className="flex items-center gap-3 mb-6">
           <div className="p-2 bg-amber-500/10 rounded-xl">
              <ShieldAlert className="text-amber-400" size={20} />
           </div>
           <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em]">Conditional VaR (CVaR)</h4>
        </div>
        <div className="space-y-4">
           <div>
              <p className="text-4xl font-black text-white tracking-tighter">-{Math.abs(cvar).toFixed(2)}%</p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2 leading-relaxed">
                Expected Shortfall: The average loss in the worst 5% of trading scenarios (Tail Risk).
              </p>
           </div>
           <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(Math.abs(cvar) * 5, 100)}%` }}
                className="h-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
              ></motion.div>
           </div>
        </div>
      </div>
    </div>
  );
};
