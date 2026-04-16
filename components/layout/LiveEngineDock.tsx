import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, ShieldCheck, Wifi, Server, RefreshCw,
    ChevronDown, ExternalLink, Settings, CheckCircle2, AlertTriangle, XCircle
} from 'lucide-react';
import { formatINR } from '../../utils/indianFormatter';
import { upstoxCacheService } from '../../services/UpstoxCacheService';
import { useToast } from '../shared/ToastProvider';
import { useBridgeTelemetry } from '../../hooks/useBridgeTelemetry';

export interface UpstoxHealthState {
    status: 'green' | 'yellow' | 'red' | 'disabled';
    token_active: boolean;
    interactive_token_active?: boolean;
    analytics_token_active?: boolean;
    rate_limit?: {
        minute_usage: number;
        minute_limit: number;
    };
}

export interface OpenAlgoStatusState {
    status: 'online' | 'offline';
    broker: string;
    message?: string;
}

interface LiveEngineDockProps {
    upstoxHealth: UpstoxHealthState | null;
    openalgoStatus: OpenAlgoStatusState | null;
    fundLimit: { availabelBalance: number } | null;
    isSyncingInstruments?: boolean;
    syncStatusText?: string;
    onOpenSettings: () => void;
}

export const LiveEngineDock: React.FC<LiveEngineDockProps> = ({
    upstoxHealth,
    openalgoStatus,
    fundLimit,
    isSyncingInstruments,
    syncStatusText,
    onOpenSettings,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    const { telemetry, isOnline: isBridgeOnline } = useBridgeTelemetry(15000);

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    // Compute composite health status
    const isUpstoxActive = upstoxHealth?.status === 'green' || upstoxHealth?.token_active;
    const isUpstoxWarning = upstoxHealth?.status === 'yellow';
    const isOpenAlgoOnline = openalgoStatus?.status === 'online';

    const overallStatus = (!isUpstoxActive && upstoxHealth?.status === 'red')
        ? 'error'
        : (isUpstoxWarning || (openalgoStatus && !isOpenAlgoOnline))
            ? 'warning'
            : 'healthy';

    const handleClearCache = (e: React.MouseEvent) => {
        e.stopPropagation();
        toast.success('Flushing Upstox cache and syncing latest market data...');
        upstoxCacheService.clear();
        setTimeout(() => {
            window.location.reload();
        }, 800);
    };

    const handleOpenAlgoClick = () => {
        const hostname = window.location.hostname;
        const isTunnelAccess = hostname.includes('wealthos-sudhanshu.xyz');
        const targetUrl = (hostname === 'localhost' || hostname === '127.0.0.1')
            ? 'http://127.0.0.1:5000/auth/mock-upstox-login'
            : isTunnelAccess
                ? (hostname.includes('local')
                    ? 'https://local-openalgo.wealthos-sudhanshu.xyz/auth/mock-upstox-login'
                    : 'https://openalgo.wealthos-sudhanshu.xyz/auth/mock-upstox-login')
                : 'http://127.0.0.1:5000/auth/mock-upstox-login';
        window.open(targetUrl, '_blank');
    };

    return (
        <div className="relative" ref={containerRef}>
            {/* Master Capsule Button */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-label="System Engine & Broker Status Dock"
                className={`flex items-center gap-2.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150 select-none cursor-pointer group ${
                    isOpen
                        ? 'bg-[#131620] border-white/20 text-white shadow-lg shadow-black/40'
                        : 'bg-[#0D0E14] hover:bg-[#131620] border-white/[0.08] hover:border-white/[0.16] text-slate-300 hover:text-white shadow-sm'
                }`}
            >
                {/* Pulsing Status Dot */}
                <div className="relative flex items-center justify-center w-2 h-2">
                    {overallStatus === 'healthy' && (
                        <span className="absolute w-2 h-2 rounded-full bg-emerald-500 animate-ping opacity-75"></span>
                    )}
                    <span
                        className={`relative w-1.5 h-1.5 rounded-full ${
                            overallStatus === 'healthy'
                                ? 'bg-emerald-400'
                                : overallStatus === 'warning'
                                    ? 'bg-amber-400 animate-pulse'
                                    : 'bg-rose-500'
                        }`}
                    />
                </div>

                {/* Primary Telemetry Label */}
                <div className="flex items-center gap-2">
                    {isSyncingInstruments ? (
                        <span className="text-indigo-400 font-medium flex items-center gap-1.5">
                            <RefreshCw size={10} className="animate-spin" />
                            {syncStatusText || 'Syncing...'}
                        </span>
                    ) : (
                        <span className="font-semibold text-slate-200 tracking-tight">
                            {isUpstoxActive
                                ? 'Engine Live'
                                : upstoxHealth?.status === 'disabled'
                                    ? 'Feed Cached'
                                    : 'Engine Offline'}
                        </span>
                    )}

                    {/* Runway Fund Limit Badge (Compact) */}
                    {fundLimit && (
                        <>
                            <span className="text-white/20">/</span>
                            <span className="flex items-center gap-1 font-mono font-bold text-slate-200 financial-value">
                                ₹{formatINR(fundLimit.availabelBalance, { compact: true })}
                                <span className="text-[9px] font-sans font-medium text-slate-400 tracking-wider uppercase">
                                    Runway
                                </span>
                            </span>
                        </>
                    )}
                </div>

                {/* Dropdown Indicator */}
                <ChevronDown
                    size={13}
                    className={`text-slate-400 transition-transform duration-200 group-hover:text-slate-200 ${
                        isOpen ? 'rotate-180 text-white' : ''
                    }`}
                />
            </button>

            {/* Floating Luxury Telemetry Popover */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        className="absolute right-0 top-12 w-84 max-w-[90vw] bg-[#0D0E14]/95 backdrop-blur-2xl border border-white/[0.10] shadow-[0_16px_36px_rgba(0,0,0,0.6)] rounded-2xl p-4 z-50 text-slate-200 font-sans"
                    >
                        {/* Header Row */}
                        <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/[0.06]">
                            <div className="flex items-center gap-2">
                                <ShieldCheck size={16} className="text-indigo-400" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                                    System Telemetry
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={handleClearCache}
                                    title="Flush cache and reload fresh data"
                                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                                >
                                    <RefreshCw size={12} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsOpen(false);
                                        onOpenSettings();
                                    }}
                                    title="Open App Settings"
                                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                                >
                                    <Settings size={12} />
                                </button>
                            </div>
                        </div>

                        {/* Broker / Feed Status */}
                        <div className="space-y-2.5">
                            <div className="bg-[#131620] border border-white/[0.05] rounded-xl p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[11px] font-bold text-slate-300">Upstox Market Feed</span>
                                    <span
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                                            isUpstoxActive
                                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                        }`}
                                    >
                                        {isUpstoxActive ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                                        {isUpstoxActive ? 'ACTIVE' : 'OFFLINE'}
                                    </span>
                                </div>

                                <div className="space-y-1.5 text-[10px]">
                                    <div className="flex justify-between text-slate-400">
                                        <span>Daily F&O Login:</span>
                                        <span
                                            className={`font-mono font-bold ${
                                                upstoxHealth?.interactive_token_active
                                                    ? 'text-emerald-400'
                                                    : 'text-rose-400'
                                            }`}
                                        >
                                            {upstoxHealth?.interactive_token_active ? 'READY' : 'EXPIRED'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-slate-400">
                                        <span>1-Year Analytics:</span>
                                        <span
                                            className={`font-mono font-bold ${
                                                upstoxHealth?.analytics_token_active
                                                    ? 'text-emerald-400'
                                                    : 'text-rose-400'
                                            }`}
                                        >
                                            {upstoxHealth?.analytics_token_active ? 'READY' : 'EXPIRED'}
                                        </span>
                                    </div>

                                    {upstoxHealth?.rate_limit && (
                                        <div className="pt-1">
                                            <div className="flex justify-between text-slate-400 mb-1">
                                                <span>API Minute Usage:</span>
                                                <span className="font-mono text-slate-200">
                                                    {upstoxHealth.rate_limit.minute_usage} / {upstoxHealth.rate_limit.minute_limit} req
                                                </span>
                                            </div>
                                            <div className="w-full bg-white/[0.05] rounded-full h-1 overflow-hidden">
                                                <div
                                                    className="bg-indigo-500 h-full rounded-full transition-all duration-300"
                                                    style={{
                                                        width: `${Math.min(
                                                            (upstoxHealth.rate_limit.minute_usage / upstoxHealth.rate_limit.minute_limit) * 100,
                                                            100
                                                        )}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* OpenAlgo Status */}
                            {openalgoStatus && (
                                <div className="bg-[#131620] border border-white/[0.05] rounded-xl p-3 flex items-center justify-between">
                                    <div>
                                        <p className="text-[11px] font-bold text-slate-300">OpenAlgo Gateway</p>
                                        <p className="text-[10px] text-slate-400 font-mono">
                                            {openalgoStatus.broker ? openalgoStatus.broker.toUpperCase() : 'NO BROKER'}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleOpenAlgoClick}
                                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-semibold text-slate-200 border border-white/[0.08] transition-colors"
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full ${openalgoStatus.status === 'online' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                                        <span>Dashboard</span>
                                        <ExternalLink size={9} />
                                    </button>
                                </div>
                            )}

                            {/* Capital Runway & Infrastructure Status */}
                            <div className="bg-[#131620] border border-white/[0.05] rounded-xl p-3 space-y-2">
                                {fundLimit && (
                                    <div className="flex items-center justify-between pb-2 border-b border-white/[0.05]">
                                        <span className="text-[11px] text-slate-400">Available Runway</span>
                                        <span className="font-mono font-bold text-emerald-400 text-xs financial-value">
                                            ₹{fundLimit.availabelBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                        </span>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 pt-0.5">
                                    <div className="flex items-center gap-1.5">
                                        <Server size={11} className="text-slate-500" />
                                        <span>Bridge:</span>
                                        <span className={`font-mono font-bold ${isBridgeOnline ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isBridgeOnline ? 'ONLINE' : 'OFFLINE'}
                                        </span>
                                    </div>
                                    {telemetry?.system && (
                                        <div className="flex items-center gap-1.5 justify-end">
                                            <Activity size={11} className="text-slate-500" />
                                            <span className="font-mono font-bold text-slate-200">
                                                {telemetry.system.cpu_percent.toFixed(0)}% CPU
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Footer Help Note */}
                        <p className="mt-3 text-center text-[9px] text-slate-500">
                            Click settings icon to manage API keys, brokers, and scheduled syncs.
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default LiveEngineDock;
