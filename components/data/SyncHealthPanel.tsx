import React, { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { AlertTriangle, CheckCircle2, Clock3, Cloud, GitCompareArrows, RefreshCw, Activity, Database, Server, HardDrive, Terminal } from 'lucide-react';
import { db, SyncRecordRow } from '../../database';
import { buildSyncHealthSummary } from '../../services/SyncHealthService';
import { getBackupMarkers } from '../../services/BackupService';
import { MetricTile, SectionHeader, StateSurface } from '../shared/SurfacePrimitives';
import { useBridgeTelemetry } from '../../hooks/useBridgeTelemetry';

const formatTimestamp = (value: string | null): string => {
    if (!value) return 'Never';
    return new Date(value).toLocaleString();
};

const SyncHealthPanel: React.FC = () => {
    const [syncRecords, setSyncRecords] = useState<SyncRecordRow[]>([]);
    const [markers, setMarkers] = useState(getBackupMarkers());
    const { telemetry, isOnline: isBridgeOnline } = useBridgeTelemetry();

    useEffect(() => {
        const sub = liveQuery(() => db.sync_records.toArray()).subscribe({
            next: (value) => setSyncRecords(value || []),
        });

        const onFocus = () => setMarkers(getBackupMarkers());
        window.addEventListener('focus', onFocus);

        return () => {
            sub.unsubscribe();
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    const summary = useMemo(() => buildSyncHealthSummary(syncRecords, markers), [markers, syncRecords]);
    const isHealthy = summary.conflictedRecords === 0 && summary.erroredRecords === 0;
    const statusTone = isHealthy
        ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/20'
        : 'bg-amber-500/10 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/20';

    return (
        <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="border-b border-slate-200/70 bg-gradient-to-r from-sky-50 via-white to-indigo-50 px-5 py-4 dark:border-slate-800 dark:from-sky-950/20 dark:via-slate-900 dark:to-indigo-950/20">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-500 dark:text-sky-300">Trust Layer</p>
                        <h4 className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                            <Cloud size={16} className="text-sky-500" />
                            Sync Health
                        </h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Cloud, restore, and conflict visibility in one place.</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${statusTone}`}>
                        {isHealthy ? 'Stable' : 'Attention'}
                    </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-700">Cloud push/pull</span>
                    <span className="rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-700">Restore preview</span>
                    <span className="rounded-full bg-white/80 px-2.5 py-1 ring-1 ring-slate-200 dark:bg-slate-900/70 dark:ring-slate-700">Conflict drift</span>
                </div>
            </div>

            <div className="p-5">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MetricTile label="Tracked Records" value={summary.trackedPipelines} tone="neutral" />
                    <MetricTile label="Conflicts" value={summary.conflictedRecords} tone={summary.conflictedRecords > 0 ? 'warning' : 'neutral'} />
                    <MetricTile label="Errors" value={summary.erroredRecords} tone={summary.erroredRecords > 0 ? 'danger' : 'neutral'} />
                    <MetricTile label="Stale" value={summary.staleRecords} tone={summary.staleRecords > 0 ? 'warning' : 'neutral'} />
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/90 p-4 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950/50">
                        <SectionHeader
                            eyebrow="Recovery"
                            title="Recovery Points"
                            description="The most recent backup, restore, and cloud recovery checkpoints."
                            icon={CheckCircle2}
                            tone="success"
                        />
                        <div className="mt-2 space-y-2 text-xs">
                            <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-2 text-slate-500"><CheckCircle2 size={12} /> Last Backup</span>
                                <span className="font-medium text-slate-700 dark:text-slate-200">{formatTimestamp(summary.lastBackupAt)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-2 text-slate-500"><RefreshCw size={12} /> Last Restore</span>
                                <span className="font-medium text-slate-700 dark:text-slate-200">{formatTimestamp(summary.lastRestoreAt)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-2 text-slate-500"><Cloud size={12} /> Cloud Push</span>
                                <span className="font-medium text-slate-700 dark:text-slate-200">{formatTimestamp(summary.lastCloudPushAt)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="flex items-center gap-2 text-slate-500"><Clock3 size={12} /> Cloud Pull</span>
                                <span className="font-medium text-slate-700 dark:text-slate-200">{formatTimestamp(summary.lastCloudPullAt)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/90 p-4 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950/50">
                        <SectionHeader
                            eyebrow="Confidence"
                            title="Recent Drift"
                            description="Latest sync records that changed, conflicted, or need trust review."
                            icon={GitCompareArrows}
                            tone={isHealthy ? 'neutral' : 'warning'}
                        />
                        <div className="mt-2 space-y-2">
                            {summary.recentRecords.length > 0 ? summary.recentRecords.map((record) => (
                                <div key={record.id} className="flex items-start justify-between gap-3 text-xs">
                                    <div>
                                        <p className="font-semibold text-slate-800 dark:text-white">{record.entityId}</p>
                                        <p className="text-slate-500">{record.source} {record.scope}</p>
                                    </div>
                                    <span className={`rounded-full px-2 py-1 font-bold uppercase ${record.syncStatus === 'CONFLICT' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300' : record.syncStatus === 'ERROR' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                                        {record.syncStatus}
                                    </span>
                                </div>
                            )) : (
                                <StateSurface
                                    compact
                                    tone="success"
                                    title="No sync drift recorded yet."
                                    description="Recent sync activity has not produced conflict or drift signals."
                                    icon={GitCompareArrows}
                                />
                            )}
                        </div>
                    </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/90 p-4 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950/50">
                    <SectionHeader
                        eyebrow="Python Bridge"
                        title="API Telemetry"
                        description="Live health, performance, and cache stats from the Python market-data bridge."
                        icon={Server}
                        tone={isBridgeOnline ? 'success' : isBridgeOnline === false ? 'danger' : 'neutral'}
                    />
                    {telemetry ? (
                        <div className="mt-4 grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
                            <div className="space-y-1">
                                <span className="text-slate-500 block">Status & Uptime</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                                    <span className={`h-2 w-2 rounded-full ${isBridgeOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                    {isBridgeOnline ? 'Online' : 'Offline'} ({Math.round(telemetry.server.uptime_seconds / 60)}m uptime)
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-slate-500 block">HTTP Requests</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                                    <Activity size={12} className="text-sky-500" />
                                    {telemetry.http.total_requests} calls
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-slate-500 block">SQLite Cache & Disk</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                                    <Database size={12} className="text-indigo-500" />
                                    {telemetry.storage.cache_db_size_mb} MB ({telemetry.storage.disk.used_percent}% disk used)
                                </span>
                            </div>
                            <div className="space-y-1">
                                <span className="text-slate-500 block">Websocket Feed</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1">
                                    <Terminal size={12} className="text-amber-500" />
                                    {telemetry.websocket.status} ({telemetry.websocket.ping_time_ms}ms)
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="mt-2 text-xs text-slate-500">
                            {isBridgeOnline === false ? 'Python API Bridge is offline.' : 'Loading bridge telemetry...'}
                        </div>
                    )}
                </div>

                {!isHealthy && (
                    <StateSurface
                        className="mt-4"
                        compact
                        tone="warning"
                        title="Sync needs attention."
                        description="Conflicts or sync errors have been detected recently. Review restore previews before replacing local data, and use Dhan diagnostics if broker records are involved."
                        icon={AlertTriangle}
                    />
                )}
            </div>
        </div>
    );
};

export default SyncHealthPanel;
