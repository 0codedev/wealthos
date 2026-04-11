
import React, { useState, useEffect } from 'react';
import { User, TrendingUp, TrendingDown, Clock, ShieldAlert, ArrowRight, UserSearch } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { marketDataService, InsiderTrade } from '../../services/MarketDataService';
import { motion } from 'framer-motion';

const InsiderRadar: React.FC = () => {
    const [trades, setTrades] = useState<InsiderTrade[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = async (force = false) => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await marketDataService.fetchInsiderTrades(force);
            setTrades(data);
        } catch (err: unknown) {
            console.error("InsiderRadar Load Error:", err);
            const message = err instanceof Error ? err.message : String(err);
            setTrades([]);
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
                <UserSearch size={160} className="text-indigo-500" />
            </div>

            <div className="flex items-center justify-between mb-6 relative z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 rounded-2xl border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
                        <UserSearch size={22} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase">Insider Radar</h3>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                            <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 tracking-widest uppercase">Promoter Surveillance</span>
                        </div>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRefresh}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-indigo-500 group/btn"
                        title="Sync with Exchanges"
                    >
                        <Clock size={16} className="group-hover/btn:rotate-180 transition-transform duration-500" />
                    </button>
                    {error && (
                        <span className="text-[9px] font-black bg-amber-500/10 text-amber-500 px-2 py-1 rounded-lg border border-amber-500/20">
                            {error}
                        </span>
                    )}
                </div>
            </div>

            <div className="space-y-3 relative z-10 flex-1 overflow-y-auto pr-1 scrollbar-hide">
                {isLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800/40 rounded-2xl animate-pulse"></div>
                        ))}
                    </div>
                ) : (
                    trades.map((trade, idx) => (
                        <motion.div 
                            key={trade.id} 
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-500/30 dark:hover:border-indigo-500/30 transition-all duration-300 shadow-sm hover:shadow-xl group/item relative overflow-hidden"
                        >
                            {/* Trading Accent */}
                            <div className={`absolute top-0 left-0 w-1.5 h-full ${trade.type === 'BUY' ? 'bg-emerald-500' : 'bg-rose-500'} opacity-30`}></div>

                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-black text-slate-900 dark:text-white text-base tracking-tight">{trade.ticker}</span>
                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${
                                            trade.type === 'BUY' 
                                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                                            : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                        }`}>
                                            {trade.type}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                        {trade.person} <span className="opacity-50 mx-1">•</span> <span className="text-[10px] text-indigo-500/70 dark:text-indigo-400/70 uppercase font-black">{trade.relation}</span>
                                    </p>
                                </div>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono font-bold">
                                    {trade.date}
                                </span>
                            </div>

                            <div className="flex justify-between items-end border-t border-slate-100 dark:border-slate-700/50 pt-3 mt-1">
                                <div>
                                    <p className="text-[9px] uppercase text-slate-400 dark:text-slate-500 font-black tracking-widest mb-0.5">Value</p>
                                    <p className="text-lg font-mono font-black text-slate-900 dark:text-white leading-none">
                                        {formatCurrency(trade.value)}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[9px] uppercase text-slate-400 dark:text-slate-500 font-black tracking-widest mb-0.5">Mode</p>
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                        {trade.mode}
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    ))
                )}
            </div>

            <button className="w-full mt-6 shrink-0 py-4 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-600 dark:hover:bg-indigo-600 text-slate-600 dark:text-slate-300 hover:text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl transition-all flex items-center justify-center gap-3 border border-slate-200 dark:border-slate-700 hover:border-transparent group/footer shadow-lg hover:shadow-indigo-500/25 active:scale-[0.98]">
                Exchange Filings <ArrowRight size={14} className="group-hover/footer:translate-x-1 transition-transform" />
            </button>
        </div>
    );
};

export default InsiderRadar;
