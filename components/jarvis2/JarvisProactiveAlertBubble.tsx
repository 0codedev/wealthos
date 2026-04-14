import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Volume2, RotateCw } from 'lucide-react';
import { useJarvis2 } from '../../hooks/useJarvis2';
import { jarvis2Service, Jarvis2Alert } from '../../services/Jarvis2Service';

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 30_000;

/**
 * JarvisProactiveAlertBubble — a stack of glass-morphic bubbles
 * pinned to the bottom-left of the viewport. Each bubble shows
 * one proactive alert and offers "Speak Again" / "Dismiss".
 */
const JarvisProactiveAlertBubble: React.FC = () => {
    const { snapshot, dismissAlert } = useJarvis2();
    const visible: Jarvis2Alert[] = snapshot.alerts
        .filter((a: Jarvis2Alert) => !a.dismissed)
        .slice(0, MAX_VISIBLE);

    return (
        <div
            className="fixed bottom-24 md:bottom-6 left-4 md:left-6 z-[55] flex flex-col gap-2 pointer-events-none"
            aria-live="polite"
            aria-relevant="additions"
        >
            <AnimatePresence initial={false}>
                {visible.map((alert, idx) => (
                    <AlertBubble
                        key={alert.id}
                        alert={alert}
                        stackIndex={idx}
                        onDismiss={() => dismissAlert(alert.id)}
                    />
                ))}
            </AnimatePresence>
        </div>
    );
};

const AlertBubble: React.FC<{
    alert: Jarvis2Alert;
    stackIndex: number;
    onDismiss: () => void;
}> = ({ alert, stackIndex, onDismiss }) => {
    const [age, setAge] = useState(0);

    useEffect(() => {
        const tick = setInterval(() => setAge(Date.now() - alert.timestamp), 1000);
        return () => clearInterval(tick);
    }, [alert.timestamp]);

    // Auto-dismiss after 30 seconds
    useEffect(() => {
        const t = setTimeout(() => onDismiss(), AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [alert.id, onDismiss]);

    const colorByCategory: Record<Jarvis2Alert['category'], string> = {
        market: 'border-indigo-500/30 from-indigo-500/10',
        holding: 'border-rose-500/30 from-rose-500/10',
        milestone: 'border-emerald-500/30 from-emerald-500/10',
        sip: 'border-amber-500/30 from-amber-500/10',
        system: 'border-slate-500/30 from-slate-500/10',
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -16, scale: 0.96 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={`pointer-events-auto w-80 max-w-[calc(100vw-2rem)] bg-gradient-to-br ${colorByCategory[alert.category]} to-slate-900/95 border ${colorByCategory[alert.category].split(' ')[0]} rounded-2xl shadow-2xl shadow-slate-950/40 backdrop-blur-md overflow-hidden`}
        >
            <div className="flex items-start gap-3 p-3.5">
                {/* Avatar */}
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                    <Sparkles size={16} className="text-white" />
                </div>
                {/* Body */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                            Jarvis Alert
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                            {Math.floor(age / 1000)}s ago
                        </span>
                    </div>
                    <p className="text-[12.5px] text-slate-100 leading-snug">
                        {alert.text}
                    </p>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between border-t border-white/5 bg-slate-950/40 px-2 py-1.5">
                <button
                    type="button"
                    onClick={() => jarvis2Service.speak(alert.speakText)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300 hover:text-indigo-100 px-2.5 py-1 rounded-md hover:bg-indigo-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                >
                    <Volume2 size={12} /> Speak Again
                </button>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => jarvis2Service.interruptForUser()}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200 px-2.5 py-1 rounded-md hover:bg-slate-700/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                        title="Listen for a follow-up"
                    >
                        <RotateCw size={11} /> Reply
                    </button>
                    <button
                        type="button"
                        aria-label="Dismiss alert"
                        onClick={onDismiss}
                        className="p-1.5 text-slate-400 hover:text-rose-400 rounded-md hover:bg-rose-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                    >
                        <X size={13} />
                    </button>
                </div>
            </div>
        </motion.div>
    );
};

export default JarvisProactiveAlertBubble;
