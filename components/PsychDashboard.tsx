import React, { useState, useEffect, useMemo, useDeferredValue, Suspense } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
    LayoutDashboard, BookOpen, Library, Plus,
    Calendar as CalendarIcon, ShieldAlert, Snowflake, Grid, CheckSquare, X, AlertCircle, Sun, Brain,
    BarChart2, Download
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { db, Trade, DailyReview, calculatePnL } from '../database';
import { usePageVisibility } from '../contexts/PageVisibilityContext';
import { calculateStreaks } from '../utils/helpers';

// Components
import JournalAnalytics from './journal/JournalAnalytics';
import { JournalDashboardTab } from './tabs/journal/JournalDashboardTab';
import MistakesTab from './tabs/journal/MistakesTab';
import ReportsTab from './tabs/journal/ReportsTab';
const JournalCalendarView = React.lazy(() => import('./journal/JournalCalendarView'));
const PlaybookGallery = React.lazy(() => import('./journal/PlaybookGallery'));
const MistakesReflector = React.lazy(() => import('./journal/MistakesReflector'));
const ExecutionDesk = React.lazy(() => import('./journal/ExecutionDesk'));
const DailyReviewModal = React.lazy(() => import('./journal/DailyReviewModal'));
const SlumpBusterModal = React.lazy(() => import('./journal/SlumpBusterModal'));
import TradeJournalExportModal from './journal/TradeJournalExportModal';
import JournalCommandCenter from './journal/JournalCommandCenter';
import { StrategyPlaybook } from './trading/StrategyPlaybook';
import { AnimatedToggle } from './ui/AnimatedToggle';
import { ToggleGroup } from './ui/toggle-group';
import { PreTradeChecklist } from './journal/PreTradeChecklist';
import { WhatIfScenarioBuilder } from './journal/WhatIfScenarioBuilder';
import { useNavigationIntentStore } from '../store/navigationIntentStore';
import { acknowledgeCommandAction } from '../services/CommandCenterAcknowledgementService';
import ConfirmationModal from './shared/ConfirmationModal';
import { useCosmicGovernorStore } from '../store/cosmicGovernorStore';
import { useShallow } from 'zustand/react/shallow';
import { useSandboxStore } from '../store/sandboxStore';
import { CosmicTradeGovernor } from '../services/CosmicTradeGovernor';
import CosmicCircuitBreaker from './journal/CosmicCircuitBreaker';

import { Investment } from '../types';
import { deleteWithUndo } from '../lib/deleteWithUndo';
import { consumeUndo } from '../lib/undoStack';
import { COPY } from '../utils/appCopy';
import { useToast } from './shared/ToastProvider';
import { useSettingsStore } from '../store/settingsStore';
import { syncSandboxTradesFromApi } from './journal/SyncSandboxTradesButton';

type ViewMode = 'ANALYTICS' | 'JOURNAL' | 'PLAYBOOK' | 'MIRROR' | 'EXECUTION' | 'MISTAKES' | 'REPORTS';

const EMPTY_INVESTMENTS: Investment[] = [];

interface PsychDashboardProps {
    activeSubTab?: string;
}

const PsychDashboard: React.FC<PsychDashboardProps> = ({ activeSubTab = 'analytics' }) => {
    // View State
    const designPreset = useSettingsStore((s) => s.designPreset);
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const [viewMode, setViewMode] = useState<ViewMode>('ANALYTICS');
    const [analyticsMode, setAnalyticsMode] = useState<'BASIC' | 'PRO'>('BASIC');
    const { toast } = useToast();

    // Sync viewMode with activeSubTab prop
    useEffect(() => {
        if (activeSubTab === 'analytics') {
            setViewMode('ANALYTICS');
        } else if (activeSubTab === 'journal' || activeSubTab === 'calendar') {
            setViewMode('JOURNAL');
        } else if (activeSubTab === 'playbook') {
            setViewMode('PLAYBOOK');
        } else if (activeSubTab === 'mirror') {
            setViewMode('MIRROR');
        } else if (activeSubTab === 'mistakes') {
            setViewMode('MISTAKES');
        } else if (activeSubTab === 'reports') {
            setViewMode('REPORTS');
        }
    }, [activeSubTab]);
    const [playbookSubView, setPlaybookSubView] = useState<'STRATEGIES' | 'GALLERY'>('STRATEGIES');
    const [timeframe, setTimeframe] = useState<'ALL' | '30D' | '90D' | 'CUSTOM'>('ALL');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');
    const [isCustomOpen, setIsCustomOpen] = useState(false);

    // Modal State
    const [isDailyReviewModalOpen, setIsDailyReviewModalOpen] = useState(false);
    // Reflector is now a ViewMode ('MIRROR')
    const [isSlumpBusterOpen, setIsSlumpBusterOpen] = useState(false);

    // Checklist Sidebar State (New Feature)
    const [isChecklistOpen, setIsChecklistOpen] = useState(false);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);

    // Edit Mode State
    const [selectedTradeToEdit, setSelectedTradeToEdit] = useState<Trade | null>(null);
    // Mirror of Truth prefill state
    const [mirrorPrefill, setMirrorPrefill] = useState<{ title: string; coreLesson: string; emotionalContext: string } | null>(null);

    // Confirmation Modal State
    const [tradeToDeleteId, setTradeToDeleteId] = useState<number | null>(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [isCircuitBreakerOpen, setIsCircuitBreakerOpen] = useState(false);
    const [deskClickCount, setDeskClickCount] = useState(0);

    const isVisible = usePageVisibility();
    // P0#3: useShallow on cosmic governor selector
    const { isCircuitBreakerActive, incrementTradeCount, checkCircuitBreaker } = useCosmicGovernorStore(
        useShallow(state => ({
            isCircuitBreakerActive: state.isCircuitBreakerActive,
            incrementTradeCount: state.incrementTradeCount,
            checkCircuitBreaker: state.checkCircuitBreaker,
        }))
    );
    const isSandboxMode = useSandboxStore(state => state.isSandboxMode);


    const handleEditTrade = (trade: Trade) => {
        if (focusPendingReviews) {
            acknowledgeCommandAction('broker', 'trade-review', 'Working trade review queue');
        }
        setSelectedTradeToEdit(trade);
        setViewMode('EXECUTION');
    };

    const handlePushToMirror = (data: { title: string; coreLesson: string; emotionalContext: string }) => {
        setMirrorPrefill(data);
        setViewMode('MIRROR');
    };

    const handleDeleteTrade = (tradeId: number) => {
        setTradeToDeleteId(tradeId);
        setIsDeleteModalOpen(true);
    };

    const confirmDeleteTrade = async () => {
        if (tradeToDeleteId === null) return;
        const trade = rawTrades.find(t => t.id === tradeToDeleteId);
        const label = trade?.ticker ?? 'Trade';
        const entryId = await deleteWithUndo({
            table: 'trades',
            id: tradeToDeleteId,
            kind: 'trade',
            label,
            message: COPY.undo.tradeDeleted(label),
        });
        if (entryId) {
            setRawTrades(prev => prev.filter(t => t.id !== tradeToDeleteId));
            toast.success(COPY.undo.tradeDeleted(label), {
                duration: 30000,
                action: { label: 'Undo', onClick: () => { void consumeUndo(entryId)?.undo(); } },
            });
        } else {
            toast.error(COPY.undo.failed);
        }
        setTradeToDeleteId(null);
    };

    // Filter Logic
    const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
    const [ignoredMistakes, setIgnoredMistakes] = useState<string[]>([]);
    const [focusPendingReviews, setFocusPendingReviews] = useState(false);
    const [focusCoaching, setFocusCoaching] = useState(false);
    const navigationIntent = useNavigationIntentStore((state) => state.intent);
    const clearNavigationIntent = useNavigationIntentStore((state) => state.clearIntent);



    // Data Fetching
    const [rawTrades, setRawTrades] = useState<Trade[]>([]);
    const [dailyReviews, setDailyReviews] = useState<DailyReview[]>([]);
    const [hasInitialData, setHasInitialData] = useState(false);

    useEffect(() => {
        const subTrades = liveQuery(() => db.trades.toArray()).subscribe((data: Trade[]) => {
            const activeTrades = data.filter((t: any) => !t.isDeleted);
            const sorted = [...activeTrades].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5000);
            setRawTrades(sorted);
            setHasInitialData(true);
        });
        const subReviews = liveQuery(() => db.daily_reviews.toArray()).subscribe((data) => {
            const activeReviews = (data || []).filter((r: any) => !r.isDeleted);
            setDailyReviews(activeReviews);
        });
        return () => {
            subTrades.unsubscribe();
            subReviews.unsubscribe();
        };
    }, []);

    // Auto-sync Sandbox trades silently on mount when in Sandbox mode
    useEffect(() => {
        if (!isSandboxMode) return;
        void syncSandboxTradesFromApi(false);
    }, [isSandboxMode]);

    // Sync Cosmic Governor with DB on mount & periodically
    useEffect(() => {
        if (!isVisible) return;
        CosmicTradeGovernor.syncWithDatabase();
        const interval = setInterval(() => {
            if (!isVisible) return;
            CosmicTradeGovernor.syncWithDatabase();
            CosmicTradeGovernor.updateSensitivity();
        }, 30000); // Every 30s
        return () => clearInterval(interval);
    }, []);

    // Enriched Trades (PnL & Risk) - Memoized for stability
    const trades = useMemo(() => {
        if (rawTrades.length === 0) return [];
        const modeTrades = rawTrades.filter(t => isSandboxMode ? t.source === 'SANDBOX' : t.source !== 'SANDBOX');
        return modeTrades.map(t => {
            let r = t.riskRewardRatio || 0;
            if (!r && t.entryPrice && t.stopLoss && t.exitPrice) {
                const risk = Math.abs(t.entryPrice - t.stopLoss);
                if (risk > 0) {
                    const reward = t.direction === 'Long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice;
                    r = reward / risk;
                }
            }
            return {
                ...t,
                pnl: calculatePnL(t),
                riskRewardRatio: r
            };
        });
    }, [rawTrades, isSandboxMode]);

    // Derived Logic
    const filteredTrades = useMemo(() => {
        if (viewMode === 'JOURNAL' && selectedCalendarDate) {
            return trades.filter(t => t.date === selectedCalendarDate);
        }
        if (viewMode !== 'ANALYTICS') return trades;
        if (timeframe === 'ALL') return trades;
        if (timeframe === 'CUSTOM') {
            const start = customStart ? new Date(customStart) : new Date(0);
            start.setHours(0, 0, 0, 0);
            const end = customEnd ? new Date(customEnd) : new Date();
            end.setHours(23, 59, 59, 999);
            return trades.filter(t => {
                const tDate = new Date(t.date);
                return tDate >= start && tDate <= end;
            });
        }

        const now = new Date();
        const days = timeframe === '30D' ? 30 : 90;
        const cutoff = new Date(now.setDate(now.getDate() - days));
        return trades.filter(t => new Date(t.date) >= cutoff);
    }, [trades, timeframe, viewMode, selectedCalendarDate, customStart, customEnd]);

    const selectedDayReview = useMemo(() => {
        return selectedCalendarDate
            ? dailyReviews.find(r => r.date === selectedCalendarDate) || null
            : null;
    }, [dailyReviews, selectedCalendarDate]);

    const slumpStats = useMemo(() => calculateStreaks(trades), [trades]);

    useEffect(() => {
        if (!navigationIntent || navigationIntent.target !== 'journal') return;

        if (navigationIntent.action === 'trade-review') {
            setViewMode('JOURNAL');
            setSelectedCalendarDate(null);
            setFocusPendingReviews(true);
            setFocusCoaching(false);
        } else if (navigationIntent.action === 'journal-coach') {
            setViewMode('ANALYTICS');
            setFocusPendingReviews(false);
            setFocusCoaching(true);
        }

        clearNavigationIntent();
    }, [clearNavigationIntent, navigationIntent]);

    // Slump Buster Check
    useEffect(() => {
        if (slumpStats.currentLoseStreak >= 3) {
            setIsSlumpBusterOpen(true);
        }
    }, [slumpStats.currentLoseStreak]);

    // Full Page View: Mirror of Truth

    if (viewMode === 'EXECUTION') {
        return (
            <Suspense fallback={<div className="flex h-screen items-center justify-center bg-white dark:bg-slate-950 text-indigo-400 font-bold animate-pulse">Loading Flight Deck...</div>}>
                <ExecutionDesk onClose={() => setViewMode('ANALYTICS')} tradeToEdit={selectedTradeToEdit} onPushToMirror={handlePushToMirror} />
            </Suspense>
        );
    }

    return (
        // REFACTOR 1: Reduced Padding & Full Width
        <div className="min-h-screen text-slate-900 dark:text-slate-200 p-4 font-sans selection:bg-indigo-500/30">
            


            {/* 1. HEADER & CONTROLS */}
            {viewMode === 'ANALYTICS' && (
                <div className="w-full mb-6 flex flex-col xl:flex-row justify-between items-center gap-4">

                    {/* Left Side: Analytics Mode Toggle (only visible in Analytics) */}
                    <div className="flex items-center gap-2">
                        {viewMode === 'ANALYTICS' && (
                            <ToggleGroup
                                options={[
                                    { value: 'BASIC', label: 'Basic Analytics' },
                                    { value: 'PRO', label: 'Pro Analytics' }
                                ]}
                                value={analyticsMode}
                                onChange={(val) => setAnalyticsMode(val as any)}
                                layoutId="psychAnalyticsMode"
                                size="sm"
                                ariaLabel="Analytics Mode"
                            />
                        )}
                    </div>

                    {/* Right Side Controls */}
                    <div className="flex flex-wrap items-center justify-center gap-3">

                        {/* Timeframe Toggles (Analytics Only) */}
                        {viewMode === 'ANALYTICS' && (
                            <div className="hidden sm:flex items-center gap-2 mr-2">
                                <ToggleGroup
                                    options={[
                                        { value: 'ALL', label: 'ALL' },
                                        { value: '30D', label: '30D' },
                                        { value: '90D', label: '90D' }
                                    ]}
                                    value={timeframe}
                                    onChange={(id) => {
                                        setTimeframe(id as any);
                                        setIsCustomOpen(false);
                                    }}
                                    layoutId="analyticsTimeframe"
                                    size="xs"
                                    ariaLabel="Analytics Timeframe"
                                />
                                
                                <div className="relative">
                                    <button
                                        onClick={() => setIsCustomOpen(!isCustomOpen)}
                                        className={`px-2.5 py-1.5 rounded-xl transition-all relative flex items-center justify-center border ${
                                            isCustomOpen || timeframe === 'CUSTOM'
                                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 bg-white/60 dark:bg-slate-900/50 border-slate-200 dark:border-white/5'
                                        }`}
                                        title="Custom Date Range"
                                    >
                                        <CalendarIcon size={14} />
                                        {timeframe === 'CUSTOM' && !isCustomOpen && (
                                            <span className="absolute -top-1 -right-1 w-2 h-2 bg-indigo-400 rounded-full border border-slate-900" />
                                        )}
                                    </button>
                                    
                                    {isCustomOpen && (
                                        <div className="absolute right-0 mt-2 z-[150] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-xl flex flex-col gap-3 min-w-[260px] text-slate-800 dark:text-slate-200">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Custom Range</span>
                                                {timeframe === 'CUSTOM' && (
                                                    <button
                                                        onClick={() => {
                                                            setTimeframe('ALL');
                                                            setIsCustomOpen(false);
                                                            setCustomStart('');
                                                            setCustomEnd('');
                                                        }}
                                                        className="text-[9px] font-bold text-slate-400 hover:text-rose-500 transition-colors"
                                                    >
                                                        Reset
                                                    </button>
                                                )}
                                            </div>

                                            <div className="space-y-2">
                                                <div>
                                                    <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase ml-1 mb-1 block">Start Date</label>
                                                    <input
                                                        type="date"
                                                        value={customStart}
                                                        onChange={(e) => {
                                                            setCustomStart(e.target.value);
                                                            setTimeframe('CUSTOM');
                                                        }}
                                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none text-slate-800 dark:text-white"
                                                    />
                                                </div>

                                                <div>
                                                    <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase ml-1 mb-1 block">End Date</label>
                                                    <input
                                                        type="date"
                                                        value={customEnd}
                                                        onChange={(e) => {
                                                            setCustomEnd(e.target.value);
                                                            setTimeframe('CUSTOM');
                                                        }}
                                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none text-slate-800 dark:text-white"
                                                    />
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => setIsCustomOpen(false)}
                                                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black rounded-lg transition-all uppercase tracking-widest mt-1"
                                            >
                                                Apply
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {(viewMode as string) !== 'MIRROR' && (
                            <>
                                {/* Streak Badge */}
                                {slumpStats.currentLoseStreak > 0 && (
                                    <div className={`px-3 py-1 bg-rose-500/10 text-rose-500 rounded-lg text-xs font-bold border border-rose-500/20 flex items-center gap-1 ${isVisible ? 'animate-pulse' : ''}`}>
                                        <Snowflake size={12} /> Streak: -{slumpStats.currentLoseStreak}
                                    </div>
                                )}

                                {viewMode === 'ANALYTICS' && (
                                    <>
                                        {/* Export & Restore Trade Journal Button */}
                                        <button
                                            type="button"
                                            onClick={() => setIsExportModalOpen(true)}
                                            className="px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 hover:text-white rounded-xl font-bold border border-white/[0.08] hover:border-indigo-500/40 flex items-center gap-2 transition-all shadow-sm group"
                                            title="Export or Restore Trade Journal (AI-Ready JSON, Standalone HTML, CSV)"
                                        >
                                            <Download size={18} className="text-indigo-400 group-hover:scale-110 transition-transform" />
                                            <span className="hidden sm:inline">Export</span>
                                        </button>

                                        {/* REFACTOR 2: Checklist Toggle Button */}
                                        <button
                                            onClick={() => setIsChecklistOpen(true)}
                                            className="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-xl font-bold border border-emerald-500/20 flex items-center gap-2 transition-all"
                                        >
                                            <CheckSquare size={18} /> Checklist
                                        </button>

                                        {/* Speed-Run Button */}
                                        <button
                                            onClick={() => {
                                                window.dispatchEvent(new CustomEvent('PSYCH_NAVIGATE', { detail: 'REVIEW' }));
                                            }}
                                            className="px-4 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-xl font-bold border border-indigo-500/20 flex items-center gap-2 transition-all shadow-[0_0_15px_-5px_rgba(99,102,241,0.2)]"
                                        >
                                            <Brain size={20} /> 
                                        </button>

                                        {/* Add Trade Button */}
                                        <button
                                            onClick={() => {
                                                setDeskClickCount(prev => prev + 1);
                                                CosmicTradeGovernor.detectCompulsion(deskClickCount + 1);
                                                
                                                if (isCircuitBreakerActive) {
                                                    setIsCircuitBreakerOpen(true);
                                                    return;
                                                }
                                                
                                                setSelectedTradeToEdit(null);
                                                setViewMode('EXECUTION');
                                            }}
                                            className={`px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 border backdrop-blur-sm transition-all duration-300 ${
                                                isCircuitBreakerActive 
                                                ? 'bg-rose-600/20 border-rose-500/50 text-rose-500 cursor-not-allowed shadow-[0_0_20px_-5px_rgba(244,63,94,0.3)]' 
                                                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-500/50 shadow-[0_0_20px_-5px_rgba(79,70,229,0.4)]'
                                            }`}
                                        >
                                            {isCircuitBreakerActive ? <ShieldAlert size={18} /> : <Plus size={18} />}
                                            {isCircuitBreakerActive ? 'Rahu Locked' : 'New Trade'}
                                        </button>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}


            {/* 2. MAIN CONTENT AREA — Conditional Rendering for Peak Performance */}
            <div className="w-full relative">
                <Suspense fallback={
                    <div className="flex flex-col gap-6 animate-pulse">
                        <div className="h-48 bg-white/60 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-white/5" />
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="h-64 bg-white/60 dark:bg-slate-900/50 rounded-2xl border border-slate-200 dark:border-white/5" />
                            <div className="h-64 bg-white/60 dark:bg-slate-900/50 rounded-2xl border border-white/5" />
                        </div>
                    </div>
                }>
                    <div className="w-full">
                        {!hasInitialData ? (
                            <div className="flex flex-col gap-6 animate-pulse">
                                <div className="h-48 bg-slate-900/50 rounded-2xl border border-white/5" />
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div className="h-64 bg-slate-900/50 rounded-2xl border border-white/5" />
                                    <div className="h-64 bg-slate-900/50 rounded-2xl border border-white/5" />
                                </div>
                            </div>
                        ) : viewMode === 'ANALYTICS' && (
                            <div className="w-full space-y-6">
                                {focusCoaching && (
                                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10 mb-4">
                                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Focused from command center</p>
                                        <p className="mt-1 text-xs text-emerald-700/90 dark:text-emerald-300">You were brought here to work the coaching queue. Review expectancy, process score, and setup weakness, then mark the session as in progress.</p>
                                        <button
                                            onClick={() => {
                                                acknowledgeCommandAction('journal', 'journal-coach', 'Working journal coaching queue');
                                                setFocusCoaching(false);
                                            }}
                                            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500"
                                        >
                                            Working Coaching Queue
                                        </button>
                                    </div>
                                )}
                                {analyticsMode === 'PRO' ? (
                                    <JournalDashboardTab 
                                        onNewTrade={() => {
                                            setDeskClickCount(prev => prev + 1);
                                            CosmicTradeGovernor.detectCompulsion(deskClickCount + 1);
                                            
                                            if (isCircuitBreakerActive) {
                                                setIsCircuitBreakerOpen(true);
                                                return;
                                            }
                                            
                                            setSelectedTradeToEdit(null);
                                            setViewMode('EXECUTION');
                                        }} 
                                        onEditTrade={handleEditTrade} 
                                    />
                                ) : (
                                    <JournalAnalytics
                                        trades={trades}
                                        timeframe={timeframe}
                                        ignoredMistakes={ignoredMistakes}
                                        setIgnoredMistakes={setIgnoredMistakes}
                                        customStart={customStart}
                                        customEnd={customEnd}
                                    />
                                )}
                            </div>
                        )}

                        {viewMode === 'JOURNAL' && (
                            <JournalCalendarView
                                trades={filteredTrades}
                                dailyReviews={dailyReviews}
                                selectedCalendarDate={selectedCalendarDate}
                                setSelectedCalendarDate={setSelectedCalendarDate}
                                selectedDayReview={selectedDayReview}
                                onOpenDailyReviewModal={() => setIsDailyReviewModalOpen(true)}
                                onTradeClick={handleEditTrade}
                                onDeleteTrade={handleDeleteTrade}
                                focusPendingReviews={focusPendingReviews}
                                onJumpToAnalytics={() => setViewMode('ANALYTICS')}
                                onAcknowledgeReviewAction={() => acknowledgeCommandAction('broker', 'trade-review', 'Working trade review queue')}
                            />
                        )}

                        {viewMode === 'PLAYBOOK' && (
                            <div className="space-y-6">
                                <div className="flex bg-slate-100/50 dark:bg-slate-900/50 p-1 rounded-xl w-fit border border-slate-200 dark:border-slate-800">
                                    <button
                                        onClick={() => setPlaybookSubView('STRATEGIES')}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${playbookSubView === 'STRATEGIES' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                    >
                                        Strategy Rules
                                    </button>
                                    <button
                                        onClick={() => setPlaybookSubView('GALLERY')}
                                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${playbookSubView === 'GALLERY' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                    >
                                        Trade Gallery
                                    </button>
                                </div>

                                {playbookSubView === 'STRATEGIES' ? (
                                    <div className="bg-white/60 dark:bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-slate-200 dark:border-white/5">
                                        <StrategyPlaybook />
                                    </div>
                                ) : (
                                    <PlaybookGallery trades={trades} onEditTrade={handleEditTrade} />
                                )}
                            </div>
                        )}

                        {viewMode === 'MIRROR' && (
                            <MistakesReflector initialData={mirrorPrefill} onConsumeInitialData={() => setMirrorPrefill(null)} />
                        )}

                        {viewMode === 'MISTAKES' && (
                            <MistakesTab />
                        )}

                        {viewMode === 'REPORTS' && (
                            <ReportsTab />
                        )}
                    </div>
                </Suspense>
            </div>

            {/* 3. MODALS */}

            {/* REFACTOR 5: Checklist Drawer Modal */}
            <AnimatePresence>
                {isChecklistOpen && (
                    <>
                        <div
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] cursor-pointer"
                            onClick={() => setIsChecklistOpen(false)}
                        />
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: "spring", damping: 25, stiffness: 200 }}
                            className="fixed top-0 right-0 h-screen w-full md:w-[450px] bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 z-[100] shadow-2xl flex flex-col"
                        >
                            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                                <span className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                                    <CheckSquare size={20} className="text-emerald-500" /> Pre-Trade Flight Check
                                </span>
                                <button
                                    onClick={() => setIsChecklistOpen(false)}
                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                                <PreTradeChecklist />
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            <DailyReviewModal
                isOpen={isDailyReviewModalOpen}
                onClose={() => setIsDailyReviewModalOpen(false)}
                date={selectedCalendarDate || new Date().toISOString().split('T')[0]}
                onSave={() => {/* Auto-updates via liveQuery */ }}
            />

            <SlumpBusterModal
                isOpen={isSlumpBusterOpen}
                onClose={() => setIsSlumpBusterOpen(false)}
                slumpStats={slumpStats}
            />

            <TradeJournalExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
            />

            {/* 4. COMMAND CENTER (Hidden until triggered) */}
            <JournalCommandCenter />

            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                onConfirm={confirmDeleteTrade}
                title="Delete Trade Record"
                message="Are you sure you want to permanently delete this trade? This will remove all associated logs, P&L data, and psychological notes. This action cannot be undone."
                confirmText="Delete Permanently"
                variant="danger"
            />

            <CosmicCircuitBreaker 
                isOpen={isCircuitBreakerOpen} 
                onClose={() => setIsCircuitBreakerOpen(false)} 
            />


        </div>
    );
};

export default PsychDashboard;
