import React, { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, Wifi, Wallet, BookOpenCheck, Activity, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, SyncRecordRow, Trade } from '../../database';
import { Investment } from '../../types';
import { useDhanStore } from '../../store/dhanStore';
import { useShallow } from 'zustand/react/shallow';
import { dhanTradeSyncService } from '../../services/DhanTradeSyncService';
import { summarizeDhanDiagnostics } from '../../services/DhanDiagnosticsService';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import { useToast } from '../shared/ToastProvider';
import { refreshImportedTradeReviewQueue } from '../../services/BrokerReviewWorkflowService';
import { BROKER_EXECUTION_HANDOFF_EVENT, clearConfirmedBrokerExecutionHandoffs, getActiveBrokerExecutionHandoffs } from '../../services/BrokerExecutionHandoffService';
import { FreshnessBadge, MetricTile, SectionHeader, StateSurface } from '../shared/SurfacePrimitives';

interface DhanDiagnosticsPanelProps {
    investments: Investment[];
    formatCurrency: (value: number) => string;
    isPrivacyMode: boolean;
    isFocused?: boolean;
    onNavigate?: (tab: string) => void;
}

const formatSyncTime = (value?: string) => {
    if (!value) return 'Not yet';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const DhanDiagnosticsPanel: React.FC<DhanDiagnosticsPanelProps> = ({
    investments,
    formatCurrency,
    isPrivacyMode,
    isFocused = false,
    onNavigate,
}) => {
    const { toast } = useToast();
    const { fundLimit, positions, refreshBrokerState } = useDhanStore(
        useShallow(state => ({
            fundLimit: state.fundLimit,
            positions: state.positions,
            refreshBrokerState: state.refreshBrokerState
        }))
    );
    const [syncRecords, setSyncRecords] = useState<SyncRecordRow[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isRefreshingReviews, setIsRefreshingReviews] = useState(false);
    const [executionHandoffs, setExecutionHandoffs] = useState(() => getActiveBrokerExecutionHandoffs());
    const [isCollapsed, setIsCollapsed] = useState(true);

    useEffect(() => {
        const syncSub = liveQuery(() => db.sync_records.toArray()).subscribe({
            next: (value) => setSyncRecords(value || []),
        });
        const tradeSub = liveQuery(() => db.trades.filter((t: any) => !t.isDeleted).toArray()).subscribe({
            next: (value) => setTrades(value || []),
        });

        return () => {
            syncSub.unsubscribe();
            tradeSub.unsubscribe();
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

    const summary = useMemo(() => summarizeDhanDiagnostics({
        configured: dhanBrokerService.isConfigured(),
        syncRecords,
        trades,
        investments,
        positions,
        fundLimit,
        executionHandoffs,
    }), [executionHandoffs, fundLimit, investments, positions, syncRecords, trades]);

    const statusTone = summary.syncHealth === 'healthy'
        ? 'emerald'
        : summary.syncHealth === 'warning'
            ? 'amber'
            : 'rose';

    const primaryReviewAction = summary.pendingReviewTrades > 0
        ? `${summary.pendingReviewTrades} trades still need review work.`
        : summary.recentExecutions > 0
            ? `${summary.recentExecutions} fresh execution follow-up ${summary.recentExecutions > 1 ? 'items are' : 'item is'} waiting.`
            : summary.reconciliationConflicts > 0 || summary.orphanedHoldings > 0
                ? 'Broker matches need review before trusting the book.'
                : 'The broker lane is currently quiet.';

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshBrokerState(true);
            await dhanTradeSyncService.refreshReviewWorkflow();
            const tradeSyncRecord = await db.sync_records.get('dhan:trade-sync');
            const lastConfirmedAt = tradeSyncRecord?.lastSyncedAt ? new Date(tradeSyncRecord.lastSyncedAt).getTime() : null;
            const clearedExecutionHandoffs = lastConfirmedAt
                ? clearConfirmedBrokerExecutionHandoffs(lastConfirmedAt, tradeSyncRecord?.syncStatus === 'SYNCED')
                : 0;

            toast.success('Dhan command panel refreshed.');
            if (clearedExecutionHandoffs > 0) {
                toast.info(`Confirmed ${clearedExecutionHandoffs} fresh execution follow-up ${clearedExecutionHandoffs > 1 ? 'items' : 'item'} from broker sync.`);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(message || 'Failed to refresh broker diagnostics.');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleRefreshReviews = async () => {
        setIsRefreshingReviews(true);
        try {
            const updated = await refreshImportedTradeReviewQueue();
            toast.success(updated > 0 ? `Refreshed ${updated} trade review state(s).` : 'Trade review queue is already up to date.');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(message || 'Failed to refresh trade review queue.');
        } finally {
            setIsRefreshingReviews(false);
        }
    };

    return (
        <div className={`relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg transition-all duration-300 ${isFocused ? 'ring-2 ring-indigo-500/60 shadow-[0_0_0_1px_rgba(99,102,241,0.2)]' : ''}`}>
            <div className={`absolute inset-x-0 top-0 h-1 ${statusTone === 'emerald' ? 'bg-emerald-500/70' : statusTone === 'amber' ? 'bg-amber-500/70' : 'bg-rose-500/70'}`} />

            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <motion.button
                            onClick={() => setIsCollapsed(!isCollapsed)}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className={`rounded-xl border p-2 transition-colors ${statusTone === 'emerald' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : statusTone === 'amber' ? 'border-amber-500/20 bg-amber-500/10 text-amber-300' : 'border-rose-500/20 bg-rose-500/10 text-rose-300'}`}
                            title={isCollapsed ? 'Expand Panel' : 'Collapse Panel'}
                        >
                            {summary.syncHealth === 'healthy' ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
                        </motion.button>
                        <div className="cursor-pointer" onClick={() => setIsCollapsed(!isCollapsed)}>
                            <h3 className="text-sm font-black uppercase tracking-wider text-white">Dhan Command Panel</h3>
                            <p className="mt-0.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                                {isCollapsed ? (
                                    <span className="flex items-center gap-2">
                                        MTM: <span className={summary.syncHealth === 'healthy' ? 'text-emerald-400' : 'text-amber-400'}>{summary.syncHealth.toUpperCase()}</span> |
                                        RUNWAY: <span className="text-white">{isPrivacyMode ? '****' : formatCurrency(summary.availableBalance || 0)}</span> |
                                        REVIEW: <span className="text-white">{summary.pendingReviewTrades} PENDING</span>
                                    </span>
                                ) : (
                                    summary.syncHealth === 'healthy'
                                        ? 'Broker sync, review queue, and runway look stable.'
                                        : summary.syncHealth === 'warning'
                                            ? 'Broker workflows need attention, but functionality remains.'
                                            : 'Broker health degraded.'
                                )}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className={`inline-flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-xs font-bold text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-50 ${isCollapsed ? 'px-2 py-1' : 'px-4 py-2'}`}
                    >
                        <RefreshCw size={isCollapsed ? 12 : 14} className={isRefreshing ? 'animate-spin' : ''} />
                        {!isCollapsed && (isRefreshing ? 'Refreshing...' : 'Refresh Broker State')}
                    </button>
                </div>

                <AnimatePresence>
                    {!isCollapsed && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="overflow-hidden"
                        >
                            <div className="space-y-4 pt-4">
                                <StateSurface
                                    tone={!summary.configured ? 'warning' : summary.pendingReviewTrades > 0 || summary.reconciliationConflicts > 0 || summary.orphanedHoldings > 0 ? 'info' : 'success'}
                                    title={primaryReviewAction}
                                    description={
                                        !summary.configured
                                            ? 'Configure the broker connection first so sync, review workflow, and diagnostics can become meaningful.'
                                            : summary.pendingReviewTrades > 0
                                                ? 'Refresh the queue, then open the review lane and work the oldest imported trade first.'
                                                : summary.recentExecutions > 0
                                                    ? 'Refresh broker state now so the latest submitted order is confirmed inside sync and holdings.'
                                                    : summary.reconciliationConflicts > 0 || summary.orphanedHoldings > 0
                                                        ? 'Refresh broker state and inspect holdings before placing fresh trades.'
                                                        : 'Run a broker refresh before the next execution session to keep this lane current.'
                                    }
                                    icon={!summary.configured ? AlertTriangle : summary.pendingReviewTrades > 0 ? BookOpenCheck : CheckCircle2}
                                    badge="What to do next"
                                    actions={onNavigate && summary.pendingReviewTrades > 0 ? (
                                        <button
                                            onClick={() => onNavigate('journal')}
                                            className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-slate-200 transition-colors hover:border-slate-600"
                                        >
                                            Open Queue
                                            <ArrowRight size={12} />
                                        </button>
                                    ) : null}
                                />

                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    <MetricTile
                                        label="Sync Health"
                                        icon={Wifi}
                                        tone={statusTone === 'emerald' ? 'success' : statusTone === 'amber' ? 'warning' : 'danger'}
                                        value={summary.syncHealth.toUpperCase()}
                                        meta={`${summary.erroredPipelines} error, ${summary.conflictedPipelines} conflict, ${summary.stalePipelines} stale`}
                                    />
                                    <MetricTile
                                        label="Dhan Runway"
                                        icon={Wallet}
                                        tone="neutral"
                                        value={summary.availableBalance === null || isPrivacyMode ? '******' : formatCurrency(summary.availableBalance)}
                                        meta={`Open exposure ${isPrivacyMode ? '******' : formatCurrency(summary.totalOpenExposure)}`}
                                    />
                                    <MetricTile
                                        label="Review Loop"
                                        icon={BookOpenCheck}
                                        tone={summary.pendingReviewTrades > 0 ? 'info' : 'neutral'}
                                        value={`${summary.pendingReviewTrades} pending`}
                                        meta={`${summary.needsScreenshots} screenshots, ${summary.readyForLesson} lesson-ready, ${summary.recentExecutions} fresh exec`}
                                    />
                                    <MetricTile
                                        label="Live Book"
                                        icon={Activity}
                                        tone={summary.reconciliationConflicts > 0 || summary.orphanedHoldings > 0 ? 'warning' : 'neutral'}
                                        value={`${summary.openPositions} open positions`}
                                        meta={`${summary.reconciliationConflicts} partial, ${summary.orphanedHoldings} orphaned`}
                                    />
                                </div>

                                {isFocused && (
                                    <StateSurface
                                        tone="info"
                                        title="Focused from command center"
                                        description="Broker sync risk was promoted into your mission queue. Refresh the broker state first, then review imported trades if the queue is still elevated."
                                        icon={ShieldAlert}
                                        actions={
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    onClick={handleRefresh}
                                                    disabled={isRefreshing}
                                                    className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-3 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                                                >
                                                    <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                                                    Refresh Now
                                                </button>
                                                <button
                                                    onClick={handleRefreshReviews}
                                                    disabled={isRefreshingReviews}
                                                    className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-slate-200 transition-colors hover:border-slate-600 disabled:opacity-50"
                                                >
                                                    <BookOpenCheck size={12} className={isRefreshingReviews ? 'animate-pulse' : ''} />
                                                    Refresh Review Queue
                                                </button>
                                                {onNavigate && (
                                                    <button
                                                        onClick={() => onNavigate('journal')}
                                                        className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-slate-200 transition-colors hover:border-slate-600"
                                                    >
                                                        <BookOpenCheck size={12} />
                                                        Open Review Queue
                                                    </button>
                                                )}
                                            </div>
                                        }
                                    />
                                )}

                                <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
                                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                        <SectionHeader
                                            eyebrow="Broker Feed"
                                            title="Diagnostics Feed"
                                            description="Current sync, review, and reconciliation signals coming from the broker lane."
                                            icon={AlertTriangle}
                                            tone={statusTone === 'emerald' ? 'success' : statusTone === 'amber' ? 'warning' : 'danger'}
                                        />
                                        <div className="mt-3 space-y-2">
                                            {summary.diagnostics.length > 0 ? summary.diagnostics.map((item) => (
                                                <div key={item} className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
                                                    <AlertTriangle size={12} className={`${statusTone === 'emerald' ? 'text-emerald-400' : statusTone === 'amber' ? 'text-amber-300' : 'text-rose-300'} mt-0.5`} />
                                                    <span>{item}</span>
                                                </div>
                                            )) : (
                                                <StateSurface
                                                    compact
                                                    tone="success"
                                                    title="All core Dhan broker diagnostics are currently clear."
                                                    icon={CheckCircle2}
                                                />
                                            )}
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                                        <SectionHeader
                                            eyebrow="Freshness"
                                            title="Latest Sync Marks"
                                            description="The most recent broker confirmation points the app can trust."
                                            icon={RefreshCw}
                                            tone="neutral"
                                        />
                                        <div className="mt-3 space-y-3 text-xs">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-slate-400">Trade sync</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-slate-200">{formatSyncTime(summary.lastTradeSyncAt)}</span>
                                                    <FreshnessBadge lastUpdated={summary.lastTradeSyncAt} staleAfterMinutes={15} sourceLabel="trades" />
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-slate-400">Portfolio sync</span>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-slate-200">{formatSyncTime(summary.lastPortfolioSyncAt)}</span>
                                                    <FreshnessBadge lastUpdated={summary.lastPortfolioSyncAt} staleAfterMinutes={15} sourceLabel="holdings" />
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-slate-400">Broker configured</span>
                                                <span className={`font-bold ${summary.configured ? 'text-emerald-400' : 'text-rose-300'}`}>{summary.configured ? 'YES' : 'NO'}</span>
                                            </div>
                                        </div>
                                        {!summary.configured && (
                                            <StateSurface
                                                className="mt-4"
                                                compact
                                                tone="warning"
                                                title="Dhan is running in partial mode."
                                                description="Without broker credentials, diagnostics cannot validate live holdings or sync freshness fully."
                                                icon={AlertTriangle}
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

