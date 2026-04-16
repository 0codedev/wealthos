import React from 'react';
import { createPortal } from 'react-dom';
import { Brain, Snowflake, Target } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { Trade } from '../../database';

interface SlumpBusterModalProps {
    isOpen: boolean;
    onClose: () => void;
    slumpStats: {
        currentLoseStreak: number;
        bestTrade: Trade | null;
    };
}

const SlumpBusterModal: React.FC<SlumpBusterModalProps> = ({ isOpen, onClose, slumpStats }) => {
    if (!isOpen) return null;
    if (typeof window === 'undefined') return null;

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="slump-buster-title" className="fixed inset-0 z-[100] bg-slate-900/60 dark:bg-black/90 backdrop-blur-xl flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-white dark:bg-slate-900 border-2 border-rose-600 rounded-[2.5rem] p-8 text-center relative overflow-hidden shadow-2xl dark:shadow-[0_0_100px_rgba(225,29,72,0.5)]">
                <div className="absolute top-0 right-0 p-6 opacity-10 dark:opacity-20">
                    <Snowflake size={120} className="text-rose-600 dark:text-rose-500 animate-spin-slow" />
                </div>

                <div className="relative z-10">
                    <div className="w-20 h-20 bg-rose-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl shadow-rose-600/40">
                        <Brain size={40} className="text-white" />
                    </div>

                    <h2 className="text-3xl font-black text-slate-900 dark:text-white mb-2 uppercase tracking-tight italic">Protocol Active</h2>
                    <p className="text-rose-600 dark:text-rose-400 font-black text-sm mb-6 uppercase tracking-[0.2em]">3-Day Losing Streak Detected</p>

                    <p className="text-slate-600 dark:text-slate-300 mb-8 leading-relaxed font-medium">
                        Trading is currently locked. To break the cycle, you must pause and reconnect with your strategic edge.
                    </p>

                    {slumpStats.bestTrade ? (
                        <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-5 border border-emerald-500/30 dark:border-emerald-500/20 mb-8 text-left shadow-inner">
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-black tracking-widest mb-3 flex items-center gap-2">
                                <Target size={12} /> High Conviction Memory
                            </p>
                            <div className="flex justify-between items-end">
                                <div>
                                    <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{slumpStats.bestTrade.ticker}</p>
                                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-wider">{slumpStats.bestTrade.setup}</p>
                                </div>
                                <p className="text-2xl font-mono font-black text-emerald-600 dark:text-emerald-400">+{formatCurrency(slumpStats.bestTrade.pnl || 0)}</p>
                            </div>
                            {slumpStats.bestTrade.notes && (
                                <p className="mt-4 text-xs text-slate-500 dark:text-slate-300 italic border-t border-slate-200 dark:border-slate-700/50 pt-3 leading-relaxed">
                                    "{slumpStats.bestTrade.notes}"
                                </p>
                            )}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-500 italic mb-8">No wins recorded yet. Visualize your first win with clarity.</p>
                    )}

                    <button
                        onClick={onClose}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl shadow-lg shadow-emerald-600/30 transition-all active:scale-95 uppercase tracking-widest text-xs"
                    >
                        I HAVE REVIEWED MY EDGE
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default SlumpBusterModal;
