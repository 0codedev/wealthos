
import React, { useMemo } from 'react';
import { Investment } from '../../types';
import { formatCurrency, calculatePercentage } from '../../utils/helpers';
import { Calculator, ArrowRight, AlertTriangle, Scale, Percent, TrendingDown, Target, Scissors } from 'lucide-react';
import { motion } from 'framer-motion';

interface TaxHarvesterProps {
    investments: Investment[];
}

const TaxHarvester: React.FC<TaxHarvesterProps> = ({ investments }) => {

    // Logic: Identify assets with Unrealized Loss > 5% (Worth harvesting)
    const harvestCandidates = useMemo(() => {
        return (investments || [])
            .filter(inv => {
                const gain = inv.currentValue - inv.investedAmount;
                const gainPct = (gain / inv.investedAmount) * 100;
                return gainPct < -5; // Only show significant losses
            })
            .sort((a, b) => {
                const lossA = a.investedAmount - a.currentValue;
                const lossB = b.investedAmount - b.currentValue;
                return lossB - lossA;
            });
    }, [investments]);

    const totalHarvestableLoss = harvestCandidates.reduce((acc, curr) => acc + (curr.investedAmount - curr.currentValue), 0);
    const potentialTaxSave = totalHarvestableLoss * 0.15; // Assume 15% STCG offset

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden group h-full flex flex-col shadow-xl">
            {/* Background Icon Decor */}
            <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-all duration-700 -mr-4 -mt-4 transform group-hover:scale-125 rotate-12">
                <Scissors size={160} className="text-rose-500" />
            </div>

            <div className="flex items-center justify-between mb-6 relative z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-rose-500/10 text-rose-500 dark:text-rose-400 rounded-2xl border border-rose-500/20 shadow-lg shadow-rose-500/5">
                        <Calculator size={22} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase">Tax Harvester</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]"></span>
                            <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 tracking-widest uppercase">FY End Optimizer</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="relative z-10 flex-1 flex flex-col">
                <div className="grid grid-cols-2 gap-4 mb-6 shrink-0">
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm relative overflow-hidden">
                        <div className="absolute inset-0 bg-rose-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase font-black tracking-widest mb-1">Harvestable Loss</p>
                        <p className="text-2xl font-mono font-black text-rose-500 leading-none">{formatCurrency(totalHarvestableLoss)}</p>
                    </div>
                    <div className="p-4 bg-emerald-500/5 dark:bg-emerald-900/10 rounded-2xl border border-emerald-500/10 dark:border-emerald-500/20 shadow-sm relative overflow-hidden">
                        <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-black tracking-widest mb-1">Tax Savings (Est)</p>
                        <p className="text-2xl font-mono font-black text-emerald-500 dark:text-emerald-400 leading-none">{formatCurrency(potentialTaxSave)}</p>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar-hide">
                    {harvestCandidates.length > 0 ? (
                        harvestCandidates.map((inv, idx) => {
                            const loss = inv.currentValue - inv.investedAmount;
                            const lossPct = (loss / inv.investedAmount) * 100;
                            return (
                                <motion.div 
                                    key={inv.id} 
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    className="flex justify-between items-center p-4 bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-transparent hover:border-rose-500/30 dark:hover:border-rose-500/30 transition-all group/item shadow-sm hover:shadow-md"
                                >
                                    <div>
                                        <p className="font-black text-slate-900 dark:text-white text-sm tracking-tight uppercase">{inv.name}</p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">Basis: {formatCurrency(inv.investedAmount)}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-mono font-black text-rose-500 text-base leading-none">{formatCurrency(loss)}</p>
                                        <p className="text-[9px] text-rose-500 font-black bg-rose-500/10 px-2 py-0.5 rounded-full mt-1 inline-block border border-rose-500/20">
                                            {lossPct.toFixed(2)}%
                                        </p>
                                    </div>
                                </motion.div>
                            )
                        })
                    ) : (
                        <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-slate-500 bg-slate-50 dark:bg-slate-800/20 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
                            <div className="p-4 bg-emerald-500/10 rounded-full mb-4">
                                <Target size={32} className="text-emerald-500" />
                            </div>
                            <h4 className="text-slate-900 dark:text-white font-black text-sm uppercase tracking-tight">Zero Targets Detected</h4>
                            <p className="text-xs text-slate-400 mt-1 max-w-[150px]">Your portfolio is 100% efficient or fully in green.</p>
                        </div>
                    )}
                </div>

                <button className="w-full mt-6 shrink-0 py-4 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-lg shadow-rose-900/20 active:scale-[0.98] flex items-center justify-center gap-3 group/footer">
                    Execute Harvesting Report <ArrowRight size={14} className="group-hover/footer:translate-x-1 transition-transform" />
                </button>
            </div>
        </div>
    );
};

export default TaxHarvester;
