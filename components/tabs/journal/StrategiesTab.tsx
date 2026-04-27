import React, { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, Trade, calculatePnL } from '../../../database';
import { StrategyPlaybook } from '../../trading/StrategyPlaybook';
import PlaybookGallery from '../../journal/PlaybookGallery';
import { BookOpen } from 'lucide-react';

interface StrategiesTabProps {
    onEditTrade: (trade: Trade) => void;
}

export const StrategiesTab: React.FC<StrategiesTabProps> = ({ onEditTrade }) => {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [playbookSubView, setPlaybookSubView] = useState<'STRATEGIES' | 'GALLERY'>('STRATEGIES');

    useEffect(() => {
        const subscription = liveQuery(() => db.trades.filter((t: any) => !t.isDeleted).toArray()).subscribe(data => {
            const enriched = (data || []).map(t => ({
                ...t,
                pnl: calculatePnL(t)
            }));
            setTrades(enriched);
        });
        return () => subscription.unsubscribe();
    }, []);

    return (
        <div className="space-y-6 pb-20">
            {/* Header Toolbar */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
                        <BookOpen size={20} />
                    </div>
                    <div>
                        <h2 className="text-md font-bold text-slate-800 dark:text-white">Strategies Playbook</h2>
                        <p className="text-[10px] text-slate-400 mt-0.5">Define strategy parameters and browse textbook trade setups</p>
                    </div>
                </div>

                {/* Sub View Toggle */}
                <div className="flex bg-slate-100 dark:bg-slate-950 p-1 rounded-xl border border-slate-200/60 dark:border-slate-800/80 w-fit">
                    <button
                        onClick={() => setPlaybookSubView('STRATEGIES')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                            playbookSubView === 'STRATEGIES'
                                ? 'bg-indigo-650 text-white shadow-md'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        Strategy Rules
                    </button>
                    <button
                        onClick={() => setPlaybookSubView('GALLERY')}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                            playbookSubView === 'GALLERY'
                                ? 'bg-indigo-650 text-white shadow-md'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        Trade Gallery
                    </button>
                </div>
            </div>

            {/* Sub View Rendering */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-6 shadow-sm">
                {playbookSubView === 'STRATEGIES' ? (
                    <StrategyPlaybook />
                ) : (
                    <PlaybookGallery trades={trades} onEditTrade={onEditTrade} />
                )}
            </div>
        </div>
    );
};

export default StrategiesTab;
