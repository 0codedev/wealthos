import React, { useMemo } from 'react';
import { Scissors, Calendar, AlertCircle } from 'lucide-react';
import { Investment } from '../../types';
import { calculateTaxHarvesting, TaxHarvestOpportunity } from '../../services/QuantService';
import { formatCurrency } from '../../utils/helpers';
import { WashSaleDetector } from '../compliance/WashSaleDetector';
import { EmptyState } from '../shared/EmptyState';

interface TaxHarvestingWidgetProps {
    investments: Investment[];
}

export const TaxHarvestingWidget: React.FC<TaxHarvestingWidgetProps> = ({ investments }) => {
    // 1. Calculate main harvesting opportunities
    const opportunities = useMemo(() => calculateTaxHarvesting(investments), [investments]);

    // 2. Prepare wash sale data (Mock logic or reuse existing logic)
    // Warning: If we sold recently, we can't buy back. Here we just show the detector.
    const washSaleWarnings = useMemo(() => {
        // Mock checking transaction history
        return [];
    }, [investments]);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm h-full flex flex-col">
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg text-emerald-600">
                    <Scissors size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800 dark:text-white">Tax Harvester</h3>
                    <p className="text-xs text-slate-500">Offset gains before March 31.</p>
                </div>
            </div>

            <div className="flex-1 space-y-6">

                {/* Opportunities List */}
                <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                    {opportunities.length === 0 ? (
                        <EmptyState
                            variant="minimal"
                            type="no-data"
                            message="No harvesting candidates found."
                            icon={Scissors}
                        />
                    ) : (
                        opportunities.map((opp, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow group">
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-slate-800 dark:text-white">{opp.ticker}</p>
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${opp.term === 'LONG' ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'
                                                }`}>
                                                {opp.term} Term
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                            <Calendar size={10} /> Bought {opp.purchaseDate}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-rose-500">-{formatCurrency(opp.unrealizedLoss)}</p>
                                        <p className="text-xs text-rose-400">{(opp.lossPercentage * 100).toFixed(1)}% Down</p>
                                    </div>
                                </div>

                                <div className="mt-3 p-2 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800/50 flex gap-2 items-start">
                                    <AlertCircle size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-snug">
                                        {opp.suggestion}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Integration with Wash Sale Detector */}
                <WashSaleDetector warnings={washSaleWarnings} />
            </div>
        </div>
    );
};
