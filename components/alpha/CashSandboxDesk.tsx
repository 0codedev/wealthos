import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Briefcase, ShieldCheck, AlertTriangle, ArrowUpRight, TrendingUp, 
    TrendingDown, Lock, CheckCircle2, XCircle, Sliders, RefreshCw, 
    Clock, Zap, Power, ShieldAlert
} from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

export interface CashSandboxPosition {
    id: string;
    orderId: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    strategyTag: string;
    strategyLabel: string;
    quantity: number;
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
    targetPrice: number;
    stopLossPrice: number;
    trailingStopLoss: number;
    trailState: 'NONE' | 'BREAKEVEN' | 'PROFIT_LOCK' | 'CIRCUIT_LOCK';
    entryTime: number;
    isNearCircuit: boolean;
    roomToUc: number;
    upperCircuit: number;
}

export interface CashSandboxRiskSettings {
    capitalPerTrade: number;
    maxConcurrentPositions: number;
    enforceMorningWindow: boolean;
    minConfluenceScore: number;
    autoTrailEnabled: boolean;
}

export const DEFAULT_RISK_SETTINGS: CashSandboxRiskSettings = {
    capitalPerTrade: 15000,
    maxConcurrentPositions: 3,
    enforceMorningWindow: true,
    minConfluenceScore: 80,
    autoTrailEnabled: true
};

const STORAGE_KEY_POSITIONS = 'wealthos_cash_sandbox_positions_v1';
const STORAGE_KEY_SETTINGS = 'wealthos_cash_sandbox_settings_v1';

export function isWithinCashMorningWindow(): boolean {
    try {
        const kolkataTime = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
        const [hours, minutes] = kolkataTime.split(':').map(Number);
        const timeVal = hours * 100 + minutes;
        // 09:18 AM to 10:30 AM IST (morning momentum expansion)
        return timeVal >= 918 && timeVal <= 1030;
    } catch {
        return true;
    }
}

interface CashSandboxDeskProps {
    liveQuotes: Record<string, any>;
    isOpen: boolean;
    onToggle: () => void;
    onPositionsChange?: (count: number) => void;
    onSettingsChange?: (settings: CashSandboxRiskSettings) => void;
    activeRiskSettings?: CashSandboxRiskSettings;
}

export const CashSandboxDesk: React.FC<CashSandboxDeskProps> = ({
    liveQuotes,
    isOpen,
    onToggle,
    onPositionsChange,
    onSettingsChange,
    activeRiskSettings
}) => {
    const { toast } = useToast();

    // Risk Settings state with local persistence
    const [riskSettings, setRiskSettings] = useState<CashSandboxRiskSettings>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
            return saved ? { ...DEFAULT_RISK_SETTINGS, ...JSON.parse(saved) } : DEFAULT_RISK_SETTINGS;
        } catch {
            return DEFAULT_RISK_SETTINGS;
        }
    });

    const [showConfig, setShowConfig] = useState(false);
    const [closingId, setClosingId] = useState<string | null>(null);
    const [isFlattening, setIsFlattening] = useState(false);

    // Active Positions state with local persistence
    const [positions, setPositions] = useState<CashSandboxPosition[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_POSITIONS);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    // Listen for instant external position updates
    useEffect(() => {
        const handleUpdated = () => {
            try {
                const saved = localStorage.getItem(STORAGE_KEY_POSITIONS);
                if (saved) setPositions(JSON.parse(saved));
            } catch (e) {
                console.error(e);
            }
        };
        window.addEventListener('wealthos_sandbox_positions_updated', handleUpdated);
        return () => window.removeEventListener('wealthos_sandbox_positions_updated', handleUpdated);
    }, []);

    // Notify parent of positions count
    useEffect(() => {
        onPositionsChange?.(positions.length);
        try {
            localStorage.setItem(STORAGE_KEY_POSITIONS, JSON.stringify(positions));
        } catch (e) {
            console.error('Failed to persist sandbox positions:', e);
        }
    }, [positions, onPositionsChange]);

    // Notify parent of settings change
    useEffect(() => {
        onSettingsChange?.(riskSettings);
        try {
            localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(riskSettings));
        } catch (e) {
            console.error('Failed to persist risk settings:', e);
        }
    }, [riskSettings, onSettingsChange]);

    const isMorningWindow = useMemo(() => isWithinCashMorningWindow(), []);

    // Trailing Stop-Loss & Circuit Lock Automation Loop
    useEffect(() => {
        if (positions.length === 0) return;

        let hasUpdates = false;
        const updated = positions.map(pos => {
            const quote = liveQuotes[pos.symbol];
            const liveLtp = Number(quote?.last_price || quote?.ltp || pos.currentPrice);
            if (!liveLtp || liveLtp <= 0) return pos;

            const pnl = (liveLtp - pos.entryPrice) * pos.quantity;
            const pnlPct = pos.entryPrice > 0 ? ((liveLtp - pos.entryPrice) / pos.entryPrice) * 100 : 0;
            const ucPrice = pos.upperCircuit || (pos.entryPrice * 1.20);
            const roomToUc = ucPrice > 0 ? ((ucPrice - liveLtp) / liveLtp) * 100 : 0;
            const isNearCircuit = roomToUc <= 0.8;

            let trailingSl = pos.trailingStopLoss || pos.stopLossPrice;
            let trailState = pos.trailState;

            if (riskSettings.autoTrailEnabled) {
                // Tier 1: Trail to Breakeven (+2.5% move)
                if (pnlPct >= 2.5 && trailingSl < pos.entryPrice) {
                    trailingSl = pos.entryPrice;
                    trailState = 'BREAKEVEN';
                    hasUpdates = true;
                    toast.info(`🛡️ ${pos.symbol}: Trailing Stop locked to Breakeven (₹${pos.entryPrice.toFixed(2)})`);
                }
                // Tier 2: Trail to +2.5% profit (+5.0% move)
                if (pnlPct >= 5.0 && trailingSl < pos.entryPrice * 1.025) {
                    trailingSl = Number((pos.entryPrice * 1.025).toFixed(2));
                    trailState = 'PROFIT_LOCK';
                    hasUpdates = true;
                    toast.success(`⚡ ${pos.symbol}: Trailing Stop advanced to +2.5% Profit (₹${trailingSl})`);
                }
                // Tier 3: Near Upper Circuit Lock (within 0.8% of UC)
                if (isNearCircuit && ucPrice > 0) {
                    const circuitLockSl = Number((ucPrice * 0.985).toFixed(2));
                    if (trailingSl < circuitLockSl) {
                        trailingSl = circuitLockSl;
                        trailState = 'CIRCUIT_LOCK';
                        hasUpdates = true;
                        toast.success(`🔒 ${pos.symbol}: Near Upper Circuit! Stop locked at ₹${circuitLockSl}`);
                    }
                }
            }

            if (liveLtp !== pos.currentPrice || trailingSl !== pos.trailingStopLoss || trailState !== pos.trailState) {
                hasUpdates = true;
                return {
                    ...pos,
                    currentPrice: liveLtp,
                    unrealizedPnl: pnl,
                    unrealizedPnlPct: pnlPct,
                    trailingStopLoss: trailingSl,
                    trailState,
                    isNearCircuit,
                    roomToUc
                };
            }
            return pos;
        });

        if (hasUpdates) {
            setPositions(updated);
        }
    }, [liveQuotes, riskSettings.autoTrailEnabled, toast]);

    // Handle Square Off for single position
    const handleClosePosition = useCallback(async (pos: CashSandboxPosition) => {
        setClosingId(pos.id);
        try {
            // Forward close request to OpenAlgo gateway
            await fetch('/api/python-nse/api/openalgo/closeposition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: pos.symbol,
                    exchange: 'NSE',
                    product: 'MIS'
                })
            }).catch(() => {});

            setPositions(prev => prev.filter(p => p.id !== pos.id));
            toast.success(`Position Squared Off: ${pos.symbol} | P&L: ₹${pos.unrealizedPnl.toFixed(2)} (${pos.unrealizedPnlPct >= 0 ? '+' : ''}${pos.unrealizedPnlPct.toFixed(2)}%)`);
        } catch (err) {
            setPositions(prev => prev.filter(p => p.id !== pos.id));
            toast.info(`Position Closed (Local): ${pos.symbol}`);
        } finally {
            setClosingId(null);
        }
    }, [toast]);

    // Panic Flatten All Positions
    const handlePanicFlatten = useCallback(async () => {
        if (positions.length === 0) return;
        setIsFlattening(true);
        try {
            await Promise.allSettled(
                positions.map(p => 
                    fetch('/api/python-nse/api/openalgo/closeposition', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol: p.symbol, exchange: 'NSE', product: 'MIS' })
                    })
                )
            );
            setPositions([]);
            toast.success(`All ${positions.length} Cash Sandbox positions flattened.`);
        } catch (err) {
            setPositions([]);
            toast.info('All Sandbox positions cleared locally.');
        } finally {
            setIsFlattening(false);
        }
    }, [positions, toast]);

    // Aggregated Metrics
    const totalPnl = useMemo(() => {
        return positions.reduce((acc, p) => acc + (p.unrealizedPnl || 0), 0);
    }, [positions]);

    const totalInvested = useMemo(() => {
        return positions.reduce((acc, p) => acc + (p.entryPrice * p.quantity), 0);
    }, [positions]);

    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    return (
        <div className="w-full">
            {/* Top Compact Persistent StatusBar Strip */}
            <div className="px-4 py-2.5 bg-tf-bg-app/70 border-y border-tf-border/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                        onClick={onToggle}
                        className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/20 text-indigo-300 font-bold tracking-wide transition-all"
                    >
                        <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Sandbox Cash Desk</span>
                        <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-black ${
                            positions.length > 0 
                                ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/50' 
                                : 'bg-tf-bg-card text-tf-text-muted'
                        }`}>
                            {positions.length}
                        </span>
                    </button>

                    {/* Window Status Pill */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-tf-bg-card border border-tf-border text-[10px] text-tf-text-muted font-medium">
                        <Clock className={`w-3 h-3 ${isMorningWindow ? 'text-emerald-400 animate-pulse' : 'text-tf-text-muted'}`} />
                        <span>Morning Window:</span>
                        <span className={`font-bold ${isMorningWindow ? 'text-emerald-400' : 'text-tf-text-muted'}`}>
                            {isMorningWindow ? '09:18 - 10:30 (ACTIVE)' : 'STANDBY (Post 10:30)'}
                        </span>
                    </div>

                    {/* Capacity Pill */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-tf-bg-card border border-tf-border text-[10px] text-tf-text-muted font-medium">
                        <ShieldCheck className="w-3 h-3 text-indigo-400" />
                        <span>Allocation:</span>
                        <span className="font-bold text-tf-text-secondary">
                            {positions.length} / {riskSettings.maxConcurrentPositions} max
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Real-time Aggregate P&L */}
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-bold text-tf-text-muted tracking-wider">Unrealized P&L:</span>
                        <span className={`text-xs font-black tracking-tight ${
                            totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                            {totalPnl >= 0 ? '+' : ''}₹{totalPnl.toFixed(2)} ({totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%)
                        </span>
                    </div>

                    {/* Expand/Collapse Desk Button */}
                    <button
                        onClick={onToggle}
                        className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider text-tf-text-secondary hover:text-white bg-tf-bg-card hover:bg-tf-bg-elevated border border-tf-border transition-all"
                    >
                        {isOpen ? 'Hide Desk ▲' : 'Open Desk ▼'}
                    </button>
                </div>
            </div>

            {/* Slide-Down Cash Sandbox Desk Drawer */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="border-b border-tf-border/80 bg-tf-bg-app/90 backdrop-blur-xl overflow-hidden"
                    >
                        <div className="p-4 sm:p-6 space-y-4">
                            {/* Desk Top Action Bar */}
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-tf-border/60">
                                <div>
                                    <h3 className="text-sm font-black text-white tracking-tight flex items-center gap-2">
                                        <span>Live Cash Sandbox Tradebook</span>
                                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            VIRTUAL EXECUTION (MIS 5X)
                                        </span>
                                    </h3>
                                    <p className="text-[11px] text-tf-text-muted mt-0.5">
                                        Protected by Dynamic Trailing SL, Breakeven Ratchets, and Circuit Lock Defense.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setShowConfig(!showConfig)}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                                            showConfig 
                                                ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' 
                                                : 'bg-tf-bg-card border-tf-border text-tf-text-muted hover:text-tf-text-secondary'
                                        }`}
                                    >
                                        <Sliders className="w-3.5 h-3.5" />
                                        <span>Risk Guardrails</span>
                                    </button>

                                    {positions.length > 0 && (
                                        <button
                                            onClick={handlePanicFlatten}
                                            disabled={isFlattening}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 transition-all disabled:opacity-50"
                                        >
                                            <Power className="w-3.5 h-3.5 text-rose-400" />
                                            <span>{isFlattening ? 'Flattening...' : 'Panic Flatten All'}</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Risk Guardrails Configuration Panel */}
                            <AnimatePresence>
                                {showConfig && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -8 }}
                                        className="p-3.5 rounded-xl bg-tf-bg-card/80 border border-tf-border space-y-3"
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black uppercase text-indigo-400 tracking-wider flex items-center gap-1.5">
                                                <ShieldCheck className="w-4 h-4" />
                                                Auto-Punch Execution Guardrails
                                            </span>
                                            <span className="text-[10px] text-tf-text-muted">Auto-saved to local memory</span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                                            {/* Capital Allocation */}
                                            <div className="p-2.5 rounded-lg bg-tf-bg-app/60 border border-tf-border/80">
                                                <label className="text-[10px] font-bold uppercase text-tf-text-muted block mb-1.5">
                                                    Capital / Trade (MIS 5x)
                                                </label>
                                                <div className="grid grid-cols-3 gap-1">
                                                    {[10000, 15000, 25000].map(val => (
                                                        <button
                                                            key={val}
                                                            onClick={() => setRiskSettings(s => ({ ...s, capitalPerTrade: val }))}
                                                            className={`py-1 rounded text-[10px] font-black transition-all ${
                                                                riskSettings.capitalPerTrade === val
                                                                    ? 'bg-indigo-600 text-white shadow-sm'
                                                                    : 'bg-tf-bg-card text-tf-text-muted hover:text-tf-text-secondary'
                                                            }`}
                                                        >
                                                            ₹{(val / 1000).toFixed(0)}k
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Max Concurrent Positions */}
                                            <div className="p-2.5 rounded-lg bg-tf-bg-app/60 border border-tf-border/80">
                                                <label className="text-[10px] font-bold uppercase text-tf-text-muted block mb-1.5">
                                                    Max Concurrent Positions
                                                </label>
                                                <div className="grid grid-cols-4 gap-1">
                                                    {[1, 2, 3, 5].map(val => (
                                                        <button
                                                            key={val}
                                                            onClick={() => setRiskSettings(s => ({ ...s, maxConcurrentPositions: val }))}
                                                            className={`py-1 rounded text-[10px] font-black transition-all ${
                                                                riskSettings.maxConcurrentPositions === val
                                                                    ? 'bg-indigo-600 text-white shadow-sm'
                                                                    : 'bg-tf-bg-card text-tf-text-muted hover:text-tf-text-secondary'
                                                            }`}
                                                        >
                                                            {val}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Morning Window Gate */}
                                            <div className="p-2.5 rounded-lg bg-tf-bg-app/60 border border-tf-border/80 flex flex-col justify-between">
                                                <label className="text-[10px] font-bold uppercase text-tf-text-muted block mb-1.5">
                                                    Morning Window Gate
                                                </label>
                                                <button
                                                    onClick={() => setRiskSettings(s => ({ ...s, enforceMorningWindow: !s.enforceMorningWindow }))}
                                                    className={`py-1 px-2 rounded text-[10px] font-black transition-all text-left flex items-center justify-between ${
                                                        riskSettings.enforceMorningWindow
                                                            ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                                                            : 'bg-tf-bg-card text-tf-text-muted'
                                                    }`}
                                                >
                                                    <span>09:18 - 10:30 Only</span>
                                                    <span>{riskSettings.enforceMorningWindow ? 'ACTIVE' : 'OFF'}</span>
                                                </button>
                                            </div>

                                            {/* Dynamic Trailing SL */}
                                            <div className="p-2.5 rounded-lg bg-tf-bg-app/60 border border-tf-border/80 flex flex-col justify-between">
                                                <label className="text-[10px] font-bold uppercase text-tf-text-muted block mb-1.5">
                                                    Circuit & Trailing SL
                                                </label>
                                                <button
                                                    onClick={() => setRiskSettings(s => ({ ...s, autoTrailEnabled: !s.autoTrailEnabled }))}
                                                    className={`py-1 px-2 rounded text-[10px] font-black transition-all text-left flex items-center justify-between ${
                                                        riskSettings.autoTrailEnabled
                                                            ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                                                            : 'bg-tf-bg-card text-tf-text-muted'
                                                    }`}
                                                >
                                                    <span>Breakeven + Circuit Trail</span>
                                                    <span>{riskSettings.autoTrailEnabled ? 'ARMED' : 'OFF'}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Active Positions Table */}
                            {positions.length === 0 ? (
                                <div className="py-10 text-center rounded-xl border border-dashed border-tf-border/80 bg-tf-bg-card/30 p-6">
                                    <Briefcase className="w-8 h-8 text-tf-text-muted mx-auto mb-2.5" />
                                    <h4 className="text-xs font-black uppercase tracking-wider text-tf-text-secondary">
                                        No Active Cash Sandbox Positions
                                    </h4>
                                    <p className="text-[11px] text-tf-text-muted mt-1 max-w-md mx-auto">
                                        When you 1-click punch or when Auto-Punch fires on a top 5/5 verified accumulator, it will execute and trail here in real time.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto no-scrollbar rounded-xl border border-tf-border/60 bg-tf-bg-card/40">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="border-b border-tf-border/80 bg-tf-bg-app/60 text-[10px] font-black uppercase text-tf-text-muted tracking-wider">
                                                <th className="py-2.5 px-3">Stock & Strategy</th>
                                                <th className="py-2.5 px-3">Qty & Product</th>
                                                <th className="py-2.5 px-3">Entry / LTP</th>
                                                <th className="py-2.5 px-3">Unrealized P&L</th>
                                                <th className="py-2.5 px-3">Protective SL & Trail</th>
                                                <th className="py-2.5 px-3">Target / UC Runway</th>
                                                <th className="py-2.5 px-3 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-tf-border/40">
                                            {positions.map(pos => {
                                                const pnlPositive = pos.unrealizedPnl >= 0;
                                                return (
                                                    <tr key={pos.id} className="hover:bg-tf-bg-elevated/40 transition-colors">
                                                        {/* Stock & Strategy */}
                                                        <td className="py-3 px-3">
                                                            <div className="font-black text-white text-sm tracking-tight">
                                                                {pos.symbol}
                                                            </div>
                                                            <div className="text-[9.5px] font-bold text-indigo-400 tracking-wider uppercase mt-0.5">
                                                                {pos.strategyLabel}
                                                            </div>
                                                        </td>

                                                        {/* Qty & Product */}
                                                        <td className="py-3 px-3">
                                                            <div className="font-bold text-tf-text-primary">
                                                                {pos.quantity} shares
                                                            </div>
                                                            <div className="text-[9.5px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded inline-block mt-0.5">
                                                                MIS 5x Margin
                                                            </div>
                                                        </td>

                                                        {/* Entry / LTP */}
                                                        <td className="py-3 px-3">
                                                            <div className="text-tf-text-muted text-[11px]">
                                                                Entry: <span className="font-bold text-tf-text-primary">₹{pos.entryPrice.toFixed(2)}</span>
                                                            </div>
                                                            <div className="text-[11px] mt-0.5">
                                                                LTP: <span className="font-black text-white">₹{pos.currentPrice.toFixed(2)}</span>
                                                            </div>
                                                        </td>

                                                        {/* Unrealized P&L */}
                                                        <td className="py-3 px-3">
                                                            <div className={`font-black text-sm tracking-tight ${pnlPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                                {pnlPositive ? '+' : ''}₹{pos.unrealizedPnl.toFixed(2)}
                                                            </div>
                                                            <div className={`text-[10px] font-bold ${pnlPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                {pnlPositive ? '+' : ''}{pos.unrealizedPnlPct.toFixed(2)}%
                                                            </div>
                                                        </td>

                                                        {/* Protective SL & Trail Status */}
                                                        <td className="py-3 px-3">
                                                            <div className="text-tf-text-secondary font-bold text-xs flex items-center gap-1.5">
                                                                <span>SL: ₹{pos.trailingStopLoss ? pos.trailingStopLoss.toFixed(2) : pos.stopLossPrice.toFixed(2)}</span>
                                                            </div>
                                                            <div className="mt-1">
                                                                {pos.trailState === 'CIRCUIT_LOCK' && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 w-max animate-pulse">
                                                                        <Lock className="w-2.5 h-2.5" />
                                                                        Circuit Lock Trail
                                                                    </span>
                                                                )}
                                                                {pos.trailState === 'PROFIT_LOCK' && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 w-max">
                                                                        <Zap className="w-2.5 h-2.5" />
                                                                        +2.5% Profit Banked
                                                                    </span>
                                                                )}
                                                                {pos.trailState === 'BREAKEVEN' && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 w-max">
                                                                        <ShieldCheck className="w-2.5 h-2.5" />
                                                                        Breakeven Protected
                                                                    </span>
                                                                )}
                                                                {pos.trailState === 'NONE' && (
                                                                    <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold uppercase tracking-wider bg-tf-bg-card text-tf-text-muted border border-tf-border w-max">
                                                                        Low of Day SL
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>

                                                        {/* Target / UC Runway */}
                                                        <td className="py-3 px-3">
                                                            <div className="text-tf-text-secondary font-bold text-xs">
                                                                Target: ₹{pos.targetPrice.toFixed(2)}
                                                            </div>
                                                            <div className="text-[10px] font-bold text-emerald-400 mt-0.5">
                                                                Room to UC: +{pos.roomToUc.toFixed(1)}%
                                                            </div>
                                                        </td>

                                                        {/* Action Square Off */}
                                                        <td className="py-3 px-3 text-right">
                                                            <button
                                                                onClick={() => handleClosePosition(pos)}
                                                                disabled={closingId === pos.id}
                                                                className="px-2.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 transition-all disabled:opacity-50"
                                                            >
                                                                {closingId === pos.id ? 'Closing...' : 'Square Off'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
