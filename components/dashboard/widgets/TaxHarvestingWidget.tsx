import React, { useMemo } from 'react';
import { FileX, BadgePercent, CheckCircle2, ArrowRight, Coins, Scale, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';
import { findHarvestingOpportunities } from '../../../utils/TaxRules';
import { Investment } from '../../../types';
import { EmptyState } from '../../shared/EmptyState';

interface TaxHarvestingWidgetProps {
    investments: Investment[];
    onClick?: () => void;
}

const TaxHarvestingWidget: React.FC<TaxHarvestingWidgetProps> = ({ investments, onClick }) => {

    const opportunities = useMemo(() => findHarvestingOpportunities(investments), [investments]);
    const totalPotentialAlpha = opportunities.reduce((acc, curr) => acc + curr.potentialTaxSaving, 0);
    const topOpportunities = opportunities.slice(0, 3);
    const hiddenCount = Math.max(0, opportunities.length - 3);

    return (
        <div
            onClick={onClick}
            className="h-full bg-slate-950 border border-slate-800 rounded-2xl p-5 relative overflow-hidden group cursor-pointer hover:border-amber-500/30 transition-all duration-500 flex flex-col"
        >
            {/* Background Glow */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-amber-500/20 transition-all" />

            {/* Header */}
            <div className="flex justify-between items-start mb-5 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-950/30 rounded-xl flex items-center justify-center border border-amber-500/20 shadow-lg shadow-amber-900/10">
                        <Scale size={20} className="text-amber-500" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">Tax Alpha</h3>
                        <p className="text-[10px] text-amber-500/80 font-mono">Harvesting Command</p>
                    </div>
                </div>

                {/* Status Badge */}
                {opportunities.length > 0 ? (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/50 border border-amber-500/30 text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-wide">Action Reqd</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/50 border border-emerald-500/30 text-emerald-400">
                        <CheckCircle2 size={10} />
                        <span className="text-[10px] font-bold uppercase tracking-wide">Optimized</span>
                    </div>
                )}
            </div>

            {/* Main Metric */}
            <div className="mb-6 relative z-10">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Recoverable Value</p>
                <div className="flex items-baseline gap-2">
                    <h2 className={`text-3xl font-black font-mono tracking-tight ${totalPotentialAlpha > 0 ? 'text-amber-400' : 'text-slate-700'}`}>
                        {formatCurrency(totalPotentialAlpha)}
                    </h2>
                    {totalPotentialAlpha > 0 && (
                        <span className="text-xs font-bold text-slate-500">+1.2% Boost</span>
                    )}
                </div>
            </div>

            {/* Missions List */}
            <div className="flex-1 space-y-2 relative z-10">
                {topOpportunities.length > 0 ? (
                    topOpportunities.map(opp => (
                        <div key={opp.investmentId} className="flex justify-between items-center bg-slate-900/50 p-3 rounded-xl border border-slate-800 hover:border-amber-500/30 hover:bg-slate-900 transition-all group/card">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 group-hover/card:text-amber-500 transition-colors">
                                    <FileX size={14} />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-300 group-hover/card:text-white transition-colors">{opp.name}</p>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-500 font-mono">Loss: {formatCurrency(opp.unrealizedLoss)}</span>
                                        {/* Wash Sale Warning could go here */}
                                    </div>
                                </div>
                            </div>
                            <button className="px-2 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded text-[10px] font-bold border border-amber-500/20 transition-colors">
                                Harvest
                            </button>
                        </div>
                    ))
                ) : (
                    <EmptyState
                        variant="minimal"
                        type="no-alerts"
                        message="No active harvesting missions"
                        icon={Coins}
                    />
                )}
            </div>

            {/* Footer */}
            {hiddenCount > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-800 text-center relative z-10">
                    <p className="text-[10px] text-slate-500 hover:text-white transition-colors cursor-pointer font-bold inline-flex items-center gap-1">
                        View {hiddenCount} more missions <ArrowRight size={10} />
                    </p>
                </div>
            )}
        </div >
    );
};

export default TaxHarvestingWidget;
