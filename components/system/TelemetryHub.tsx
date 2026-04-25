import React, { useState, useEffect, useRef } from 'react';
import { 
    Activity, Cpu, Shield, Clock, Terminal, HardDrive, 
    RefreshCw, Search, ArrowLeft, Download, ShieldCheck, 
    AlertTriangle, CheckCircle2, XCircle, Database, Play, Square, FileText 
} from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import ServerControlPanel from '../settings/ServerControlPanel';

interface SystemStats {
    cpu_percent: number;
    ram: {
        total_mb: number;
        used_mb: number;
        free_mb: number;
        percent: number;
    };
    swap: {
        total_mb: number;
        used_mb: number;
        percent: number;
    };
    threads_active: number;
}

interface ProcessStats {
    pid: number;
    fds: number;
    threads: number;
    memory_rss_mb: number;
}

interface StorageStats {
    cache_db_size_mb: number;
    parquet_archive_size_mb: number;
    disk: {
        total_gb: number;
        free_gb: number;
        used_percent: number;
    };
}

interface TelemetryPayload {
    status: string;
    timestamp: string;
    server: {
        uptime_seconds: number;
        fastapi_version: string;
    };
    system?: SystemStats;
    process?: ProcessStats;
    http?: {
        total_requests: number;
        status_distribution: Record<string, number>;
        latencies: Record<string, {
            calls: number;
            avg_ms: number;
            p50_ms: number;
            p90_ms: number;
            p99_ms: number;
        }>;
    };
    database: {
        active_connections: number;
        peak_connections: number;
        row_counts: Record<string, number>;
    };
    websocket: {
        status: string;
        ping_time_ms: number;
        active_sse_listeners: number;
        subscribed_keys_count: number;
    };
    storage: StorageStats;
}

interface TrafficLog {
    timestamp: string;
    client_ip: string;
    method: string;
    path: string;
    status_code: number;
    duration_ms: number;
}

interface SecurityLog {
    timestamp: string;
    event_type: string;
    message: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    client_ip: string;
}

export const TelemetryHub: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'health' | 'traffic' | 'latency' | 'security' | 'console'>('health');
    const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);
    const [trafficLogs, setTrafficLogs] = useState<TrafficLog[]>([]);
    const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { toast } = useToast();

    // Console State
    const [consoleService, setConsoleService] = useState<string>('wealthos-api');
    const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
    const [isLoadingConsole, setIsLoadingConsole] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const consoleEndRef = useRef<HTMLDivElement | null>(null);

    const fetchTelemetry = async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const response = await fetch('/api/python-nse/api/telemetry');
            if (response.ok) {
                const data = await response.json();
                setTelemetry(data);
            }
        } catch (err) {
            console.error('Failed to fetch system telemetry:', err);
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    const fetchTrafficLogs = async () => {
        try {
            const response = await fetch('/api/python-nse/api/telemetry/traffic/logs');
            if (response.ok) {
                const data = await response.json();
                setTrafficLogs(data);
            }
        } catch (err) {
            console.error('Failed to fetch traffic logs:', err);
        }
    };

    const fetchSecurityLogs = async () => {
        try {
            const response = await fetch('/api/python-nse/api/telemetry/security/logs');
            if (response.ok) {
                const data = await response.json();
                setSecurityLogs(data);
            }
        } catch (err) {
            console.error('Failed to fetch security logs:', err);
        }
    };

    const fetchConsoleLogs = async (service: string) => {
        setIsLoadingConsole(true);
        try {
            const response = await fetch(`/api/python-nse/api/services/${service}/logs`);
            if (response.ok) {
                const data = await response.json();
                setConsoleLogs(data.logs || []);
            }
        } catch (err) {
            console.error('Failed to fetch console logs:', err);
        } finally {
            setIsLoadingConsole(false);
        }
    };

    const loadAllData = async (silent = false) => {
        setIsRefreshing(true);
        await Promise.all([
            fetchTelemetry(silent),
            fetchTrafficLogs(),
            fetchSecurityLogs(),
            fetchConsoleLogs(consoleService)
        ]);
        setIsRefreshing(false);
    };

    useEffect(() => {
        loadAllData();
        const interval = setInterval(() => {
            fetchTelemetry(true);
            fetchTrafficLogs();
            fetchSecurityLogs();
        }, 10000); // Polling every 10 seconds
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        fetchConsoleLogs(consoleService);
    }, [consoleService]);

    useEffect(() => {
        if (autoScroll && consoleEndRef.current) {
            consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [consoleLogs, autoScroll]);

    const formatUptime = (seconds: number) => {
        const d = Math.floor(seconds / (24 * 3600));
        const h = Math.floor((seconds % (24 * 3600)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}d ${h}h ${m}m`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    if (isLoading || !telemetry) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <RefreshCw className="animate-spin text-indigo-500 mb-3" size={24} />
                <span className="text-xs font-black uppercase tracking-widest text-slate-400">Loading Telemetry Suite...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Navigation Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                        <Activity className="text-indigo-500" size={20} /> System Diagnostics & Health Hub
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Uptime: {formatUptime(telemetry.server.uptime_seconds)} | FastAPI v{telemetry.server.fastapi_version}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => loadAllData(true)}
                        disabled={isRefreshing}
                        className="flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200 transition-all"
                    >
                        <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Tabs List */}
            <div className="flex overflow-x-auto gap-2 border-b border-slate-100 dark:border-slate-800 pb-1">
                <button
                    onClick={() => setActiveTab('health')}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                        activeTab === 'health' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-700'
                    }`}
                >
                    <Cpu size={14} /> System Health
                </button>
                <button
                    onClick={() => setActiveTab('traffic')}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                        activeTab === 'traffic' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-700'
                    }`}
                >
                    <Activity size={14} /> Traffic Monitor
                </button>
                <button
                    onClick={() => setActiveTab('latency')}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                        activeTab === 'latency' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-700'
                    }`}
                >
                    <Clock size={14} /> Latency
                </button>
                <button
                    onClick={() => setActiveTab('security')}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                        activeTab === 'security' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-700'
                    }`}
                >
                    <Shield size={14} /> Security
                </button>
                <button
                    onClick={() => setActiveTab('console')}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                        activeTab === 'console' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-700'
                    }`}
                >
                    <Terminal size={14} /> Live Console
                </button>
            </div>

            {/* TAB CONTENTS */}
            <div className="mt-4">
                {/* 1. HEALTH TAB */}
                {activeTab === 'health' && (
                    <div className="space-y-6">
                        {/* Resource Gauges */}
                        {telemetry.system && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">System CPU Load</p>
                                        <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{telemetry.system.cpu_percent}%</p>
                                    </div>
                                    <div className="relative h-12 w-12 flex items-center justify-center">
                                        <div className="absolute inset-0 rounded-full border-4 border-slate-100 dark:border-slate-800"></div>
                                        <svg className="w-12 h-12 transform -rotate-90">
                                            <circle 
                                                cx="24" cy="24" r="20" 
                                                stroke={telemetry.system.cpu_percent > 80 ? "#f43f5e" : telemetry.system.cpu_percent > 55 ? "#eab308" : "#10b981"}
                                                strokeWidth="4" fill="transparent" 
                                                strokeDasharray="125" 
                                                strokeDashoffset={125 - (125 * telemetry.system.cpu_percent) / 100}
                                            />
                                        </svg>
                                    </div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Virtual Memory</p>
                                        <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{telemetry.system.ram.percent}%</p>
                                        <p className="text-[10px] text-slate-400 mt-1">Used: {Math.round(telemetry.system.ram.used_mb)}MB / {Math.round(telemetry.system.ram.total_mb)}MB</p>
                                    </div>
                                    <div className="relative h-12 w-12 flex items-center justify-center">
                                        <div className="absolute inset-0 rounded-full border-4 border-slate-100 dark:border-slate-800"></div>
                                        <svg className="w-12 h-12 transform -rotate-90">
                                            <circle 
                                                cx="24" cy="24" r="20" 
                                                stroke={telemetry.system.ram.percent > 85 ? "#f43f5e" : telemetry.system.ram.percent > 70 ? "#eab308" : "#10b981"}
                                                strokeWidth="4" fill="transparent" 
                                                strokeDasharray="125" 
                                                strokeDashoffset={125 - (125 * telemetry.system.ram.percent) / 100}
                                            />
                                        </svg>
                                    </div>
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Database Connection</p>
                                        <p className="mt-2 text-2xl font-black text-emerald-500">Active</p>
                                        <p className="text-[10px] text-slate-400 mt-1">Pool: {telemetry.database.active_connections} active / {telemetry.database.peak_connections} peak</p>
                                    </div>
                                    <Database className="h-8 w-8 text-emerald-500/20" />
                                </div>
                                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cloud Storage Remaining</p>
                                        <p className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{(100 - telemetry.storage.disk.used_percent).toFixed(1)}%</p>
                                        <p className="text-[10px] text-slate-400 mt-1">Free: {telemetry.storage.disk.free_gb}GB / {telemetry.storage.disk.total_gb}GB</p>
                                    </div>
                                    <HardDrive className="h-8 w-8 text-indigo-500/20" />
                                </div>
                            </div>
                        )}

                        {/* Process details */}
                        {telemetry.process && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-slate-100 dark:border-slate-800 pb-6">
                                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl shadow-sm">
                                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Terminal size={12} /> FastAPI Engine Handle</h4>
                                    <div className="mt-3 flex items-center justify-between text-xs font-mono">
                                        <span className="text-slate-500">PID: {telemetry.process.pid}</span>
                                        <span className="text-slate-500">Threads: {telemetry.process.threads}</span>
                                        <span className="text-slate-500">Handles: {telemetry.process.fds}</span>
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl shadow-sm">
                                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Database size={12} /> Cache Storage Footprint</h4>
                                    <div className="mt-3 flex items-center justify-between text-xs font-mono">
                                        <span className="text-slate-500">SQLite DB: {telemetry.storage.cache_db_size_mb} MB</span>
                                        <span className="text-slate-500">Parquet: {telemetry.storage.parquet_archive_size_mb} MB</span>
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl shadow-sm">
                                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5"><Activity size={12} /> Upstox WebSocket Stream</h4>
                                    <div className="mt-3 flex items-center justify-between text-xs font-mono">
                                        <span className="text-slate-500">Status: {telemetry.websocket.status}</span>
                                        <span className="text-slate-500">Ping: {telemetry.websocket.ping_time_ms} ms</span>
                                        <span className="text-slate-500">Keys: {telemetry.websocket.subscribed_keys_count}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* PM2 Service Controller */}
                        <ServerControlPanel />
                    </div>
                )}

                {/* 2. TRAFFIC MONITOR TAB */}
                {activeTab === 'traffic' && (
                    <div className="space-y-6">
                        {/* Traffic Overview Header */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                                <p className="text-3xl font-black text-indigo-500">{telemetry.http?.total_requests || 0}</p>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Total API Requests</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                                <p className="text-3xl font-black text-rose-500">{telemetry.http?.status_distribution['exceptions'] || 0}</p>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Exceptions Logged</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                                <p className="text-3xl font-black text-slate-900 dark:text-white">
                                    {Object.values(telemetry.http?.status_distribution || {}).reduce((a, b) => a + b, 0)}
                                </p>
                                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mt-1">Total Routing Hits</p>
                            </div>
                        </div>

                        {/* Recent HTTP Logs */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                            <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Chronological HTTP Traffic Logs</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs min-w-[500px]">
                                    <thead>
                                        <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400 pb-2">
                                            <th className="pb-2">Timestamp</th>
                                            <th className="pb-2">Method</th>
                                            <th className="pb-2">Path</th>
                                            <th className="pb-2">Status</th>
                                            <th className="pb-2">Latency</th>
                                            <th className="pb-2 pr-2 text-right">Client IP</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                        {trafficLogs.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="text-center py-8 text-slate-400 italic">No traffic registered.</td>
                                            </tr>
                                        ) : (
                                            trafficLogs.map((log, index) => (
                                                <tr key={index} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10">
                                                    <td className="py-2.5 font-mono text-[10px] text-slate-400">{new Date(log.timestamp).toLocaleTimeString('en-IN')}</td>
                                                    <td className="py-2.5">
                                                        <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                                                            log.method === 'GET' ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'
                                                        }`}>
                                                            {log.method}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 font-mono text-[10px] text-slate-600 dark:text-slate-350">{log.path}</td>
                                                    <td className="py-2.5">
                                                        <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-black ${
                                                            log.status_code < 300 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
                                                        }`}>
                                                            {log.status_code}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 font-mono text-[10px] text-slate-500">{log.duration_ms.toFixed(1)} ms</td>
                                                    <td className="py-2.5 font-mono text-[10px] text-slate-400 text-right pr-2">{log.client_ip}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* 3. LATENCY MONITOR TAB */}
                {activeTab === 'latency' && (
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                            <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Route Average Response Latencies</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs min-w-[600px]">
                                    <thead>
                                        <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400 pb-2">
                                            <th className="pb-2">FastAPI Route Endpoint</th>
                                            <th className="pb-2">Total Hits</th>
                                            <th className="pb-2">Average (RTT)</th>
                                            <th className="pb-2">Median (P50)</th>
                                            <th className="pb-2">Elevated (P90)</th>
                                            <th className="pb-2 pr-2 text-right">Tail Spike (P99)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                        {!telemetry.http || Object.keys(telemetry.http.latencies).length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="text-center py-8 text-slate-400 italic">No latency statistics gathered.</td>
                                            </tr>
                                        ) : (
                                            Object.entries(telemetry.http.latencies).map(([route, stats]) => (
                                                <tr key={route} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10">
                                                    <td className="py-3 font-mono text-[10px] text-slate-700 dark:text-slate-300">{route}</td>
                                                    <td className="py-3 font-mono text-[10px] text-slate-500">{stats.calls}</td>
                                                    <td className="py-3 font-mono text-[10px] text-slate-500">{stats.avg_ms.toFixed(1)} ms</td>
                                                    <td className="py-3 font-mono text-[10px] text-emerald-500">{stats.p50_ms.toFixed(1)} ms</td>
                                                    <td className="py-3 font-mono text-[10px] text-amber-500">{stats.p90_ms.toFixed(1)} ms</td>
                                                    <td className="py-3 font-mono text-[10px] text-rose-500 text-right pr-2">{stats.p99_ms.toFixed(1)} ms</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* 4. SECURITY LOGS TAB */}
                {activeTab === 'security' && (
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                            <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Security, Auth & Compliance Logs</h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs min-w-[500px]">
                                    <thead>
                                        <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400 pb-2">
                                            <th className="pb-2">Timestamp</th>
                                            <th className="pb-2">Event</th>
                                            <th className="pb-2">Severity</th>
                                            <th className="pb-2">Details Message</th>
                                            <th className="pb-2 pr-2 text-right">Client IP</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                        {securityLogs.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="text-center py-8 text-slate-400 italic">No security events triggered.</td>
                                            </tr>
                                        ) : (
                                            securityLogs.map((log, index) => (
                                                <tr key={index} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10">
                                                    <td className="py-3 font-mono text-[10px] text-slate-400">{new Date(log.timestamp).toLocaleTimeString('en-IN')}</td>
                                                    <td className="py-3">
                                                        <span className="font-bold text-slate-700 dark:text-slate-350">{log.event_type}</span>
                                                    </td>
                                                    <td className="py-3">
                                                        <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                                                            log.severity === 'CRITICAL' ? 'bg-rose-500/10 text-rose-500' :
                                                            log.severity === 'WARNING' ? 'bg-amber-500/10 text-amber-500' :
                                                            'bg-emerald-500/10 text-emerald-500'
                                                        }`}>
                                                            {log.severity}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 text-slate-500 dark:text-slate-400">{log.message}</td>
                                                    <td className="py-3 font-mono text-[10px] text-slate-400 text-right pr-2">{log.client_ip}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* 5. LIVE LOGS TAB */}
                {activeTab === 'console' && (
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <label className="text-xs font-black uppercase tracking-wider text-slate-400">Select Daemon:</label>
                                <select
                                    value={consoleService}
                                    onChange={(e) => setConsoleService(e.target.value)}
                                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold rounded-xl px-3 py-1.5 outline-none text-slate-800 dark:text-white"
                                >
                                    <option value="wealthos-api">FastAPI Bridge</option>
                                    <option value="wealthos-openalgo">OpenAlgo Strategy Server</option>
                                    <option value="wealthos-telegram">Telegram Ear</option>
                                    <option value="wealthos-dhan">Dhan Bridge</option>
                                    <option value="wealthos-webhook">Webhook Receiver</option>
                                    <option value="wealthos-email">Email Signal Listener</option>
                                    <option value="wealthos-tunnel">Cloudflare Tunnel</option>
                                </select>
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={autoScroll} 
                                        onChange={(e) => setAutoScroll(e.target.checked)} 
                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Auto Scroll
                                </label>
                                <button
                                    onClick={() => fetchConsoleLogs(consoleService)}
                                    disabled={isLoadingConsole}
                                    className="flex items-center gap-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-3 py-1.5 text-xs font-bold transition-all text-slate-800 dark:text-white"
                                >
                                    <RefreshCw size={12} className={isLoadingConsole ? 'animate-spin' : ''} />
                                    Fetch Logs
                                </button>
                            </div>
                        </div>

                        {/* Terminal Window */}
                        <div className="bg-slate-950 text-slate-300 font-mono text-[10px] p-6 rounded-3xl overflow-y-auto h-[450px] border border-slate-800/80 leading-relaxed shadow-2xl relative shadow-inner">
                            <div className="absolute top-2 right-4 flex items-center gap-1 text-[9px] font-black uppercase text-slate-600 tracking-wider">
                                <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping"></span> Live console session
                            </div>
                            {isLoadingConsole ? (
                                <div className="flex flex-col items-center justify-center h-full gap-2">
                                    <RefreshCw className="animate-spin text-slate-600" size={16} />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Reading logs from disk...</span>
                                </div>
                            ) : consoleLogs.length === 0 ? (
                                <div className="text-slate-600 italic py-8 text-center">No logs generated yet.</div>
                            ) : (
                                consoleLogs.map((line, idx) => (
                                    <div key={idx} className="whitespace-pre-wrap hover:bg-slate-900/50 px-1 py-0.5 rounded leading-relaxed border-l-2 border-transparent hover:border-indigo-500/20">
                                        <span className="text-slate-600 select-none mr-3 inline-block w-6 text-right">{(idx + 1).toString().padStart(2, '0')}</span>
                                        {line}
                                    </div>
                                ))
                            )}
                            <div ref={consoleEndRef} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TelemetryHub;
