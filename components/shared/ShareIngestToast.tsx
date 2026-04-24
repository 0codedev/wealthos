/**
 * ShareIngestToast — A3 (Lane 7.1)
 *
 * Bottom-positioned toast banner that surfaces the result of a share
 * ingest. Three states:
 *
 *   - TRADE   → green left bar, "Looks like a trade — review and save."
 *               + "Open" button that fires the same `app:open-add-trade`
 *               event the hook fires (so the user can re-open the modal
 *               after dismissing the toast).
 *   - JOURNAL → indigo left bar, "Saved to your journal." + "Dismiss"
 *               button.
 *   - NONE    → slate left bar, "Nothing shared." + "Dismiss" button.
 *
 * Auto-dismisses after 6 seconds. Honors `prefers-reduced-motion`.
 * Mounted in `App.tsx` next to the install prompt.
 *
 * Spec: docs/superpowers/specs/2026-06-20-share-target-api-design.md
 */
import React, { useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { CheckCircle2, FileText, X, Share2 } from 'lucide-react';
import type { IngestResult, TradePrefill } from '../../services/shareIngestService';

const AUTO_DISMISS_MS = 6000;

export interface ShareIngestToastProps {
    result: IngestResult | null;
    /** Called when the user taps "Open" on a TRADE toast. */
    onOpenAddTrade?: (prefill: TradePrefill) => void;
    /** Called when the user taps "Dismiss" (or auto-dismiss fires). */
    onDismiss?: () => void;
}

export const ShareIngestToast: React.FC<ShareIngestToastProps> = ({
    result,
    onOpenAddTrade,
    onDismiss,
}) => {
    const reduceMotion = useReducedMotion();
    const visible = !!result;

    useEffect(() => {
        if (!visible) return;
        const t = setTimeout(() => onDismiss?.(), AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [visible, result, onDismiss]);

    if (!result) return null;

    const config = configFor(result);
    const Icon = config.icon;
    const prefill = result.savedAs === 'TRADE' ? result.prefill : null;

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    data-testid="share-ingest-toast"
                    data-saved-as={result.savedAs}
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-[min(28rem,calc(100vw-2rem))]"
                    role="status"
                    aria-live="polite"
                >
                    <div
                        className={`flex items-start gap-3 rounded-xl border bg-white dark:bg-slate-900 shadow-lg p-3 sm:p-4 ${config.border}`}
                    >
                        <div className={`shrink-0 mt-0.5 ${config.iconColor}`}>
                            <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className={`text-[10px] font-black uppercase tracking-widest ${config.iconColor}`}>
                                {config.eyebrow}
                            </div>
                            <div className="text-sm font-bold text-slate-900 dark:text-slate-50 mt-0.5">
                                {config.title}
                            </div>
                            {config.detail && (
                                <div className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
                                    {config.detail}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {prefill && onOpenAddTrade && (
                                <button
                                    type="button"
                                    onClick={() => onOpenAddTrade(prefill)}
                                    data-testid="share-ingest-toast-open"
                                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider ${config.buttonClass}`}
                                >
                                    Open
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => onDismiss?.()}
                                data-testid="share-ingest-toast-dismiss"
                                aria-label="Dismiss"
                                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

interface ToastConfig {
    icon: React.ComponentType<{ className?: string }>;
    iconColor: string;
    border: string;
    eyebrow: string;
    title: string;
    detail: string;
    buttonClass: string;
}

function configFor(result: IngestResult): ToastConfig {
    if (result.savedAs === 'TRADE') {
        return {
            icon: CheckCircle2,
            iconColor: 'text-emerald-500',
            border: 'border-emerald-200 dark:border-emerald-500/30',
            eyebrow: 'Trade detected',
            title: result.summary,
            detail: `${result.prefill.ticker} · ${result.prefill.side} @ ${result.prefill.entryPrice}`,
            buttonClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
        };
    }
    if (result.savedAs === 'JOURNAL') {
        return {
            icon: FileText,
            iconColor: 'text-indigo-500',
            border: 'border-indigo-200 dark:border-indigo-500/30',
            eyebrow: 'Saved as note',
            title: result.summary,
            detail: 'Find it in the journal under Shared.',
            buttonClass: 'bg-indigo-600 hover:bg-indigo-700 text-white',
        };
    }
    return {
        icon: Share2,
        iconColor: 'text-slate-400',
        border: 'border-slate-200 dark:border-slate-700',
        eyebrow: 'Nothing shared',
        title: result.summary,
        detail: '',
        buttonClass: 'bg-slate-600 hover:bg-slate-700 text-white',
    };
}

export default ShareIngestToast;
