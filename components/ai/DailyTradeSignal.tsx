import React, { useState } from 'react';
import { Activity, AlertTriangle, Play, Square, Loader2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface DailyTradeSignalProps {
    signal?: 'go' | 'caution' | 'stop';
    reason?: string;
    isLoading?: boolean;
    onRefresh?: () => void;
    className?: string;
}

export const DailyTradeSignal: React.FC<DailyTradeSignalProps> = ({ 
    signal, 
    reason, 
    isLoading, 
    onRefresh,
    className = '' 
}) => {
    const [isHovered, setIsHovered] = useState(false);

    if (isLoading) {
        return (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 ${className}`}>
                <Loader2 size={12} className="animate-spin text-slate-400" />
                <span className="text-[10px] font-bold tracking-wide uppercase text-slate-500">AI Computing</span>
            </div>
        );
    }

    if (!signal) return null;

    const config = {
        go: {
            color: 'emerald',
            icon: Play,
            label: 'GO',
            bg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
            text: 'text-emerald-600 dark:text-emerald-400',
            border: 'border-emerald-500/20 dark:border-emerald-500/30',
            glow: 'shadow-[0_0_10px_rgba(16,185,129,0.3)]',
            dotPing: 'bg-emerald-400',
            dotCore: 'bg-emerald-500'
        },
        caution: {
            color: 'amber',
            icon: AlertTriangle,
            label: 'CAUTION',
            bg: 'bg-amber-500/10 dark:bg-amber-500/20',
            text: 'text-amber-600 dark:text-amber-400',
            border: 'border-amber-500/20 dark:border-amber-500/30',
            glow: 'shadow-[0_0_10px_rgba(245,158,11,0.3)]',
            dotPing: 'bg-amber-400',
            dotCore: 'bg-amber-500'
        },
        stop: {
            color: 'rose',
            icon: Square,
            label: 'STOP',
            bg: 'bg-rose-500/10 dark:bg-rose-500/20',
            text: 'text-rose-600 dark:text-rose-400',
            border: 'border-rose-500/20 dark:border-rose-500/30',
            glow: 'shadow-[0_0_10px_rgba(244,63,94,0.3)]',
            dotPing: 'bg-rose-400',
            dotCore: 'bg-rose-500'
        }
    };

    const activeConfig = config[signal];
    const Icon = activeConfig.icon;

    return (
        <div 
            className={`relative flex items-center ${className}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => setIsHovered(!isHovered)}
        >
            <div className={`cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-full border backdrop-blur-sm transition-all duration-300 ${activeConfig.bg} ${activeConfig.border} ${activeConfig.text} ${activeConfig.glow}`}>
                <div className="relative flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${activeConfig.dotPing}`}></span>
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${activeConfig.dotCore}`}></span>
                </div>
                <Icon size={12} className="fill-current opacity-70" />
                <span className="text-[10px] font-black tracking-widest uppercase">{activeConfig.label}</span>

                {onRefresh && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                        className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors"
                        title="Refresh Signal"
                    >
                        <RefreshCw size={10} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                )}
            </div>

            <AnimatePresence>
                {isHovered && reason && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-full left-0 mt-2 z-50 w-64 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl"
                    >
                        <div className="flex items-start gap-2">
                            <Activity size={14} className={`mt-0.5 shrink-0 ${activeConfig.text}`} />
                            <div>
                                <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${activeConfig.text}`}>
                                    Market Posture: {activeConfig.label}
                                </p>
                                <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                                    {reason}
                                </p>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default DailyTradeSignal;
