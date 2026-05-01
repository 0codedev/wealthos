import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, ShieldAlert, Sparkles, TrendingUp, CheckCircle2, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

interface ScalpSimulationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ScalpTrade {
    tradeId: string;
    symbol: string;
    underlying: string;
    quantity: number;
    entryPrice: number;
    currentSl: number;
    highestLtp: number;
    lastLtp: number;
    status: string;
    isRiskFree: boolean;
    openalgoBuyId: string;
    openalgoSellId?: string;
}

interface ScalpStats {
    totalTrades: number;
    wins: number;
    losses: number;
    totalPnl: number;
}

export const ScalpSimulationModal: React.FC<ScalpSimulationModalProps> = ({ isOpen, onClose }) => {
    const { toast } = useToast();
    const [customText, setCustomText] = useState('');
    const [channelId, setChannelId] = useState('-1001899590869');
    const [channelName, setChannelName] = useState('Stock Index group no 2');
    const [isRunning, setIsRunning] = useState(false);
    const [runningScenario, setRunningScenario] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<any>(null);
    const [activeTrades, setActiveTrades] = useState<ScalpTrade[]>([]);
    const [dailyStats, setDailyStats] = useState<ScalpStats | null>(null);

    const getEarHttpBase = () => {
        if (typeof window !== 'undefined' && (window as any).__TELEGRAM_EAR_HTTP_URL__) {
            return (window as any).__TELEGRAM_EAR_HTTP_URL__;
        }
        return (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
            ? `${window.location.protocol}//${window.location.host}/api/telegram-ear`
            : 'http://127.0.0.1:3001';
    };

    const fetchLedger = async () => {
        try {
            const res = await fetch(`${getEarHttpBase()}/api/scalp-ledger`);
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    setActiveTrades(data.active || []);
                    setDailyStats(data.stats || null);
                }
            }
        } catch (e) {
            // Ignore if ear server offline
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchLedger();
            const interval = setInterval(fetchLedger, 3000);
            return () => clearInterval(interval);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const injectSignal = async (text: string, scenarioName?: string) => {
        if (!text.trim()) return;
        setIsRunning(true);
        setRunningScenario(scenarioName || 'Custom');

        try {
            const res = await fetch(`${getEarHttpBase()}/api/simulate-signal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text.trim(),
                    channelId,
                    channelName
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                toast.error(`HTTP ${res.status}: ${errText}`, { title: 'Simulation Failed' });
                setLastResult({ error: errText });
            } else {
                const data = await res.json();
                setLastResult(data);
                toast.success(`Classification: ${data.result?.classification?.category || 'PROCESSED'}`, { title: 'Signal Injected' });
                await fetchLedger();
            }
        } catch (err: any) {
            toast.error(err.message || 'Cannot reach Ear Server', { title: 'Simulation Error' });
            setLastResult({ error: err.message });
        } finally {
            setIsRunning(false);
            setRunningScenario(null);
        }
    };

    const handleRunFullCycle = async () => {
        setIsRunning(true);
        setRunningScenario('Full Lifecycle');

        try {
            // 1. Fresh Entry
            toast.info('Placing Buy order for NIFTY 24500 CE...', { title: 'Step 1/4: Entry Signal' });
            await injectSignal('BUY NIFTY 24500 CE ABOVE 120 SL 110 TGT 140/160', 'Entry');
            await new Promise(r => setTimeout(r, 2000));

            // 2. Number Progression Spam
            toast.info('Broadcasting LTP 128... 🔥', { title: 'Step 2/4: Number Spam' });
            await injectSignal('128... 🔥', 'Number Spam');
            await new Promise(r => setTimeout(r, 2000));

            // 3. Trail SL
            toast.info('Locking Break-Even SL at cost...', { title: 'Step 3/4: Trailing SL' });
            await injectSignal('TRAIL SL TO COST - SAFE TRADERS BOOK 50%', 'Trail SL');
            await new Promise(r => setTimeout(r, 2000));

            // 4. Full Exit
            toast.info('Dispatching Market SELL to OpenAlgo...', { title: 'Step 4/4: Full Profit Exit' });
            await injectSignal('BOOK FULL PROFIT HERE 🎯 ALL TARGETS DONE', 'Full Exit');
            await fetchLedger();

            toast.success('Full 4-stage scalp trade simulated with zero manual effort!', { title: 'Simulation Complete' });
        } catch (e: any) {
            toast.error(e.message, { title: 'Cycle Error' });
        } finally {
            setIsRunning(false);
            setRunningScenario(null);
        }
    };

    const handleCloseAllTrades = async () => {
        try {
            const res = await fetch(`${getEarHttpBase()}/api/scalp-close-all`, { method: 'POST' });
            if (res.ok) {
                toast.success('Emergency exit completed for all active scalp positions.', { title: 'Trades Closed' });
                await fetchLedger();
            }
        } catch (e: any) {
            toast.error(e.message, { title: 'Error' });
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-800 bg-slate-900/95 shadow-2xl shadow-purple-950/30 overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-950/40">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                                <Sparkles size={18} />
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                                    Telegram Scalp Autopilot - Simulation Lab
                                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                        Sandbox Mode: Gates Bypassed
                                    </span>
                                </h2>
                                <p className="text-xs text-slate-400">
                                    Test open orders, number-spam rejection, trailing stoploss & full market exits on demand
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
                        {/* Preset Scenarios Strip */}
                        <div>
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
                                <span>1-Click Test Scenarios</span>
                                <button
                                    onClick={handleRunFullCycle}
                                    disabled={isRunning}
                                    className="px-3 py-1 rounded-lg text-xs font-semibold text-purple-200 bg-purple-600/30 border border-purple-500/40 hover:bg-purple-600/50 flex items-center gap-1.5 transition-all shadow-sm shadow-purple-500/10"
                                >
                                    <Play size={12} />
                                    <span>{isRunning && runningScenario === 'Full Lifecycle' ? 'Running E2E Cycle...' : 'Run Full 4-Step Cycle'}</span>
                                </button>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                <button
                                    onClick={() => injectSignal('BUY NIFTY 24500 CE ABOVE 120 SL 110 TGT 140/160', 'NIFTY Entry')}
                                    disabled={isRunning}
                                    className="p-3 text-left rounded-xl border border-emerald-500/20 bg-emerald-950/10 hover:bg-emerald-900/20 hover:border-emerald-500/40 transition-all group"
                                >
                                    <div className="font-semibold text-emerald-300 text-xs flex items-center justify-between">
                                        <span>🎯 NIFTY CE Entry</span>
                                        <span className="text-[10px] text-emerald-400/70 font-mono">BUY</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                                        BUY NIFTY 24500 CE ABOVE 120
                                    </div>
                                </button>

                                <button
                                    onClick={() => injectSignal('SENSEX 81200 PE CMP 220 SL 200 TGT 250', 'SENSEX Entry')}
                                    disabled={isRunning}
                                    className="p-3 text-left rounded-xl border border-blue-500/20 bg-blue-950/10 hover:bg-blue-900/20 hover:border-blue-500/40 transition-all group"
                                >
                                    <div className="font-semibold text-blue-300 text-xs flex items-center justify-between">
                                        <span>⚡ SENSEX PE (BFO)</span>
                                        <span className="text-[10px] text-blue-400/70 font-mono">10 Lot</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                                        SENSEX 81200 PE CMP 220
                                    </div>
                                </button>

                                <button
                                    onClick={() => injectSignal('128... 🔥', 'Number Spam')}
                                    disabled={isRunning}
                                    className="p-3 text-left rounded-xl border border-amber-500/20 bg-amber-950/10 hover:bg-amber-900/20 hover:border-amber-500/40 transition-all group"
                                >
                                    <div className="font-semibold text-amber-300 text-xs flex items-center justify-between">
                                        <span>📈 Number Spam (Tick)</span>
                                        <span className="text-[10px] text-amber-400/70 font-mono">NO ORDER</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                                        128... 🔥 (LTP Progression)
                                    </div>
                                </button>

                                <button
                                    onClick={() => injectSignal('TRAIL SL TO COST - SAFE TRADERS BOOK 50%', 'Trail SL')}
                                    disabled={isRunning}
                                    className="p-3 text-left rounded-xl border border-cyan-500/20 bg-cyan-950/10 hover:bg-cyan-900/20 hover:border-cyan-500/40 transition-all group"
                                >
                                    <div className="font-semibold text-cyan-300 text-xs flex items-center justify-between">
                                        <span>🛡️ Trail SL to Cost</span>
                                        <span className="text-[10px] text-cyan-400/70 font-mono">RISK-FREE</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                                        TRAIL SL TO COST
                                    </div>
                                </button>

                                <button
                                    onClick={() => injectSignal('BOOK FULL PROFIT HERE 🎯 ALL TARGETS DONE', 'Full Exit')}
                                    disabled={isRunning}
                                    className="p-3 text-left rounded-xl border border-purple-500/20 bg-purple-950/10 hover:bg-purple-900/20 hover:border-purple-500/40 transition-all group"
                                >
                                    <div className="font-semibold text-purple-300 text-xs flex items-center justify-between">
                                        <span>🎯 Full Profit Exit</span>
                                        <span className="text-[10px] text-purple-400/70 font-mono">SELL MKT</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                                        BOOK FULL PROFIT HERE 🎯
                                    </div>
                                </button>

                                <button
                                    onClick={() => injectSignal('SL HIT EXIT NOW', 'SL Exit')}
                                    disabled={isRunning}
                                    className="p-3 text-left rounded-xl border border-rose-500/20 bg-rose-950/10 hover:bg-rose-900/20 hover:border-rose-500/40 transition-all group"
                                >
                                    <div className="font-semibold text-rose-300 text-xs flex items-center justify-between">
                                        <span>🛑 SL Hit Exit</span>
                                        <span className="text-[10px] text-rose-400/70 font-mono">EXIT NOW</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">
                                        SL HIT EXIT NOW
                                    </div>
                                </button>
                            </div>
                        </div>

                        {/* Custom Signal Input */}
                        <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-3">
                            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                Custom Message Injector
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={customText}
                                    onChange={(e) => setCustomText(e.target.value)}
                                    placeholder="e.g. BUY BANKNIFTY 51200 CE CMP 240 SL 210 TGT 280"
                                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-purple-500 font-mono"
                                    onKeyDown={(e) => e.key === 'Enter' && injectSignal(customText)}
                                />
                                <button
                                    onClick={() => injectSignal(customText)}
                                    disabled={isRunning || !customText.trim()}
                                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors shrink-0"
                                >
                                    {isRunning ? 'Injecting...' : 'Inject Signal'}
                                </button>
                            </div>
                        </div>

                        {/* Active Trades & Ground-Truth Ledger */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                    <Layers size={14} className="text-purple-400" />
                                    <span>Active Scalp Ledger ({activeTrades.length} Open)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={fetchLedger}
                                        className="p-1 rounded text-slate-400 hover:text-white"
                                        title="Refresh Ledger"
                                    >
                                        <RefreshCw size={12} />
                                    </button>
                                    {activeTrades.length > 0 && (
                                        <button
                                            onClick={handleCloseAllTrades}
                                            className="text-[11px] px-2 py-0.5 rounded border border-rose-500/30 text-rose-400 hover:bg-rose-950/30"
                                        >
                                            Close All Open Trades
                                        </button>
                                    )}
                                </div>
                            </div>

                            {activeTrades.length === 0 ? (
                                <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/30 text-center text-xs text-slate-500">
                                    No active open scalp trades currently in ledger. Click a preset above to place a sandbox order!
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {activeTrades.map(trade => (
                                        <div
                                            key={trade.tradeId}
                                            className="p-3 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center justify-between"
                                        >
                                            <div>
                                                <div className="font-semibold text-white text-xs flex items-center gap-2">
                                                    <span>{trade.symbol}</span>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 font-mono">
                                                        Qty: {trade.quantity}
                                                    </span>
                                                    {trade.isRiskFree && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 font-mono flex items-center gap-1">
                                                            <CheckCircle2 size={10} /> Risk-Free
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-1 space-x-3">
                                                    <span>Entry: <b className="text-slate-200">₹{trade.entryPrice}</b></span>
                                                    <span>Current SL: <b className="text-amber-300">₹{trade.currentSl}</b></span>
                                                    <span>Peak LTP: <b className="text-emerald-400">₹{trade.highestLtp}</b></span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider bg-purple-950/50 text-purple-300 border border-purple-500/30">
                                                    {trade.status}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {dailyStats && (
                                <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800/60 bg-slate-950/30 text-xs text-slate-400">
                                    <span>Today's Trades: <b className="text-slate-200">{dailyStats.totalTrades}</b></span>
                                    <span>Wins: <b className="text-emerald-400">{dailyStats.wins}</b></span>
                                    <span>Losses: <b className="text-rose-400">{dailyStats.losses}</b></span>
                                    <span>Net PnL: <b className={dailyStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>₹{dailyStats.totalPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</b></span>
                                </div>
                            )}
                        </div>

                        {/* Raw JSON Debug Viewer */}
                        {lastResult && (
                            <div className="p-3 rounded-xl border border-slate-800/80 bg-slate-950/80 text-[11px] font-mono text-slate-300 space-y-1">
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                    Latest Pipeline Telemetry
                                </div>
                                <pre className="overflow-x-auto text-[10px] text-slate-400">
                                    {JSON.stringify(lastResult, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default ScalpSimulationModal;