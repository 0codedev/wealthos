import React, { useState } from 'react';
import { 
  TrendingDown, ArrowRight, ShieldAlert, 
  HelpCircle, ChevronDown, ChevronUp 
} from 'lucide-react';
import { HarvestOpportunity } from '../../types';
import { formatCurrency } from '../../utils/helpers';

interface HarvestOpportunityCardProps {
  opportunity: HarvestOpportunity;
}

export const HarvestOpportunityCard: React.FC<HarvestOpportunityCardProps> = ({ opportunity }) => {
  const [expanded, setExpanded] = useState(false);

  const priorityColors = {
    HIGH: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    MEDIUM: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    LOW: 'bg-slate-800 text-slate-400 border border-slate-700',
  };

  return (
    <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-2xl p-5 hover:border-indigo-500/30 transition-all duration-300 shadow-md">
      <div className="flex items-start justify-between gap-4">
        {/* Left Side: Instrument and loss info */}
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-rose-500/10 rounded-xl text-rose-400 border border-rose-500/25 mt-0.5">
            <TrendingDown className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-black text-white leading-none">
                {opportunity.ticker}
              </h4>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${priorityColors[opportunity.priority]}`}>
                {opportunity.priority} PRIORITY
              </span>
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 tracking-wider">
                {opportunity.gainType} (Sec {opportunity.taxSection})
              </span>
            </div>
            <p className="text-xs text-rose-400 mt-2 font-mono font-bold">
              Unrealized Loss: -{formatCurrency(Math.abs(opportunity.unrealizedLoss))}
            </p>
          </div>
        </div>

        {/* Right Side: Estimated Tax Saving */}
        <div className="text-right">
          <p className="text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">
            EST. TAX SAVED
          </p>
          <p className="text-xl font-black text-emerald-400 tracking-tight">
            +{formatCurrency(opportunity.taxSaving)}
          </p>
        </div>
      </div>

      {/* Suggested replacement bridge */}
      <div className="mt-4 bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
        <div className="min-w-0">
          <span className="text-[9px] font-black text-slate-500 uppercase block tracking-wider mb-0.5">
            Suggested Replacement
          </span>
          <span className="font-bold text-slate-200 block truncate">
            {opportunity.suggestedReplacement}
          </span>
        </div>
        <div className="flex items-center text-indigo-400 shrink-0">
          <ArrowRight className="w-4 h-4 animate-pulse" />
        </div>
        <div className="text-right shrink-0">
          <span className="text-[9px] font-black text-slate-500 uppercase block tracking-wider mb-0.5">
            Wash-Sale Hold
          </span>
          <span className="font-bold text-amber-400 block font-mono">
            {opportunity.lockInPeriod} Days
          </span>
        </div>
      </div>

      {/* Expandable Rationale Details */}
      <div className="mt-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1 py-1 text-[10px] font-black text-slate-500 hover:text-slate-400 uppercase tracking-widest transition-colors focus:outline-none"
        >
          {expanded ? (
            <>
              Hide Rationale <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              View Rationale & Warnings <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-800/50 space-y-2 text-xs text-slate-400 leading-relaxed animate-in slide-in-from-top-2 duration-250">
            <p className="font-medium">
              <strong className="text-slate-200">Rebalancing Strategy:</strong> {opportunity.replacementRationale}
            </p>
            <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/15 rounded-lg p-2.5 text-[11px] text-amber-400/90 font-medium">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>Wash-Sale Warning:</strong> Re-buying {opportunity.ticker} within {opportunity.lockInPeriod} days of exit will disqualify this tax loss under business-purpose guidelines. Keep capital in {opportunity.suggestedReplacement} until the holding period lock expires.
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
export default HarvestOpportunityCard;
