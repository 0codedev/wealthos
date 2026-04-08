/**
 * A4 — DailyDigestWidget
 *
 * Dashboard card showing today's 9 AM Telegram digest (or "No overnight
 * messages" on quiet days). Pinned to the TOP of DEFAULT_WIDGETS so it
 * is the first thing the user sees when opening the dashboard in the
 * morning.
 *
 * Visual contract mirrors MacroClockWidget: slate-900 surface, indigo
 * accent ring, three-row card with a sentiment-colored bar on the left.
 *
 * No props — pulls from `useDailyDigest()`.
 */
import React, { useMemo } from 'react';
import { RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useDailyDigest } from '../../../hooks/useDailyDigest';
import { logger } from '../../../utils/logger';
import { fadeRise } from '../../ui/motion';

const SENTIMENT_LABEL: Record<'BULLISH' | 'BEARISH' | 'NEUTRAL', string> = {
    BULLISH: '🐂 BULLISH',
    BEARISH: '🐻 BEARISH',
    NEUTRAL: '⚖️ NEUTRAL'
};

const SENTIMENT_BAR: Record<'BULLISH' | 'BEARISH' | 'NEUTRAL', string> = {
    BULLISH: 'bg-emerald-500',
    BEARISH: 'bg-rose-500',
    NEUTRAL: 'bg-slate-500'
};

function formatIstStamp(date: string): string {
    const d = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return date;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function formatTimeOfDay(epochMs: number): string {
    const d = new Date(epochMs);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const DailyDigestWidget: React.FC = () => {
    const { digest, isGenerating, error, refresh } = useDailyDigest();
    const reducedMotion = useReducedMotion();

    const isQuiet = useMemo(() => digest != null && digest.messageCount < 3, [digest]);
    const headlineLine = useMemo(() => {
        if (!digest) return '';
        if (isQuiet) return 'No overnight messages';
        const firstBreak = digest.combinedBrief.indexOf('\n');
        const text = firstBreak > 0 ? digest.combinedBrief.slice(firstBreak + 1).trim() : digest.combinedBrief;
        return text.length > 140 ? text.slice(0, 137) + '…' : text;
    }, [digest, isQuiet]);

    // Loading skeleton — no digest yet and generating
    if (isGenerating && !digest) {
        return (
            <div data-testid="daily-digest-widget" data-state="loading" className="h-full min-h-[160px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                    <div className="h-3 w-2/3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                </div>
            </div>
        );
    }

    // Error state
    if (error && !digest) {
        return (
            <div data-testid="daily-digest-widget" data-state="error" className="h-full min-h-[160px] rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 p-5 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-rose-500" aria-hidden />
                <div className="flex-1">
                    <div className="text-sm font-semibold text-rose-700 dark:text-rose-300">Could not load digest</div>
                    <div className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">{error}</div>
                </div>
                <button
                    type="button"
                    data-testid="daily-digest-refresh"
                    onClick={() => { void refresh(); }}
                    className="text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline"
                >
                    Try again
                </button>
            </div>
        );
    }

    // Empty — no digest yet (e.g. early morning, before 9 AM trigger). Render nothing.
    if (!digest) return null;

    const bar = SENTIMENT_BAR[digest.sentiment];
    const label = SENTIMENT_LABEL[digest.sentiment];

    const cardInner = (
        <div className="flex h-full min-h-[160px]">
            <div className={`w-1.5 rounded-l-2xl ${bar}`} aria-hidden data-testid="daily-digest-bar" data-sentiment={digest.sentiment} />
            <div className="flex-1 p-5 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <Sparkles className="h-3.5 w-3.5 text-indigo-500" aria-hidden />
                        <span data-testid="daily-digest-sentiment">{label}</span>
                        <span aria-hidden>·</span>
                        <span data-testid="daily-digest-date">{formatIstStamp(digest.date)}</span>
                        <span aria-hidden>·</span>
                        <span>09:00 IST</span>
                    </div>
                    <button
                        type="button"
                        data-testid="daily-digest-refresh"
                        onClick={() => {
                            logger.log('DailyDigestWidget', 'manual refresh clicked');
                            void refresh();
                        }}
                        className="text-slate-400 hover:text-indigo-500 transition-colors"
                        aria-label="Refresh digest"
                    >
                        <RefreshCw className={`h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <div data-testid="daily-digest-headline" className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-50 leading-snug">
                    {headlineLine || (isQuiet ? 'No overnight messages' : label)}
                </div>

                <div className="mt-auto pt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-3" data-testid="daily-digest-footer">
                        <span><span className="tabular-nums font-semibold text-slate-700 dark:text-slate-300">{digest.keySignals.length}</span> signals</span>
                        <span><span className="tabular-nums font-semibold text-slate-700 dark:text-slate-300">{digest.newsHeadlines.length}</span> headlines</span>
                        <span aria-hidden>·</span>
                        <span>updated {formatTimeOfDay(digest.generatedAt)}</span>
                        {digest.pushedToTelegram && (
                            <>
                                <span aria-hidden>·</span>
                                <span className="text-indigo-500 font-semibold" data-testid="daily-digest-pushed">DM sent</span>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    if (reducedMotion) {
        return (
            <div data-testid="daily-digest-widget" data-state="content" data-sentiment={digest.sentiment} className="h-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                {cardInner}
            </div>
        );
    }

    return (
        <motion.div
            data-testid="daily-digest-widget"
            data-state="content"
            data-sentiment={digest.sentiment}
            variants={fadeRise}
            initial="hidden"
            animate="visible"
            className="h-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm"
        >
            {cardInner}
        </motion.div>
    );
};

export default DailyDigestWidget;
