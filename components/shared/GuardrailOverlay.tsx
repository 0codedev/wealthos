import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Lock, ShieldAlert, Timer, X, Zap } from 'lucide-react';
import { useGuardrailStore } from '../../store/useGuardrailStore';
import { useShallow } from 'zustand/react/shallow';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';

export const GuardrailOverlay: React.FC = () => {
    // P0#3: useShallow keeps the modal from re-rendering on every guardrail mutation.
    const { activeBreaker, breakerReason, breakerExpiry, emergencyOverride } = useGuardrailStore(
        useShallow(state => ({
            activeBreaker: state.activeBreaker,
            breakerReason: state.breakerReason,
            breakerExpiry: state.breakerExpiry,
            emergencyOverride: state.emergencyOverride,
        }))
    );
    const [timeLeft, setTimeLeft] = useState<string>('');
    const [isOverridePending, setIsOverridePending] = useState(false);
    const [overrideCountdown, setOverrideCountdown] = useState(30);

    const isVisible = usePageVisibility();

    useEffect(() => {
        if (!breakerExpiry || !isVisible) return;

        const interval = setInterval(() => {
            const now = Date.now();
            const diff = breakerExpiry - now;
            
            if (diff <= 0) {
                setTimeLeft('00:00');
                clearInterval(interval);
            } else {
                const mins = Math.floor(diff / 60000);
                const secs = Math.floor((diff % 60000) / 1000);
                setTimeLeft(`${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [breakerExpiry, isVisible]);

    const handleOverrideClick = () => {
        setIsOverridePending(true);
        let count = 30;
        const interval = setInterval(() => {
            if (!isVisible) return;
            count--;
            setOverrideCountdown(count);
            if (count <= 0) {
                clearInterval(interval);
            }
        }, 1000);
    };

    const confirmOverride = () => {
        emergencyOverride();
        setIsOverridePending(false);
        setOverrideCountdown(30);
    };

    if (activeBreaker === 'none') return null;

    return (
        <AnimatePresence>
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[200] flex items-center justify-center p-6 backdrop-blur-md bg-slate-950/60"
            >
                <motion.div 
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-3xl p-8 shadow-[0_0_50px_rgba(239,68,68,0.2)] text-center relative overflow-hidden"
                >
                    {/* Background Pulse */}
                    <div className={`absolute inset-0 bg-red-500/5 pointer-events-none ${isVisible ? 'animate-pulse' : ''}`} />

                    <div className="flex justify-center mb-6">
                        <div className="p-4 bg-red-500/20 rounded-2xl border border-red-500/30">
                            {activeBreaker === 'lockout' ? (
                                <Lock size={40} className="text-red-500" />
                            ) : (
                                <ShieldAlert size={40} className="text-red-400" />
                            )}
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold text-white mb-2 uppercase tracking-tighter">
                        {activeBreaker === 'lockout' ? 'Session Terminated' : 'Mandatory Cooldown'}
                    </h2>
                    
                    <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                        {breakerReason || 'Automated risk management has intervened to protect your capital.'}
                    </p>

                    {breakerExpiry && (
                        <div className="flex flex-col items-center gap-2 mb-8 p-4 bg-white/5 rounded-2xl border border-white/5">
                            <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-widest font-bold">
                                <Timer size={14} /> Time Remaining
                            </div>
                            <div className="text-4xl font-mono text-white font-bold tracking-tighter">
                                {timeLeft}
                            </div>
                        </div>
                    )}

                    {!isOverridePending ? (
                        <div className="space-y-4">
                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                                <p className="text-[10px] text-amber-400 uppercase font-bold tracking-widest mb-1">AI Coach Directive</p>
                                <p className="text-xs text-slate-300 italic">"Step away from the screen. Walk for 5 minutes. The market will be here when your mind is calm."</p>
                            </div>
                            
                            <button 
                                onClick={handleOverrideClick}
                                className="text-[10px] text-slate-500 hover:text-red-400 transition-colors uppercase tracking-widest font-bold"
                            >
                                Emergency Override
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <p className="text-xs text-red-400 font-bold uppercase tracking-widest">
                                Override Available in {overrideCountdown}s
                            </p>
                            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                                <motion.div 
                                    initial={{ width: "0%" }}
                                    animate={{ width: "100%" }}
                                    transition={{ duration: 30, ease: "linear" }}
                                    className="h-full bg-red-500"
                                />
                            </div>
                            {overrideCountdown <= 0 ? (
                                <button 
                                    onClick={confirmOverride}
                                    className="w-full py-4 bg-red-600 hover:bg-red-500 text-white rounded-2xl font-bold text-sm transition-all shadow-lg shadow-red-600/20"
                                >
                                    CONFIRM OVERRIDE & UNLOCK
                                </button>
                            ) : (
                                <button 
                                    onClick={() => setIsOverridePending(false)}
                                    className="w-full py-4 bg-slate-800 text-slate-400 rounded-2xl font-bold text-sm"
                                >
                                    CANCEL OVERRIDE
                                </button>
                            )}
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
