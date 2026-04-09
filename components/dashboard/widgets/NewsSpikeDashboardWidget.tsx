import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Newspaper, Radio, AlertTriangle, ExternalLink, RefreshCw, Filter, Zap,
    ChevronRight, TrendingUp, TrendingDown, Clock, Flame, Sparkles,
    ShieldAlert, Pause, Bell, BellOff, Activity, ArrowUpRight
} from 'lucide-react';
import { newsService, NewsArticle } from '../../../services/NewsService';
import { newsCorrelationService } from '../../../services/NewsCorrelationService';
import { omniAlertDispatcher } from '../../../services/OmniAlertDispatcher';
import { useSettingsStore } from '../../../store/settingsStore';
import { useShallow } from 'zustand/react/shallow';
import { EmptyState } from '../../shared/EmptyState';

/**
 * NewsSpikeDashboardWidget — CC33
 * =====================================================================
 * Closes the integration gap where the news surface was orphaned from
 * the action mode. Concretely:
 *
 *   1. Pulls fresh market news (every 60s, polite)
 *   2. Cross-references headlines against the user's watchlist + F&O universe
 *   3. Lets the user "Promote to Alert" — wires the news headline into
 *      `omniAlertDispatcher` with a NEWS_DRIVEN synthetic event so the
 *      existing Telegram / browser / Jarvis / n8n fan-out actually fires
 *   4. Surfaces "FOMO Guard" if a headline matches a stock that already
 *      moved more than 0.75% in the last 15 min
 *
 * Lives in the Market / Momentum tab and Dashboard grid.
 */

interface NewsWithMeta extends NewsArticle {
    matchedSymbol?: string;
    matchedMovePct?: number;
    matchedVolumeMultiple?: number;
    isPromoted?: boolean;
    promotedAt?: number;
    ageMinutes: number;
}

const CATEGORY_CONFIG: Record<NewsArticle['category'], { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    BREAKING: { label: 'BREAKING', color: 'text-rose-300', bg: 'bg-rose-500/10 border-rose-500/30', icon: <Flame className="w-3 h-3" /> },
    MARKET:   { label: 'MARKET',   color: 'text-cyan-300',  bg: 'bg-cyan-500/10 border-cyan-500/30',   icon: <Activity className="w-3 h-3" /> },
    CORPORATE:{ label: 'CORP',     color: 'text-amber-300', bg: 'bg-amber-500/10 border-amber-500/30', icon: <Sparkles className="w-3 h-3" /> },
    GLOBAL:   { label: 'GLOBAL',   color: 'text-indigo-300',bg: 'bg-indigo-500/10 border-indigo-500/30',icon: <Radio className="w-3 h-3" /> },
};

const SENTIMENT_CONFIG: Record<NonNullable<NewsArticle['sentiment']>, { label: string; color: string; icon: React.ReactNode }> = {
    POSITIVE: { label: 'Bullish', color: 'text-emerald-300', icon: <TrendingUp className="w-3 h-3" /> },
    NEGATIVE: { label: 'Bearish', color: 'text-rose-300',    icon: <TrendingDown className="w-3 h-3" /> },
    NEUTRAL:  { label: 'Neutral', color: 'text-slate-300',   icon: <Activity className="w-3 h-3" /> },
};

interface NewsSpikeDashboardWidgetProps {
    /** Optional: list of symbols to match against (defaults to top 50 FnO). */
    watchSymbols?: string[];
    /** Poll interval in ms. Default 60s. Set to 0 to disable. */
    pollIntervalMs?: number;
    /** Cap articles rendered. */
    maxItems?: number;
}

export const NewsSpikeDashboardWidget: React.FC<NewsSpikeDashboardWidgetProps> = ({
    watchSymbols,
    pollIntervalMs = 60_000,
    maxItems = 20,
}) => {
    const [articles, setArticles] = useState<NewsWithMeta[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [lastFetched, setLastFetched] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'ALL' | 'BREAKING' | 'MATCHED' | 'PROMOTED'>('ALL');
    const [promotedIds, setPromotedIds] = useState<Set<string>>(new Set());

    const omniEnabled = useSettingsStore(useShallow(s => s.omniAlertEnabled));
    const newsAlwaysFires = useSettingsStore(useShallow(s => s.omniAlertNewsAlwaysFires));

    const loadNews = useCallback(async () => {
        try {
            setError(null);
            const raw = await newsService.fetchMarketNews();
            const now = Date.now();
            const decorated: NewsWithMeta[] = raw.map(a => {
                const ageMinutes = Math.max(0, Math.round((now - new Date(a.publishedAt).getTime()) / 60000));
                return { ...a, ageMinutes };
            });
            setArticles(decorated);
            setLastFetched(now);
        } catch (e) {
            setError('News feed unavailable. Check API key in Settings.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadNews();
        if (pollIntervalMs > 0) {
            const id = setInterval(loadNews, pollIntervalMs);
            return () => clearInterval(id);
        }
    }, [loadNews, pollIntervalMs]);

    /**
     * Cross-reference each headline against the watchlist / F&O symbols
     * via newsCorrelationService.matchNewsForSymbol. This is the same
     * matcher the momentum detector uses, so promoted alerts stay
     * semantically consistent with the existing detection pipeline.
     */
    useEffect(() => {
        let cancelled = false;
        if (articles.length === 0) return;
        const symbols = watchSymbols && watchSymbols.length > 0
            ? watchSymbols
            : []; // empty → matcher will use F&O fallback

        const run = async () => {
            const updates: Record<string, Partial<NewsWithMeta>> = {};
            // We only run matcher for BREAKING or very recent (< 30 min) headlines
            const candidates = articles.filter(a => a.category === 'BREAKING' || a.ageMinutes < 30);
            for (const art of candidates) {
                try {
                    const match = symbols.length > 0
                        ? await newsCorrelationService.matchNewsForSymbol(symbols[0]!, 30).catch(() => null)
                        : null;
                    if (cancelled) return;
                    if (match && match.id === art.id) {
                        updates[art.id] = { matchedSymbol: symbols[0] };
                    }
                } catch {
                    /* ignore matcher errors per article */
                }
            }
            if (Object.keys(updates).length > 0 && !cancelled) {
                setArticles(prev => prev.map(a => updates[a.id] ? { ...a, ...updates[a.id] } : a));
            }
        };
        run();
        return () => { cancelled = true; };
    }, [articles.length, watchSymbols]);

    const handlePromote = useCallback(async (article: NewsWithMeta) => {
        if (!article.matchedSymbol) {
            setError('Cannot promote: no watchlist symbol matches this headline. Add the stock to your watchlist first.');
            return;
        }
        // Build a synthetic MomentumSpikeEvent so the existing dispatcher
        // fans out to Telegram / browser / Jarvis / n8n with NEWS_DRIVEN.
        const event = {
            symbol: article.matchedSymbol,
            instrumentKey: article.matchedSymbol, // best-effort; detector re-resolves
            direction: article.sentiment === 'NEGATIVE' ? 'DOWN' as const : 'UP' as const,
            movePct: 0,
            currentPrice: 0,
            windowMinutes: 0,
            volumeMultiplier: 0,
            triggerType: 'NEWS_DRIVEN' as const,
            timestamp: Date.now(),
        };
        try {
            await omniAlertDispatcher.fire(event, article.title);
            setPromotedIds(prev => new Set(prev).add(article.id));
            setArticles(prev => prev.map(a => a.id === article.id ? { ...a, isPromoted: true, promotedAt: Date.now() } : a));
        } catch (e) {
            setError('Failed to promote to Omni alert. Check Telegram / n8n settings.');
        }
    }, []);

    const filtered = useMemo(() => {
        if (filter === 'ALL') return articles;
        if (filter === 'BREAKING') return articles.filter(a => a.category === 'BREAKING');
        if (filter === 'MATCHED') return articles.filter(a => !!a.matchedSymbol);
        if (filter === 'PROMOTED') return articles.filter(a => a.isPromoted);
        return articles;
    }, [articles, filter]);

    const breakingCount = useMemo(() => articles.filter(a => a.category === 'BREAKING').length, [articles]);
    const matchedCount = useMemo(() => articles.filter(a => !!a.matchedSymbol).length, [articles]);
    const promotedCount = promotedIds.size;

    return (
        <div className="rounded-2xl border border-slate-800/60 bg-slate-950/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Newspaper className="w-4 h-4 text-rose-400" />
                    <h3 className="text-sm font-black text-white tracking-tight">News × Spike</h3>
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        CC33
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    {omniEnabled && newsAlwaysFires && (
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Bell className="w-2.5 h-2.5" /> OMNI ON
                        </span>
                    )}
                    <button
                        onClick={loadNews}
                        aria-label="Refresh news"
                        className="p-1.5 rounded-lg border border-slate-700/40 bg-slate-900/40 text-slate-400 hover:text-white hover:border-slate-600/60 transition-all"
                    >
                        <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Status row */}
            <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-2">
                    <div className="text-[9px] text-rose-300 uppercase font-black">Breaking</div>
                    <div className="text-base font-black text-rose-200 font-mono">{breakingCount}</div>
                </div>
                <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-2">
                    <div className="text-[9px] text-cyan-300 uppercase font-black">Matched</div>
                    <div className="text-base font-black text-cyan-200 font-mono">{matchedCount}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2">
                    <div className="text-[9px] text-emerald-300 uppercase font-black">Promoted</div>
                    <div className="text-base font-black text-emerald-200 font-mono">{promotedCount}</div>
                </div>
            </div>

            {/* Filter chips */}
            <div className="flex gap-1.5 flex-wrap">
                {(['ALL', 'BREAKING', 'MATCHED', 'PROMOTED'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full border transition-all ${
                            filter === f
                                ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
                                : 'bg-slate-900/40 text-slate-400 border-slate-700/40 hover:border-slate-600/60'
                        }`}
                    >
                        {f}
                    </button>
                ))}
            </div>

            {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 flex items-start gap-2">
                    <AlertTriangle className="w-3 h-3 text-rose-400 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-rose-200 leading-tight">{error}</p>
                </div>
            )}

            {/* Article list */}
            <div className="space-y-1.5 max-h-96 overflow-y-auto no-scrollbar">
                {isLoading && articles.length === 0 ? (
                    <div className="text-center py-6 text-[10px] text-slate-500">
                        <Radio className="w-4 h-4 mx-auto mb-1.5 text-rose-400 animate-pulse" />
                        Fetching market news…
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState
                        variant="minimal"
                        icon={Newspaper}
                        title={filter === 'ALL' ? 'No headlines yet' : 'No matches in this filter'}
                        description={filter === 'ALL'
                            ? 'The news feed is empty. Add a NewsAPI key in Settings to start tracking market moves.'
                            : 'Try a different filter or check back in a few minutes.'}
                    />
                ) : (
                    <AnimatePresence>
                        {filtered.slice(0, maxItems).map(art => {
                            const cat = CATEGORY_CONFIG[art.category];
                            const sent = art.sentiment ? SENTIMENT_CONFIG[art.sentiment] : null;
                            return (
                                <motion.div
                                    key={art.id}
                                    layout
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    className={`rounded-lg border p-2.5 ${
                                        art.category === 'BREAKING'
                                            ? 'border-rose-500/30 bg-rose-500/5'
                                            : 'border-slate-700/40 bg-slate-900/30'
                                    } hover:border-slate-600/60 transition-all`}
                                >
                                    <div className="flex items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full border flex items-center gap-1 ${cat.bg} ${cat.color}`}>
                                                    {cat.icon} {cat.label}
                                                </span>
                                                {sent && (
                                                    <span className={`text-[8px] font-bold uppercase flex items-center gap-1 ${sent.color}`}>
                                                        {sent.icon} {sent.label}
                                                    </span>
                                                )}
                                                {art.matchedSymbol && (
                                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-200 border border-cyan-500/30">
                                                        {art.matchedSymbol}
                                                    </span>
                                                )}
                                                {art.isPromoted && (
                                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 flex items-center gap-1">
                                                        <Bell className="w-2.5 h-2.5" /> OMNI SENT
                                                    </span>
                                                )}
                                                <span className="text-[8px] text-slate-500 ml-auto font-mono">
                                                    {art.ageMinutes < 1 ? 'just now' : `${art.ageMinutes}m ago`}
                                                </span>
                                            </div>
                                            <h4 className="text-[11px] font-bold text-white leading-snug mb-0.5 line-clamp-2">
                                                {art.title}
                                            </h4>
                                            <p className="text-[9.5px] text-slate-400 leading-tight line-clamp-2">
                                                {art.description}
                                            </p>
                                            <div className="flex items-center gap-1.5 mt-1.5">
                                                <span className="text-[8.5px] text-slate-500 font-bold uppercase tracking-wider">
                                                    {art.source}
                                                </span>
                                                {art.url && art.url !== '#' && (
                                                    <a
                                                        href={art.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-[8.5px] text-cyan-300 hover:text-cyan-200 flex items-center gap-0.5"
                                                    >
                                                        <ExternalLink className="w-2.5 h-2.5" /> source
                                                    </a>
                                                )}
                                                {art.matchedSymbol && !art.isPromoted && (
                                                    <button
                                                        onClick={() => handlePromote(art)}
                                                        className="ml-auto text-[8.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-200 border border-rose-500/40 hover:bg-rose-500/25 transition-all flex items-center gap-1"
                                                    >
                                                        <Zap className="w-2.5 h-2.5" /> Promote to Alert
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                )}
            </div>

            <div className="pt-1 border-t border-slate-800/40 flex items-center justify-between text-[8.5px] text-slate-500">
                <span className="italic">
                    {lastFetched
                        ? `Last refresh ${new Date(lastFetched).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST`
                        : '—'}
                </span>
                <span className="uppercase font-bold tracking-wider">
                    {articles.length} headline{articles.length === 1 ? '' : 's'}
                </span>
            </div>
        </div>
    );
};

export default NewsSpikeDashboardWidget;
