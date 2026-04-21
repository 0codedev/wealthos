import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, ChevronRight, Trophy, BookOpen, Lightbulb, Target, Crown } from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import { useProfitabilityRecompute } from '../../services/ProfitabilityRecompute';
import { formatCurrency } from '../../utils/helpers';

/**
 * ProfitabilityCoPilot — the "Anyone Can Win" anchor.
 * A horizontal banner at the top of the Quantum deck. Single number
 * (0..100), tier name, 5 mini bars, and a coach cue. Designed to be
 * instantly readable in <2 seconds.
 */
export const ProfitabilityCoPilot: React.FC = () => {
    useProfitabilityRecompute();
    const profitability = useQuantumStore(useShallow(s => s.profitability));

    if (!profitability) {
        return (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-4 text-slate-400 text-xs">
                Computing your Profitability Score from your journal…
            </div>
        );
    }

    const tierColor =
        profitability.tier === 'MASTER' ? 'text-amber-300 border-amber-500/30' :
        profitability.tier === 'STRATEGIST' ? 'text-fuchsia-300 border-fuchsia-500/30' :
        profitability.tier === 'OPERATOR' ? 'text-cyan-300 border-cyan-500/30' :
        profitability.tier === 'APPRENTICE' ? 'text-violet-300 border-violet-500/30' :
        'text-slate-300 border-slate-700/30';

    return (
        <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl border p-4 bg-gradient-to-r from-slate-950/60 to-slate-900/40 ${tierColor}`}
        >
            <div className="flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex items-center gap-3">
                    <div className="relative h-16 w-16">
                        <svg className="absolute inset-0" viewBox="0 0 64 64">
                            <defs>
                                <linearGradient id="cp-grad" x1="0" y1="0" x2="1" y2="1">
                                    <stop offset="0%" stopColor="#22d3ee" />
                                    <stop offset="50%" stopColor="#a78bfa" />
                                    <stop offset="100%" stopColor="#f0abfc" />
                                </linearGradient>
                            </defs>
                            <circle cx="32" cy="32" r="28" stroke="rgba(34,211,238,0.15)" strokeWidth="5" fill="none" />
                            <motion.circle
                                cx="32" cy="32" r="28"
                                stroke="url(#cp-grad)" strokeWidth="5" fill="none"
                                strokeLinecap="round"
                                strokeDasharray="175.9"
                                initial={{ strokeDashoffset: 175.9 }}
                                animate={{ strokeDashoffset: 175.9 - (175.9 * (profitability.score / 100)) }}
                                transition={{ duration: 1, ease: 'easeOut' }}
                            />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center font-black text-lg">
                            {profitability.score}
                        </div>
                    </div>
                    <div>
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Profitability</div>
                        <div className="text-base font-black tracking-wider">{profitability.tier}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                            Confidence {(profitability.confidence * 100).toFixed(0)}% · 21d projection {formatCurrency(profitability.projected21dPnl)}
                        </div>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-5 gap-2 min-w-0">
                    {(['process', 'risk', 'edge', 'behavior', 'learning'] as const).map(k => (
                        <div key={k} className="min-w-0">
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 truncate">{k}</div>
                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-0.5">
                                <div className="h-full" style={{
                                    width: `${profitability.components[k]}%`,
                                    background: k === profitability.primaryDriver ? '#f43f5e' : '#22d3ee',
                                }} />
                            </div>
                            <div className="text-[9px] text-slate-400 mt-0.5">{Math.round(profitability.components[k])}</div>
                        </div>
                    ))}
                </div>

                <div className="md:w-72 rounded-xl bg-slate-950/70 border border-slate-800 p-2">
                    <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-amber-300">
                        <Lightbulb size={11} /> Coach
                    </div>
                    <div className="text-xs text-slate-200 mt-0.5">{profitability.coach}</div>
                </div>
            </div>
        </motion.div>
    );
};

export default ProfitabilityCoPilot;
