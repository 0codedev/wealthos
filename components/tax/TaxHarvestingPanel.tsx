import React, { useMemo, useState } from 'react';
import { 
  ShieldCheck, AlertTriangle, Coins, Sparkles, 
  HelpCircle, RefreshCw, Layers, Filter 
} from 'lucide-react';
import { Investment, HarvestPlan } from '../../types';
import { taxHarvestingEngine } from '../../services/TaxHarvestingEngine';
import { HarvestOpportunityCard } from './HarvestOpportunityCard';
import { formatCurrency } from '../../utils/helpers';

interface TaxHarvestingPanelProps {
  investments: Investment[];
}

export const TaxHarvestingPanel: React.FC<TaxHarvestingPanelProps> = ({ investments }) => {
  const [filterPriority, setFilterPriority] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [filterType, setFilterType] = useState<'ALL' | 'STCG' | 'LTCG'>('ALL');
  const [minLossThreshold, setMinLossThreshold] = useState<number>(10000);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const plan = useMemo(() => {
    return taxHarvestingEngine.generateHarvestPlan(investments, minLossThreshold);
  }, [investments, minLossThreshold, refreshTrigger]);

  const filteredOpportunities = useMemo(() => {
    return plan.opportunities.filter(opp => {
      const matchPriority = filterPriority === 'ALL' || opp.priority === filterPriority;
      const matchType = filterType === 'ALL' || opp.gainType === filterType;
      return matchPriority && matchType;
    });
  }, [plan.opportunities, filterPriority, filterType]);

  const filteredTaxSaving = useMemo(() => {
    return filteredOpportunities.reduce((sum, opp) => sum + opp.taxSaving, 0);
  }, [filteredOpportunities]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6 relative overflow-hidden">
      {/* Decorative gradient overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-indigo-500/5 via-sky-500/0 to-transparent" />

      {/* Header Info */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-indigo-400" />
            Tax Harvesting Optimizer
            <span className="px-2 py-0.5 text-[9px] font-black uppercase rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono tracking-wider">
              AY 2025-26
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Scan your portfolio holdings automatically for tax-loss harvesting candidates. Adjust the slider below to customize the loss threshold and locate candidates dynamically.
          </p>
        </div>

        {/* Global Estimated Savings */}
        <div className="bg-indigo-500/10 border border-indigo-500/25 rounded-2xl p-4 min-w-[200px] text-right shadow-inner">
          <span className="text-[9px] font-black text-indigo-300 uppercase tracking-widest block mb-0.5">
            Total Potential Saving
          </span>
          <span className="text-2xl font-black text-emerald-400 tracking-tight block">
            {formatCurrency(plan.totalTaxSaving)}
          </span>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800/80 p-4 rounded-2xl">
        <div className="flex flex-wrap items-center gap-4">
          {/* Priority filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Priority:</span>
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 gap-1">
              {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setFilterPriority(p)}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                    filterPriority === p 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Gain Type:</span>
            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 gap-1">
              {(['ALL', 'STCG', 'LTCG'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${
                    filterType === t 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Threshold Slider and Recalc */}
        <div className="flex flex-wrap items-center gap-4 justify-between lg:justify-end w-full lg:w-auto">
          <div className="flex items-center gap-2.5 text-xs text-slate-400 w-full sm:w-auto min-w-[240px]">
            <span className="shrink-0 font-bold">Min Loss:</span>
            <input 
              type="range" 
              min="1000" 
              max="50000" 
              step="1000"
              value={minLossThreshold}
              onChange={(e) => setMinLossThreshold(parseInt(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="font-mono text-indigo-400 shrink-0 font-bold text-right min-w-[70px]">
              ₹{minLossThreshold.toLocaleString('en-IN')}
            </span>
          </div>

          <button
            onClick={() => setRefreshTrigger(prev => prev + 1)}
            className="flex items-center gap-1.5 py-1.5 px-3 bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-white rounded-xl border border-slate-800 text-[10px] font-black uppercase tracking-wider transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Recalculate
          </button>
        </div>
      </div>

      {/* Tax Warnings Box */}
      {plan.warnings.length > 0 && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-xs space-y-2 leading-relaxed">
          <span className="text-[10px] font-black text-indigo-400 flex items-center gap-1 uppercase tracking-wider">
            <AlertTriangle className="w-3.5 h-3.5 text-indigo-400" />
            Tax Compliance Advisory
          </span>
          <ul className="list-disc pl-4 space-y-1.5 text-slate-400 font-medium">
            {plan.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Opportunities Grid / List */}
      <div className="relative z-10">
        {filteredOpportunities.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredOpportunities.map(opp => (
              <HarvestOpportunityCard key={opp.investmentId} opportunity={opp} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 bg-slate-900/20 border border-dashed border-slate-800 rounded-2xl text-center">
            <ShieldCheck className="w-10 h-10 text-emerald-500/80 mb-3 animate-pulse" />
            <p className="text-sm font-bold text-slate-300">
              Your Portfolio is Tax Optimized
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              {plan.opportunities.length === 0 
                ? "No holdings currently have unrealized losses exceeding the ₹10,000 optimization threshold." 
                : "No opportunities match your current filter settings. Reset filters to view all."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
export default TaxHarvestingPanel;
