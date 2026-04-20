import React, { useState, useEffect, useMemo } from 'react';
import { liveQuery } from 'dexie';
import { db, Trade, calculatePnL } from '../../database';
import { ArrowRight, BookOpen, TrendingUp, TrendingDown, Target } from 'lucide-react';

interface TradingJournalPnLCardProps {
    onNavigate?: (tab: string) => void;
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
}

export const TradingJournalPnLCard: React.FC<TradingJournalPnLCardProps> = ({ onNavigate, formatCurrency, isPrivacyMode }) => {
    const [rawTrades, setRawTrades] = useState<Trade[]>([]);

    useEffect(() => {
        const sub = liveQuery(() => db.trades.filter((t: any) => !t.isDeleted).toArray()).subscribe(rows => {
            const sorted = (rows || []).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5000);
            setRawTrades(sorted);
        });
        return () => sub.unsubscribe();
    }, []);

    const { totalPnL, winRate, totalTrades } = useMemo(() => {
        let pnl = 0;
        let wins = 0;
        rawTrades.forEach(t => {
            const tPnl = calculatePnL(t);
            pnl += tPnl;
            if (tPnl > 0) wins++;
        });

        const rate = rawTrades.length > 0 ? (wins / rawTrades.length) * 100 : 0;

        return { totalPnL: pnl, winRate: rate, totalTrades: rawTrades.length };
    }, [rawTrades]);

    const isProfit = totalPnL >= 0;

    return (
        <div className="mb-6 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg relative group transition-all hover:border-slate-700">
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform duration-500">
                <BookOpen size={120} className="text-emerald-500" />
            </div>

            <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
                        <Target size={20} />
                    </div>
                    <div>
                        <h3 className="text-white font-bold text-base flex items-center gap-2">
                            Trading Journal Profile
                            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono tracking-widest uppercase">
                                Realized
                            </span>
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                            {totalTrades} closed trade{totalTrades !== 1 ? 's' : ''} • {winRate.toFixed(1)}% Win Rate
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="text-right">
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">
                            Net Trading P&L
                        </div>
                        <div className={`flex items-center justify-end gap-1.5 font-mono text-xl font-black ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                            {isPrivacyMode ? '••••••' : `${isProfit ? '+' : ''}${formatCurrency(totalPnL)}`}
                        </div>
                    </div>

                    <button
                        onClick={() => onNavigate && onNavigate('journal')}
                        className="p-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors flex items-center gap-2 group-hover:bg-emerald-600 shadow-lg shrink-0"
                        title="Open Trading Journal"
                    >
                        <span className="text-sm font-bold hidden sm:block">View Journal</span>
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            </div>
        </div>
    );
};
