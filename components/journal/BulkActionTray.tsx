import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Zap, Brain, X, Clock, RefreshCw } from 'lucide-react';
import { Strategy, Trade } from '../../database';
import { UnifiedButton } from '../ui/UnifiedButton';

interface BulkActionTrayProps {
    selectedCount: number;
    isUpdating: boolean;
    strategies: Strategy[];
    onBulkUpdate: (updates: Partial<Trade>) => Promise<void>;
    onStitchDelivery?: () => Promise<void>;
    onCancel: () => void;
}

export const BulkActionTray: React.FC<BulkActionTrayProps> = ({
    selectedCount,
    isUpdating,
    strategies,
    onBulkUpdate,
    onStitchDelivery,
    onCancel
}) => {
    if (selectedCount === 0) return null;

    const tray = (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-fit max-w-[95%]" style={{ perspective: '1000px' }}>
            <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.95 }}
                className="py-2 px-3.5 sm:py-2.5 sm:px-6 bg-slate-900/90 dark:bg-slate-950/95 backdrop-blur-2xl rounded-full border border-white/10 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] flex items-center gap-3 sm:gap-8"
            >
                {/* Status Indicator */}
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[11px] sm:text-xs font-black shadow-lg shadow-indigo-500/20">
                        {selectedCount}
                    </div>
                    <div className="flex flex-col leading-tight">
                        <span className="text-[9px] sm:text-[10px] font-black text-indigo-400 uppercase tracking-widest">Bulk</span>
                        <span className="hidden sm:inline text-xs font-bold text-white">Selected</span>
                    </div>
                </div>

                {/* Actions Row */}
                <div className="flex items-center gap-1.5 sm:gap-4">
                    {/* Emotion Drop-up */}
                    <div className="relative group/menu">
                        <button 
                            className="preset-button flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5 transition-all text-xs font-bold group-hover/menu:text-indigo-400 group-hover/menu:border-indigo-500/30"
                            title="Set Emotion"
                            aria-label="Set Emotion"
                        >
                            <Brain size={14} className="text-indigo-400" />
                            <span className="hidden sm:inline">Set Emotion</span>
                        </button>
                        <div className="absolute bottom-full left-0 pb-2 hidden group-hover/menu:flex flex-col min-w-[140px] animate-in fade-in slide-in-from-bottom-2 duration-200">
                            <div className="flex flex-col bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl">
                                {['Focused', 'Anxious', 'Bored', 'Revenge', 'Greedy'].map(m => (
                                    <button
                                        key={m}
                                        onClick={() => onBulkUpdate({ moodEntry: m as any })}
                                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-indigo-500 hover:text-white transition-all"
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Product Drop-up */}
                    <div className="relative group/menu">
                        <button 
                            className="preset-button flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5 transition-all text-xs font-bold group-hover/menu:text-emerald-400 group-hover/menu:border-emerald-500/30"
                            title="Set Product"
                            aria-label="Set Product"
                        >
                            <Layers size={14} className="text-emerald-400" />
                            <span className="hidden sm:inline">Set Product</span>
                        </button>
                        <div className="absolute bottom-full left-0 pb-2 hidden group-hover/menu:flex flex-col min-w-[120px] animate-in fade-in slide-in-from-bottom-2 duration-200">
                            <div className="flex flex-col bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl">
                                {['MIS', 'CNC', 'MARGIN', 'MTF'].map(p => (
                                    <button
                                        key={p}
                                        onClick={() => onBulkUpdate({ productType: p })}
                                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-emerald-500 hover:text-white transition-all"
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Strategy Drop-up */}
                    <div className="relative group/menu">
                        <button 
                            className="preset-button flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 border border-white/5 transition-all text-xs font-bold group-hover/menu:text-amber-400 group-hover/menu:border-amber-500/30"
                            title="Apply Setup"
                            aria-label="Apply Setup"
                        >
                            <Zap size={14} className="text-amber-400" />
                            <span className="hidden sm:inline">Apply Setup</span>
                        </button>
                        <div className="absolute bottom-full left-0 pb-2 hidden group-hover/menu:flex flex-col min-w-[180px] animate-in fade-in slide-in-from-bottom-2 duration-200">
                            <div className="flex flex-col bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-1.5 shadow-2xl max-h-60 overflow-y-auto no-scrollbar">
                                {strategies.map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => onBulkUpdate({ setup: s.name })}
                                        className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-amber-500 hover:text-white transition-all"
                                    >
                                        {s.name}
                                    </button>
                                ))}
                                <button
                                    onClick={() => onBulkUpdate({ setup: 'Discretionary' })}
                                    className="w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:bg-slate-700 hover:text-white transition-all border-t border-white/5 mt-1"
                                >
                                    Discretionary
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Stitch Delivery Button */}
                    <UnifiedButton 
                        variant={selectedCount === 2 ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={onStitchDelivery}
                        disabled={selectedCount !== 2 || isUpdating}
                        className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 text-xs font-bold border ${
                            selectedCount === 2 
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.2)]' 
                            : 'bg-white/5 text-slate-500 border-white/5 cursor-not-allowed grayscale'
                        }`}
                        title={selectedCount === 2 ? "Merge Entry/Exit for Delivery Trade" : "Select exactly 2 trades to stitch"}
                        aria-label="Stitch Delivery"
                    >
                        <RefreshCw size={14} className={selectedCount === 2 ? "animate-pulse" : ""} />
                        <span className="hidden sm:inline">Stitch Delivery</span>
                    </UnifiedButton>
                </div>

                <div className="w-px h-6 bg-white/10" />

                {/* Close Button */}
                <button 
                    onClick={onCancel}
                    className="p-2 bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-full transition-all"
                    aria-label="Clear selection"
                >
                    <X size={16} />
                </button>

                {/* Loading Overlay */}
                <AnimatePresence>
                    {isUpdating && (
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-900/90 backdrop-blur-md flex items-center justify-center z-10 rounded-full"
                        >
                            <div className="flex items-center gap-3">
                                <Clock size={16} className="text-indigo-400 animate-spin" />
                                <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Syncing...</span>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );

    return typeof window !== 'undefined' ? createPortal(tray, document.body) : null;
};

export default BulkActionTray;
