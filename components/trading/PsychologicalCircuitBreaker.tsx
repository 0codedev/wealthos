import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Heart, Brain, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { useTiltDetectorStore } from '../../hooks/useTiltDetector';

export const PsychologicalCircuitBreaker: React.FC = () => {
    const { isLocked, activeTilt, resolveCircuitBreaker } = useTiltDetectorStore();
    const [timeLeft, setTimeLeft] = useState<number>(0);
    const [notes, setNotes] = useState<string>('');
    const [mistakeTag, setMistakeTag] = useState<string>('Revenge Trade');
    const [breathState, setBreathState] = useState<'Inhale' | 'Hold' | 'Exhale'>('Inhale');

    // Update countdown timer
    useEffect(() => {
        if (!activeTilt) return;

        const updateTimer = () => {
            const remaining = Math.max(0, Math.round((activeTilt.coolingOffUntil - Date.now()) / 1000));
            setTimeLeft(remaining);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [activeTilt]);

    // 4-7-8 Breathing Cycle Animation
    useEffect(() => {
        if (!isLocked) return;

        let breathTimer: NodeJS.Timeout;
        const runBreathing = () => {
            setBreathState('Inhale');
            breathTimer = setTimeout(() => {
                setBreathState('Hold');
                breathTimer = setTimeout(() => {
                    setBreathState('Exhale');
                    breathTimer = setTimeout(runBreathing, 8000);
                }, 7000);
            }, 4000);
        };

        runBreathing();
        return () => clearTimeout(breathTimer);
    }, [isLocked]);

    if (!isLocked || !activeTilt || typeof document === 'undefined') return null;

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const isTimeUp = timeLeft <= 0;

    const handleUnlock = () => {
        const fullNotes = `Mistake: [${mistakeTag}] - ${notes}`;
        resolveCircuitBreaker(fullNotes);
    };

    return createPortal(
        <div className="fixed inset-0 z-[999999] bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-slate-900 border border-rose-500/30 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-center p-8 space-y-6"
            >
                {/* Header Icon */}
                <div className="flex flex-col items-center justify-center">
                    <div className="p-4 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mb-3 shadow-lg shadow-rose-500/10 animate-pulse">
                        <ShieldAlert size={36} />
                    </div>
                    <span className="text-[11px] font-black uppercase tracking-widest text-rose-400 font-mono">
                        Institutional Risk Circuit Breaker
                    </span>
                    <h2 className="text-2xl font-black text-white font-display mt-1">
                        Trading Terminal Locked for Cooling Off
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm">
                        {activeTilt.lossStreakCount} consecutive stop-loss triggers detected. Terminal access is paused to protect capital from psychological tilt.
                    </p>
                </div>

                {/* Breathing Visualizer */}
                <div className="py-4 flex flex-col items-center justify-center">
                    <div className="relative flex items-center justify-center w-36 h-36">
                        <motion.div 
                            animate={{
                                scale: breathState === 'Inhale' ? 1.3 : breathState === 'Hold' ? 1.3 : 0.85,
                                opacity: breathState === 'Hold' ? 0.9 : 0.6
                            }}
                            transition={{ duration: breathState === 'Inhale' ? 4 : breathState === 'Exhale' ? 8 : 0.5, ease: 'easeInOut' }}
                            className="absolute inset-0 rounded-full bg-gradient-to-tr from-indigo-500/20 via-purple-500/20 to-rose-500/20 border border-indigo-500/30"
                        />
                        <div className="relative z-10 flex flex-col items-center">
                            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300 font-mono">
                                {breathState}
                            </span>
                            <span className="text-2xl font-black text-white font-mono mt-0.5">
                                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                            </span>
                        </div>
                    </div>
                    <span className="text-[10px] text-slate-500 mt-2 font-mono">4-7-8 Downregulation Breath</span>
                </div>

                {/* Post-Mortem Reflection */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 text-left space-y-3">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Brain size={14} className="text-indigo-400" />
                        Discipline Post-Mortem (Commitment to Reset)
                    </label>

                    <div className="flex flex-wrap gap-1.5">
                        {['Revenge Trade', 'FOMO', 'Overleveraged', 'Ignored Stop Loss', 'Market Noise'].map(tag => (
                            <button
                                key={tag}
                                type="button"
                                onClick={() => setMistakeTag(tag)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                                    mistakeTag === tag 
                                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' 
                                        : 'bg-slate-800/40 border-slate-700/50 text-slate-400 hover:text-slate-200'
                                }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>

                    <input
                        type="text"
                        placeholder="What triggered this emotional deviation?..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                    />
                </div>

                {/* Unlock Button */}
                <button
                    onClick={handleUnlock}
                    disabled={!isTimeUp && notes.trim().length < 5}
                    className={`w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                        isTimeUp || notes.trim().length >= 5
                            ? 'bg-gradient-to-r from-emerald-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/20 hover:scale-[1.01]'
                            : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                    }`}
                >
                    {isTimeUp ? <CheckCircle2 size={16} /> : <Lock size={16} />}
                    <span>{isTimeUp ? 'Cooling Off Complete • Resume Terminal' : notes.trim().length >= 5 ? 'Acknowledge Post-Mortem & Reset' : `Wait ${minutes}m ${seconds}s or Log Post-Mortem`}</span>
                </button>
            </motion.div>
        </div>,
        document.body
    );
};
