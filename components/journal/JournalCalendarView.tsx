import React, { useEffect, useState, useMemo } from 'react';
import { Book, Star, Edit2, Plus, List, Moon, Battery, Smile, Dumbbell, Send, RefreshCw, CheckCircle2 } from 'lucide-react';
import PnLCalendar from './PnLCalendar';
import TradeHistoryTable from './TradeHistoryTable';
import { db, Trade, DailyReview, QuickLog } from '../../database';
import { SyncTradesButton } from './SyncTradesButton';
import { SyncSandboxTradesButton } from './SyncSandboxTradesButton';
import { Search, SlidersHorizontal, ArrowRight, X, Filter, TrendingUp, TrendingDown, Target, Zap, Trash2, Download, ChevronDown, Check } from 'lucide-react';
import { refreshImportedTradeReviewQueue, summarizeBrokerReviewQueue } from '../../services/BrokerReviewWorkflowService';
import { getActiveJournalReviewHandoffs, JOURNAL_REVIEW_HANDOFF_EVENT } from '../../services/JournalReviewHandoffService';
import ConfirmationModal from '../shared/ConfirmationModal';
import { StateSurface } from '../shared/SurfacePrimitives';
import { EmptyState } from '../shared/EmptyState';
import { motion } from 'framer-motion';
import BrokerCSVImport, { ParsedTrade } from './BrokerCSVImport';

interface JournalCalendarViewProps {
    trades: Trade[];
    dailyReviews: DailyReview[];
    selectedCalendarDate: string | null;
    setSelectedCalendarDate: (date: string | null) => void;
    selectedDayReview: DailyReview | null;
    onOpenDailyReviewModal: () => void;
    onTradeClick?: (trade: Trade) => void;
    onDeleteTrade?: (tradeId: number) => void;
    focusPendingReviews?: boolean;
    onJumpToAnalytics?: () => void;
    onAcknowledgeReviewAction?: () => void;
}

const JournalCalendarView: React.FC<JournalCalendarViewProps> = ({
    trades,
    dailyReviews,
    selectedCalendarDate,
    setSelectedCalendarDate,
    selectedDayReview,
    onOpenDailyReviewModal,
    onTradeClick,
    onDeleteTrade,
    focusPendingReviews = false,
    onJumpToAnalytics,
    onAcknowledgeReviewAction
}) => {
    const [quickLogText, setQuickLogText] = useState('');
    
    // Filter State
    const [showFilters, setShowFilters] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = React.useDeferredValue(searchQuery);
    const [pnlFilter, setPnlFilter] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
    const [directionFilter, setDirectionFilter] = useState<'ALL' | 'Long' | 'Short'>('ALL');
    const [productFilter, setProductFilter] = useState<'ALL' | 'MIS' | 'CNC' | 'MARGIN' | 'MTF'>('ALL');
    const [minPnl, setMinPnl] = useState('');
    const [maxPnl, setMaxPnl] = useState('');
    const [reviewFilter, setReviewFilter] = useState<'ALL' | 'NEEDS_ANNOTATION' | 'NEEDS_SCREENSHOTS' | 'READY_FOR_LESSON'>('ALL');
    const [isRefreshingReviewQueue, setIsRefreshingReviewQueue] = useState(false);
    const [reviewHandoffs, setReviewHandoffs] = useState(() => getActiveJournalReviewHandoffs());
    const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
    const [selectedTradeIds, setSelectedTradeIds] = useState<number[]>([]);

    // CSV Import State & Filters
    const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
    const [assetFilter, setAssetFilter] = useState('ALL');
    const [setupFilter, setSetupFilter] = useState('ALL');
    const [isAssetDropdownOpen, setIsAssetDropdownOpen] = useState(false);
    const [isSetupDropdownOpen, setIsSetupDropdownOpen] = useState(false);

    const handleImportTrades = async (parsed: ParsedTrade[]) => {
        try {
            const newTrades: Trade[] = parsed.map(pt => ({
                ticker: pt.symbol,
                direction: pt.type === 'BUY' ? 'Long' : 'Short',
                quantity: pt.quantity,
                entryPrice: pt.price,
                exitPrice: pt.price,
                date: pt.date,
                entryTime: '09:15',
                moodEntry: 'Focused',
                moodExit: 'Satisfied',
                mistakes: [],
                setup: 'Manual CSV',
                pnl: 0,
                notes: `Imported from ${pt.broker} CSV. OrderNo: ${pt.orderNo || 'N/A'}`
            }));

            for (const t of newTrades) {
                await db.trades.add(t);
            }
        } catch (e) {
            console.error('Failed to save imported trades:', e);
            alert('Failed to import trades. Please check the console for logs.');
        }
    };

    const assetClasses = useMemo(() => {
        const set = new Set<string>();
        trades.forEach(t => {
            if (t.assetClass) set.add(t.assetClass);
        });
        return Array.from(set);
    }, [trades]);

    const setups = useMemo(() => {
        const set = new Set<string>();
        trades.forEach(t => {
            if (t.setup) set.add(t.setup);
        });
        return Array.from(set);
    }, [trades]);

    useEffect(() => {
        const refreshReviewHandoffs = () => setReviewHandoffs(getActiveJournalReviewHandoffs());
        window.addEventListener(JOURNAL_REVIEW_HANDOFF_EVENT, refreshReviewHandoffs);
        window.addEventListener('storage', refreshReviewHandoffs);
        return () => {
            window.removeEventListener(JOURNAL_REVIEW_HANDOFF_EVENT, refreshReviewHandoffs);
            window.removeEventListener('storage', refreshReviewHandoffs);
        };
    }, []);

    const handleQuickLog = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!quickLogText.trim()) return;

        const targetDate = selectedCalendarDate || new Date().toISOString().split('T')[0];
        let review = await db.daily_reviews.get(targetDate);

        const newLog: QuickLog = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            note: quickLogText.trim()
        };

        if (review) {
            review.quickLogs = [...(review.quickLogs || []), newLog];
            await db.daily_reviews.put(review);
        } else {
            await db.daily_reviews.put({
                date: targetDate,
                rating: 3,
                marketCondition: 'Sideways',
                notes: '',
                didWell: '',
                didPoorly: '',
                quickLogs: [newLog]
            });
        }
        setQuickLogText('');
    };

    const currentQuickLogs = useMemo(() => {
        if (selectedCalendarDate) {
            return selectedDayReview?.quickLogs || [];
        }
        return dailyReviews.flatMap(r => r.quickLogs || []);
    }, [selectedCalendarDate, selectedDayReview, dailyReviews]);

    const filteredTrades = useMemo(() => {
        return trades.filter(t => {
            if (focusPendingReviews) {
                const isPendingReview = Boolean(
                    (t.isImported || t.broker === 'dhan' || t.source === 'dhan') &&
                    t.reviewStatus &&
                    t.reviewStatus !== 'ANNOTATED'
                );
                if (!isPendingReview) return false;
            }

            if (reviewFilter !== 'ALL' && t.reviewStatus !== reviewFilter) {
                return false;
            }

            // Search Query
            const matchesSearch = !deferredSearchQuery || 
                t.ticker.toLowerCase().includes(deferredSearchQuery.toLowerCase()) || 
                t.notes?.toLowerCase().includes(deferredSearchQuery.toLowerCase());
            if (!matchesSearch) return false;

            // P&L Filter
            if (pnlFilter === 'WIN' && (t.pnl || 0) < 0) return false;
            if (pnlFilter === 'LOSS' && (t.pnl || 0) >= 0) return false;

            // Direction Filter
            if (directionFilter !== 'ALL' && t.direction !== directionFilter) return false;

            // Product Filter
            if (productFilter !== 'ALL') {
                const pType = t.productType?.toUpperCase() || '';
                if (productFilter === 'MIS') {
                    if (!(pType === 'MIS' || pType === 'INTRADAY')) return false;
                } else if (productFilter === 'CNC') {
                    if (pType !== 'CNC' && pType !== '') return false;
                } else if (productFilter === 'MARGIN') {
                    if (pType !== 'MARGIN') return false;
                } else if (productFilter === 'MTF') {
                    if (pType !== 'MTF') return false;
                }
            }

            // P&L Range
            if (minPnl !== '' && (t.pnl || 0) < parseFloat(minPnl)) return false;
            if (maxPnl !== '' && (t.pnl || 0) > parseFloat(maxPnl)) return false;

            // Asset Class Filter
            if (assetFilter !== 'ALL' && t.assetClass !== assetFilter) return false;

            // Setup Filter
            if (setupFilter !== 'ALL' && t.setup !== setupFilter) return false;

            return true;
        });
    }, [trades, deferredSearchQuery, pnlFilter, directionFilter, productFilter, minPnl, maxPnl, focusPendingReviews, reviewFilter, assetFilter, setupFilter]);

    // Reset selection when filters change to avoid bulk-editing hidden items
    useEffect(() => {
        setSelectedTradeIds([]);
    }, [searchQuery, pnlFilter, directionFilter, productFilter, minPnl, maxPnl, reviewFilter, assetFilter, setupFilter, selectedCalendarDate]);

    const reviewQueueSummary = useMemo(() => summarizeBrokerReviewQueue(trades), [trades]);
    const recentReviewHandoff = reviewHandoffs[0];
    const recentReviewHandoffText = recentReviewHandoff
        ? `${recentReviewHandoff.ticker} just arrived from a fresh Dhan execution and is now in the review lane.`
        : null;
    const hasFilteredResults = filteredTrades.length > 0;

    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (searchQuery) count++;
        if (pnlFilter !== 'ALL') count++;
        if (directionFilter !== 'ALL') count++;
        if (productFilter !== 'ALL') count++;
        if (minPnl !== '' || maxPnl !== '') count++;
        if (assetFilter !== 'ALL') count++;
        if (setupFilter !== 'ALL') count++;
        return count;
    }, [searchQuery, pnlFilter, directionFilter, productFilter, minPnl, maxPnl, assetFilter, setupFilter]);

    const clearFilters = () => {
        setSearchQuery('');
        setPnlFilter('ALL');
        setDirectionFilter('ALL');
        setProductFilter('ALL');
        setMinPnl('');
        setMaxPnl('');
        setReviewFilter('ALL');
        setAssetFilter('ALL');
        setSetupFilter('ALL');
    };

    const handleRefreshReviewQueue = async () => {
        setIsRefreshingReviewQueue(true);
        try {
            await refreshImportedTradeReviewQueue();
        } finally {
            setIsRefreshingReviewQueue(false);
        }
    };

    const handleDeleteAllForDay = () => {
        if (!selectedCalendarDate) return;
        const count = trades.filter(t => t.date === selectedCalendarDate).length;
        if (count === 0) return;
        setIsPurgeModalOpen(true);
    };

    const confirmPurgeDay = async () => {
        if (!selectedCalendarDate) return;
        await db.trades.where('date').equals(selectedCalendarDate).delete();
    };

    const handleSetMarketCondition = async (date: string, condition: 'Trending' | 'Choppy' | 'Volatile' | 'Sideways') => {
        let review = await db.daily_reviews.get(date);
        if (review) {
            review.marketCondition = condition;
            await db.daily_reviews.put(review);
        } else {
            await db.daily_reviews.put({
                date,
                rating: 3,
                marketCondition: condition,
                notes: '',
                didWell: '',
                didPoorly: '',
                quickLogs: []
            });
        }
    };

    return (
        <div className="space-y-5">
            <PnLCalendar
                trades={trades}
                dailyReviews={dailyReviews}
                selectedDate={selectedCalendarDate}
                onDateSelect={setSelectedCalendarDate}
                onSetMarketCondition={handleSetMarketCondition}
            />


            {/* Daily Report Card Section */}
            {selectedCalendarDate && (
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 shadow-sm relative overflow-hidden">
                    {selectedDayReview ? (
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                        <Book size={20} className="text-indigo-500" /> Daily Report Card
                                    </h3>
                                    <p className="text-sm text-slate-500">Self-Review for {selectedCalendarDate}</p>
                                </div>
                                <div className="flex gap-2">
                                    <div className="flex gap-1">
                                        {[1, 2, 3, 4, 5].map(s => <Star key={s} size={16} className={selectedDayReview.rating >= s ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-700"} />)}
                                    </div>
                                    <button onClick={onOpenDailyReviewModal} className="ml-4 p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-indigo-500">
                                        <Edit2 size={16} />
                                    </button>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                <div className="bg-white dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                                    <span className="text-xs font-bold text-emerald-500 uppercase block mb-1">What went well</span>
                                    <p className="text-slate-700 dark:text-slate-300">{selectedDayReview.didWell || 'No notes.'}</p>
                                </div>
                                <div className="bg-white dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                                    <span className="text-xs font-bold text-rose-500 uppercase block mb-1">What went wrong</span>
                                    <p className="text-slate-700 dark:text-slate-300">{selectedDayReview.didPoorly || 'No notes.'}</p>
                                </div>
                            </div>

                            {/* Phase 15: Holistic Life Journal Display */}
                            {(selectedDayReview.sleepHours || selectedDayReview.mood) && (
                                <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-4 bg-slate-100/50 dark:bg-slate-950/50 p-3 rounded-xl border border-dashed border-slate-200 dark:border-slate-700">
                                    {selectedDayReview.sleepHours && (
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                                            <Moon size={14} className="text-indigo-400" /> {selectedDayReview.sleepHours}h Sleep
                                        </div>
                                    )}
                                    {selectedDayReview.energyLevel && (
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                                            <Battery size={14} className="text-amber-400" /> Energy: {selectedDayReview.energyLevel}/10
                                        </div>
                                    )}
                                    {selectedDayReview.mood && (
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
                                            <Smile size={14} className="text-emerald-400" /> Mood: {selectedDayReview.mood}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400 flex-1 justify-end">
                                        <Dumbbell size={14} className={selectedDayReview.exercise ? "text-emerald-500" : "text-rose-400"} />
                                        {selectedDayReview.exercise ? 'Exercised' : 'No Exercise'}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <p className="text-slate-500 mb-4">No daily review logged for {selectedCalendarDate}.</p>
                            <button
                                onClick={onOpenDailyReviewModal}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-lg shadow-indigo-500/20 inline-flex items-center gap-2"
                            >
                                <Plus size={16} /> Add Daily Review
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className="space-y-4">
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
                            <List size={20} />
                        </div>
                        <div>
                            <h2 className="text-md font-bold text-slate-800 dark:text-white">
                                {selectedCalendarDate ? `Trades Ledger (${selectedCalendarDate})` : 'Comprehensive Trades Ledger'}
                            </h2>
                            <p className="text-[10px] text-slate-400 mt-0.5">Manage, filter, and audit your execution records</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            onClick={() => setIsCsvModalOpen(true)}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold border border-slate-200 dark:border-slate-700 rounded-xl text-xs flex items-center gap-2 transition-all"
                        >
                            <Download size={14} /> Import CSV
                        </button>
                        
                        <SyncTradesButton selectedDate={selectedCalendarDate} />
                        <SyncSandboxTradesButton />

                        {selectedCalendarDate && (
                            <button
                                onClick={handleDeleteAllForDay}
                                title="Delete ALL trades for this day"
                                className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-bold border border-rose-500/20 rounded-xl text-xs flex items-center gap-2 transition-all"
                            >
                                <Trash2 size={14} /> Purge Day
                            </button>
                        )}

                        {selectedCalendarDate && (
                            <button
                                onClick={() => setSelectedCalendarDate(null)}
                                className="text-xs text-indigo-500 font-bold hover:underline"
                            >
                                Show All
                            </button>
                        )}
                    </div>
                </div>

                {focusPendingReviews && (
                    <div className="space-y-2">
                        <StateSurface
                            tone="info"
                            title="Focused from command center"
                            description={
                                <div className="space-y-2">
                                    <p>You were brought here because imported trades still need review work. Annotate or open a trade, then jump back to analytics once the queue is cleaner.</p>
                                    {recentReviewHandoffText && (
                                        <div className="rounded-lg border border-indigo-300/40 bg-white/70 px-3 py-2 text-xs text-indigo-700 dark:border-indigo-500/30 dark:bg-slate-900/60 dark:text-indigo-200">
                                            {recentReviewHandoffText}
                                        </div>
                                    )}
                                </div>
                            }
                            icon={CheckCircle2}
                            actions={
                                <div className="flex flex-wrap gap-1.5">
                                    <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-500/30 dark:bg-slate-900 dark:text-indigo-300">
                                        {reviewQueueSummary.total} pending
                                    </span>
                                    <button
                                        onClick={() => setReviewFilter('NEEDS_ANNOTATION')}
                                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                    >
                                        {reviewQueueSummary.needsAnnotation} annotation
                                    </button>
                                    <button
                                        onClick={() => setReviewFilter('NEEDS_SCREENSHOTS')}
                                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                    >
                                        {reviewQueueSummary.needsScreenshots} screenshots
                                    </button>
                                    <button
                                        onClick={() => setReviewFilter('READY_FOR_LESSON')}
                                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                    >
                                        {reviewQueueSummary.readyForLesson} lesson-ready
                                    </button>
                                    <button
                                        onClick={() => setReviewFilter('ALL')}
                                        className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-slate-600 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                    >
                                        All pending
                                    </button>
                                </div>
                            }
                        />
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => {
                                    onAcknowledgeReviewAction?.();
                                    handleRefreshReviewQueue();
                                }}
                                disabled={isRefreshingReviewQueue}
                                className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-slate-800"
                            >
                                <RefreshCw size={12} className={isRefreshingReviewQueue ? 'animate-spin' : ''} />
                                Refresh Review Queue
                            </button>
                            {reviewQueueSummary.nextTrade && onTradeClick && (
                                <button
                                    onClick={() => {
                                        onAcknowledgeReviewAction?.();
                                        onTradeClick(reviewQueueSummary.nextTrade!);
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-2.5 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-indigo-500"
                                >
                                    <CheckCircle2 size={12} />
                                    Open Next Pending Trade
                                </button>
                            )}
                            {onJumpToAnalytics && (
                                <button
                                    onClick={() => {
                                        onAcknowledgeReviewAction?.();
                                        onJumpToAnalytics();
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-2.5 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-indigo-500"
                                >
                                    Open Coaching View
                                </button>
                            )}
                        </div>
                        {reviewQueueSummary.total === 0 && (
                            <StateSurface
                                compact
                                tone="success"
                                title="Review debt is clear right now."
                                description="Jump to coaching view if you want to capture lessons while the queue is clean."
                                icon={CheckCircle2}
                            />
                        )}
                    </div>
                )}

                {!focusPendingReviews && reviewQueueSummary.total > 0 && (
                    <StateSurface
                        tone="warning"
                        title="Broker Review Queue Active"
                        description={
                            <div className="space-y-2">
                                <p>{reviewQueueSummary.total} imported trades still need review attention across annotation, screenshots, or lesson extraction.</p>
                                {recentReviewHandoffText && <p>{recentReviewHandoffText}</p>}
                            </div>
                        }
                        icon={RefreshCw}
                        actions={
                            <div className="flex flex-wrap gap-1.5">
                                <span className="rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300">
                                    {reviewQueueSummary.needsAnnotation} annotation
                                </span>
                                <span className="rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300">
                                    {reviewQueueSummary.needsScreenshots} screenshots
                                </span>
                                <span className="rounded-full border border-amber-200 bg-white px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-300">
                                    {reviewQueueSummary.readyForLesson} lesson-ready
                                </span>
                            </div>
                        }
                    />
                )}

                <div className="flex flex-col gap-3">
                    <form onSubmit={handleQuickLog} className="relative z-10 flex gap-2">
                        {/* ... input and buttons ... */}
                        <div className="relative flex-1">
                            <input
                                type="text"
                                value={quickLogText}
                                onChange={(e) => setQuickLogText(e.target.value)}
                                placeholder="Quick Jot: What are you observing right now?"
                                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:border-indigo-500 dark:text-white"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={!quickLogText.trim()}
                            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-3 py-2.5 rounded-xl transition-colors shadow-lg shadow-indigo-500/20 flex items-center gap-2 text-[11px] font-bold"
                        >
                            <Send size={16} /> <span className="hidden sm:inline">Log Event</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowFilters(!showFilters)}
                            className={`px-3 py-2.5 rounded-xl border transition-all flex items-center gap-2 text-[11px] font-bold relative ${
                                showFilters || activeFilterCount > 0
                                ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400'
                                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-300'
                            }`}
                        >
                            <SlidersHorizontal size={18} />
                            <span className="hidden md:inline">Filters</span>
                            {activeFilterCount > 0 && (
                                <span className="absolute -top-1 -right-1 w-5 h-5 bg-indigo-600 text-white rounded-full text-[10px] flex items-center justify-center border-2 border-white dark:border-slate-900">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>
                    </form>

                    {showFilters && (
                        <div className="relative z-50 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-6 shadow-xl space-y-6 backdrop-blur-md">
                            {/* Grid container */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Search Symbol/Note */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Search Symbol/Note</label>
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                                        <input 
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            placeholder="RELIANCE, FOMO, etc..."
                                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl pl-9 pr-4 py-2.5 text-xs outline-none focus:border-indigo-500 dark:focus:border-indigo-500/50 transition-all font-medium dark:text-white shadow-sm"
                                        />
                                    </div>
                                </div>

                                {/* Profit / Loss Toggle */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Profit / Loss</label>
                                    <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-850 shadow-sm h-[38px] items-center">
                                        {(['ALL', 'WIN', 'LOSS'] as const).map(type => (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => setPnlFilter(type)}
                                                className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                                                    pnlFilter === type
                                                    ? type === 'WIN' ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/10' 
                                                        : type === 'LOSS' ? 'bg-rose-500 text-white shadow-md shadow-rose-500/10'
                                                        : 'bg-indigo-600 text-white shadow-md shadow-indigo-600/10'
                                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                                }`}
                                            >
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Direction Toggle */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Direction</label>
                                    <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-850 shadow-sm h-[38px] items-center">
                                        {(['ALL', 'Long', 'Short'] as const).map(dir => (
                                            <button
                                                key={dir}
                                                type="button"
                                                onClick={() => setDirectionFilter(dir)}
                                                className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                                                    directionFilter === dir
                                                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-950 shadow-sm'
                                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                                }`}
                                            >
                                                {dir.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Product Type (Type) */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Product Type</label>
                                    <div className="flex bg-white dark:bg-slate-950 p-1 rounded-xl border border-slate-200 dark:border-slate-850 shadow-sm h-[38px] items-center overflow-x-auto no-scrollbar">
                                        {(['ALL', 'MIS', 'CNC', 'MARGIN', 'MTF'] as const).map(prod => (
                                            <button
                                                key={prod}
                                                type="button"
                                                onClick={() => setProductFilter(prod)}
                                                className={`flex-1 min-w-[42px] py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                                                    productFilter === prod
                                                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                                }`}
                                            >
                                                {prod}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Asset Class Custom Dropdown */}
                                <div className={`space-y-1.5 relative ${isAssetDropdownOpen ? 'z-50' : 'z-10'}`}>
                                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Asset Class</label>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsAssetDropdownOpen(!isAssetDropdownOpen);
                                                setIsSetupDropdownOpen(false);
                                            }}
                                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl py-2 px-3 text-xs outline-none focus:border-indigo-500 transition-all cursor-pointer dark:text-white flex items-center justify-between font-medium shadow-sm hover:border-slate-300 dark:hover:border-slate-700 h-[38px]"
                                        >
                                            <span className="truncate">
                                                {assetFilter === 'ALL' ? 'All Asset Classes' : assetFilter}
                                            </span>
                                            <ChevronDown size={14} className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isAssetDropdownOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                        
                                        {isAssetDropdownOpen && (
                                            <>
                                                <div className="fixed inset-0 z-30" onClick={() => setIsAssetDropdownOpen(false)} />
                                                <div className="absolute left-0 right-0 mt-2 z-40 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-1 shadow-xl max-h-60 overflow-y-auto no-scrollbar animate-in fade-in slide-in-from-top-1 duration-150">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setAssetFilter('ALL');
                                                            setIsAssetDropdownOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-between ${
                                                            assetFilter === 'ALL'
                                                            ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                                        }`}
                                                    >
                                                        <span>All Asset Classes</span>
                                                        {assetFilter === 'ALL' && <Check size={12} className="text-indigo-500 dark:text-indigo-400" />}
                                                    </button>
                                                    {assetClasses.map(a => (
                                                        <button
                                                            key={a}
                                                            type="button"
                                                            onClick={() => {
                                                                setAssetFilter(a);
                                                                setIsAssetDropdownOpen(false);
                                                            }}
                                                            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-between ${
                                                                assetFilter === a
                                                                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                                                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                                            }`}
                                                        >
                                                            <span className="truncate">{a}</span>
                                                            {assetFilter === a && <Check size={12} className="text-indigo-500 dark:text-indigo-400" />}
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Setup Custom Dropdown */}
                                <div className={`space-y-1.5 relative ${isSetupDropdownOpen ? 'z-50' : 'z-10'}`}>
                                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Setup</label>
                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsSetupDropdownOpen(!isSetupDropdownOpen);
                                                setIsAssetDropdownOpen(false);
                                            }}
                                            className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl py-2 px-3 text-xs outline-none focus:border-indigo-500 transition-all cursor-pointer dark:text-white flex items-center justify-between font-medium shadow-sm hover:border-slate-300 dark:hover:border-slate-700 h-[38px]"
                                        >
                                            <span className="truncate">
                                                {setupFilter === 'ALL' ? 'All Setups' : setupFilter}
                                            </span>
                                            <ChevronDown size={14} className={`text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isSetupDropdownOpen ? 'rotate-180' : ''}`} />
                                        </button>
                                        
                                        {isSetupDropdownOpen && (
                                            <>
                                                <div className="fixed inset-0 z-30" onClick={() => setIsSetupDropdownOpen(false)} />
                                                <div className="absolute left-0 right-0 mt-2 z-40 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-1 shadow-xl max-h-60 overflow-y-auto no-scrollbar animate-in fade-in slide-in-from-top-1 duration-150">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSetupFilter('ALL');
                                                            setIsSetupDropdownOpen(false);
                                                        }}
                                                        className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-between ${
                                                            setupFilter === 'ALL'
                                                            ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                                                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                                        }`}
                                                    >
                                                        <span>All Setups</span>
                                                        {setupFilter === 'ALL' && <Check size={12} className="text-indigo-500 dark:text-indigo-400" />}
                                                    </button>
                                                    {setups.map(s => (
                                                        <button
                                                            key={s}
                                                            type="button"
                                                            onClick={() => {
                                                                setSetupFilter(s);
                                                                setIsSetupDropdownOpen(false);
                                                            }}
                                                            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-between ${
                                                                setupFilter === s
                                                                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                                                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/60'
                                                            }`}
                                                        >
                                                            <span className="truncate">{s}</span>
                                                            {setupFilter === s && <Check size={12} className="text-indigo-500 dark:text-indigo-400" />}
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Numerical Ranges */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-wider block">P&L Range (₹)</label>
                                    <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                            <input 
                                                type="number"
                                                value={minPnl}
                                                onChange={e => setMinPnl(e.target.value)}
                                                placeholder="Min"
                                                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500 transition-all font-mono dark:text-white shadow-sm h-[38px]"
                                            />
                                        </div>
                                        <ArrowRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" />
                                        <div className="relative flex-1">
                                            <input 
                                                type="number"
                                                value={maxPnl}
                                                onChange={e => setMaxPnl(e.target.value)}
                                                placeholder="Max"
                                                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-850 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500 transition-all font-mono dark:text-white shadow-sm h-[38px]"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Actions Panel */}
                                <div className="flex items-end justify-between gap-3 pt-1.5">
                                    <button 
                                        type="button"
                                        onClick={clearFilters}
                                        className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-transparent text-xs font-bold text-slate-500 hover:text-rose-500 dark:text-slate-400 hover:bg-rose-500/5 transition-all w-1/2"
                                    >
                                        <X size={14} /> Reset
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setShowFilters(false)}
                                        className="bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600 px-6 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 dark:shadow-none transition-all w-1/2"
                                    >
                                        Apply
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {!hasFilteredResults && (
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                        <EmptyState
                            type="no-trades"
                            title="No matching trades"
                            message={focusPendingReviews
                                ? 'Try widening the review stage filter or refresh the broker review queue if new imports were expected.'
                                : 'Clear the current filters to get back to the full journal log.'}
                            actionLabel="Clear Filters"
                            onAction={clearFilters}
                        />
                    </motion.div>
                )}

                <TradeHistoryTable 
                    trades={filteredTrades} 
                    quickLogs={currentQuickLogs} 
                    onTradeClick={onTradeClick} 
                    onDeleteTrade={onDeleteTrade}
                    onRefresh={handleRefreshReviewQueue}
                    selectedTradeIds={selectedTradeIds}
                    setSelectedTradeIds={setSelectedTradeIds}
                />
            </div>

            <ConfirmationModal
                isOpen={isPurgeModalOpen}
                onClose={() => setIsPurgeModalOpen(false)}
                onConfirm={confirmPurgeDay}
                title="Purge Trading Day"
                message={`Are you sure you want to permanently delete all trades for ${selectedCalendarDate}? This will wipe out all data for this specific day and cannot be recovered.`}
                confirmText="Purge Day"
                variant="danger"
            />

            {/* CSV Import Modal */}
            <BrokerCSVImport
                isOpen={isCsvModalOpen}
                onClose={() => setIsCsvModalOpen(false)}
                onImport={handleImportTrades}
            />
        </div>
    );
};

export default React.memo(JournalCalendarView);
