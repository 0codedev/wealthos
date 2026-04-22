import React, { useState, useEffect } from 'react';
import { RefreshCw, Play, Square, FileText, Terminal, Cpu, HardDrive, CheckCircle2, XCircle, AlertCircle, Server } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

interface PM2Service {
    name: string;
    displayName: string;
    status: 'online' | 'offline' | 'launching';
    pm2Status: string;
    pid: number;
    uptime: number;
    restarts: number;
    memory: number; // in bytes
    cpu: number;
}

export const ServerControlPanel: React.FC = () => {
    const [services, setServices] = useState<PM2Service[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [activeLogs, setActiveLogs] = useState<{ name: string; displayName: string; logs: string[] } | null>(null);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);
    const [actionInProgress, setActionInProgress] = useState<string | null>(null);
    const { toast } = useToast();

    const fetchStatus = async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const response = await fetch('/api/python-nse/api/services/status');
            if (response.ok) {
                const data = await response.json();
                setServices(data);
            } else {
                if (!silent) toast.error('Failed to retrieve server status.');
            }
        } catch (err: any) {
            console.error('Error fetching service status:', err);
            if (!silent) toast.error('FastAPI Bridge is offline or unreachable.');
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(() => fetchStatus(true), 15000); // Auto-refresh status silently every 15s
        return () => clearInterval(interval);
    }, []);

    const handleServiceAction = async (name: string, action: 'restart' | 'stop') => {
        setActionInProgress(name);
        try {
            const response = await fetch(`/api/python-nse/api/services/${name}/${action}`, {
                method: 'POST',
            });
            const data = await response.json();
            if (response.ok && data.success) {
                toast.success(`Service ${name} ${action}ed successfully.`);
                // Refresh status after action
                setTimeout(() => fetchStatus(true), 1500);
            } else {
                toast.error(data.detail || `Failed to ${action} service ${name}.`);
            }
        } catch (err: any) {
            toast.error(`Network error: Failed to contact FastAPI bridge.`);
        } finally {
            setActionInProgress(null);
        }
    };

    const handleFetchLogs = async (name: string, displayName: string) => {
        setIsLoadingLogs(true);
        try {
            const response = await fetch(`/api/python-nse/api/services/${name}/logs`);
            if (response.ok) {
                const data = await response.json();
                setActiveLogs({
                    name,
                    displayName,
                    logs: data.logs || [],
                });
            } else {
                toast.error(`Failed to load logs for ${name}`);
            }
        } catch (err) {
            toast.error(`Network error loading logs`);
        } finally {
            setIsLoadingLogs(false);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    };

    const formatUptime = (rawVal: number) => {
        if (!rawVal || rawVal === 0) return '—';
        // PM2 pm_uptime is an absolute start timestamp in ms (e.g. 1723653410000)
        const elapsedMs = rawVal > 1000000000000 ? Math.max(0, Date.now() - rawVal) : rawVal;
        const seconds = Math.floor(elapsedMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
    };

    return (
        <div className="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500 dark:text-indigo-300">
                        <Server size={12} /> Infrastructure Manager
                    </p>
                    <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Cloud Daemon Process Control</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Monitor health, CPU, RAM, and restarts for always-on PM2 processes running on your VM.
                    </p>
                </div>
                <button
                    onClick={() => fetchStatus()}
                    disabled={isLoading}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white px-4 py-2.5 text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                >
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    Refresh Stats
                </button>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[600px]">
                    <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400 pb-2">
                            <th className="pb-2 pl-2">Service</th>
                            <th className="pb-2">Status</th>
                            <th className="pb-2">Uptime</th>
                            <th className="pb-2">CPU</th>
                            <th className="pb-2">Memory</th>
                            <th className="pb-2">Restarts</th>
                            <th className="pb-2 pr-2 text-right">Operations</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                        {services.map((svc) => {
                            const isOnline = svc.status === 'online';
                            const isLaunching = svc.status === 'launching';
                            const isWarning = svc.restarts > svc.uptime / 3600000 && svc.restarts > 0; // high restart rate

                            return (
                                <tr key={svc.name} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors">
                                    <td className="py-3.5 pl-2">
                                        <div className="font-bold text-slate-800 dark:text-slate-200">{svc.displayName}</div>
                                        <div className="text-[9px] text-slate-400 font-mono mt-0.5">{svc.name} {svc.pid > 0 && `(PID: ${svc.pid})`}</div>
                                    </td>
                                    <td className="py-3.5">
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                                            isOnline ? (isWarning ? 'bg-amber-500/15 text-amber-500' : 'bg-emerald-500/15 text-emerald-500') :
                                            isLaunching ? 'bg-indigo-500/15 text-indigo-500 animate-pulse' :
                                            'bg-rose-500/15 text-rose-500'
                                        }`}>
                                            {isOnline ? (isWarning ? '⚠️ Unstable' : '🟢 Active') :
                                             isLaunching ? '⚡ Booting' : '🔴 Offline'}
                                        </span>
                                    </td>
                                    <td className="py-3.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                        {formatUptime(svc.uptime)}
                                    </td>
                                    <td className="py-3.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                        {svc.pid > 0 ? `${svc.cpu}%` : '—'}
                                    </td>
                                    <td className="py-3.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                                        {svc.pid > 0 ? formatBytes(svc.memory) : '—'}
                                    </td>
                                    <td className="py-3.5 font-mono text-[10px]">
                                        <span className={svc.restarts > 5 ? "text-rose-500 font-bold" : svc.restarts > 0 ? "text-amber-500" : "text-slate-400"}>
                                            {svc.restarts}
                                        </span>
                                    </td>
                                    <td className="py-3.5 pr-2 text-right">
                                        <div className="flex items-center justify-end gap-1.5">
                                            <button
                                                onClick={() => handleFetchLogs(svc.name, svc.displayName)}
                                                className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-400 hover:text-indigo-500 transition-colors"
                                                title="View Service Logs"
                                            >
                                                <FileText size={13} />
                                            </button>
                                            <button
                                                disabled={actionInProgress !== null}
                                                onClick={() => handleServiceAction(svc.name, 'restart')}
                                                className="p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 dark:text-indigo-400 transition-colors disabled:opacity-30"
                                                title="Restart Service"
                                            >
                                                <RefreshCw size={13} className={actionInProgress === svc.name ? 'animate-spin' : ''} />
                                            </button>
                                            {isOnline ? (
                                                <button
                                                    disabled={actionInProgress !== null}
                                                    onClick={() => handleServiceAction(svc.name, 'stop')}
                                                    className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 transition-colors disabled:opacity-30"
                                                    title="Stop Service"
                                                >
                                                    <Square size={13} />
                                                </button>
                                            ) : (
                                                <button
                                                    disabled={actionInProgress !== null}
                                                    onClick={() => handleServiceAction(svc.name, 'restart')}
                                                    className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 transition-colors disabled:opacity-30"
                                                    title="Start Service"
                                                >
                                                    <Play size={13} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Logs Console Container */}
            {activeLogs && (
                <div className="mt-8 border-t border-slate-100 dark:border-slate-800 pt-6 animate-fade-in">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-xs font-black uppercase text-indigo-500">
                            <Terminal size={14} /> Console Logs: {activeLogs.displayName}
                        </div>
                        <button
                            onClick={() => setActiveLogs(null)}
                            className="text-[10px] font-bold text-slate-400 hover:text-slate-800 dark:hover:text-white uppercase tracking-wider transition-colors"
                        >
                            Close Logs
                        </button>
                    </div>
                    <div className="w-full bg-slate-950 text-slate-300 font-mono text-[10px] p-4 rounded-2xl overflow-y-auto max-h-[250px] border border-slate-800/80 leading-relaxed shadow-inner">
                        {isLoadingLogs ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="animate-spin text-slate-500 mr-2" size={14} />
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">Reading logs from disk...</span>
                            </div>
                        ) : activeLogs.logs.length === 0 ? (
                            <div className="text-slate-500 italic py-4 text-center">No logs recorded for this service.</div>
                        ) : (
                            activeLogs.logs.map((line, idx) => (
                                <div key={idx} className="whitespace-pre-wrap hover:bg-slate-900/50 px-1 py-0.5 rounded">
                                    {line}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
export default ServerControlPanel;
