/**
 * TickerLink - Phase 9 / CC19
 *
 * A clickable ticker that is wired into the central memory store.
 * Clicking the ticker changes the activeTicker globally; all listening
 * tabs (Alpha Engine, Options Playground, Journal) react in lock-step.
 *
 * Visual cue: a glowing violet/blue ring + sync arrow next to the
 * currently active ticker so users can see that the views are linked.
 */

import React, { useEffect, useState } from 'react';
import { Link2, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCentralMemoryStore, selectActiveQuote } from '../../store/centralMemoryStore';

interface TickerLinkProps {
    symbol: string;
    className?: string;
    /** Optional click override (called after the global state updates). */
    onActivate?: (symbol: string) => void;
    /** Display mode: 'inline' (default) or 'badge'. */
    variant?: 'inline' | 'badge' | 'pill';
    /** Hide the active indicator dot. */
    hideActiveIndicator?: boolean;
    /** Title attribute override. */
    title?: string;
}

const TickerLink: React.FC<TickerLinkProps> = ({
    symbol,
    className = '',
    onActivate,
    variant = 'inline',
    hideActiveIndicator = false,
    title,
}) => {
    const normalized = (symbol || '').toUpperCase().trim();
    const activeTicker = useCentralMemoryStore((s) => s.activeTicker);
    const setActiveTicker = useCentralMemoryStore((s) => s.setActiveTicker);
    const activeQuote = useCentralMemoryStore(selectActiveQuote);
    const [pulse, setPulse] = useState(false);

    const isActive = activeTicker === normalized;
    const livePrice = isActive ? activeQuote?.price : null;
    const liveChange = isActive ? activeQuote?.changePercent : null;

    useEffect(() => {
        if (isActive) {
            setPulse(true);
            const t = setTimeout(() => setPulse(false), 600);
            return () => clearTimeout(t);
        }
    }, [isActive, activeTicker]);

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!normalized) return;
        setActiveTicker(normalized);
        onActivate?.(normalized);
    };

    if (variant === 'badge') {
        return (
            <button
                onClick={handleClick}
                title={title || `Activate ${normalized} across all tabs`}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono font-bold tracking-wide border transition-all duration-200 ${
                    isActive
                        ? 'bg-gradient-to-r from-violet-500/20 to-sky-500/20 border-violet-400/50 text-violet-700 dark:text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.25)]'
                        : 'border-slate-200/50 dark:border-slate-700/50 text-slate-700 dark:text-slate-300 hover:border-indigo-400/60 hover:text-indigo-600 dark:hover:text-indigo-300 bg-slate-100/50 dark:bg-slate-800/40'
                } ${className}`}
            >
                {!hideActiveIndicator && (
                    <span className="relative flex h-1.5 w-1.5">
                        <AnimatePresence>
                            {isActive && (
                                <motion.span
                                    key="ring"
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 0.6, scale: 1.4 }}
                                    exit={{ opacity: 0, scale: 0.5 }}
                                    className="absolute inline-flex h-full w-full rounded-full bg-violet-400"
                                />
                            )}
                        </AnimatePresence>
                        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isActive ? 'bg-violet-500' : 'bg-slate-400/60'}`} />
                    </span>
                )}
                <span>{normalized}</span>
                {isActive && <Link2 size={10} className="text-violet-500" />}
            </button>
        );
    }

    if (variant === 'pill') {
        return (
            <button
                onClick={handleClick}
                title={title || `Sync ${normalized} across all tabs`}
                className={`group inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-bold border transition-all ${
                    isActive
                        ? 'border-violet-500/50 text-violet-700 dark:text-violet-200 bg-violet-500/10 shadow-[0_0_20px_rgba(139,92,246,0.25)]'
                        : 'border-slate-200/60 dark:border-slate-700/50 text-slate-700 dark:text-slate-300 hover:border-indigo-400/60 hover:text-indigo-600 dark:hover:text-indigo-300'
                } ${className}`}
            >
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-violet-500 animate-pulse' : 'bg-slate-400'}`} />
                <span>{normalized}</span>
                {isActive && (
                    <span className="text-[9px] font-black tracking-widest text-violet-500/80 uppercase">Active</span>
                )}
                {livePrice != null && (
                    <span className={`text-[10px] font-mono font-bold ${(liveChange ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        ₹{Number(livePrice).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </span>
                )}
            </button>
        );
    }

    // 'inline' default
    return (
        <button
            onClick={handleClick}
            title={title || `Activate ${normalized} across all tabs`}
            className={`group inline-flex items-center gap-1 font-mono font-bold uppercase tracking-wide transition-all duration-200 ${
                isActive
                    ? 'text-violet-700 dark:text-violet-300 drop-shadow-[0_0_4px_rgba(139,92,246,0.4)]'
                    : 'text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300'
            } ${className}`}
        >
            <span className="relative">
                {normalized}
                <AnimatePresence>
                    {isActive && (
                        <motion.span
                            key="underline"
                            initial={{ scaleX: 0, opacity: 0 }}
                            animate={{ scaleX: 1, opacity: 1 }}
                            exit={{ scaleX: 0, opacity: 0 }}
                            className="absolute -bottom-0.5 left-0 right-0 h-[1.5px] bg-gradient-to-r from-violet-500 via-fuchsia-500 to-sky-500 origin-left"
                        />
                    )}
                </AnimatePresence>
            </span>
            {!hideActiveIndicator && isActive && (
                <motion.span
                    key="pulse"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    className="inline-flex"
                >
                    <Link2 size={10} className="text-violet-500" />
                </motion.span>
            )}
            {!hideActiveIndicator && !isActive && pulse && (
                <ExternalLink size={9} className="text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
        </button>
    );
};

export default TickerLink;
