import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Activity, TrendingUp, TrendingDown, Zap, Bell, Plus,
    Calculator, RefreshCw, Search, Command, Keyboard,
    BarChart3, PieChart, Wallet, AlertTriangle, ArrowUpRight, ArrowDownRight, BookOpenCheck, ShieldAlert
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { liveQuery } from 'dexie';
import MarketPulse from '../RoutineClock';
import { MarketStatus } from '../../hooks/useMarketSentiment';
import { logger } from '../../services/Logger';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { db, Trade, SyncRecordRow } from '../../database';
import { buildUnifiedCommandInsights } from '../../services/UnifiedCommandCenterService';
import { computeResolvedCommandInsights, ResolvedCommandInsight } from '../../services/CommandCenterResolutionService';
import { COMMAND_CENTER_ACK_EVENT, filterAcknowledgedInsights, getActiveAcknowledgedInsights, isAcknowledgedActionInsight } from '../../services/CommandCenterAcknowledgementService';
import { BROKER_EXECUTION_HANDOFF_EVENT, getActiveBrokerExecutionHandoffs } from '../../services/BrokerExecutionHandoffService';
import { SectionHeader, StateSurface } from '../shared/SurfacePrimitives';
import { Badge } from '../ui/badge';
import { Kbd } from '../ui/kbd';

interface CommandCenterProps {
    marketStatus: MarketStatus;
    marketVix: number;
    onQuickAction?: (action: string) => void;
}

// ===================== LIVE MARKET TICKER =====================
interface IndexData {
    name: string;
    value: number;
    change: number;
    changePercent: number;
}

const MarketTicker: React.FC = () => {
    const [indices, setIndices] = useState<IndexData[]>([
        { name: 'NIFTY 50', value: 0, change: 0, changePercent: 0 },
        { name: 'SENSEX', value: 0, change: 0, changePercent: 0 },
        { name: 'NIFTY BANK', value: 0, change: 0, changePercent: 0 },
        { name: 'INDIA VIX', value: 0, change: 0, changePercent: 0 },
    ]);
    const [isLive, setIsLive] = useState(false);
    const isVisible = usePageVisibility();

    // Fetch live data from DhanHQ
    const fetchLiveData = useCallback(async () => {
        if (!dhanBrokerService.isConfigured()) return;
        try {
            const dhanIndices = await dhanBrokerService.getIndexQuotes();
            if (dhanIndices.length > 0) {
                setIndices(prev => prev.map(idx => {
                    const match = dhanIndices.find(d => d.symbol === idx.name);
                    if (match && match.price > 0) {
                        return { name: idx.name, value: match.price, change: match.change, changePercent: match.changePercent };
                    }
                    return idx;
                }));
                setIsLive(true);
            }
        } catch (e) { logger.warn('Dashboard ticker: DhanHQ fetch failed', e); }
    }, []);

    useEffect(() => {
        if (!isVisible) return;
        fetchLiveData();
    }, [fetchLiveData, isVisible]);

    // P0#2: visibility-paused 30s ticker refresh
    usePausedInterval(
      fetchLiveData,
      isVisible ? 30_000 : null
    );

    return (
        <div className="flex items-center gap-1 overflow-hidden">
            <div className="flex animate-[scroll_30s_linear_infinite] gap-6 whitespace-nowrap">
                {[...indices, ...indices].map((idx, i) => (
                    <div key={`${idx.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50 rounded-lg border border-slate-800">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{idx.name}</span>
                        <span className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                            {idx.value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                        <span className={`text-[10px] font-mono font-bold flex items-center gap-0.5 ${idx.change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {idx.change >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                            {Math.abs(idx.changePercent).toFixed(2)}%
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ===================== SMART ACTION CARDS =====================
interface SmartAction {
    id: string;
    title: string;
    description: string;
    icon: React.ReactNode;
    priority: 'high' | 'medium' | 'low';
    action: string;
}

const laneIconMap = {
    broker: <ShieldAlert size={16} className="text-rose-500" />,
    portfolio: <PieChart size={16} className="text-indigo-500" />,
    journal: <BookOpenCheck size={16} className="text-emerald-500" />,
} as const;

const laneToneMap = {
    broker: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    portfolio: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    journal: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
} as const;

const formatRelativeResolutionTime = (resolvedAt: number): string => {
    const seconds = Math.max(1, Math.round((Date.now() - resolvedAt) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `${minutes}m ago`;
};

const SmartActionCard: React.FC<{ action: SmartAction; onExecute: (id: string) => void }> = ({ action, onExecute }) => {
    const priorityColors = {
        high: 'border-rose-500/30 bg-rose-50 dark:bg-rose-950/20',
        medium: 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/20',
        low: 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20'
    };

    const priorityBadge = {
        high: 'bg-rose-500 text-white',
        medium: 'bg-amber-500 text-white',
        low: 'bg-emerald-500 text-white'
    };

    return (
        <button
            onClick={() => onExecute(action.id)}
            className={`group p-3 rounded-xl border ${priorityColors[action.priority]} hover:scale-[1.02] transition-all duration-200 text-left w-full`}
        >
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-white dark:bg-slate-900 shadow-sm">
                    {action.icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-slate-800 dark:text-white truncate">{action.title}</span>
                        <Badge
                            variant={action.priority === 'high' ? 'loss' : action.priority === 'medium' ? 'warn' : 'gain'}
                            size="sm"
                            className="text-[8px] uppercase tracking-wider px-1.5 py-0"
                        >
                            {action.priority}
                        </Badge>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">{action.description}</p>
                </div>
            </div>
        </button>
    );
};

// ===================== QUICK ACTIONS BAR =====================
interface QuickAction {
    id: string;
    label: string;
    icon: React.ReactNode;
    shortcut: string;
}

const QuickActionsBar: React.FC<{ onAction: (id: string) => void }> = ({ onAction }) => {
    const quickActions: QuickAction[] = [
        { id: 'add', label: 'Add Investment', icon: <Plus size={14} />, shortcut: 'N' },
        { id: 'calculate', label: 'Calculator', icon: <Calculator size={14} />, shortcut: 'C' },
        { id: 'refresh', label: 'Refresh', icon: <RefreshCw size={14} />, shortcut: 'R' },
        { id: 'search', label: 'Search', icon: <Search size={14} />, shortcut: '/' },
        { id: 'alerts', label: 'Alerts', icon: <Bell size={14} />, shortcut: 'A' },
    ];

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                const action = quickActions.find(a => a.shortcut.toLowerCase() === e.key.toLowerCase());
                if (action) {
                    e.preventDefault();
                    onAction(action.id);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onAction]);

    return (
        <div className="flex items-center gap-1">
            {quickActions.map(action => (
                <button
                    key={action.id}
                    onClick={() => onAction(action.id)}
                    className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 border border-transparent hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
                    title={`${action.label} (Ctrl+${action.shortcut})`}
                >
                    <span className="text-slate-600 dark:text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        {action.icon}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-500 hidden lg:block">
                        {action.label}
                    </span>
                    <Kbd className="hidden xl:inline-flex text-[9px]">
                        ⌘{action.shortcut}
                    </Kbd>
                </button>
            ))}
        </div>
    );
};

// ===================== MAIN COMMAND CENTER =====================
const CommandCenter: React.FC<CommandCenterProps> = ({ marketStatus, marketVix, onQuickAction }) => {
    const investments = usePortfolioStore((state) => state.investments);
    const allocationTargets = useSettingsStore((state) => state.allocationTargets);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [syncRecords, setSyncRecords] = useState<SyncRecordRow[]>([]);
    const [resolvedQueue, setResolvedQueue] = useState<ResolvedCommandInsight[]>([]);
    const [acknowledgedInsights, setAcknowledgedInsights] = useState(() => getActiveAcknowledgedInsights());
    const [executionHandoffs, setExecutionHandoffs] = useState(() => getActiveBrokerExecutionHandoffs());
    const [isCollapsed, setIsCollapsed] = useState(true);

    const isRed = marketStatus === 'RED';
    const statusColor = isRed ? 'text-rose-500' : marketStatus === 'AMBER' ? 'text-amber-500' : 'text-emerald-500';
    const statusBg = isRed ? 'bg-rose-500/10 border-rose-500/20' : marketStatus === 'AMBER' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20';

    useEffect(() => {
        const tradeSub = liveQuery(() => db.trades.filter((t: any) => !t.isDeleted).toArray()).subscribe({
            next: (value) => setTrades(value || []),
        });
        const syncSub = liveQuery(() => db.sync_records.toArray()).subscribe({
            next: (value) => setSyncRecords(value || []),
        });

        return () => {
            tradeSub.unsubscribe();
            syncSub.unsubscribe();
        };
    }, []);

    const handleQuickAction = useCallback((actionId: string) => {
        logger.debug('Quick action triggered', { actionId }, 'CommandCenter');
        onQuickAction?.(actionId);
    }, [onQuickAction]);

    useEffect(() => {
        const refreshAcknowledgements = () => setAcknowledgedInsights(getActiveAcknowledgedInsights());
        window.addEventListener(COMMAND_CENTER_ACK_EVENT, refreshAcknowledgements);
        window.addEventListener('storage', refreshAcknowledgements);
        return () => {
            window.removeEventListener(COMMAND_CENTER_ACK_EVENT, refreshAcknowledgements);
            window.removeEventListener('storage', refreshAcknowledgements);
        };
    }, []);

    useEffect(() => {
        const refreshExecutionHandoffs = () => setExecutionHandoffs(getActiveBrokerExecutionHandoffs());
        window.addEventListener(BROKER_EXECUTION_HANDOFF_EVENT, refreshExecutionHandoffs);
        window.addEventListener('storage', refreshExecutionHandoffs);
        return () => {
            window.removeEventListener(BROKER_EXECUTION_HANDOFF_EVENT, refreshExecutionHandoffs);
            window.removeEventListener('storage', refreshExecutionHandoffs);
        };
    }, []);

    const rawMissionQueue = useMemo(() => buildUnifiedCommandInsights(
        investments,
        trades,
        syncRecords,
        allocationTargets,
        executionHandoffs,
    ), [allocationTargets, executionHandoffs, investments, syncRecords, trades]);

    const missionQueue = useMemo(
        () => filterAcknowledgedInsights(rawMissionQueue, acknowledgedInsights),
        [acknowledgedInsights, rawMissionQueue],
    );

    const [previousQueue, setPreviousQueue] = useState<typeof missionQueue>([]);

    useEffect(() => {
        if (acknowledgedInsights.length === 0) return;
        setResolvedQueue((existing) => {
            const merged = [...acknowledgedInsights, ...existing];
            const deduped = merged.filter((item, index, items) =>
                items.findIndex((candidate) => candidate.id === item.id && candidate.resolvedAt === item.resolvedAt) === index
            );
            return deduped.slice(0, 4);
        });
    }, [acknowledgedInsights]);

    useEffect(() => {
        if (previousQueue.length > 0) {
            const resolved = computeResolvedCommandInsights(previousQueue, missionQueue);
            if (resolved.length > 0) {
                setResolvedQueue((existing) => [...resolved, ...existing].slice(0, 4));
            }
        }
        setPreviousQueue(missionQueue);
    }, [missionQueue]);

    useEffect(() => {
        if (resolvedQueue.length === 0) return;
        const timeout = window.setTimeout(() => {
            const cutoff = Date.now() - 12000;
            setResolvedQueue((items) => items.filter((item) => item.resolvedAt >= cutoff));
        }, 12000);
        return () => window.clearTimeout(timeout);
    }, [resolvedQueue]);

    return (
        <div className="space-y-3 mb-6">


            {/* ROW 2: Unified Market Pulse (Timing + Sentiment + VIX) */}
            <MarketPulse marketStatus={marketStatus} marketVix={marketVix} />

            <div className="luxury-card relative overflow-hidden rounded-wa-lg border border-slate-800/80 dark:border-wa-border bg-slate-900/80 dark:bg-wa-card backdrop-blur-xl p-4 sm:p-5 shadow-sm">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-indigo-500/10 via-sky-500/5 to-emerald-500/10" />
                <SectionHeader
                    className="relative z-10 mb-3"
                    eyebrow="Workflow Console"
                    title="Mission Queue"
                    description="Broker, portfolio, and journal priorities in one flow."
                    icon={Command}
                    tone="info"
                    badge={`${missionQueue.length} active`}
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    isCollapsed={isCollapsed}
                />

                <AnimatePresence>
                    {!isCollapsed && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="overflow-hidden space-y-4"
                        >
                            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 list-rise">
                                {missionQueue.length > 0 ? missionQueue.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => handleQuickAction(item.action)}
                                        className="group rounded-wa-md border border-slate-800/80 dark:border-wa-border bg-slate-900/60 dark:bg-wa-surface/60 p-3.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-indigo-500/40 dark:hover:border-white/[0.15] hover:bg-slate-800/80 dark:hover:bg-wa-card-elevated hover:shadow-md"
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-wa-sm border border-slate-800/80 dark:border-wa-border bg-slate-900/80 dark:bg-wa-card-elevated shadow-sm transition-transform group-hover:scale-105">
                                                {laneIconMap[item.lane]}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="truncate text-[13px] font-bold text-slate-900 dark:text-white">{item.title}</p>
                                                    <Badge
                                                        variant={item.priority === 'high' ? 'loss' : item.priority === 'medium' ? 'warn' : 'gain'}
                                                        size="sm"
                                                        className="text-[9px] uppercase tracking-wider"
                                                    >
                                                        {item.priority}
                                                    </Badge>
                                                </div>
                                                <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{item.description}</p>
                                                <div className="mt-2 flex items-center justify-between gap-3">
                                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.lane}</p>
                                                    <p className="text-[9px] font-bold uppercase tracking-wide text-indigo-500 opacity-0 transition-opacity group-hover:opacity-100 dark:text-indigo-300">
                                                        Open lane
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                )) : (
                                    <StateSurface
                                        className="col-span-full"
                                        tone="success"
                                        icon={BookOpenCheck}
                                        title="Command center is clear."
                                        description="No broker drift, no urgent portfolio actions, and no journal coaching alerts right now."
                                        badge="Stay in monitor mode"
                                    />
                                )}
                            </div>

                            {resolvedQueue.length > 0 && (
                                <div className="mt-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] dark:bg-emerald-500/[0.05] p-3.5 backdrop-blur-sm">
                                    <SectionHeader
                                        eyebrow="Completion Feed"
                                        title="Recently Cleared"
                                        description="Work the app has just acknowledged as handled."
                                        icon={BookOpenCheck}
                                        tone="success"
                                    />
                                    <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                                        {resolvedQueue.map((item) => (
                                            <div key={`${item.id}-${item.resolvedAt}`} className="rounded-xl border border-emerald-500/15 bg-white/60 dark:bg-white/[0.04] px-3.5 py-2.5 text-xs shadow-sm">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className="font-bold text-slate-900 dark:text-white">{item.title}</p>
                                                    <Badge variant="outline" size="sm" className="text-[9px] uppercase tracking-wider">
                                                        {item.lane}
                                                    </Badge>
                                                </div>
                                                <div className="mt-1.5 flex items-center justify-between gap-2">
                                                    <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                                                        {isAcknowledgedActionInsight(item.id) ? 'Worked from command center' : 'Resolved from queue change'}
                                                    </p>
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                                        {formatRelativeResolutionTime(item.resolvedAt)}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default CommandCenter;
