import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, AlertTriangle, CheckCircle2, X } from 'lucide-react';

interface VoiceInsightCardProps {
    insight: any;
    onClose: () => void;
}

/**
 * Breakthrough 3: Voice Insight Display
 * A sleek, slide-up card that shows the psychological analysis.
 */
const VoiceInsightCard: React.FC<VoiceInsightCardProps> = ({ insight, onClose }) => {
    if (!insight) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.9 }}
                className="fixed bottom-8 right-8 z-[100] w-80 rounded-[32px] bg-white/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/20 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] p-6 overflow-hidden"
            >
                <div className="space-y-5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
                                <Brain size={16} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Emotional Verdict</span>
                        </div>
                        <button 
                            onClick={onClose}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                        >
                            <X size={16} className="text-slate-400" />
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                                {insight.emotion}
                            </h3>
                            <div className={`px-3 py-1 rounded-full text-[10px] font-black tracking-tighter ${insight.risk_level === 'High' ? 'bg-rose-100 text-rose-600' : insight.risk_level === 'Medium' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                {insight.risk_level} RISK
                            </div>
                        </div>
                        
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                            {insight.sentiment}
                        </p>

                        <div className="mt-4 p-4 rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-500/30">
                            <div className="flex gap-3">
                                <AlertTriangle size={18} className="shrink-0 text-indigo-200" />
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-1">Coach's Directive</p>
                                    <p className="text-xs font-bold leading-tight">{insight.coach_tip}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button 
                        onClick={onClose}
                        className="w-full py-3 mt-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                        Dismiss Analysis
                    </button>
                </div>
            </motion.div>
        </AnimatePresence>
    );
};

export default VoiceInsightCard;
