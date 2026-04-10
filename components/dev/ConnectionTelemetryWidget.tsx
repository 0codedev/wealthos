/**
 * CC28: ConnectionTelemetryWidget
 * ================================
 *
 * Premium "Bloomberg terminal" telemetry panel that surfaces the live
 * status of the Python bridge, the Upstox HTTP client, the WebSocket
 * stream, and the cache hit ratio. Designed to be opened from a
 * "System Pulse" indicator in the header bar and rendered as a
 * glassmorphic modal.
 *
 * All metrics are fetched via the new `/api/telemetry/health`
 * endpoint that aggregates the BridgeErrorMiddleware stats, the
 * sliding-window rate limiter, the multicaster, and the Stealth NSE
 * scraper counters.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X, Activity, Wifi, Database, Cpu, HardDrive, Server,
    TrendingUp, AlertTriangle, CheckCircle2, RefreshCw, Trash2, Zap,
} from 'lucide-react';
import { logger } from '../../services/Logger';
import { useToast } from '../shared/ToastProvider';

interface BridgeHealth {
    status: string;
    timestamp?: string;
    server?: { uptime_seconds?: number; fastapi_version?: string };
    database?: {
        active_connections: number;
        peak_connections: number;
        row_counts?: Record<string, number>;
    };
    websocket?: {
        status: string;
        ping_time_ms: number;
        active_sse_listeners: number;
        subscribed_keys_count: number;
    };
    http?: {
        total_requests: number;
        status_distribution: Record<string, number>;
    };
    storage?: {
        cache_db_size_mb: number;
        parquet_archive_size_mb: number;
        disk: { total_gb: number; free_gb: number; used_percent: number };
    };
}

interface ResilienceSnapshot {
    rate_limiter: {
        current_window_size: number;
        max_requests: number;
        throttled_calls: number;
        rejected_calls: number;
        total_calls: number;
        last_throttle_ms: number;
    };
    token_monitor: {
        interactive_seconds_remaining: number | null;
        analytics_seconds_remaining: number | null;
        refresh_needed: boolean;
    };
}

interface NseStealthStats {
    requests: number;
    successes: number;
    failures: number;
    success_rate: number;
    ua_rotations: number;
    session_resets: number;
    fallback_cache_hits: number;
    blocked_streak: number;
    latency_history: number[];
}

interface TelemetryBundle {
    bridge: BridgeHealth | null;
    resilience: ResilienceSnapshot | null;
    nse: NseStealthStats | null;
}

const REFRESH_INTERVAL_MS = 4000;

const StatusDot: React.FC<{ state: 'green' | 'yellow' | 'red' | 'unknown' }> = ({ state }) => {
    const colors = {
        green: 'bg-emerald-500 shadow-emerald-500/50',
        yellow: 'bg-amber-500 shadow-amber-500/50',
        red: 'bg-rose-500 shadow-rose-500/50',
        unknown: 'bg-slate-500 shadow-slate-500/30',
    };
    return (
        <span
            className={`inline-block w-2.5 h-2.5 rounded-full shadow-[0_0_8px] ${colors[state]} ${
                state === 'green' ? 'animate-pulse' : ''
            }`}
        />
    );
};

const Sparkline: React.FC<{ data: number[]; height?: number; stroke?: string }> = ({
    data,
    height = 28,
    stroke = '#10b981',
}) => {
    if (!data || data.length === 0) {
        return <div style={{ height }} className="text-[10px] text-slate-500">— no data —</div>;
    }
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = Math.max(max - min, 1);
    const width = 100;
    const step = data.length > 1 ? width / (data.length - 1) : width;
    const points = data.map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`).join(' ');

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ height }}
        >
            <polyline
                points={points}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};

const StatCard: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    accent?: 'green' | 'yellow' | 'red' | 'blue';
}> = ({ icon, label, value, sub, accent = 'blue' }) => {
    const accentMap: Record<string, string> = {
        green: 'text-emerald-400',
        yellow: 'text-amber-400',
        red: 'text-rose-400',
        blue: 'text-indigo-400',
    };
    return (
        <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 backdrop-blur-xl p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between text-slate-400">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em]">
                    {icon}
                    <span>{label}</span>
                </div>
            </div>
            <div className={`text-2xl font-mono font-bold ${accentMap[accent]}`}>{value}</div>
            {sub && <div className="text-[11px] text-slate-500 leading-snug">{sub}</div>}
        </div>
    );
};

export const ConnectionTelemetryWidget: React.FC<{ open: boolean; onClose: () => void }> = ({
    open,
    onClose,
}) => {
    const [data, setData] = useState<TelemetryBundle>({ bridge: null, resilience: null, nse: null });
    const [loading, setLoading] = useState(false);
    const [lastFetchedAt, setLastFetchedAt] = useState<number>(0);
    const { toast } = useToast();

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [bridgeRes, resilienceRes, nseRes] = await Promise.allSettled([
                fetch('/api/python-nse/api/telemetry/health').then((r) => (r.ok ? r.json() : null)),
                fetch('/api/python-nse/api/telemetry/resilience').then((r) => (r.ok ? r.json() : null)),
                fetch('/api/python-nse/api/telemetry/nse-stealth').then((r) => (r.ok ? r.json() : null)),
            ]);
            setData({
                bridge: bridgeRes.status === 'fulfilled' ? bridgeRes.value : null,
                resilience: resilienceRes.status === 'fulfilled' ? resilienceRes.value : null,
                nse: nseRes.status === 'fulfilled' ? nseRes.value : null,
            });
            setLastFetchedAt(Date.now());
        } catch (err) {
            logger.warn('[TelemetryWidget] Refresh failed', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        fetchAll();
        const id = window.setInterval(fetchAll, REFRESH_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, [open, fetchAll]);

    const handleFlushCache = async () => {
        try {
            const res = await fetch('/api/python-nse/api/upstox/cache/clear', { method: 'POST' });
            if (res.ok) {
                toast.success('Upstox cache flushed');
                fetchAll();
            } else {
                toast.error('Cache flush failed');
            }
        } catch (err) {
            toast.error('Cache flush failed');
            logger.warn('[TelemetryWidget] Cache flush failed', err);
        }
    };

    const bridgeState = useMemo<'green' | 'yellow' | 'red' | 'unknown'>(() => {
        if (!data.bridge) return 'unknown';
        if (data.bridge.websocket?.status === 'connected' && data.bridge.database?.active_connections! < 20) {
            return 'green';
        }
        if (data.bridge.websocket?.status === 'disconnected') return 'red';
        return 'yellow';
    }, [data.bridge]);

    const overallStatus = useMemo(() => {
        if (!data.bridge && !data.resilience) return 'unknown';
        if (bridgeState === 'red') return 'degraded';
        if (bridgeState === 'yellow') return 'standby';
        return 'optimal';
    }, [bridgeState, data.bridge, data.resilience]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.92, y: 20, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.92, y: 20, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-800/80 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 shadow-2xl shadow-indigo-900/30"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur-xl">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-900/50">
                                    <Activity className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-slate-100 tracking-wide">Connection Telemetry</h2>
                                    <p className="text-[11px] text-slate-500 font-mono uppercase tracking-widest">
                                        Python bridge · WS · cache · rate-limit
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-[11px] font-mono">
                                    <StatusDot state={bridgeState} />
                                    <span className="uppercase tracking-widest text-slate-300">{overallStatus}</span>
                                </div>
                                <button
                                    onClick={fetchAll}
                                    className="p-2 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 text-slate-300 transition-colors"
                                    title="Refresh"
                                >
                                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                </button>
                                <button
                                    onClick={onClose}
                                    className="p-2 rounded-xl bg-slate-800/70 hover:bg-slate-700/70 text-slate-300 transition-colors"
                                    title="Close"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Row 1: Bridge + WS + DB */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <StatCard
                                    icon={<Server className="w-3.5 h-3.5" />}
                                    label="Bridge"
                                    value={data.bridge?.status ?? '—'}
                                    sub={data.bridge?.server ? `uptime ${formatUptime(data.bridge.server.uptime_seconds || 0)} · fastapi ${data.bridge.server.fastapi_version}` : 'No bridge connection'}
                                    accent={bridgeState === 'green' ? 'green' : bridgeState === 'red' ? 'red' : 'yellow'}
                                />
                                <StatCard
                                    icon={<Wifi className="w-3.5 h-3.5" />}
                                    label="WebSocket"
                                    value={data.bridge?.websocket?.status ?? '—'}
                                    sub={data.bridge?.websocket ? (
                                        <>
                                            ping {data.bridge.websocket.ping_time_ms?.toFixed(0) ?? '—'} ms ·{' '}
                                            {data.bridge.websocket.subscribed_keys_count} keys ·{' '}
                                            {data.bridge.websocket.active_sse_listeners} listeners
                                        </>
                                    ) : '—'}
                                    accent={data.bridge?.websocket?.status === 'connected' ? 'green' : 'red'}
                                />
                                <StatCard
                                    icon={<Database className="w-3.5 h-3.5" />}
                                    label="SQLite"
                                    value={`${data.bridge?.database?.active_connections ?? '—'} / ${data.bridge?.database?.peak_connections ?? '—'}`}
                                    sub={data.bridge?.storage ? `cache ${data.bridge.storage.cache_db_size_mb.toFixed(1)} MB · disk ${data.bridge.storage.disk.used_percent}%` : 'No data'}
                                    accent="blue"
                                />
                            </div>

                            {/* Row 2: Rate limiter + Token monitor + NSE stealth */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 backdrop-blur-xl p-4">
                                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-[0.18em] mb-3">
                                        <span className="flex items-center gap-2"><Zap className="w-3.5 h-3.5" />Rate Limiter</span>
                                        <span>60s window</span>
                                    </div>
                                    {data.resilience ? (
                                        <>
                                            <div className="text-2xl font-mono font-bold text-amber-400">
                                                {data.resilience.rate_limiter.current_window_size}/{data.resilience.rate_limiter.max_requests}
                                            </div>
                                            <div className="text-[11px] text-slate-500 mt-2">
                                                throttled {data.resilience.rate_limiter.throttled_calls} · rejected {data.resilience.rate_limiter.rejected_calls}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-slate-500 text-sm">—</div>
                                    )}
                                </div>
                                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 backdrop-blur-xl p-4">
                                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-[0.18em] mb-3">
                                        <span className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" />Token Monitor</span>
                                        <span>JWT exp</span>
                                    </div>
                                    {data.resilience ? (
                                        <>
                                            <div className={`text-2xl font-mono font-bold ${
                                                data.resilience.token_monitor.refresh_needed ? 'text-rose-400' : 'text-emerald-400'
                                            }`}>
                                                {data.resilience.token_monitor.refresh_needed
                                                    ? 'Refresh Soon'
                                                    : `${formatRemaining(data.resilience.token_monitor.interactive_seconds_remaining)}`}
                                            </div>
                                            <div className="text-[11px] text-slate-500 mt-2">
                                                interactive · analytics {data.resilience.token_monitor.analytics_seconds_remaining
                                                    ? formatRemaining(data.resilience.token_monitor.analytics_seconds_remaining)
                                                    : '—'}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-slate-500 text-sm">—</div>
                                    )}
                                </div>
                                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 backdrop-blur-xl p-4">
                                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-[0.18em] mb-3">
                                        <span className="flex items-center gap-2"><HardDrive className="w-3.5 h-3.5" />NSE Stealth</span>
                                        <span>{data.nse ? `${data.nse.success_rate.toFixed(0)}% OK` : '—'}</span>
                                    </div>
                                    {data.nse ? (
                                        <>
                                            <div className="text-2xl font-mono font-bold text-indigo-300">
                                                {data.nse.requests}
                                            </div>
                                            <div className="text-[11px] text-slate-500 mt-2">
                                                {data.nse.successes} ok · {data.nse.failures} fail · {data.nse.ua_rotations} UA rot · {data.nse.session_resets} reset
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-slate-500 text-sm">—</div>
                                    )}
                                </div>
                            </div>

                            {/* Row 3: NSE stealth sparkline + HTTP distribution */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 backdrop-blur-xl p-4">
                                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-[0.18em] mb-3">
                                        <span className="flex items-center gap-2"><TrendingUp className="w-3.5 h-3.5" />NSE Latency (ms)</span>
                                        <span>{data.nse ? `${data.nse.latency_history.length} samples` : '—'}</span>
                                    </div>
                                    <Sparkline
                                        data={data.nse?.latency_history ?? []}
                                        stroke={data.nse && data.nse.blocked_streak > 0 ? '#f43f5e' : '#6366f1'}
                                    />
                                </div>
                                <div className="rounded-2xl border border-slate-800/70 bg-slate-900/40 backdrop-blur-xl p-4">
                                    <div className="flex items-center justify-between text-slate-400 text-[10px] font-bold uppercase tracking-[0.18em] mb-3">
                                        <span className="flex items-center gap-2"><Cpu className="w-3.5 h-3.5" />HTTP Distribution</span>
                                        <span>last {data.bridge?.http?.total_requests ?? 0} reqs</span>
                                    </div>
                                    {data.bridge?.http?.status_distribution ? (
                                        <div className="flex items-end gap-1 h-12">
                                            {Object.entries(data.bridge.http.status_distribution).map(([bucket, count]) => {
                                                const total = Object.values(data.bridge!.http!.status_distribution).reduce((a, b) => a + b, 0) || 1;
                                                const pct = (count / total) * 100;
                                                const colour = bucket.startsWith('2') ? '#10b981' : bucket.startsWith('3') ? '#0ea5e9' : bucket.startsWith('4') ? '#f59e0b' : bucket.startsWith('5') ? '#f43f5e' : '#94a3b8';
                                                return (
                                                    <div key={bucket} className="flex-1 flex flex-col items-center gap-1">
                                                        <div
                                                            className="w-full rounded-t"
                                                            style={{ height: `${Math.max(pct, 2)}%`, backgroundColor: colour }}
                                                            title={`${bucket}: ${count}`}
                                                        />
                                                        <span className="text-[9px] text-slate-500 font-mono">{bucket}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-slate-500 text-sm">—</div>
                                    )}
                                </div>
                            </div>

                            {/* Row 4: Actions + last refresh */}
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                                    {data.bridge?.timestamp ? (
                                        <>last sync {new Date(data.bridge.timestamp).toLocaleTimeString()}</>
                                    ) : (
                                        <>no telemetry yet</>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleFlushCache}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 text-rose-300 border border-rose-500/30 text-xs font-semibold hover:bg-rose-500/25 transition-colors"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" /> Flush Upstox cache
                                    </button>
                                    <button
                                        onClick={fetchAll}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-xs font-semibold hover:bg-indigo-500/25 transition-colors"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" /> Force refresh
                                    </button>
                                </div>
                            </div>

                            {data.nse && data.nse.blocked_streak >= 3 && (
                                <div className="flex items-start gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200 text-xs">
                                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                                    <div>
                                        <div className="font-semibold">NSE upstream appears blocked.</div>
                                        <div className="text-rose-300/80 mt-1">
                                            The stealth scraper has been refused {data.nse.blocked_streak} times in a row. The dashboard is serving the last-known-good cache.
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
}

function formatRemaining(secs: number | null): string {
    if (secs === null || secs === undefined) return '—';
    if (secs <= 0) return 'expired';
    if (secs < 60) return `${Math.floor(secs)}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}
