import React from 'react';
import { ShieldCheck, Info } from 'lucide-react';
import { BacktestMetrics } from '../../../types/backtester.types';
import { formatCurrency } from '../../../utils/helpers';

interface CostReportProps {
  metrics: BacktestMetrics;
}

export const CostReport: React.FC<CostReportProps> = ({ metrics }) => {
  const frictionPct = (metrics.totalBrokeragePaid / metrics.initialCapital) * 100;
  
  return (
    <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/60 shadow-xl h-full">
      <div className="flex justify-between items-center mb-8">
        <h4 className="text-xs font-black text-slate-300 uppercase tracking-[0.2em] flex items-center gap-2">
          <ShieldCheck size={14} className="text-indigo-400" /> Friction & Slippage Audit
        </h4>
        <div className="px-2 py-1 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
           <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">NSE Standards</span>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex justify-between items-end border-b border-slate-800/40 pb-4">
           <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Trading Friction</p>
              <p className="text-2xl font-black text-white italic">{formatCurrency(Math.round(metrics.totalBrokeragePaid))}</p>
           </div>
           <div className="text-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Capital Drag</p>
              <p className="text-lg font-black text-rose-400 italic">{frictionPct.toFixed(2)}%</p>
           </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
           <div className="p-4 bg-slate-950/30 rounded-2xl border border-slate-800/40">
              <span className="text-[8px] font-black text-slate-600 uppercase block mb-1">Estimated STT/GST</span>
              <span className="text-sm font-black text-slate-300">{formatCurrency(Math.round(metrics.totalBrokeragePaid * 0.4))}</span>
           </div>
           <div className="p-4 bg-slate-950/30 rounded-2xl border border-slate-800/40">
              <span className="text-[8px] font-black text-slate-600 uppercase block mb-1">Brokerage Estimate</span>
              <span className="text-sm font-black text-slate-300">{formatCurrency(Math.round(metrics.totalBrokeragePaid * 0.6))}</span>
           </div>
        </div>

        <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 flex items-start gap-3">
           <Info size={16} className="text-indigo-400 mt-0.5" />
           <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
              Friction costs account for **{frictionPct.toFixed(1)}%** of your initial capital. 
              {frictionPct > 5 ? " This is high-frequency drag. Consider optimizing entry count." : " Your execution efficiency is within institutional limits."}
           </p>
        </div>
      </div>
    </div>
  );
};
