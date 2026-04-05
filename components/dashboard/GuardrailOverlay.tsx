import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ShieldAlert, Clock, Zap, AlertTriangle } from 'lucide-react';
import { useGuardrailStore } from '../../store/useGuardrailStore';
import { useShallow } from 'zustand/react/shallow';

import { usePageVisibility } from '../../contexts/PageVisibilityContext';

const GuardrailOverlay: React.FC = () => {
    // P0#3: wrap multi-field selector in useShallow to avoid re-render on
    // any guardrail store change (was: re-renders on every store mutation).
    const { activeBreaker, breakerExpiry, breakerReason, clearBreaker, checkBreakers } = useGuardrailStore(
        useShallow(state => ({
            activeBreaker: state.activeBreaker,
            breakerExpiry: state.breakerExpiry,
            breakerReason: state.breakerReason,
            clearBreaker: state.clearBreaker,
            checkBreakers: state.checkBreakers,
        }))
    );
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const isVisible = usePageVisibility();

    useEffect(() => {
        const timer = setInterval(() => {
            if (!isVisible) return;
            checkBreakers();
            if (breakerExpiry) {
                const diff = Math.max(0, breakerExpiry - Date.now());
                setTimeLeft(diff);
            } else {
                setTimeLeft(null);
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [breakerExpiry, checkBreakers]);

    if (activeBreaker === 'none') return null;

    const formatTime = (ms: number) => {
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const isLockout = activeBreaker === 'lockout';

    return (
        <AnimatePresence>
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-xl p-6"
            >
                <div className="max-w-md w-full relative">
                    {/* Background Glow */}
                    <div className={`absolute -inset-10 blur-[100px] opacity-20 rounded-full ${isLockout ? 'bg-rose-500' : 'bg-amber-500'}`} />

                    <div className="relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center shadow-2xl overflow-hidden">
                        {/* Hazard Stripes Header */}
                        <div className="absolute top-0 left-0 right-0 h-1.5 flex">
                            {[...Array(10)].map((_, i) => (
                                <div key={i} className={`flex-1 h-full ${i % 2 === 0 ? (isLockout ? 'bg-rose-500' : 'bg-amber-500') : 'bg-slate-100 dark:bg-slate-950'}`} />
                            ))}
                        </div>

                        <div className={`mx-auto w-20 h-20 rounded-2xl flex items-center justify-center mb-6 ${isLockout ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                            {isLockout ? <Lock size={40} /> : <ShieldAlert size={40} />}
                        </div>

                        <h2 className="text-2xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tighter mb-2">
                            {isLockout ? 'System Lockout' : 'Circuit Breaker Active'}
                        </h2>
                        
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400 mb-8 leading-relaxed">
                            {breakerReason}
                        </p>

                        {/* Timer / Status */}
                        <div className="bg-slate-50 dark:bg-slate-950/50 rounded-2xl p-6 border border-slate-200 dark:border-slate-800/50 mb-8">
                            {timeLeft !== null ? (
                                <>
                                    <div className="flex items-center justify-center gap-2 text-slate-500 mb-2">
                                        <Clock size={14} />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Cooling Down</span>
                                    </div>
                                    <div className="text-4xl font-black text-slate-900 dark:text-slate-100 font-mono">
                                        {formatTime(timeLeft)}
                                    </div>
                                </>
                            ) : (
                                <div className="py-2">
                                    <div className="flex items-center justify-center gap-2 text-rose-500 dark:text-rose-400 mb-1">
                                        <AlertTriangle size={16} />
                                        <span className="text-xs font-black uppercase">Session Terminated</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase">Manual reset required to resume</p>
                                </div>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 text-left">
                                <Zap size={16} className="text-amber-400 shrink-0" />
                                <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-tight">
                                    Emotional state check detected high stress or loss velocity. This pause is to protect your capital.
                                </p>
                            </div>

                            {/* Only show override if it's a warning/cooldown and we are in dev or something? 
                                Actually, for "Hard Lockout" we disable it. 
                            */}
                            {isLockout && (
                                <button 
                                    onClick={clearBreaker}
                                    className="w-full py-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-400 text-xs font-black uppercase hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-transparent"
                                >
                                    Emergency Admin Override
                                </button>
                            )}
                        </div>
                    </div>

                    <p className="mt-8 text-center text-[10px] font-bold text-slate-500 dark:text-slate-600 uppercase tracking-[0.2em]">
                        Wealth Sentinel — Protocol 4.0
                    </p>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default GuardrailOverlay;
