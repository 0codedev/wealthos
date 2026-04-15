
import React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ShieldAlert, Brain, X, Zap, ArrowRight, Activity } from 'lucide-react';
import { useCosmicGovernorStore } from '../../store/cosmicGovernorStore';
import { useShallow } from 'zustand/react/shallow';

interface CosmicCircuitBreakerProps {
    isOpen: boolean;
    onClose: () => void;
}

const CosmicCircuitBreaker: React.FC<CosmicCircuitBreakerProps> = ({ isOpen, onClose }) => {
    // P0#3: useShallow on multi-field cosmic governor selector
    const { blockReason, dailyTradeCount, tiltScore, dailyFees } = useCosmicGovernorStore(
        useShallow(state => ({
            blockReason: state.blockReason,
            dailyTradeCount: state.dailyTradeCount,
            tiltScore: state.tiltScore,
            dailyFees: state.dailyFees,
        }))
    );

    if (!isOpen) return null;
    if (typeof window === 'undefined') return null;

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="cosmic-circuit-breaker-title" className="fixed inset-0 z-[300] bg-slate-950/90 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-300">
            <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="max-w-md w-full bg-slate-900 border-2 border-rose-600/50 rounded-[2.5rem] p-8 text-center relative overflow-hidden shadow-[0_0_100px_rgba(225,29,72,0.3)]"
            >
                {/* Background Decorations */}
                <div className="absolute -top-24 -left-24 w-64 h-64 bg-rose-600/10 rounded-full blur-3xl" />
                <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl" />

                <div className="relative z-10">
                    <div className="w-20 h-20 bg-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-rose-600/40 rotate-12">
                        <ShieldAlert size={40} className="text-white -rotate-12" />
                    </div>

                    <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">Circuit Breaker Active</h2>
                    <p className="text-rose-400 font-bold text-xs mb-8 uppercase tracking-[0.2em]">Hard Discipline Protocol</p>

                    <div className="bg-slate-950/50 border border-rose-500/20 rounded-2xl p-6 mb-8 text-left">
                        <p className="text-xs text-rose-300/70 font-bold uppercase mb-2 flex items-center gap-2">
                            <Brain size={14} /> System Verdict
                        </p>
                        <p className="text-lg font-bold text-white leading-tight">
                            "{blockReason || 'The Rahu-Saturn balance is heavily tilted. Trading is temporarily suspended to protect your capital.'}"
                        </p>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-8">
                        <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Trades</p>
                            <p className="text-xl font-mono font-bold text-white">{dailyTradeCount}</p>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Tilt</p>
                            <p className="text-xl font-mono font-bold text-rose-500">{tiltScore}%</p>
                        </div>
                        <div className="bg-slate-800/50 p-3 rounded-xl border border-white/5">
                            <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Fees</p>
                            <p className="text-lg font-mono font-bold text-amber-500">₹{Math.round(dailyFees)}</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={onClose}
                            className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-2xl transition-all active:scale-95 border border-white/5"
                        >
                            I UNDERSTAND (STAY IN JOURNAL)
                        </button>
                        
                        <p className="text-[10px] text-slate-500 italic">
                            Saturn is the lord of time. Wait for the next auspicious window.
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>,
        document.body
    );
};

export default CosmicCircuitBreaker;
