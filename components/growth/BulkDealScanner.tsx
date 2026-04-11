
import React, { useState, useEffect } from 'react';
import { Layers, Activity, TrendingUp, TrendingDown, ArrowUpRight, BarChart3, AlertCircle, Clock, Zap } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { marketDataService, BulkDeal } from '../../services/MarketDataService';
import { motion } from 'framer-motion';

const BulkDealScanner: React.FC = () => {
    const [deals, setDeals] = useState<BulkDeal[]>([]);
    const [insight, setInsight] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = async (force = false) => {
        setIsLoading(true);
        setError(null);
        try {
            const [data, insightText] = await Promise.all([
                marketDataService.fetchBulkDeals(force),
                marketDataService.fetchBulkInsight(force)
            ]);
            setDeals(data);
            setInsight(insightText);
        } catch (err: unknown) {
            console.error("BulkDealScanner Load Error:", err);
            const message = err instanceof Error ? err.message : String(err);
            setDeals([]);
            setInsight('Institutional accumulation trends are currently being synchronized.');
            setError(message.includes("Quota") ? "Quota Limit" : "API Error");
        }
        setIsLoading(false);
    }

    useEffect(() => {
        loadData();
    }, []);

    const handleRefresh = () => {
        loadData(true);
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 relative overflow-hidden group h-full flex flex-col shadow-xl">
            {/* Background Icon Decor */}
            <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-[0.08] transition-all duration-700 -mr-4 -mt-4 transform group-hover:scale-125 rotate-12">
                <BarChart3 size={160} className="text-amber-500" />
            </div>

            <div className="flex items-center justify-between mb-6 relative z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-500/10 text-amber-500 dark:text-amber-400 rounded-2xl border border-amber-500/20 shadow-lg shadow-amber-500/5">
                        <BarChart3 size={22} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase">Bulk Deal Scanner</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 tracking-widest uppercase">Smart Money Intensity</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRefresh}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-amber-500 group/btn"
                        title="Sync with Exchanges"
                    >
                        <Clock size={16} className="group-hover/btn:rotate-180 transition-transform duration-500" />
                    </button>
                </div>
            </div>

            <div className="space-y-3 relative z-10 flex-1 overflow-y-auto pr-1 scrollbar-hide">
                {isLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-24 bg-slate-100 dark:bg-slate-800/40 rounded-2xl animate-pulse"></div>
                        ))}
                    </div>
                ) : (
                    deals.map((deal, idx) => (
                        <motion.div 
                            key={deal.id} 
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 hover:bg-white dark:hover:bg-slate-800 hover:border-amber-500/30 dark:hover:border-amber-500/30 transition-all duration-300 shadow-sm hover:shadow-xl group/item relative overflow-hidden"
                        >
                            {/* Potential Impact Badge */}
                            <div className="absolute top-0 right-0 bg-slate-100 dark:bg-slate-700 text-[8px] font-black py-1 px-3 rounded-bl-xl border-l border-b border-white/10 opacity-50 group-hover/item:opacity-100 transition-opacity">
                                VOL CLUSTER: {idx + 1}X
                            </div>

                            <div className="flex justify-between items-start mb-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="font-black text-slate-900 dark:text-white text-base tracking-tight uppercase">{deal.ticker}</h4>
                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                            deal.change > 0 
                                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                                            : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                        }`}>
                                            {deal.change > 0 ? '+' : ''}{deal.change}%
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate w-[140px] md:w-[220px]" title={deal.client}>
                                        {deal.client}
                                    </p>
                                </div>

                                <div className="text-right">
                                    <div className="flex items-center justify-end gap-1.5 mb-1">
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${deal.type === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {deal.type}
                                        </span>
                                        <span className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-600"></span>
                                        <span className="text-base font-mono font-black text-slate-900 dark:text-white leading-none">
                                            {formatCurrency(deal.value)}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">
                                        @ ₹{deal.price} / share
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    ))
                )}
            </div>

            <div className="mt-6 shrink-0 p-4 bg-amber-500/5 dark:bg-amber-900/10 border border-amber-500/20 rounded-2xl flex items-start gap-3 shadow-inner shadow-amber-500/5 group/insight relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl -mr-12 -mt-12 group-hover/insight:scale-150 transition-transform duration-700"></div>
                <Zap size={20} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                <div className="relative z-10">
                    <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1">Algorithmic Insight</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed italic">
                        "{insight || 'Analyzing recent institutional patterns for accumulation signals...'}"
                    </p>
                </div>
            </div>
        </div>
    );
};

export default BulkDealScanner;
