import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../../database';
import { RefreshCw, Cpu, Database, Signal, Save, Brain, Target, ShieldCheck, Check, ChevronDown, Activity, CheckCircle2, XCircle, Copy, Eye, EyeOff, Zap, Play, Trash2, AlertTriangle, Volume2, VolumeX, Bell, Key, Plus, Info, Bot, Globe, Sliders, Lock, RotateCcw, TrendingUp, Wallet, Rocket, Beaker, Grid, MessageSquare, Waves, Wrench, Lightbulb, LayoutDashboard, Layers, Sparkles } from 'lucide-react';
import { useSettingsStore, saveAllBrokerCreds, savePersistedBrokerCreds, ExperienceTier, TIER_CATEGORIES, WORKSPACE_CATEGORIES } from '../../store/settingsStore';
import { useFirebaseAuth } from '../../contexts/FirebaseAuthContext';
import { syncEngine } from '../../services/SyncEngine';
import DataBackupSettings from '../DataBackupSettings';
import { useToast } from '../shared/ToastProvider';

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    'dashboard': LayoutDashboard,
    'portfolio': Wallet,
    'journal': Brain,
    'growth': Bot,
    'tradefinder': TrendingUp,
    'alpha': Rocket,
    'signals': Activity,
    'telegram': MessageSquare,
    'pool': Waves,
    'tools': Wrench,
    'vibe-trading': Cpu,
    'algo-bots': Bot,
    'ai-research': Brain,
    'backtester': Beaker,
    'launchpad': Grid,
    'market': Globe,
    'ipo': Zap,
    'innovation': Lightbulb,
    'analytics': Layers
};
import SecurityPrivacyPanel from './SecurityPrivacyPanel';
import { ApiKeyPoolPanel } from './ApiKeyPoolPanel';
import { MODEL_REGISTRY } from '../../services/llm/models';
import { PremiumSelect } from '../ui/PremiumSelect';
import { dhanBrokerService } from '../../services/DhanBrokerService';
import { useGuardrailStore } from '../../store/useGuardrailStore';
import { notificationService } from '../../services/NotificationService';
import { upstoxAuthService } from '../../services/UpstoxAuthService';
import { useLiteModeStore } from '../../store/liteModeStore';
import { QuotaMonitor } from '../ai/QuotaMonitor';
import { MlModelsPanel } from './MlModelsPanel';
import { RecentlyDeletedPanel } from './RecentlyDeletedPanel';
import ServerControlPanel from './ServerControlPanel';
import TelemetryHub from '../system/TelemetryHub';
import ComponentWorkshop from '../dev/ComponentWorkshop';


const sectionInputClassName = 'w-full rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 outline-none transition-colors focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
const compactInputClassName = 'w-full rounded-2xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 outline-none transition-colors focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

interface CustomSelectOption {
    id: string;
    name: string;
}

interface CustomSelectProps {
    value: string;
    onChange: (val: string) => void;
    options: CustomSelectOption[];
    label?: string;
    icon?: React.ReactNode;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    label,
    icon
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedOption = options.find(opt => opt.id === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative w-full z-[80]" ref={containerRef}>
            {label && (
                <label className="mb-1 block text-xs font-semibold text-slate-500">
                    {label}
                </label>
            )}

            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    group flex w-full items-center justify-between gap-2.5 rounded-2xl border 
                    bg-white p-2.5 text-left transition-all duration-300 backdrop-blur-md
                    dark:bg-slate-900 text-xs font-medium h-[38px]
                    ${isOpen
                        ? 'border-indigo-500 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/10'
                        : 'border-slate-200 hover:border-indigo-400/50 dark:border-slate-800 dark:hover:border-indigo-500/40 text-slate-800 dark:text-slate-200'
                    }
                `}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {icon && (
                        <div className={`
                            flex h-6 w-6 shrink-0 items-center justify-center rounded-xl transition-colors
                            ${isOpen ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}
                        `}>
                            {icon}
                        </div>
                    )}
                    <span className="truncate">
                        {selectedOption ? selectedOption.name : 'Select option...'}
                    </span>
                </div>
                <ChevronDown
                    size={14}
                    className={`shrink-0 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-indigo-500' : 'group-hover:translate-y-0.5'}`}
                />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 2, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute left-0 right-0 z-[150] mt-1 overflow-hidden rounded-[20px] border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95"
                    >
                        <div className="max-h-[200px] overflow-y-auto scrollbar-thin space-y-0.5">
                            {options.map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                        onChange(opt.id);
                                        setIsOpen(false);
                                    }}
                                    className={`
                                        flex w-full items-center justify-between rounded-xl p-2 text-left transition-all text-xs font-semibold
                                        ${value === opt.id
                                            ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
                                        }
                                    `}
                                >
                                    <span>{opt.name}</span>
                                    {value === opt.id && <Check size={12} className="text-indigo-500 shrink-0" />}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const UpstoxDiagnosticsBoard: React.FC = () => {
    const [summary, setSummary] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isClearingCache, setIsClearingCache] = useState(false);
    const [isSyncingUniverse, setIsSyncingUniverse] = useState(false);
    const { toast } = useToast();

    const fetchDiagnostics = async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/python-nse/api/upstox/health-summary');
            if (response.ok) {
                const data = await response.json();
                setSummary(data);
            }
        } catch (err: unknown) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDiagnostics();
        const interval = setInterval(fetchDiagnostics, 300000); // refresh every 5m
        return () => clearInterval(interval);
    }, []);

    const handleClearCache = async () => {
        setIsClearingCache(true);
        try {
            const response = await fetch('/api/python-nse/api/upstox/cache/clear', { method: 'POST' });
            if (response.ok) {
                toast.success('Upstox Cache successfully cleared.');
                fetchDiagnostics();
            } else {
                toast.error('Failed to clear cache.');
            }
        } catch (err: unknown) {
            toast.error('Failed to clear cache due to network error.');
        } finally {
            setIsClearingCache(false);
        }
    };

    const handleSyncUniverse = async () => {
        setIsSyncingUniverse(true);
        try {
            const response = await fetch('/api/python-nse/api/nse/fno-universe/sync', { method: 'POST' });
            if (response.ok) {
                const data = await response.json();
                toast.success('F&O Sector Mappings successfully updated and saved to disk.');
                fetchDiagnostics();
            } else {
                toast.error('Failed to update F&O sector mappings.');
            }
        } catch (err: unknown) {
            toast.error('Failed to sync due to network error.');
        } finally {
            setIsSyncingUniverse(false);
        }
    };

    if (!summary) {
        return (
            <div className="mt-4 flex items-center justify-center p-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                <RefreshCw className="animate-spin text-slate-400 mr-2" size={16} />
                <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Loading Diagnostics...</span>
            </div>
        );
    }

    return (
        <div className="mt-6 border-t border-orange-200/50 dark:border-orange-500/20 pt-6 space-y-6">
            <h5 className="text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                <Database size={14} /> Diagnostic Command & Control
            </h5>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                {/* Cache Stats Card */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cache Stats</p>
                        <p className="mt-2 text-xl font-black text-slate-850 dark:text-white">{summary.cache.total_items} Items</p>
                        <p className="text-[10px] text-slate-400 mt-1">{summary.cache.stale_items} stale / {summary.cache.fresh_items} fresh</p>
                    </div>
                    <button
                        onClick={handleClearCache}
                        disabled={isClearingCache || summary.cache.total_items === 0}
                        className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl bg-rose-500/10 text-rose-500 py-2 text-[10px] font-bold hover:bg-rose-500 hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                    >
                        <Trash2 size={12} /> Purge Cache
                    </button>
                </div>

                {/* Rate Limit Card */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Rate Limit Status</p>
                        <p className="mt-2 text-xl font-black text-slate-850 dark:text-white">{summary.rate_limit.minute_usage} Calls/Min</p>
                        <div className="w-full bg-slate-100 dark:bg-slate-850 rounded-full h-1.5 mt-3 overflow-hidden">
                            <div
                                className={`h-1.5 rounded-full transition-all duration-300 ${summary.rate_limit.minute_usage > 450 ? 'bg-rose-500' : summary.rate_limit.minute_usage > 300 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min((summary.rate_limit.minute_usage / summary.rate_limit.minute_limit) * 100, 100)}%` }}
                            ></div>
                        </div>
                    </div>
                    <p className="text-[9px] font-medium text-slate-400 mt-2">Limit: {summary.rate_limit.minute_limit}/min</p>
                </div>

                {/* F&O Sector Sync Card */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sector Mappings</p>
                        <p className="mt-2 text-[10px] font-black text-slate-800 dark:text-white uppercase tracking-wider">Last Synced:</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-1">
                            {summary.fno_last_sync
                                ? new Date(summary.fno_last_sync).toLocaleString('en-IN')
                                : 'Never (Using Fallbacks)'}
                        </p>
                        <p className="text-[9px] text-slate-400 mt-1.5 leading-relaxed">
                            Syncs index weights against active F&O contracts. Runs monthly or on-demand.
                        </p>
                    </div>
                    <button
                        onClick={handleSyncUniverse}
                        disabled={isSyncingUniverse}
                        className="mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl bg-orange-500/10 text-orange-500 py-2 text-[10px] font-bold hover:bg-orange-500 hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95"
                    >
                        {isSyncingUniverse ? (
                            <RefreshCw className="animate-spin" size={12} />
                        ) : (
                            <RefreshCw size={12} />
                        )}
                        {isSyncingUniverse ? 'Syncing...' : 'Sync Mappings'}
                    </button>
                </div>

                {/* Token Health Status Card */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Token Health Status</p>
                        <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-medium">Daily Login (F&O):</span>
                                <span className={summary.interactive_token_active ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
                                    {summary.interactive_token_active ? "🟢 Active" : "🔴 Missing / Expired"}
                                </span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-medium">1-Year Analytics:</span>
                                <span className={summary.analytics_token_active ? "text-emerald-500 font-bold" : "text-rose-500 font-bold"}>
                                    {summary.analytics_token_active ? "🟢 Active" : "🔴 Missing"}
                                </span>
                            </div>
                        </div>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
                        Fallback token keeps charts active when daily login is offline.
                    </p>
                </div>

                {/* Error Log Card */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Active Errors / Fallbacks</p>
                        <div className="mt-2 space-y-1.5 max-h-[85px] overflow-y-auto pr-1">
                            {summary.last_errors.length === 0 ? (
                                <p className="text-xs text-emerald-500 font-bold py-1">🟢 Zero failures logged.</p>
                            ) : (
                                summary.last_errors.slice(0, 2).map((err: any, idx: number) => (
                                    <div key={idx} className="flex items-start gap-1 text-[10px] border-b border-slate-100 dark:border-slate-800 last:border-none pb-1 last:pb-0">
                                        <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{err.endpoint}</p>
                                            <p className="text-slate-400 line-clamp-1">{err.message}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Background Scheduler Board */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/60 dark:border-slate-800 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-1">
                        <Play size={12} className="text-orange-500" /> Daemon Scheduler Task Board
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400 pb-2">
                                    <th className="pb-2">Job Name</th>
                                    <th className="pb-2">Last Run</th>
                                    <th className="pb-2">Next Run</th>
                                    <th className="pb-2">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                {Object.entries(summary.jobs).map(([jobId, job]: [string, any]) => {
                                    const jobNames: Record<string, string> = {
                                        bulk_volume_avg: 'Refresh 20-Day Volume Averages',
                                        instrument_sync: 'Sync Instrument Master Keys',
                                        ohlc_cache: 'Cache OHLC End of Day',
                                        fii_dii_sync: 'Sync FII/DII Institutional Flows',
                                        fundamentals_refresh: 'Weekly Fundamentals Update',
                                        database_cleanup: 'Daily Database Cache Cleanup',
                                        parquet_archive: 'Daily Post-Market Parquet Archiver'
                                    };
                                    return (
                                        <tr key={jobId} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                                            <td className="py-2.5 font-bold text-slate-800 dark:text-slate-200">{jobNames[jobId] || jobId}</td>
                                            <td className="py-2.5 text-slate-500 font-mono text-[10px]">
                                                {job.last_run ? new Date(job.last_run).toLocaleString('en-IN') : 'Never'}
                                            </td>
                                            <td className="py-2.5 text-slate-500 font-mono text-[10px]">
                                                {job.next_run ? new Date(job.next_run).toLocaleString('en-IN') : 'Paused/Triggered'}
                                            </td>
                                            <td className="py-2.5">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${job.status === 'success' ? 'bg-emerald-500/15 text-emerald-600 font-bold' :
                                                        job.status === 'failed' ? 'bg-rose-500/15 text-rose-600 font-bold' :
                                                            job.status === 'running' ? 'bg-indigo-500/15 text-indigo-600 font-bold animate-pulse' :
                                                                'bg-slate-500/15 text-slate-500'
                                                    }`}>
                                                    {job.status}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Storage & Sync Metrics Board */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/60 dark:border-slate-800 shadow-sm">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-1">
                        <Database size={12} className="text-indigo-500" /> Data Storage & Sync Metrics
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400 pb-2">
                                    <th className="pb-2">Data Point</th>
                                    <th className="pb-2">Details / Row Count</th>
                                    <th className="pb-2">Size</th>
                                    <th className="pb-2">Last Sync</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                                {summary.storage_details && Object.entries(summary.storage_details).map(([key, details]: [string, any]) => {
                                    const formatSize = (bytes: number | null | undefined) => {
                                        if (bytes === null || bytes === undefined) return '—';
                                        if (bytes >= 1024 * 1024) {
                                            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
                                        }
                                        return `${(bytes / 1024).toFixed(2)} KB`;
                                    };
                                    return (
                                        <tr key={key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                                            <td className="py-2.5">
                                                <p className="font-bold text-slate-800 dark:text-slate-200">{details.name}</p>
                                                <p className="text-[9px] text-slate-400 font-mono mt-0.5">{details.endpoint}</p>
                                            </td>
                                            <td className="py-2.5 text-slate-600 dark:text-slate-400 text-[11px]">
                                                {details.row_count !== null ? `${details.row_count.toLocaleString('en-IN')} rows` : 'File Storage'}
                                            </td>
                                            <td className="py-2.5 text-slate-600 dark:text-slate-400 font-mono text-[10px]">
                                                {formatSize(details.size_bytes)}
                                            </td>
                                            <td className="py-2.5 text-slate-500 font-mono text-[10px]">
                                                {details.last_sync ? new Date(details.last_sync).toLocaleString('en-IN') : 'N/A'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ThemeStudioPanel: React.FC = () => {
    const settings = useSettingsStore();
    const { toast } = useToast();
    const [showWorkshop, setShowWorkshop] = useState(false);

    const themes = [
        {
            id: 'default',
            name: 'Default Slate',
            desc: 'The original dashboard style with clean slate panels and indigo highlights.',
            accent: '#6366f1',
            bg: '#020617',
            colors: ['#0f172a', '#0f172a', '#6366f1']
        },
        {
            id: 'omen-cyber',
            name: 'OMEN Cyber Navy',
            desc: 'A premium cybersecurity environment with vibrant cyan accents and glassmorphic cards.',
            accent: '#06b6d4',
            bg: '#05080f',
            colors: ['#05080f', '#0a1120', '#06b6d4']
        },
        {
            id: 'grey-dark',
            name: 'TradeDiary Grey',
            desc: 'A sophisticated industrial grey palette with warm amber highlights.',
            accent: '#f59e0b',
            bg: '#18181b',
            colors: ['#18181b', '#27272a', '#f59e0b']
        },
        {
            id: 'aurora',
            name: 'Aurora Violet',
            desc: 'A futuristic design language with deep purple and violet glow.',
            accent: '#a855f7',
            bg: '#07040e',
            colors: ['#07040e', '#120924', '#a855f7']
        },
        {
            id: 'default-glass',
            name: 'Glassmorphic Slate',
            desc: 'A premium glass variant of our default theme with deep glowing radial gradients.',
            accent: '#6366f1',
            bg: '#0b0f19',
            colors: ['#0b0f19', 'rgba(15,23,42,0.45)', '#6366f1'],
            isNew: true
        },
        {
            id: 'nebula-violet',
            name: 'Nebula Glass',
            desc: 'A gorgeous cosmic blend of soft lavender, lilac, and faint wisteria glow.',
            accent: '#c084fc',
            bg: '#0a0914',
            colors: ['#0a0914', 'rgba(15,13,26,0.45)', '#c084fc'],
            isNew: true
        },
        {
            id: 'cyber-emerald',
            name: 'Emerald Glass',
            desc: 'A calming finance environment with soft sage green highlights and mint glass cards.',
            accent: '#34d399',
            bg: '#060b08',
            colors: ['#060b08', 'rgba(8,16,12,0.45)', '#34d399'],
            isNew: true
        },
        {
            id: 'solar-amber',
            name: 'Solar Glass',
            desc: 'A warm solar-themed layout with soft peach tones and champagne gold highlights.',
            accent: '#fbbf24',
            bg: '#0a0805',
            colors: ['#0a0805', 'rgba(18,15,12,0.45)', '#fbbf24'],
            isNew: true
        },
        {
            id: 'obsidian',
            name: 'Obsidian Nova',
            desc: 'Ultra-deep chromatic obsidian with specular top-edge hairlines and violet glow.',
            accent: '#8B5CF6',
            bg: '#08090C',
            colors: ['#08090C', '#0E101A', '#8B5CF6'],
            isNew: true
        }
    ];

    const currentTheme = settings.activeTheme || 'default';
    const currentPreset = settings.designPreset || 'wealthos-classic';

    const designPresets = [
        {
            id: 'wealthos-classic',
            name: 'WealthOS Classic',
            desc: 'Your familiar local layout, 20px glassmorphic cards, ambient orbs, and Outfit typography.',
            accent: '#6366F1',
            badge: 'DEFAULT BASELINE',
            badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
        },
        {
            id: 'astryx',
            name: 'Meta Astryx',
            desc: 'Official Meta open-source design system. 10px controls, 12px cards, 9999px action pills, Figtree font, and Theme Neutral palette.',
            accent: '#ffffff',
            badge: 'META ASTRYX',
            badgeColor: 'text-zinc-300 bg-zinc-800 border-zinc-700'
        },
        {
            id: 'reui-nova',
            name: 'Pure ReUI / Shadcn',
            desc: 'Official ReUI building blocks & Shadcn Zinc design. 12px cards, 8px buttons, Inter font, clean borders, and mobile reflow.',
            accent: '#71717A',
            badge: 'REUI PRIMITIVES',
            badgeColor: 'text-zinc-300 bg-zinc-800 border-zinc-700'
        }
    ];

    return (
        <div className="space-y-6 min-w-0 max-w-full overflow-hidden">
            {/* Design System Preset Switcher */}
            <div 
                className="p-4 sm:p-6 shadow-sm border transition-all duration-300 min-w-0 max-w-full overflow-hidden"
                style={{
                    backgroundColor: 'var(--surface-card, rgba(15, 23, 42, 0.6))',
                    borderColor: 'var(--border-card, rgba(255, 255, 255, 0.08))',
                    borderRadius: 'var(--card-radius, 24px)'
                }}
            >
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500 dark:text-indigo-300">
                            Design System Engine
                        </p>
                        <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Tri-Vertical Component Preset Architecture</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Select your UI component and primitive library. Colors, skins, and backgrounds adapt dynamically via Theme Studio below.</p>
                    </div>
                </div>

                <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                    {designPresets.map((preset) => {
                        const isActive = currentPreset === preset.id;
                        return (
                            <button
                                type="button"
                                key={preset.id}
                                onClick={() => {
                                    settings.updateSetting('designPreset', preset.id as any);
                                    toast.success(`${preset.name} design preset applied!`);
                                }}
                                className={`group relative flex flex-col text-left p-5 border transition-all duration-300 active:scale-98 ${
                                    isActive
                                        ? 'border-indigo-500/80 dark:border-indigo-500 bg-indigo-50/15 dark:bg-white/[0.04] shadow-[0_0_20px_rgba(99,102,241,0.12)] ring-1 ring-indigo-500'
                                        : 'border-slate-200 dark:border-white/[0.08] bg-transparent hover:border-slate-300 dark:hover:border-white/20'
                                }`}
                                style={{ borderRadius: 'var(--card-radius, 16px)' }}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${preset.badgeColor}`}>
                                        {preset.badge}
                                    </span>
                                    {isActive && (
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    )}
                                </div>
                                <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-1">{preset.name}</h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{preset.desc}</p>
                            </button>
                        );
                    })}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-200/60 dark:border-slate-800/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Component Workshop (Storybook Workbench)</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Live 3-column side-by-side preview with real-time typography slider and state controls.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowWorkshop(!showWorkshop)}
                        className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-all shadow-sm shrink-0 active:scale-95"
                    >
                        {showWorkshop ? 'Close Workshop' : 'Open Component Workshop'}
                    </button>
                </div>

                {showWorkshop && (
                    <div className="mt-6 pt-4 border-t border-slate-200/60 dark:border-slate-800/80">
                        <ComponentWorkshop />
                    </div>
                )}
            </div>

            {/* Theme Studio */}
            <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500 dark:text-indigo-300">
                            Theme Studio
                        </p>
                    <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Workspace Skin & Accent Customization</h3>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Select a unified visual style. Backgrounds, panels, highlights, active states, and buttons adapt automatically.</p>
                </div>
            </div>

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {themes.map((theme) => {
                    const isActive = currentTheme === theme.id;
                    return (
                        <button
                            type="button"
                            key={theme.id}
                            onClick={() => {
                                settings.updateSetting('activeTheme', theme.id as any);
                                toast.success(`${theme.name} layout applied successfully!`);
                            }}
                            className={`group relative flex flex-col text-left rounded-3xl p-5 border transition-all duration-300 active:scale-98 ${
                                isActive
                                    ? 'border-indigo-500/80 dark:border-[var(--accent)] bg-indigo-50/15 dark:bg-slate-950 shadow-[0_0_20px_rgba(99,102,241,0.08)]'
                                    : 'border-slate-200 dark:border-slate-800 bg-transparent hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                            style={{
                                borderColor: isActive ? theme.accent : undefined,
                                boxShadow: isActive ? `0 0 20px ${theme.accent}15` : undefined
                            }}
                        >
                            {/* Color preview panel */}
                            <div className="w-full h-16 rounded-xl flex gap-1 p-1 mb-4 overflow-hidden" style={{ backgroundColor: theme.colors[0] }}>
                                <div className="flex-1 rounded-lg" style={{ backgroundColor: theme.colors[1] }} />
                                <div className="w-1/3 rounded-lg flex items-center justify-center" style={{ backgroundColor: theme.colors[2] }}>
                                    <div className="w-2.5 h-2.5 rounded-full bg-white/40 animate-pulse" />
                                </div>
                            </div>

                            {/* Badge */}
                            {theme.isNew && (
                                <span className="absolute top-4 right-4 bg-purple-500/10 text-purple-400 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-purple-500/20">
                                    NEW
                                </span>
                            )}

                            <div>
                                <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                                    {theme.name}
                                    {isActive && (
                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }} />
                                    )}
                                </h4>
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-normal">
                                    {theme.desc}
                                </p>
                            </div>

                            {/* Checkmark or Selection Status */}
                            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 w-full flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                                <span>Preview Skin</span>
                                {isActive ? (
                                    <span className="font-bold text-emerald-500 flex items-center gap-1">
                                        Active
                                    </span>
                                ) : (
                                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                                        Apply
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    </div>
    );
};

const SettingsDesktopView: React.FC = () => {
    const { user } = useFirebaseAuth();
    const settings = useSettingsStore();
    const guardrail = useGuardrailStore();
    const { toast } = useToast();
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);
    const toggleLiteMode = useLiteModeStore(state => state.toggleLiteMode);

    const [purgeConfirmInput, setPurgeConfirmInput] = useState('');
    const [isPurging, setIsPurging] = useState(false);
    const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
    const [isTestingDhan, setIsTestingDhan] = useState(false);
    const [isRegeneratingDhan, setIsRegeneratingDhan] = useState(false);
    const [isSavingDhan, setIsSavingDhan] = useState(false);
    const [dhanTestResult, setDhanTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [showDhanToken, setShowDhanToken] = useState(false);

    const [isTestingUpstox, setIsTestingUpstox] = useState(false);
    const [isSavingUpstox, setIsSavingUpstox] = useState(false);
    const [upstoxTestResult, setUpstoxTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [showUpstoxToken, setShowUpstoxToken] = useState(false);
    const [showUpstoxSecret, setShowUpstoxSecret] = useState(false);

    const [isTestingTelegram, setIsTestingTelegram] = useState(false);
    const [telegramTestResult, setTelegramTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [showTelegramToken, setShowTelegramToken] = useState(false);
    const [showBotTokens, setShowBotTokens] = useState<Record<string, boolean>>({});
    const [testingBotId, setTestingBotId] = useState<string | null>(null);
    const [botTestResults, setBotTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

    const [isTabCustomizerOpen, setIsTabCustomizerOpen] = useState(false);

    const currentTier: ExperienceTier = settings.experienceTier || (settings.expertMode ? 'QUANT' : 'INVESTOR');
    const activeCategoryIds = settings.customEnabledCategories && settings.customEnabledCategories.length > 0
        ? settings.customEnabledCategories
        : (TIER_CATEGORIES[currentTier] || TIER_CATEGORIES.QUANT);
    const activeTabCount = activeCategoryIds.length;

    const handleSelectTier = (tier: ExperienceTier) => {
        settings.updateSetting('experienceTier', tier);
        toast.success(`Switched to ${tier} Workspace preset (${TIER_CATEGORIES[tier].length} tabs)`);
    };

    const handleToggleCategory = (catId: string) => {
        if (catId === 'dashboard') return;
        const currentActive = settings.customEnabledCategories
            ? [...settings.customEnabledCategories]
            : [...(TIER_CATEGORIES[currentTier] || TIER_CATEGORIES.QUANT)];

        let updated: string[];
        if (currentActive.includes(catId)) {
            updated = currentActive.filter(id => id !== catId);
            toast.info(`Removed ${catId} from sidebar navigation`);
        } else {
            updated = [...currentActive, catId];
            toast.success(`Added ${catId} to sidebar navigation`);
        }
        if (!updated.includes('dashboard')) {
            updated = ['dashboard', ...updated];
        }
        settings.updateSetting('customEnabledCategories', updated);
    };

    const handleResetTierDefaults = () => {
        settings.updateSetting('customEnabledCategories', undefined);
        toast.success(`Reset tabs to default ${currentTier} configuration`);
    };

    const handleSelectAllTabs = () => {
        const allIds = WORKSPACE_CATEGORIES.map(c => c.id);
        settings.updateSetting('customEnabledCategories', allIds);
        toast.success('Enabled all 19 workspace modules');
    };

    // Auto-migrate single bot to multiple bots array if empty
    useEffect(() => {
        if ((!settings.telegramBots || settings.telegramBots.length === 0) && settings.telegramBotToken) {
            settings.updateSetting('telegramBots', [
                {
                    id: 'bot_primary',
                    name: 'Trade Trigger Bot',
                    token: settings.telegramBotToken,
                    chatId: settings.telegramChatId,
                    role: 'alerts',
                    enabled: settings.telegramEnabled
                }
            ]);
        }
    }, [settings.telegramBots, settings.telegramBotToken, settings.telegramChatId, settings.telegramEnabled]);

    // Sync Telegram bots config to python-bridge whenever they are updated
    useEffect(() => {
        if (settings.telegramBots && settings.telegramBots.length > 0) {
            fetch('/api/python-nse/api/alerts/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bots: settings.telegramBots })
            }).catch(err => console.error('Failed to sync Telegram config to Python bridge:', err));
        }
    }, [settings.telegramBots]);

    const handleTestTelegram = async () => {
        setIsTestingTelegram(true);
        setTelegramTestResult(null);
        try {
            const { telegramAlertService } = await import('../../services/TelegramAlertService');
            const res = await telegramAlertService.test();
            if (res.success) {
                setTelegramTestResult({ success: true, message: 'Telegram bot connected successfully!' });
                toast.success('Telegram test message sent!');
            } else {
                setTelegramTestResult({ success: false, message: res.error || 'Failed to send test message' });
                toast.error(res.error || 'Failed to connect Telegram');
            }
        } catch (err: any) {
            setTelegramTestResult({ success: false, message: err?.message || 'Network error' });
            toast.error(err?.message || 'Failed to test Telegram');
        } finally {
            setIsTestingTelegram(false);
        }
    };

    const handleTestSpecificBot = async (bot: any) => {
        if (!bot.token || !bot.chatId) {
            toast.error('Bot Token and Chat ID are required to test connection.');
            return;
        }
        setTestingBotId(bot.id);
        try {
            let chatId = bot.chatId;
            let threadId: number | undefined = undefined;
            if (typeof chatId === 'string' && chatId.includes('#')) {
                const parts = chatId.split('#');
                chatId = parts[0];
                const parsed = parseInt(parts[1], 10);
                if (!isNaN(parsed)) {
                    threadId = parsed;
                }
            }

            const res = await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_thread_id: threadId,
                    text: `🔔 Connection Test Successful!\nBot Name: ${bot.name}\nRole: ${bot.role.toUpperCase()}\nDashboard URL: http://localhost:3000`
                })
            });
            const data = await res.json();
            if (data.ok) {
                setBotTestResults(prev => ({ ...prev, [bot.id]: { success: true, message: 'Connected!' } }));
                toast.success(`Test message sent successfully from ${bot.name}!`);
            } else {
                const errMsg = data.description || 'API Error';
                setBotTestResults(prev => ({ ...prev, [bot.id]: { success: false, message: errMsg } }));
                toast.error(`Telegram API Error: ${errMsg}`);
            }
        } catch (err: any) {
            const msg = err?.message || 'Network error';
            setBotTestResults(prev => ({ ...prev, [bot.id]: { success: false, message: msg } }));
            toast.error(`Failed to connect: ${msg}`);
        } finally {
            setTestingBotId(null);
        }
    };

    const handleUpdateBot = (botId: string, updates: Partial<any>) => {
        const updatedBots = (settings.telegramBots || []).map(bot => {
            if (bot.id === botId) {
                const newBot = { ...bot, ...updates };
                // Sync primary alert bot values to root keys for backwards compatibility
                if (newBot.role === 'alerts') {
                    settings.updateSetting('telegramBotToken', newBot.token);
                    settings.updateSetting('telegramChatId', newBot.chatId);
                    settings.updateSetting('telegramEnabled', newBot.enabled);
                }
                return newBot;
            }
            // Enforce role uniqueness (only one bot per role)
            if (updates.role === 'alerts' && bot.role === 'alerts') {
                return { ...bot, role: 'none' };
            }
            if (updates.role === 'autopilot' && bot.role === 'autopilot') {
                return { ...bot, role: 'none' };
            }
            return bot;
        });
        settings.updateSetting('telegramBots', updatedBots);
    };

    const handleAddBot = () => {
        const newBot = {
            id: 'bot_' + Date.now(),
            name: 'New Custom Bot',
            token: '',
            chatId: '',
            role: 'none' as const,
            enabled: true
        };
        settings.updateSetting('telegramBots', [...(settings.telegramBots || []), newBot]);
        toast.info('New Telegram bot added to configurations.');
    };

    const handleDeleteBot = (botId: string) => {
        const botToDelete = (settings.telegramBots || []).find(b => b.id === botId);
        const remainingBots = (settings.telegramBots || []).filter(b => b.id !== botId);
        settings.updateSetting('telegramBots', remainingBots);
        
        if (botToDelete?.role === 'alerts') {
            settings.updateSetting('telegramBotToken', '');
            settings.updateSetting('telegramChatId', '');
            settings.updateSetting('telegramEnabled', false);
        }
        toast.success(`Deleted ${botToDelete?.name || 'Telegram Bot'}`);
    };

    const handleChange = (key: keyof typeof settings, value: string) => {
        if (key === 'targetDate' || key === 'geminiApiKey' || key === 'groqApiKey' || key === 'openRouterApiKey' || key === 'preferredModelId' || key === 'apiKeys') {
            settings.updateSetting(key, value);
            return;
        }

        let numValue = parseFloat(value);
        if (isNaN(numValue)) numValue = 0;
        settings.updateSetting(key, numValue);

        // 2026-06-19: explicitly refresh the portfolio view on loanPrincipal
        // change. The cross-store subscribe that used to handle this was
        // removed because it was the source of the Portfolio Hub render
        // loop. The next liveQuery tick will also pick up the new value, but
        // explicit refresh keeps the "Total Net Worth" line in the hub
        // responsive while typing.
        if (key === 'loanPrincipal') {
            // Lazy-import to avoid a hard module cycle and keep the chunk
            // boundary clean.
            import('../../store/portfolioStore').then(({ usePortfolioStore }) => {
                const s = usePortfolioStore.getState();
                if (s.investments.length > 0) {
                    s.setPortfolioData(s.investments, s.history, s.lifeEvents);
                }
            }).catch(() => { /* portfolio store not yet initialized — fine */ });
        }
    };

    const handleResetDefaults = () => {
        settings.resetDefaults();
        toast.success('System settings reset to default thresholds.');
    };

    const handlePurgeTrades = async () => {
        if (purgeConfirmInput !== 'DELETE') {
            toast.error('Please type "DELETE" to confirm.');
            return;
        }

        setIsPurging(true);
        try {
            await Promise.all([
                db.trades.clear(),
                db.sync_records.clear(),
                db.broker_positions_cache.clear(),
                db.broker_holdings_cache.clear(),
                db.missed_trades.clear()
            ]);
            toast.success('All trades and sync history have been purged.');
            setPurgeConfirmInput('');
            setIsPurgeModalOpen(false);
        } catch (err: unknown) {
            toast.error('Failed to purge database.');
            console.error(err);
        } finally {
            setIsPurging(false);
        }
    };

    const handleCopyToken = () => {
        if (!settings.dhanAccessToken) return;
        navigator.clipboard.writeText(settings.dhanAccessToken);
        toast.success('Access Token copied to clipboard');
    };

    const handleTestDhan = async () => {
        setIsTestingDhan(true);
        setDhanTestResult(null);
        try {
            const result = await dhanBrokerService.testConnection();
            setDhanTestResult(result);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Connection test failed';
            setDhanTestResult({ success: false, message: msg });
            toast.error(msg);
        } finally {
            setIsTestingDhan(false);
        }
    };

    const handleRegenerateDhanToken = async () => {
        setIsRegeneratingDhan(true);
        setDhanTestResult(null);
        try {
            const result = await dhanBrokerService.regenerateToken();
            setDhanTestResult(result);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Token generation failed';
            setDhanTestResult({ success: false, message: msg });
            toast.error(msg);
        } finally {
            setIsRegeneratingDhan(false);
        }
    };

    const handleCopyUpstoxToken = () => {
        if (!settings.upstoxAccessToken) return;
        navigator.clipboard.writeText(settings.upstoxAccessToken);
        toast.success('Upstox Access Token copied to clipboard');
    };

    const handleTestUpstox = async () => {
        setIsTestingUpstox(true);
        setUpstoxTestResult(null);
        try {
            await upstoxAuthService.syncCredentials(settings.upstoxApiKey, settings.upstoxApiSecret, settings.upstoxRedirectUri);
            if (settings.upstoxAccessToken) {
                await upstoxAuthService.setToken(settings.upstoxAccessToken);
            }
            const result = await upstoxAuthService.checkHealth();
            setUpstoxTestResult(result);
            if (result.success) {
                toast.success(result.message);
            } else {
                toast.error(result.message);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Connection test failed';
            setUpstoxTestResult({ success: false, message: msg });
            toast.error(msg);
        } finally {
            setIsTestingUpstox(false);
        }
    };

    const handleSaveDhanConfig = async () => {
        setIsSavingDhan(true);
        try {
            const dhanCreds = {
                dhanClientId: settings.dhanClientId,
                dhanAccessToken: settings.dhanAccessToken,
                dhanPin: settings.dhanPin,
                dhanTotpSecret: settings.dhanTotpSecret,
                dhanApiKey: settings.dhanApiKey,
                dhanApiSecret: settings.dhanApiSecret,
            };
            saveAllBrokerCreds(dhanCreds);
            if (user?.uid) {
                await syncEngine.performPush(user.uid);
            }
            toast.success('Dhan configuration saved and synced across devices.');
        } catch (err: unknown) {
            console.error(err);
            toast.error('Failed to sync Dhan configuration.');
        } finally {
            setIsSavingDhan(false);
        }
    };

    const handleSaveUpstoxConfig = async () => {
        setIsSavingUpstox(true);
        try {
            const upstoxCreds = {
                upstoxApiKey: settings.upstoxApiKey,
                upstoxApiSecret: settings.upstoxApiSecret,
                upstoxAccessToken: settings.upstoxAccessToken,
                upstoxRedirectUri: settings.upstoxRedirectUri,
            };
            saveAllBrokerCreds(upstoxCreds);
            await upstoxAuthService.syncCredentials(settings.upstoxApiKey, settings.upstoxApiSecret, settings.upstoxRedirectUri);
            if (settings.upstoxAccessToken) {
                await upstoxAuthService.setToken(settings.upstoxAccessToken);
            }
            if (user?.uid) {
                await syncEngine.performPush(user.uid);
            }
            toast.success('Upstox configuration saved and synced across devices.');
        } catch (err: unknown) {
            console.error(err);
            toast.error('Failed to sync Upstox configuration.');
        } finally {
            setIsSavingUpstox(false);
        }
    };

    const overviewCards = [
        {
            label: 'Primary Goal',
            value: `Rs ${Number(settings.targetNetWorth || 0).toLocaleString('en-IN')}`,
            note: settings.targetDate ? `Targeting ${settings.targetDate}` : 'Set your target date',
            icon: Target,
            tone: 'text-indigo-500',
        },
        {
            label: 'Risk Guard',
            value: `${settings.riskPerTrade || 0}%`,
            note: `Bullion cap ${settings.bullionCap || 0}%`,
            icon: ShieldCheck,
            tone: 'text-amber-500',
        },
        {
            label: 'Market Mode',
            value: settings.dataMode === 'LIVE' ? 'Live' : 'Offline',
            note: settings.dataMode === 'LIVE' ? 'Feeds and broker sync enabled' : 'Simulation mode active',
            icon: Activity,
            tone: settings.dataMode === 'LIVE' ? 'text-emerald-500' : 'text-slate-500',
        },
    ];

    return (
        <div className="w-full min-h-full bg-slate-50 dark:bg-slate-950 overflow-x-hidden">
            <div className="border-b border-slate-200/70 bg-gradient-to-r from-indigo-50 via-white to-sky-50 px-3.5 sm:px-6 py-4 sm:py-6 dark:border-slate-800 dark:from-indigo-950/20 dark:via-slate-950 dark:to-sky-950/20">
                <div className="mx-auto flex flex-col sm:flex-row w-full max-w-6xl items-start sm:items-center justify-between gap-4 sm:gap-6">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className="flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500 ring-1 ring-indigo-200 dark:bg-indigo-500/15 dark:ring-indigo-500/20">
                            <Cpu size={24} />
                        </div>
                        <div>
                            <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500 dark:text-indigo-300">Control Center</p>
                            <h2 className="mt-1 sm:mt-2 text-xl sm:text-2xl font-bold text-slate-800 dark:text-white">System Settings</h2>
                            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">Configure targets, cloud recovery, broker trust, and AI intelligence from one place.</p>
                        </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/80 px-3.5 py-2.5 sm:px-4 sm:py-3 text-left sm:text-right shadow-sm dark:border-slate-800 dark:bg-slate-900/70 w-full sm:w-auto">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">Vault State</p>
                        <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm font-bold text-slate-900 dark:text-white">Auto-saved locally</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Trust surfaces and intelligence settings stay in sync.</p>
                    </div>
                </div>
            </div>

            <div className="mx-auto flex w-full max-w-6xl flex-col px-3.5 sm:px-6 py-4 sm:py-8 pb-28 min-w-0 max-w-full">
                <div className="grid gap-3 md:grid-cols-3">
                    {overviewCards.map(({ label, value, note, icon: Icon, tone }) => (
                        <div key={label} className="rounded-2xl sm:rounded-[28px] border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">{label}</p>
                                    <p className="mt-3 text-2xl font-black text-slate-900 dark:text-white">{value}</p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p>
                                </div>
                                <div className={`rounded-2xl bg-slate-50 p-3 dark:bg-slate-800 ${tone}`}>
                                    <Icon size={18} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-8">
                    <ThemeStudioPanel />
                </div>

                <div className="mt-6 sm:mt-8 flex flex-col gap-6 sm:gap-8 w-full min-w-0 max-w-full">
                    <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">Core Rules</p>
                                <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Targets, risk, liability, and execution thresholds</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">These rules shape portfolio objectives, risk limits, and system-wide decision support.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                            {/* LEFT SIDE: Financial Rules & System Control (Spans 2 columns) */}
                            <div className="lg:col-span-2 space-y-6">
                                {/* Row 1: Targets & Goals + Risk Engine */}
                                <div className="rounded-2xl border border-slate-100 p-5 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-900/10">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="md:col-span-2 space-y-3">
                                            <h4 className="border-b border-slate-200 pb-2 text-xs font-bold uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">Targets & Goals</h4>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">Project 5L Target (Rs)</label>
                                                <input type="number" value={settings.targetNetWorth} onChange={(e) => handleChange('targetNetWorth', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">Target Date</label>
                                                <input type="date" value={settings.targetDate} onChange={(e) => handleChange('targetDate', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                        </div>
                                        <div className="md:col-span-2 space-y-3">
                                            <h4 className="border-b border-slate-200 pb-2 text-xs font-bold uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">Risk Engine</h4>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">Max Risk Per Trade (%)</label>
                                                <input type="number" value={settings.riskPerTrade} onChange={(e) => handleChange('riskPerTrade', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">Bullion Cap (%)</label>
                                                <input type="number" value={settings.bullionCap} onChange={(e) => handleChange('bullionCap', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Row 2: Liability Manager + Execution Rules */}
                                <div className="rounded-2xl border border-slate-100 p-5 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-900/10">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="md:col-span-2 space-y-3">
                                            <h4 className="border-b border-slate-200 pb-2 text-xs font-bold uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">Liability Manager</h4>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">Loan Principal (Rs)</label>
                                                <input type="number" value={settings.loanPrincipal} onChange={(e) => handleChange('loanPrincipal', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">Interest Rate (%)</label>
                                                <input type="number" value={settings.loanInterest} onChange={(e) => handleChange('loanInterest', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                        </div>
                                        <div className="md:col-span-2 space-y-3">
                                            <h4 className="border-b border-slate-200 pb-2 text-xs font-bold uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">Execution Rules</h4>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">Greed Killer ROI (%)</label>
                                                <input type="number" value={settings.greedKillerRoi} onChange={(e) => handleChange('greedKillerRoi', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-xs font-semibold text-slate-500">IPO Fresh Issue Limit (%)</label>
                                                <input type="number" value={settings.ipoFreshIssueThreshold} onChange={(e) => handleChange('ipoFreshIssueThreshold', e.target.value)} className={sectionInputClassName} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Row 3: System Control */}
                                <div className="space-y-3">
                                    <h4 className="border-b border-indigo-200 pb-2 text-sm font-bold uppercase text-indigo-500 dark:border-indigo-800 dark:text-indigo-400 flex items-center gap-2">
                                        <Cpu size={16} /> System Control
                                    </h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                        {/* Lite Mode */}
                                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-850 dark:bg-slate-950/20 flex flex-col justify-between h-28">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-slate-850 dark:text-white">Lite Mode</span>
                                                <div className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${isLiteMode ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                                                    onClick={toggleLiteMode}>
                                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isLiteMode ? 'translate-x-5' : 'translate-x-1'}`} />
                                                </div>
                                            </div>
                                            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wider mt-2">Throttles visual density</p>
                                        </div>

                                        {/* 3-Tier Workspace Experience Mode */}
                                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5 dark:border-slate-850 dark:bg-slate-950/20 flex flex-col justify-between h-28">
                                            {/* Row 1: Title & Fine-Tune Action */}
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold text-slate-850 dark:text-white">Workspace Tier</span>
                                                    {settings.customEnabledCategories && (
                                                        <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                                            Custom
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => settings.setWelcomeWizardOpen(true)}
                                                        className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-semibold flex items-center gap-1"
                                                        title="Relaunch Welcome Onboarding Wizard"
                                                    >
                                                        <Sparkles size={11} /> Setup Wizard
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsTabCustomizerOpen(!isTabCustomizerOpen)}
                                                        className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline font-semibold flex items-center gap-1"
                                                        title="Toggle Tab Customizer Drawer"
                                                    >
                                                        <Sliders size={11} /> {isTabCustomizerOpen ? 'Hide' : 'Fine-Tune'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Row 2: Dedicated Segmented 3-Tier Selector Row */}
                                            <div className="grid grid-cols-3 gap-1 bg-slate-200/70 dark:bg-slate-800/80 p-0.5 rounded-xl w-full">
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectTier('INVESTOR')}
                                                    title="Investor: 5 core wealth tabs"
                                                    className={`py-1 text-[10px] font-bold rounded-lg transition-all text-center ${
                                                        currentTier === 'INVESTOR' && !settings.customEnabledCategories
                                                            ? 'bg-emerald-600 text-white shadow-sm'
                                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                                    }`}
                                                >
                                                    Inv
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectTier('TRADER')}
                                                    title="Trader: 12 tactical tabs"
                                                    className={`py-1 text-[10px] font-bold rounded-lg transition-all text-center ${
                                                        currentTier === 'TRADER' && !settings.customEnabledCategories
                                                            ? 'bg-blue-600 text-white shadow-sm'
                                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                                    }`}
                                                >
                                                    Trd
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectTier('QUANT')}
                                                    title="Quant: All 19 modules"
                                                    className={`py-1 text-[10px] font-bold rounded-lg transition-all text-center ${
                                                        currentTier === 'QUANT' && !settings.customEnabledCategories
                                                            ? 'bg-indigo-600 text-white shadow-sm'
                                                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                                    }`}
                                                >
                                                    Qnt
                                                </button>
                                            </div>

                                            {/* Row 3: Active Status & Module Count */}
                                            <div className="flex items-center justify-between text-[9px] text-slate-400 font-medium">
                                                <span className="uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
                                                    {currentTier === 'INVESTOR' ? '🌱 Investor' : currentTier === 'TRADER' ? '⚡ Trader' : '🔬 Quant'}
                                                </span>
                                                <span className="font-mono font-bold text-slate-500 dark:text-slate-400">
                                                    {activeTabCount}/19 active
                                                </span>
                                            </div>
                                        </div>

                                        {/* Jarvis Voice */}
                                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-850 dark:bg-slate-950/20 flex flex-col justify-between h-28">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-slate-850 dark:text-white">Jarvis Voice</span>
                                                <div className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${!settings.jarvisMuted ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                                                    onClick={() => settings.updateSetting('jarvisMuted', !settings.jarvisMuted)}>
                                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${!settings.jarvisMuted ? 'translate-x-5' : 'translate-x-1'}`} />
                                                </div>
                                            </div>
                                            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wider mt-2">Voice Alerts & TTS</p>
                                        </div>

                                        {/* Mutual Funds */}
                                        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4 dark:border-slate-850 dark:bg-slate-950/20 flex flex-col justify-between h-28">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-bold text-slate-850 dark:text-white">Mutual Funds</span>
                                                <div className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${settings.enableMutualFunds ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'}`}
                                                    onClick={() => settings.updateSetting('enableMutualFunds', !settings.enableMutualFunds)}>
                                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${settings.enableMutualFunds ? 'translate-x-5' : 'translate-x-1'}`} />
                                                </div>
                                            </div>
                                            <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wider mt-2">Mutual Fund Sync</p>
                                        </div>
                                    </div>

                                    {/* Workspace Tier & Tab Customizer Panel */}
                                    <AnimatePresence>
                                        {isTabCustomizerOpen && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-5 dark:border-slate-850 dark:bg-slate-950/20 space-y-4">
                                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 dark:border-slate-800/60 pb-3">
                                                        <div>
                                                            <h4 className="text-sm font-bold uppercase text-indigo-500 dark:text-indigo-400 flex items-center gap-2">
                                                                <Sliders size={16} /> Workspace Modules & Tab Customizer
                                                            </h4>
                                                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                                                Select a baseline preset or toggle individual tabs below to tailor your navigation.
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2 self-start sm:self-auto">
                                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border ${
                                                                settings.customEnabledCategories 
                                                                    ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                                                    : currentTier === 'INVESTOR'
                                                                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                                                        : currentTier === 'TRADER'
                                                                            ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                                                                            : 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20'
                                                            }`}>
                                                                {settings.customEnabledCategories ? `Customized (${activeTabCount}/19 Tabs)` : `${currentTier} Mode (${activeTabCount} Tabs)`}
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={handleResetTierDefaults}
                                                                title="Reset all tabs to selected tier defaults"
                                                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-400 transition-colors"
                                                            >
                                                                <RotateCcw size={12} />
                                                                <span>Reset</span>
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* 3 Tier Presets Bar */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                        {/* Investor Card */}
                                                        <div
                                                            onClick={() => handleSelectTier('INVESTOR')}
                                                            className={`cursor-pointer rounded-xl border p-3 transition-all ${
                                                                currentTier === 'INVESTOR' && !settings.customEnabledCategories
                                                                    ? 'border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/20'
                                                                    : 'border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 hover:border-emerald-500/30'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                                                                    🌱 Investor Tier
                                                                </span>
                                                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                                                    5 Tabs
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                                                Pure wealth tracking: Dashboard, Portfolio Hub, IPO War Room, Journal, and Growth Engine. Zero trading noise.
                                                            </p>
                                                        </div>

                                                        {/* Trader Card */}
                                                        <div
                                                            onClick={() => handleSelectTier('TRADER')}
                                                            className={`cursor-pointer rounded-xl border p-3 transition-all ${
                                                                currentTier === 'TRADER' && !settings.customEnabledCategories
                                                                    ? 'border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/20'
                                                                    : 'border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 hover:border-blue-500/30'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs font-bold text-slate-850 dark:text-white flex items-center gap-1.5">
                                                                    ⚡ Trader Tier
                                                                </span>
                                                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                                                    12 Tabs
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                                                Tactical execution: IPO War Room, TradeFinder, Alpha Engine, Signals, Telegram Ear, Momentum Pool, Tools.
                                                            </p>
                                                        </div>

                                                        {/* Quant Card */}
                                                        <div
                                                            onClick={() => handleSelectTier('QUANT')}
                                                            className={`cursor-pointer rounded-xl border p-3 transition-all ${
                                                                currentTier === 'QUANT' && !settings.customEnabledCategories
                                                                    ? 'border-indigo-500/50 bg-indigo-500/10 ring-1 ring-indigo-500/20'
                                                                    : 'border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 hover:border-indigo-500/30'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs font-bold text-slate-800 dark:text-white flex items-center gap-1.5">
                                                                    🔬 Quant Tier
                                                                </span>
                                                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                                                                    19 Tabs
                                                                </span>
                                                            </div>
                                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                                                                All quantitative labs: Strategy Lab, Algo Bots, AI Research, Options Greeks, Math Lab, IPO War Room.
                                                            </p>
                                                        </div>
                                                    </div>

                                                    {/* Interactive Tab Chips Grid */}
                                                    <div className="pt-1">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                                Click Any Module to Toggle / Interchange ({activeTabCount} of 19 Active)
                                                            </span>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={handleSelectAllTabs}
                                                                    className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                                                >
                                                                    Enable All
                                                                </button>
                                                                <span className="text-slate-300 dark:text-slate-700">|</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSelectTier('INVESTOR')}
                                                                    className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                                                >
                                                                    Investor Minimal
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                                            {WORKSPACE_CATEGORIES.map((cat) => {
                                                                const isActive = activeCategoryIds.includes(cat.id);
                                                                const isDashboard = cat.id === 'dashboard';
                                                                const IconComponent = CATEGORY_ICONS[cat.id] || LayoutDashboard;

                                                                return (
                                                                    <div
                                                                        key={cat.id}
                                                                        onClick={() => !isDashboard && handleToggleCategory(cat.id)}
                                                                        className={`group relative flex items-center justify-between p-2.5 rounded-xl border transition-all select-none ${
                                                                            isDashboard
                                                                                ? 'cursor-default border-slate-300/80 dark:border-slate-700/80 bg-slate-100/50 dark:bg-slate-800/30'
                                                                                : isActive
                                                                                    ? 'cursor-pointer border-indigo-500/40 bg-indigo-50/50 dark:bg-indigo-950/30 hover:border-indigo-500/60 shadow-sm'
                                                                                    : 'cursor-pointer border-slate-200/60 dark:border-slate-800/60 bg-white/40 dark:bg-slate-900/20 opacity-50 hover:opacity-100 hover:border-slate-300 dark:hover:border-slate-700'
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                                                            <div className={`p-1.5 rounded-lg shrink-0 ${
                                                                                isActive 
                                                                                    ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400' 
                                                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                                                            }`}>
                                                                                <IconComponent size={15} />
                                                                            </div>
                                                                            <div className="min-w-0">
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <span className={`text-xs font-semibold truncate ${
                                                                                        isActive ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                                                                                    }`}>
                                                                                        {cat.label}
                                                                                    </span>
                                                                                    {isDashboard && (
                                                                                        <span title="Core tab (Always visible)" className="inline-flex">
                                                                                            <Lock size={10} className="text-slate-400 shrink-0" />
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate">
                                                                                    {cat.description}
                                                                                </p>
                                                                            </div>
                                                                        </div>

                                                                        {/* Switch Indicator */}
                                                                        <div className="shrink-0">
                                                                            {isDashboard ? (
                                                                                <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Locked</span>
                                                                            ) : (
                                                                                <div className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                                                                                    isActive ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-700'
                                                                                }`}>
                                                                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                                                                        isActive ? 'translate-x-4' : 'translate-x-0.5'
                                                                                    }`} />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>

                            {/* RIGHT SIDE: AI Guardrails & n8n Hub (Spans 1 column) */}
                            <div className="space-y-6">
                                <div className="space-y-4">
                                    <h4 className="border-b border-rose-200 pb-2 text-sm font-bold uppercase text-rose-500 dark:border-rose-800 dark:text-rose-400 flex items-center gap-2">
                                        <ShieldCheck size={16} /> AI Guardrails
                                    </h4>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Daily Stop-Loss (Rs)</label>
                                            <input
                                                type="number"
                                                value={guardrail.thresholds.maxDailyLoss}
                                                onChange={(e) => guardrail.setThresholds({ maxDailyLoss: parseFloat(e.target.value) || 0 })}
                                                className={compactInputClassName}
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Velocity Limit (Losses)</label>
                                            <input
                                                type="number"
                                                value={guardrail.thresholds.maxLossVelocity}
                                                onChange={(e) => guardrail.setThresholds({ maxLossVelocity: parseInt(e.target.value) || 3 })}
                                                className={compactInputClassName}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Revenge Block (Sec)</label>
                                            <input
                                                type="number"
                                                value={guardrail.thresholds.revengeTradeDelay}
                                                onChange={(e) => guardrail.setThresholds({ revengeTradeDelay: parseInt(e.target.value) || 60 })}
                                                className={compactInputClassName}
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Stress Cooldown (Min)</label>
                                            <input
                                                type="number"
                                                value={guardrail.thresholds.highStressCooldown}
                                                onChange={(e) => guardrail.setThresholds({ highStressCooldown: parseInt(e.target.value) || 15 })}
                                                className={compactInputClassName}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* n8n Hub */}
                                <div className="rounded-2xl bg-indigo-50/50 p-4 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-500/20">
                                    <div className="flex items-center justify-between mb-3">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-indigo-500">n8n Nervous System Hub</label>
                                        <button
                                            onClick={async () => {
                                                const ok = await notificationService.sendToNervousSystem('SYSTEM_TEST', { message: 'Nervous System Link Verified' });
                                                if (ok) toast.success('Link Verified: n8n acknowledged signal.');
                                                else toast.error('Link Failed: Check URL or n8n instance.');
                                            }}
                                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-500 flex items-center gap-1"
                                        >
                                            <Signal size={12} /> Test Link
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        value={settings.n8nWebhookUrl}
                                        onChange={(e) => settings.updateSetting('n8nWebhookUrl', e.target.value)}
                                        placeholder="http://localhost:5678/webhook/..."
                                        className={compactInputClassName}
                                    />
                                    <p className="mt-2 text-[10px] text-slate-400 italic">This URL connects your dashboard to Telegram, Notion, and Cloud Alerts.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                        <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-emerald-500 dark:text-emerald-300">Market Grid</p>
                                <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Broker credentials and market feed control</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage Dhan access and external feed providers without leaving the settings shell.</p>
                            </div>
                            <button
                                onClick={() => settings.updateSetting('dataMode', settings.dataMode === 'LIVE' ? 'SIMULATION' : 'LIVE')}
                                className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${settings.dataMode === 'LIVE' ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-500/20' : 'bg-slate-200 text-slate-600 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'}`}
                            >
                                {settings.dataMode === 'LIVE' ? 'Live Mode' : 'Offline Mode'}
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="rounded-[26px] border border-emerald-200/70 bg-emerald-50/70 p-5 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                                <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-emerald-600 dark:text-emerald-400">
                                    <Signal size={16} /> Market Feeds
                                </h4>
                                <div className="mt-4 space-y-4">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">RapidAPI (Indian Stocks)</label>
                                        <input type="password" value={settings.apiKeys?.rapidApi || ''} onChange={(e) => settings.updateSetting('apiKeys', { ...settings.apiKeys, rapidApi: e.target.value })} className={compactInputClassName} placeholder="Key..." />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">FMP (Financials)</label>
                                        <input type="password" value={settings.apiKeys?.fmp || ''} onChange={(e) => settings.updateSetting('apiKeys', { ...settings.apiKeys, fmp: e.target.value })} className={compactInputClassName} placeholder="Key..." />
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-[26px] border border-indigo-200/70 bg-indigo-50/70 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                                <div className="flex items-center justify-between">
                                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-indigo-600 dark:text-indigo-400">
                                        <Database size={16} /> DhanHQ Native
                                    </h4>
                                    <div className="flex items-center gap-3">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Data API</span>
                                        <button
                                            onClick={() => settings.updateSetting('isDhanDataApiEnabled', !settings.isDhanDataApiEnabled)}
                                            className={`relative h-5 w-10 rounded-full transition-colors ${settings.isDhanDataApiEnabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                        >
                                            <motion.div
                                                animate={{ x: settings.isDhanDataApiEnabled ? 20 : 2 }}
                                                className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                            />
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">Client ID</label>
                                        <input
                                            type="text"
                                            value={settings.dhanClientId || ''}
                                            onChange={(e) => settings.updateSetting('dhanClientId', e.target.value)}
                                            onBlur={() => savePersistedBrokerCreds('dhanClientId', settings.dhanClientId)}
                                            className={compactInputClassName}
                                            placeholder="Client ID..."
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">Access Token</label>
                                        <div className="relative group">
                                            <input
                                                type={showDhanToken ? "text" : "password"}
                                                value={settings.dhanAccessToken || ''}
                                                onChange={(e) => settings.updateSetting('dhanAccessToken', e.target.value)}
                                                onBlur={() => savePersistedBrokerCreds('dhanAccessToken', settings.dhanAccessToken)}
                                                className={`${compactInputClassName} pr-20 font-mono`}
                                                placeholder="Access Token..."
                                            />
                                            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setShowDhanToken(!showDhanToken)}
                                                    className="p-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 rounded-lg text-slate-400 hover:text-indigo-500 transition-colors"
                                                    title={showDhanToken ? "Hide Token" : "Show Token"}
                                                >
                                                    {showDhanToken ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                                <button
                                                    onClick={handleCopyToken}
                                                    disabled={!settings.dhanAccessToken}
                                                    className="p-1.5 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 rounded-lg text-slate-400 hover:text-indigo-500 transition-colors disabled:opacity-30"
                                                    title="Copy Token"
                                                >
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">Trading PIN</label>
                                        <input
                                            type="password"
                                            maxLength={6}
                                            value={settings.dhanPin || ''}
                                            onChange={(e) => settings.updateSetting('dhanPin', e.target.value)}
                                            onBlur={() => savePersistedBrokerCreds('dhanPin', settings.dhanPin)}
                                            className={compactInputClassName}
                                            placeholder="PIN..."
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">TOTP Secret</label>
                                        <input
                                            type="password"
                                            value={settings.dhanTotpSecret || ''}
                                            onChange={(e) => settings.updateSetting('dhanTotpSecret', e.target.value)}
                                            onBlur={() => savePersistedBrokerCreds('dhanTotpSecret', settings.dhanTotpSecret)}
                                            className={compactInputClassName}
                                            placeholder="TOTP..."
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">API Key</label>
                                        <input
                                            type="text"
                                            value={settings.dhanApiKey || ''}
                                            onChange={(e) => settings.updateSetting('dhanApiKey', e.target.value)}
                                            onBlur={() => savePersistedBrokerCreds('dhanApiKey', settings.dhanApiKey)}
                                            className={compactInputClassName}
                                            placeholder="API Key..."
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">API Secret</label>
                                        <input
                                            type="password"
                                            value={settings.dhanApiSecret || ''}
                                            onChange={(e) => settings.updateSetting('dhanApiSecret', e.target.value)}
                                            onBlur={() => savePersistedBrokerCreds('dhanApiSecret', settings.dhanApiSecret)}
                                            className={compactInputClassName}
                                            placeholder="API Secret..."
                                        />
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex-1">
                                        <AnimatePresence mode="wait">
                                            {dhanTestResult && (
                                                <motion.div
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: 10 }}
                                                    className={`flex items-center gap-2 text-[11px] font-bold ${dhanTestResult.success ? 'text-emerald-500' : 'text-rose-500'}`}
                                                >
                                                    {dhanTestResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                                                    {dhanTestResult.message}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={handleSaveDhanConfig}
                                            disabled={isSavingDhan}
                                            className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-700 active:scale-95 disabled:opacity-50"
                                            title="Save credentials locally and sync to Cloud VPS"
                                        >
                                            {isSavingDhan ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                                            {isSavingDhan ? 'Saving...' : 'Save Configuration'}
                                        </button>
                                        <button
                                            onClick={handleRegenerateDhanToken}
                                            disabled={isRegeneratingDhan || !settings.dhanClientId || !settings.dhanPin || !settings.dhanTotpSecret}
                                            className="flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-95 disabled:opacity-50"
                                            title="Manually trigger credentials-based silent auto-token generation"
                                        >
                                            {isRegeneratingDhan ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
                                            {isRegeneratingDhan ? 'Generating...' : 'Auto-Generate Token'}
                                        </button>
                                        <button
                                            onClick={handleTestDhan}
                                            disabled={isTestingDhan || !settings.dhanClientId}
                                            className="flex shrink-0 items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-600 active:scale-95 disabled:opacity-50"
                                        >
                                            {isTestingDhan ? <RefreshCw size={14} className="animate-spin" /> : <Signal size={14} />}
                                            {isTestingDhan ? 'Testing...' : 'Test Connection'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Upstox Pro Plus Panel */}
                            <div className="rounded-[26px] border border-orange-200/70 bg-orange-50/70 p-5 dark:border-orange-500/20 dark:bg-orange-500/10">
                                <div className="flex flex-wrap items-center justify-between gap-4">
                                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-orange-600 dark:text-orange-400">
                                        <Zap size={16} /> Upstox Pro Plus Native
                                    </h4>
                                    <div className="flex items-center gap-6">
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Primary Data feed</span>
                                            <button
                                                onClick={() => settings.updateSetting('isUpstoxEnabled', !settings.isUpstoxEnabled)}
                                                className={`relative h-5 w-10 rounded-full transition-colors ${settings.isUpstoxEnabled ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                            >
                                                <motion.div
                                                    animate={{ x: settings.isUpstoxEnabled ? 20 : 2 }}
                                                    className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                                />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Show Order Book Depth</span>
                                            <button
                                                onClick={() => settings.updateSetting('showOrderBookDepth', !settings.showOrderBookDepth)}
                                                className={`relative h-5 w-10 rounded-full transition-colors ${settings.showOrderBookDepth ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                            >
                                                <motion.div
                                                    animate={{ x: settings.showOrderBookDepth ? 20 : 2 }}
                                                    className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                                />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">API Key (Client ID)</label>
                                        <input
                                            type="text"
                                            value={settings.upstoxApiKey || ''}
                                            onChange={(e) => settings.updateSetting('upstoxApiKey', e.target.value)}
                                            onBlur={() => savePersistedBrokerCreds('upstoxApiKey', settings.upstoxApiKey)}
                                            className={compactInputClassName}
                                            placeholder="API Key..."
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">API Secret</label>
                                        <div className="relative group">
                                            <input
                                                type={showUpstoxSecret ? "text" : "password"}
                                                value={settings.upstoxApiSecret || ''}
                                                onChange={(e) => settings.updateSetting('upstoxApiSecret', e.target.value)}
                                                onBlur={() => savePersistedBrokerCreds('upstoxApiSecret', settings.upstoxApiSecret)}
                                                className={`${compactInputClassName} pr-10`}
                                                placeholder="API Secret..."
                                            />
                                            <button
                                                onClick={() => setShowUpstoxSecret(!showUpstoxSecret)}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-orange-500 transition-colors"
                                                title={showUpstoxSecret ? "Hide Secret" : "Show Secret"}
                                            >
                                                {showUpstoxSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">Redirect URI</label>
                                        <input
                                            type="text"
                                            value={settings.upstoxRedirectUri || ''}
                                            onChange={(e) => settings.updateSetting('upstoxRedirectUri', e.target.value)}
                                            onBlur={() => savePersistedBrokerCreds('upstoxRedirectUri', settings.upstoxRedirectUri)}
                                            className={compactInputClassName}
                                            placeholder="Redirect URI..."
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-500">Access Token (Refreshed Daily)</label>
                                        <div className="relative group">
                                            <input
                                                type={showUpstoxToken ? "text" : "password"}
                                                value={settings.upstoxAccessToken || ''}
                                                onChange={(e) => settings.updateSetting('upstoxAccessToken', e.target.value)}
                                                onBlur={() => savePersistedBrokerCreds('upstoxAccessToken', settings.upstoxAccessToken)}
                                                className={`${compactInputClassName} pr-20 font-mono`}
                                                placeholder="Access Token..."
                                            />
                                            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setShowUpstoxToken(!showUpstoxToken)}
                                                    className="p-1.5 hover:bg-orange-50 dark:hover:bg-orange-500/20 rounded-lg text-slate-400 hover:text-orange-500 transition-colors"
                                                    title={showUpstoxToken ? "Hide Token" : "Show Token"}
                                                >
                                                    {showUpstoxToken ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                                <button
                                                    onClick={handleCopyUpstoxToken}
                                                    disabled={!settings.upstoxAccessToken}
                                                    className="p-1.5 hover:bg-orange-50 dark:hover:bg-orange-500/20 rounded-lg text-slate-400 hover:text-orange-500 transition-colors disabled:opacity-30"
                                                    title="Copy Token"
                                                >
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                                    <div className="flex-1">
                                        <AnimatePresence mode="wait">
                                            {upstoxTestResult && (
                                                <motion.div
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: 10 }}
                                                    className={`flex items-center gap-2 text-[11px] font-bold ${upstoxTestResult.success ? 'text-emerald-500' : 'text-rose-500'}`}
                                                >
                                                    {upstoxTestResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                                                    {upstoxTestResult.message}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            onClick={handleSaveUpstoxConfig}
                                            disabled={isSavingUpstox}
                                            className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-700 active:scale-95 disabled:opacity-50"
                                            title="Save credentials locally and sync to Cloud VPS"
                                        >
                                            {isSavingUpstox ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                                            {isSavingUpstox ? 'Saving...' : 'Save Configuration'}
                                        </button>
                                        <button
                                            onClick={() => {
                                                const url = upstoxAuthService.buildAuthUrl();
                                                if (url) {
                                                    upstoxAuthService.syncCredentials(settings.upstoxApiKey, settings.upstoxApiSecret, settings.upstoxRedirectUri).catch(() => {});
                                                    window.location.href = url;
                                                } else {
                                                    toast.error('API Key is required to authorize.');
                                                }
                                            }}
                                            className="flex shrink-0 items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-orange-500/20 transition-all hover:bg-orange-600 active:scale-95"
                                        >
                                            <Zap size={14} />
                                            Authorize Upstox
                                        </button>
                                        <button
                                            onClick={handleTestUpstox}
                                            disabled={isTestingUpstox}
                                            className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-700 active:scale-95 disabled:opacity-50"
                                        >
                                            {isTestingUpstox ? <RefreshCw size={14} className="animate-spin" /> : <Signal size={14} />}
                                            {isTestingUpstox ? 'Testing...' : 'Test Connection'}
                                        </button>
                                    </div>
                                </div>
                                {settings.isUpstoxEnabled && <UpstoxDiagnosticsBoard />}
                            </div>
                        </div>
                    </div>

                    {/* Breakthrough 6: Omni-Alert System */}
                    <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-rose-500 dark:text-rose-400">Omni-Alert System</p>
                                <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Multi-channel price breakouts, news, and voice alerts</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Configure real-time momentum spikes, Telegram bot integration, and Jarvis voice controls.</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-bold text-slate-900 dark:text-white">Enable Alert Engine</span>
                                <button
                                    onClick={() => settings.updateSetting('omniAlertEnabled', !settings.omniAlertEnabled)}
                                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${settings.omniAlertEnabled ? 'bg-rose-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.omniAlertEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>

                        {settings.omniAlertEnabled && (
                            <div className="space-y-6">
                                {/* Telegram bot and channel configuration */}
                                {/* Telegram bot and channel configuration */}
                                <div className="rounded-[26px] border border-indigo-200/70 bg-indigo-50/70 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                                    <div className="flex items-center justify-between">
                                        <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-indigo-600 dark:text-indigo-400">
                                            <Bot size={16} /> Telegram Automation & Alert Bots
                                        </h4>
                                        <button
                                            onClick={handleAddBot}
                                            className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white shadow-md shadow-indigo-500/20 transition-all hover:bg-indigo-600 active:scale-95"
                                        >
                                            <Plus size={12} /> Add Bot
                                        </button>
                                    </div>
                                    
                                    <div className="mt-4 space-y-4">
                                        {(!settings.telegramBots || settings.telegramBots.length === 0) ? (
                                            <p className="text-xs text-slate-500 italic py-2">No bots configured. Click Add Bot to configure your first Telegram bot.</p>
                                        ) : (
                                            settings.telegramBots.map((bot) => {
                                                const showToken = showBotTokens[bot.id] || false;
                                                const testResult = botTestResults[bot.id];
                                                const isTesting = testingBotId === bot.id;
                                                
                                                return (
                                                    <div key={bot.id} className="rounded-2xl border border-indigo-100 bg-white/50 p-4 dark:border-indigo-950/30 dark:bg-slate-900/50 space-y-3 shadow-sm">
                                                        <div className="flex items-center justify-between gap-4 flex-wrap">
                                                            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                                                <input
                                                                    type="text"
                                                                    value={bot.name || ''}
                                                                    onChange={(e) => handleUpdateBot(bot.id, { name: e.target.value })}
                                                                    className="bg-transparent border-b border-dashed border-slate-300 hover:border-slate-500 dark:border-slate-700 dark:hover:border-slate-500 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors py-0.5 px-1 flex-1"
                                                                    placeholder="Bot Name (e.g. Alerts Bot)..."
                                                                />
                                                                <span className="text-[9px] uppercase tracking-wider bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-bold px-2 py-0.5 rounded-full select-none">
                                                                    {bot.role === 'none' ? 'No Role' : bot.role}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-4">
                                                                {/* Enabled Toggle */}
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-bold">Active</span>
                                                                    <button
                                                                        onClick={() => handleUpdateBot(bot.id, { enabled: !bot.enabled })}
                                                                        className={`relative h-4 w-8 rounded-full transition-colors ${bot.enabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                                                    >
                                                                        <motion.div
                                                                            animate={{ x: bot.enabled ? 16 : 2 }}
                                                                            className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm"
                                                                        />
                                                                    </button>
                                                                </div>
                                                                {/* Delete Button */}
                                                                <button
                                                                    onClick={() => handleDeleteBot(bot.id)}
                                                                    className="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-slate-400 hover:text-rose-500 rounded-lg transition-colors"
                                                                    title="Delete Bot"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                                                            <div>
                                                                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-bold">Bot Token</label>
                                                                <div className="relative">
                                                                    <input
                                                                        type={showToken ? "text" : "password"}
                                                                        value={bot.token || ''}
                                                                        onChange={(e) => handleUpdateBot(bot.id, { token: e.target.value })}
                                                                        className={`${compactInputClassName} pr-8`}
                                                                        placeholder="Token (from @BotFather)..."
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setShowBotTokens(prev => ({ ...prev, [bot.id]: !showToken }))}
                                                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                                                                    >
                                                                        {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            
                                                            <div>
                                                                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-bold">Chat ID / Channel ID</label>
                                                                <input
                                                                    type="text"
                                                                    value={bot.chatId || ''}
                                                                    onChange={(e) => handleUpdateBot(bot.id, { chatId: e.target.value })}
                                                                    className={compactInputClassName}
                                                                    placeholder="e.g. -1001234567..."
                                                                />
                                                            </div>
                                                            
                                                            <div>
                                                                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-bold">System Role</label>
                                                                <CustomSelect
                                                                    value={bot.role || 'none'}
                                                                    onChange={(val) => handleUpdateBot(bot.id, { role: val as any })}
                                                                    options={[
                                                                        { id: 'none', name: 'None (Custom Webhooks)' },
                                                                        { id: 'alerts', name: 'Alerts (Main Dashboard Notification)' },
                                                                        { id: 'autopilot', name: 'Autopilot Signals' },
                                                                        { id: 'n8n', name: 'n8n Bridge Bot' }
                                                                    ]}
                                                                />
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="flex items-center justify-between gap-4 pt-1 flex-wrap">
                                                            <div className="text-[10px] text-slate-400 flex items-center gap-1 font-medium">
                                                                <Info size={12} />
                                                                {bot.role === 'alerts' && "Sends all circuit breaker, momentum breakouts, and voice notifications."}
                                                                {bot.role === 'autopilot' && "Executes automated autopilot signals on Dhan/Upstox."}
                                                                {bot.role === 'n8n' && "Used to bridge signals into n8n workflows."}
                                                                {bot.role === 'none' && "No default role. Send payloads via custom webhook triggers."}
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                {testResult && (
                                                                    <span className={`text-[10px] font-bold ${testResult.success ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                        {testResult.message}
                                                                    </span>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleTestSpecificBot(bot)}
                                                                    disabled={isTesting || !bot.token}
                                                                    className="flex items-center gap-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 px-3 py-1 text-[11px] font-bold hover:bg-indigo-500 hover:text-white dark:hover:bg-indigo-500 dark:hover:text-white transition-all disabled:opacity-50"
                                                                >
                                                                    {isTesting ? <RefreshCw size={12} className="animate-spin" /> : <Signal size={12} />}
                                                                    Test Connection
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>

                                {/* Momentum spike detector rules */}
                                <div className="rounded-[26px] border border-rose-200/70 bg-rose-50/70 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
                                    <div className="flex items-center justify-between">
                                        <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-rose-600 dark:text-rose-400">
                                            <Activity size={16} /> Momentum Spike Detector
                                        </h4>
                                        <div className="flex items-center gap-3">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-bold">Detector Active</span>
                                            <button
                                                onClick={() => settings.updateSetting('omniAlertSpikeEnabled', !settings.omniAlertSpikeEnabled)}
                                                className={`relative h-5 w-10 rounded-full transition-colors ${settings.omniAlertSpikeEnabled ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                            >
                                                <motion.div
                                                    animate={{ x: settings.omniAlertSpikeEnabled ? 20 : 2 }}
                                                    className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                                />
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {settings.omniAlertSpikeEnabled ? (
                                        <div className="mt-4 space-y-4">
                                            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                                                <div>
                                                    <CustomSelect
                                                        label="Spike Mode"
                                                        value={settings.omniAlertSpikeMode || 'B'}
                                                        onChange={(val) => settings.updateSetting('omniAlertSpikeMode', val)}
                                                        options={[
                                                            { id: 'A', name: 'Mode A (0.5% in 3 min - Aggressive)' },
                                                            { id: 'B', name: 'Mode B (1.0% in 5 min - Balanced)' },
                                                            { id: 'C', name: 'Mode C (1.0% in 5 min OR News - News Focused)' },
                                                            { id: 'D', name: 'Mode D (Custom / Index Specific)' }
                                                        ]}
                                                    />
                                                </div>
                                                <div>
                                                    <CustomSelect
                                                        label="Alert Scope"
                                                        value={settings.omniAlertScope || 'B'}
                                                        onChange={(val) => settings.updateSetting('omniAlertScope', val)}
                                                        options={[
                                                            { id: 'A', name: 'Smart Watchlist Only' },
                                                            { id: 'B', name: 'Watchlist + Open Positions' },
                                                            { id: 'C', name: 'Watchlist + Positions + Top R-Factor' }
                                                        ]}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="mb-1 block text-xs font-semibold text-slate-500 font-bold">Volume Multiplier Threshold</label>
                                                    <input
                                                        type="number"
                                                        step="0.5"
                                                        value={settings.omniAlertVolumeSurgeMultiplier ?? 3.0}
                                                        onChange={(e) => settings.updateSetting('omniAlertVolumeSurgeMultiplier', parseFloat(e.target.value) || 3.0)}
                                                        className={compactInputClassName}
                                                    />
                                                </div>
                                            </div>

                                            {settings.omniAlertSpikeMode === 'D' && (
                                                <div className="grid gap-4 grid-cols-2">
                                                    <div>
                                                        <label className="mb-1 block text-xs font-semibold text-slate-500 font-bold">Custom Percent Threshold (%)</label>
                                                        <input
                                                            type="number"
                                                            step="0.05"
                                                            value={settings.omniAlertCustomPctThreshold ?? 0.75}
                                                            onChange={(e) => settings.updateSetting('omniAlertCustomPctThreshold', parseFloat(e.target.value) || 0.75)}
                                                            className={compactInputClassName}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="mb-1 block text-xs font-semibold text-slate-500 font-bold">Custom Window (Minutes)</label>
                                                        <input
                                                            type="number"
                                                            value={settings.omniAlertCustomWindowMinutes ?? 5}
                                                            onChange={(e) => settings.updateSetting('omniAlertCustomWindowMinutes', parseInt(e.target.value) || 5)}
                                                            className={compactInputClassName}
                                                        />
                                                    </div>
                                                </div>
                                            )}

                                            {settings.omniAlertScope === 'C' && (
                                                <div>
                                                    <label className="mb-1 block text-xs font-semibold text-slate-500 font-bold">Top N Stocks by R-Factor</label>
                                                    <input
                                                        type="number"
                                                        value={settings.omniAlertScopeTopNByRFactor ?? 10}
                                                        onChange={(e) => settings.updateSetting('omniAlertScopeTopNByRFactor', parseInt(e.target.value) || 10)}
                                                        className={compactInputClassName}
                                                    />
                                                </div>
                                            )}

                                            <div className="grid gap-4 sm:grid-cols-2">
                                                <div>
                                                    <label className="mb-1 block text-xs font-semibold text-slate-500 font-bold">Alert Cooldown (Minutes)</label>
                                                    <input
                                                        type="number"
                                                        value={settings.omniAlertCooldownMinutes ?? 10}
                                                        onChange={(e) => settings.updateSetting('omniAlertCooldownMinutes', parseInt(e.target.value) || 10)}
                                                        className={compactInputClassName}
                                                    />
                                                </div>
                                                <div className="flex flex-col justify-end pb-1 space-y-2">
                                                    <label className="flex items-center gap-3 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={settings.omniAlertNewsAlwaysFires ?? true}
                                                            onChange={(e) => settings.updateSetting('omniAlertNewsAlwaysFires', e.target.checked)}
                                                            className="rounded border-slate-300 text-rose-500 focus:ring-rose-500"
                                                        />
                                                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Breaking news alert always bypasses cooldown</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="mt-3 text-xs text-slate-500 italic">
                                            Momentum spike detector is inactive. Turn on to monitor breakouts, surges, and news triggers.
                                        </p>
                                    )}
                                </div>

                                {/* Voice and broker sync preferences */}
                                <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
                                    {/* Left Side: Staggered Toggles Stack (span-1) */}
                                    <div className="flex flex-col gap-4 lg:col-span-1">
                                        {/* Jarvis Voice Announcements */}
                                        <div className="rounded-[26px] border border-orange-200/70 bg-orange-50/70 p-5 dark:border-orange-500/20 dark:bg-orange-500/10 flex flex-col justify-between h-fit">
                                            <div>
                                                <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-orange-600 dark:text-orange-400">
                                                    {!settings.jarvisMuted ? <Volume2 size={16} /> : <VolumeX size={16} />} Jarvis Voice
                                                </h4>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    Announces ORB, breakouts, and HFT velocity alerts out loud.
                                                </p>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between border-t border-orange-100 dark:border-orange-500/15 pt-2">
                                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Voice Synthesis</span>
                                                <button
                                                    onClick={() => settings.updateSetting('omniAlertJarvisVoice', !settings.omniAlertJarvisVoice)}
                                                    className={`relative h-5 w-10 rounded-full transition-colors ${settings.omniAlertJarvisVoice ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                                >
                                                    <motion.div
                                                        animate={{ x: settings.omniAlertJarvisVoice ? 20 : 2 }}
                                                        className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                                    />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Dhan Server Alerts */}
                                        <div className="rounded-[26px] border border-emerald-200/70 bg-emerald-50/70 p-5 dark:border-emerald-500/20 dark:bg-emerald-500/10 flex flex-col justify-between h-fit">
                                            <div>
                                                <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-emerald-600 dark:text-emerald-400">
                                                    <ShieldCheck size={16} /> Dhan Server Sync
                                                </h4>
                                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                                    Automatically sync Day High/Low ranges to Dhan price alerts.
                                                </p>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between border-t border-emerald-100 dark:border-emerald-500/15 pt-2">
                                                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Auto-Sync Active</span>
                                                <button
                                                    onClick={() => settings.updateSetting('dhanDayHLAlertsEnabled', !settings.dhanDayHLAlertsEnabled)}
                                                    className={`relative h-5 w-10 rounded-full transition-colors ${settings.dhanDayHLAlertsEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                                >
                                                    <motion.div
                                                        animate={{ x: settings.dhanDayHLAlertsEnabled ? 20 : 2 }}
                                                        className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                                    />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Side: Index & Trigger Selectors + Index Velocity (HFT Mode) (span-2) */}
                                    <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {/* Card 1: Index & Trigger Selectors */}
                                        <div className="rounded-[26px] border border-indigo-200/70 bg-indigo-50/70 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/10 flex flex-col justify-between space-y-4">
                                            <div>
                                                <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-indigo-600 dark:text-indigo-400">
                                                    <Target size={16} /> Index & Trigger Selectors
                                                </h4>
                                                <p className="mt-2 text-xs text-slate-500">
                                                    Customize monitored indices and standard breakout triggers in real-time.
                                                </p>
                                            </div>
                                            <div className="border-t border-indigo-100 dark:border-indigo-500/15 pt-3 space-y-3">
                                                <div>
                                                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-bold">Monitored Indices</label>
                                                    <div className="flex flex-wrap gap-2 mt-1">
                                                        {['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'].map((idx) => {
                                                            const enabled = (settings.orbAlertIndices || ['NIFTY', 'BANKNIFTY', 'SENSEX']).includes(idx);
                                                            return (
                                                                <button
                                                                    key={idx}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const currentList = settings.orbAlertIndices || ['NIFTY', 'BANKNIFTY', 'SENSEX'];
                                                                        const newList = enabled
                                                                            ? currentList.filter((x) => x !== idx)
                                                                            : [...currentList, idx];
                                                                        settings.updateSetting('orbAlertIndices', newList);
                                                                        toast.success(`${idx} monitoring ${enabled ? 'disabled' : 'enabled'}`);
                                                                    }}
                                                                    className={`rounded-lg px-2.5 py-1.5 text-[10px] font-black tracking-wider transition-all active:scale-95 ${
                                                                        enabled
                                                                            ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/20'
                                                                            : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                                                                    }`}
                                                                >
                                                                    {idx}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                <div>
                                                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-bold">Trigger Types</label>
                                                    <div className="flex flex-wrap gap-2 mt-1">
                                                        {[
                                                            { key: 'ORB_BREAKOUT', label: 'ORB Breakout' },
                                                            { key: 'HOD_BREAKOUT', label: 'HOD Breach' },
                                                            { key: 'LOD_BREAKOUT', label: 'LOD Breach' },
                                                            { key: 'HOD_PROXIMITY', label: 'HOD Proximity' },
                                                            { key: 'LOD_PROXIMITY', label: 'LOD Proximity' }
                                                        ].map((t) => {
                                                            const enabled = (settings.enabledOrbTriggerTypes || ['ORB_BREAKOUT', 'HOD_BREAKOUT', 'LOD_BREAKOUT', 'HOD_PROXIMITY', 'LOD_PROXIMITY']).includes(t.key);
                                                            return (
                                                                <button
                                                                    key={t.key}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const currentList = settings.enabledOrbTriggerTypes || ['ORB_BREAKOUT', 'HOD_BREAKOUT', 'LOD_BREAKOUT', 'HOD_PROXIMITY', 'LOD_PROXIMITY'];
                                                                        const newList = enabled
                                                                            ? currentList.filter((x) => x !== t.key)
                                                                            : [...currentList, t.key];
                                                                        settings.updateSetting('enabledOrbTriggerTypes', newList);
                                                                        toast.success(`${t.label} alert ${enabled ? 'disabled' : 'enabled'}`);
                                                                    }}
                                                                    className={`rounded-lg px-2 py-1 text-[9px] font-black tracking-wider transition-all active:scale-95 ${
                                                                        enabled
                                                                            ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                                                                            : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                                                                    }`}
                                                                >
                                                                    {t.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Card 2: Index Velocity Alerts (HFT Mode) */}
                                        <div className="rounded-[26px] border border-violet-200/70 bg-violet-50/70 p-5 dark:border-violet-500/20 dark:bg-violet-500/10 flex flex-col justify-between space-y-4">
                                            <div>
                                                <div className="flex items-center justify-between">
                                                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-violet-600 dark:text-violet-400">
                                                        <Activity size={16} /> Index Velocity (HFT)
                                                    </h4>
                                                    <button
                                                        type="button"
                                                        onClick={() => settings.updateSetting('indexVelocityAlertsEnabled', !settings.indexVelocityAlertsEnabled)}
                                                        className={`relative h-5 w-10 rounded-full transition-colors ${settings.indexVelocityAlertsEnabled ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                                    >
                                                        <motion.div
                                                            animate={{ x: settings.indexVelocityAlertsEnabled ? 20 : 2 }}
                                                            className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                                        />
                                                    </button>
                                                </div>
                                                <p className="mt-2 text-xs text-slate-500">
                                                    High-speed, millisecond-precision momentum tracking for fast market sweeps.
                                                </p>
                                            </div>
                                            
                                            <div className="border-t border-violet-100 dark:border-violet-500/15 pt-3 space-y-3">
                                                {settings.indexVelocityAlertsEnabled ? (
                                                    <div className="space-y-3 pt-1">
                                                        <CustomSelect
                                                            label="Velocity Sensitivity"
                                                            value={settings.indexVelocityMode || 'B'}
                                                            onChange={(val) => settings.updateSetting('indexVelocityMode', val as any)}
                                                            options={[
                                                                { id: 'A', name: 'Mode A (Aggressive - 5s / 0.05%)' },
                                                                { id: 'B', name: 'Mode B (Balanced - 15s / 0.10%)' },
                                                                { id: 'C', name: 'Mode C (Macro - 30s / 0.20%)' },
                                                                { id: 'D', name: 'Mode D (Custom Thresholds)' }
                                                            ]}
                                                        />

                                                        {settings.indexVelocityMode === 'D' && (
                                                            <div className="grid grid-cols-2 gap-2 bg-white/40 dark:bg-slate-900/30 p-2 rounded-xl border border-violet-100/50 dark:border-violet-500/10">
                                                                <div>
                                                                    <label className="mb-1 block text-[9px] font-bold uppercase text-slate-400">Window (sec)</label>
                                                                    <input
                                                                        type="number"
                                                                        value={settings.indexVelocityCustomWindow ?? 10}
                                                                        onChange={(e) => settings.updateSetting('indexVelocityCustomWindow', parseInt(e.target.value) || 10)}
                                                                        className="w-full rounded-lg border border-slate-200 bg-white/80 p-1 text-[10px] text-slate-800 outline-none focus:border-violet-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold"
                                                                        min="2"
                                                                        max="120"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="mb-1 block text-[9px] font-bold uppercase text-slate-400">Threshold (%)</label>
                                                                    <input
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={settings.indexVelocityCustomPct ?? 0.08}
                                                                        onChange={(e) => settings.updateSetting('indexVelocityCustomPct', parseFloat(e.target.value) || 0.08)}
                                                                        className="w-full rounded-lg border border-slate-200 bg-white/80 p-1 text-[10px] text-slate-800 outline-none focus:border-violet-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold"
                                                                        min="0.01"
                                                                        max="5.0"
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div>
                                                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400 font-bold">Cooldown (minutes)</label>
                                                            <input
                                                                type="number"
                                                                value={settings.indexVelocityCooldownMinutes ?? 3}
                                                                onChange={(e) => settings.updateSetting('indexVelocityCooldownMinutes', parseInt(e.target.value) || 3)}
                                                                className="w-full rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold h-[38px]"
                                                                min="1"
                                                                max="60"
                                                            />
                                                        </div>

                                                        {/* ── HFT Velocity Auto-Trading (SANDBOX ONLY) ── */}
                                                        <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-3 space-y-3 dark:border-rose-500/20 dark:bg-rose-500/10">
                                                            <div className="flex items-center justify-between">
                                                                <h5 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
                                                                    ⚡ Auto-Trading · SANDBOX ONLY
                                                                </h5>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const next = !(settings.hftAutoTradeSandboxEnabled === true);
                                                                        settings.updateSetting('hftAutoTradeSandboxEnabled', next);
                                                                        toast.success(next
                                                                            ? 'Sandbox auto-trading ENABLED - orders go to OpenAlgo paper environment only'
                                                                            : 'Sandbox auto-trading disabled - alerts only');
                                                                    }}
                                                                    className={`relative h-5 w-10 rounded-full transition-colors ${settings.hftAutoTradeSandboxEnabled ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                                                    aria-label="Toggle sandbox auto-trading"
                                                                >
                                                                    <motion.div
                                                                        animate={{ x: settings.hftAutoTradeSandboxEnabled ? 20 : 2 }}
                                                                        className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                                                    />
                                                                </button>
                                                            </div>
                                                            <p className="text-[10px] leading-snug text-slate-500">
                                                                When a closed {settings.hftConfirmWindowMinutes || 2}-min NIFTY candle moves ≥ <b>{settings.hftVolMultiplier || 4}x</b> its rolling volatility, buy the ATM CE (up) / PE (down) in the OpenAlgo <b>paper sandbox</b>. No real-money path exists.
                                                            </p>
                                                            {settings.hftAutoTradeSandboxEnabled && (
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    <div>
                                                                        <label className="mb-1 block text-[9px] font-bold uppercase text-slate-400">Vol Multiplier</label>
                                                                        <input type="number" step="0.5" min="2" max="10"
                                                                            value={settings.hftVolMultiplier ?? 4}
                                                                            onChange={(e) => settings.updateSetting('hftVolMultiplier', parseFloat(e.target.value) || 4)}
                                                                            className="w-full rounded-lg border border-slate-200 bg-white/80 p-1 text-[10px] text-slate-800 outline-none focus:border-rose-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="mb-1 block text-[9px] font-bold uppercase text-slate-400">Max Trades/Day</label>
                                                                        <input type="number" min="1" max="20"
                                                                            value={settings.hftMaxTradesPerDay ?? 5}
                                                                            onChange={(e) => settings.updateSetting('hftMaxTradesPerDay', parseInt(e.target.value) || 5)}
                                                                            className="w-full rounded-lg border border-slate-200 bg-white/80 p-1 text-[10px] text-slate-800 outline-none focus:border-rose-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="mb-1 block text-[9px] font-bold uppercase text-slate-400">Quantity</label>
                                                                        <input type="number" min="25" step="25"
                                                                            value={settings.hftQuantity ?? 75}
                                                                            onChange={(e) => settings.updateSetting('hftQuantity', parseInt(e.target.value) || 75)}
                                                                            className="w-full rounded-lg border border-slate-200 bg-white/80 p-1 text-[10px] text-slate-800 outline-none focus:border-rose-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white font-semibold" />
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <p className="text-xs text-slate-500 italic py-4 text-center">
                                                        Index velocity tracking is disabled.
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Breakthrough 7: Momentum Pool Settings */}
                    <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500 dark:text-indigo-400">Momentum Pool Settings</p>
                                <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Auto-watch and target alert rules</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Configure parameters for automatic channel-to-pool imports and level checks.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="rounded-[26px] border border-indigo-200/70 bg-indigo-50/70 p-5 dark:border-indigo-500/20 dark:bg-indigo-500/10 flex flex-col justify-between space-y-4">
                                <div>
                                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-indigo-600 dark:text-indigo-400">
                                        <Bot size={16} /> Auto-Pool from Telegram
                                    </h4>
                                    <p className="mt-2 text-xs text-slate-500">
                                        Automatically watch signals received from channels matching your trust score threshold.
                                    </p>
                                </div>
                                <div className="flex items-center justify-between border-t border-indigo-100 dark:border-indigo-500/15 pt-3">
                                    <span className="text-xs font-semibold text-slate-650 dark:text-slate-350">Auto-Pool Active</span>
                                    <button
                                        onClick={() => settings.updateSetting('autoPoolEnabled', !settings.autoPoolEnabled)}
                                        className={`relative h-5 w-10 rounded-full transition-colors ${settings.autoPoolEnabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                    >
                                        <motion.div
                                            animate={{ x: settings.autoPoolEnabled ? 20 : 2 }}
                                            className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                        />
                                    </button>
                                </div>
                            </div>

                            <div className="rounded-[26px] border border-violet-200/70 bg-violet-50/70 p-5 dark:border-violet-500/20 dark:bg-violet-500/10 flex flex-col justify-between space-y-4">
                                <div>
                                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-violet-600 dark:text-violet-400">
                                        <Signal size={16} /> Trust Threshold
                                    </h4>
                                    <p className="mt-2 text-xs text-slate-500">
                                        Minimum signal provider trust score required to trigger an automatic Pool addition.
                                    </p>
                                </div>
                                <div className="border-t border-violet-100 dark:border-violet-500/15 pt-3 space-y-2">
                                    <div className="flex justify-between text-xs font-bold text-slate-555 dark:text-slate-455">
                                        <span>Min Win Rate:</span>
                                        <span className="text-violet-600 dark:text-violet-400">{settings.autoPoolTrustThreshold}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="50"
                                        max="100"
                                        value={settings.autoPoolTrustThreshold}
                                        onChange={(e) => settings.updateSetting('autoPoolTrustThreshold', parseInt(e.target.value) || 80)}
                                        className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-600"
                                    />
                                </div>
                            </div>

                            <div className="rounded-[26px] border border-emerald-200/70 bg-emerald-50/70 p-5 dark:border-emerald-500/20 dark:bg-emerald-500/10 flex flex-col justify-between space-y-4">
                                <div>
                                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-emerald-600 dark:text-emerald-400">
                                        <Activity size={16} /> Market Hours Only
                                    </h4>
                                    <p className="mt-2 text-xs text-slate-500">
                                        Limit Momentum Pool polling strictly to active trading hours (09:15 to 15:30 IST).
                                    </p>
                                </div>
                                <div className="flex items-center justify-between border-t border-emerald-100 dark:border-emerald-500/15 pt-3">
                                    <span className="text-xs font-semibold text-slate-650 dark:text-slate-350">Market Hours Only</span>
                                    <button
                                        onClick={() => settings.updateSetting('poolMarketHoursOnly', !settings.poolMarketHoursOnly)}
                                        className={`relative h-5 w-10 rounded-full transition-colors ${settings.poolMarketHoursOnly ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                    >
                                        <motion.div
                                            animate={{ x: settings.poolMarketHoursOnly ? 20 : 2 }}
                                            className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                        <div className="mb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                            <div>
                                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-indigo-500 dark:text-indigo-300">AI Stack</p>
                                <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Model routing and intelligence keys</h3>
                                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose the primary reasoning model while keeping the fallback pipeline ready.</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:ring-emerald-500/20">
                                    <Signal size={12} /> AIR Pipeline Active
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">AI Auto-Polling</span>
                                    <button
                                        onClick={() => settings.updateSetting('isAICoachEnabled', !settings.isAICoachEnabled)}
                                        className={`relative h-5 w-10 rounded-full transition-colors ${settings.isAICoachEnabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                                    >
                                        <motion.div
                                            animate={{ x: settings.isAICoachEnabled ? 20 : 2 }}
                                            className="absolute top-1 h-3 w-3 rounded-full bg-white shadow-sm"
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-4">
                                <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
                                    <Brain size={16} /> API Infrastructure
                                </h4>
                                <div className="grid grid-cols-1 gap-3">
                                    {/* OmniRoute AI Gateway Settings */}
                                    <div className="p-3 bg-indigo-950/40 border border-indigo-500/30 rounded-xl space-y-2 mb-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Globe className="w-4 h-4 text-emerald-400" />
                                                <span className="text-xs font-bold text-indigo-200 uppercase tracking-wider">OmniRoute Gateway (290+ Providers)</span>
                                            </div>
                                            <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                ~1.53B Free Tokens/Mo
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 pt-1">
                                            <div>
                                                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Proxy Base Endpoint</label>
                                                <input
                                                    type="text"
                                                    value={settings.omnirouteEndpoint || 'http://localhost:20128/v1'}
                                                    onChange={(e) => settings.updateSetting('omnirouteEndpoint', e.target.value)}
                                                    className={compactInputClassName}
                                                    placeholder="http://localhost:20128/v1"
                                                />
                                            </div>
                                            <div>
                                                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Master API Key</label>
                                                <input
                                                    type="password"
                                                    value={settings.omnirouteApiKey || 'OR-wealthos-master-key'}
                                                    onChange={(e) => settings.updateSetting('omnirouteApiKey', e.target.value)}
                                                    className={compactInputClassName}
                                                    placeholder="OR-..."
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Google Gemini</label>
                                        <input type="password" value={settings.geminiApiKey} onChange={(e) => handleChange('geminiApiKey', e.target.value)} className={compactInputClassName} placeholder="AIzaSy..." />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Groq</label>
                                            <input type="password" value={settings.groqApiKey} onChange={(e) => handleChange('groqApiKey', e.target.value)} className={compactInputClassName} placeholder="gsk_..." />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">OpenRouter</label>
                                            <input type="password" value={settings.openRouterApiKey} onChange={(e) => handleChange('openRouterApiKey', e.target.value)} className={compactInputClassName} placeholder="sk-or-..." />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Mistral</label>
                                            <input type="password" value={settings.mistralApiKey || ''} onChange={(e) => settings.updateSetting('mistralApiKey', e.target.value)} className={compactInputClassName} placeholder="Key..." />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Cerebras</label>
                                            <input type="password" value={settings.cerebrasApiKey || ''} onChange={(e) => settings.updateSetting('cerebrasApiKey', e.target.value)} className={compactInputClassName} placeholder="Key..." />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">GitHub</label>
                                            <input type="password" value={settings.githubToken || ''} onChange={(e) => settings.updateSetting('githubToken', e.target.value)} className={compactInputClassName} placeholder="ghp_..." />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">CF Account ID</label>
                                            <input type="text" value={settings.cloudflareAccountId || ''} onChange={(e) => settings.updateSetting('cloudflareAccountId', e.target.value)} className={compactInputClassName} placeholder="ID..." />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase text-slate-500 dark:text-slate-400">
                                        <Cpu size={16} /> AIR Pipeline Routing
                                    </h4>
                                    <a href="https://github.com/cheahjs/free-llm-api-resources" target="_blank" rel="noopener noreferrer" className="text-[10px] font-black uppercase tracking-wider text-indigo-500 hover:text-indigo-400 transition-colors">
                                        Get Free Keys & Guide
                                    </a>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-2">
                                    {/* Ambient Insights */}
                                    <PremiumSelect
                                        label="Ambient Insights"
                                        value={settings.modelGeneralId || ''}
                                        onChange={(val) => settings.updateSetting('modelGeneralId', val)}
                                        options={MODEL_REGISTRY}
                                    />

                                    {/* AI Coach */}
                                    <PremiumSelect
                                        label="AI Trading Coach"
                                        value={settings.modelCoachId || ''}
                                        onChange={(val) => settings.updateSetting('modelCoachId', val)}
                                        options={MODEL_REGISTRY}
                                    />

                                    {/* Deep Insights */}
                                    <PremiumSelect
                                        label="Deep Logic Engine"
                                        value={settings.modelInsightsId || ''}
                                        onChange={(val) => settings.updateSetting('modelInsightsId', val)}
                                        options={MODEL_REGISTRY}
                                    />

                                    {/* Alpha Engine */}
                                    <PremiumSelect
                                        label="Alpha Predator Engine"
                                        value={settings.modelAlphaEngineId || ''}
                                        onChange={(val) => settings.updateSetting('modelAlphaEngineId', val)}
                                        options={MODEL_REGISTRY}
                                    />

                                    {/* Macro Pulse */}
                                    <PremiumSelect
                                        label="Macro Pulse AI"
                                        value={settings.modelMacroPulseId || ''}
                                        onChange={(val) => settings.updateSetting('modelMacroPulseId', val)}
                                        options={MODEL_REGISTRY}
                                    />

                                    {/* Trade Journal */}
                                    <PremiumSelect
                                        label="Trade Journal AI"
                                        value={settings.modelJournalId || ''}
                                        onChange={(val) => settings.updateSetting('modelJournalId', val)}
                                        options={MODEL_REGISTRY}
                                    />

                                    {/* Telegram News Analyst */}
                                    <PremiumSelect
                                        label="Telegram News Analyst"
                                        value={settings.modelTelegramNewsId || ''}
                                        onChange={(val) => settings.updateSetting('modelTelegramNewsId', val)}
                                        options={MODEL_REGISTRY}
                                    />

                                    {/* Telegram Ear Summarizer */}
                                    <PremiumSelect
                                        label="Telegram Ear Summarizer"
                                        value={settings.modelTelegramEarId || ''}
                                        onChange={(val) => settings.updateSetting('modelTelegramEarId', val)}
                                        options={MODEL_REGISTRY}
                                    />
                                </div>

                                <div className="mt-4">
                                    <PremiumSelect
                                        label="Global Fallback Target"
                                        value={settings.preferredModelId || ''}
                                        onChange={(val) => handleChange('preferredModelId', val)}
                                        options={MODEL_REGISTRY}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="mt-6 border-t border-slate-100 pt-6 dark:border-slate-800">
                            <QuotaMonitor />
                        </div>
                    </div>

                    <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                        <ApiKeyPoolPanel />
                    </div>

                    <div className="rounded-2xl sm:rounded-[30px] border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none min-w-0 max-w-full overflow-hidden">
                        <div className="mb-6">
                            <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                                <Database size={14} /> Data & Recovery
                            </p>
                            <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Backup, restore, sync health, and privacy</h3>
                        </div>
                        <DataBackupSettings />
                        <div className="mt-8 border-t border-slate-200 pt-8 dark:border-slate-800 min-w-0 max-w-full overflow-hidden">
                            <MlModelsPanel />
                        </div>
                        <div className="mt-8 border-t border-slate-200 pt-8 dark:border-slate-800">
                            <SecurityPrivacyPanel />
                        </div>
                        <div className="mt-8 border-t border-slate-200 pt-8 dark:border-slate-800">
                            <RecentlyDeletedPanel />
                        </div>

                        {/* CC50 — Help section with "Restart tour" affordance. */}
                        <div className="mt-8 border-t border-slate-200 pt-8 dark:border-slate-800">
                            <h4 className="border-b border-slate-200 pb-2 text-sm font-bold uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                                Help
                            </h4>
                            <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    Re-run the product tour from the beginning.
                                </p>
                                <button
                                    onClick={() => {
                                        localStorage.removeItem('wealth_aggregator_onboarding');
                                        window.location.reload();
                                    }}
                                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
                                >
                                    Restart tour
                                </button>
                            </div>
                        </div>

                        {/* Nuclear Section */}
                        <div className="mt-8 flex flex-col items-center justify-center border-t border-rose-500/20 pt-8 text-center">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-rose-500/60">Danger Zone</p>
                            <button
                                onClick={() => setIsPurgeModalOpen(true)}
                                className="mt-4 flex items-center gap-2 rounded-xl bg-rose-500/5 px-6 py-2.5 text-[11px] font-black uppercase tracking-widest text-rose-500 ring-1 ring-rose-500/20 transition-all hover:bg-rose-500 hover:text-white hover:ring-rose-500 hover:shadow-[0_0_20px_rgba(244,63,94,0.3)]"
                            >
                                <ShieldCheck size={14} /> Purge Journal Database
                            </button>
                        </div>
                    </div>
                    
                    <TelemetryHub />

                </div>

                {/* Nuclear Purge Modal */}
                <AnimatePresence>
                    {isPurgeModalOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => !isPurging && setIsPurgeModalOpen(false)}
                                className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
                            />

                            <motion.div
                                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                                animate={{ scale: 1, opacity: 1, y: 0 }}
                                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                                className="relative w-full max-w-md overflow-hidden rounded-2xl sm:rounded-[32px] border border-rose-500/30 bg-slate-900 p-5 sm:p-8 shadow-[0_0_50px_rgba(244,63,94,0.2)]"
                            >
                                {/* Glowing Background Effect */}
                                <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-rose-500/10 blur-[60px]" />
                                <div className="absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-rose-500/10 blur-[60px]" />

                                <div className="relative text-center">
                                    <div className="mx-auto mb-4 sm:mb-6 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500 ring-1 ring-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.15)] animate-pulse">
                                        <ShieldCheck size={30} />
                                    </div>

                                    <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">Nuclear Purge</h3>
                                    <p className="mt-2 sm:mt-3 text-xs sm:text-sm leading-relaxed text-slate-400">
                                        You are about to <span className="font-bold text-rose-400">permanently erase</span> all synced trades, manual logs, and broker history. This action cannot be reversed.
                                    </p>

                                    <div className="mt-6 sm:mt-8 space-y-4">
                                        <div className="text-left">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Confirm with Security Key</label>
                                            <input
                                                type="text"
                                                autoFocus
                                                value={purgeConfirmInput}
                                                onChange={(e) => setPurgeConfirmInput(e.target.value)}
                                                placeholder="Type DELETE to authorize"
                                                className="w-full rounded-2xl border border-rose-500/20 bg-slate-950 p-3.5 sm:p-4 text-center text-base sm:text-lg font-black tracking-widest text-rose-500 outline-none transition-all focus:border-rose-500 focus:shadow-[0_0_15px_rgba(244,63,94,0.1)] placeholder:text-slate-800 placeholder:font-bold"
                                            />
                                        </div>

                                        <div className="flex gap-2.5 sm:gap-3">
                                            <button
                                                onClick={() => setIsPurgeModalOpen(false)}
                                                disabled={isPurging}
                                                className="flex-1 rounded-2xl bg-slate-800 px-4 sm:px-6 py-3 sm:py-4 text-xs font-black uppercase tracking-widest text-slate-400 transition-all hover:bg-slate-700 hover:text-white disabled:opacity-50"
                                            >
                                                Abort
                                            </button>
                                            <button
                                                onClick={handlePurgeTrades}
                                                disabled={purgeConfirmInput !== 'DELETE' || isPurging}
                                                className={`flex-[1.5] rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-xs font-black uppercase tracking-widest transition-all ${purgeConfirmInput === 'DELETE'
                                                        ? 'bg-rose-500 text-white shadow-[0_0_25px_rgba(244,63,94,0.4)] hover:bg-rose-600'
                                                        : 'bg-slate-950 text-slate-800 cursor-not-allowed border border-slate-800'
                                                    }`}
                                            >
                                                {isPurging ? 'Executing...' : 'Authorize Wipe'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>

                <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-8 pb-4 dark:border-slate-800">
                    <button
                        onClick={handleResetDefaults}
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400 transition-colors hover:text-slate-800 dark:hover:text-white"
                    >
                        <RefreshCw size={14} /> Factory Reset Thresholds
                    </button>
                    <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-900/20 dark:text-emerald-400">
                        <Save size={14} /> Vault Synchronized
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsDesktopView;
