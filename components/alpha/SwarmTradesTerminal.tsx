/**
 * SwarmTradesTerminal - Phase 9 / CC22
 *
 * High-density, glassmorphic grid that unifies Alpha Engine 2.0 signals
 * and Dhan open positions, and provides a one-click importer to push
 * signals into the trading journal.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ArrowDownCircle, ArrowUpCircle, ChevronRight, FileText, Layers, Loader2, Plus, RefreshCw, Target, TrendingDown, TrendingUp, Zap, AlertTriangle, BarChart3, Crosshair, Shield, Brain } from 'lucide-react';
import { swarmTradesService, SwarmTradeRow, AlphaCoherence } from '../../services/SwarmTradesService';
import { useToast } from '../shared/ToastProvider';
import { useCentralMemoryStore } from '../../store/centralMemoryStore';
import TickerLink from '../ui/TickerLink';
import { formatCurrencyPrecise } from '../../utils/helpers';

interface SwarmTradesTerminalProps {
    onImportToJournal?: (prefill: { ticker: string; direction: 'Long' | 'Short'; entryPrice: number; stopLoss: number; takeProfit: number; date: string; setup: string; notes: string; isSimulated: boolean }) => void;
}

const formatINR = (n: number) => `₹${formatCurrencyPrecise(n || 0)}`;

const SOURCE_COLOR: Record<string, string> = {
    ORB: 'text-amber-400',
    RS: 'text-violet-400',
    OPTION_FLOW: 'text-sky-400',
    BREAKOUT: 'text-emerald-400',
    INTRADAY_BOOST: 'text-fuchsia-400',
    CONVERGENCE: 'text-indigo-400',
    BROKER: 'text-rose-400',
};

const SwarmTradesTerminal: React.FC<SwarmTradesTerminalProps> = ({ onImportToJournal }) => {
    const { toast } = useToast();
    const [rows, setRows] = useState<SwarmTradeRow[]>([]);
    const [coherence, setCoherence] = useState<AlphaCoherence | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'ALL' | 'ALPHA_SIGNAL' | 'DHAN_POSITION'>('ALL');
    const setActiveTicker = useCentralMemoryStore((s) => s.setActiveTicker);

    const refresh = async () => {
        setLoading(true);
        try {
            const [grid, coh] = await Promise.all([
                swarmTradesService.buildGrid(),
                swarmTradesService.calculateAlphaCoherence(),
            ]);
            setRows(grid);
            setCoherence(coh);
        } catch (err) {
            toast.error('Failed to load Swarm Trades');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
        // Refresh every 90 seconds to keep up with live ticks.
        const id = setInterval(refresh, 90_000);
        return () => clearInterval(id);
    }, []);

    const filtered = useMemo(() => {
        if (filter === 'ALL') return rows;
        return rows.filter((r) => r.source === filter);
    }, [rows, filter]);

    const stats = useMemo(() => {
        const alphaCount = rows.filter((r) => r.source === 'ALPHA_SIGNAL').length;
        const positionCount = rows.filter((r) => r.source === 'DHAN_POSITION').length;
        const totalPnl = rows.filter((r) => r.source === 'DHAN_POSITION').reduce((s, r) => s + r.pnl, 0);
        return { alphaCount, positionCount, totalPnl };
    }, [rows]);

    return (
        <div className="space-y-5 animate-in fade-in duration-500">
            {/* Header */}
            <div className="rounded-2xl border border-slate-200/50 dark:border-slate-700/50 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl p-5 shadow-sm">
                <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500/20 to-sky-500/20 border border-violet-500/20 text-violet-400">
                            <Crosshair size={20} />
                        </div>
                        <div>
                            <h2 className="text-base font-black tracking-widest uppercase text-slate-900 dark:text-white">Swarm Trades Terminal</h2>
                            <p className="text-[10px] uppercase tracking-widest text-slate-500">Alpha Engine 2.0 × Dhan Positions · Unified Ledger</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {(['ALL', 'ALPHA_SIGNAL', 'DHAN_POSITION'] as const).map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                                    filter === f
                                        ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/40'
                                        : 'bg-slate-100/60 dark:bg-slate-800/40 text-slate-500 border border-transparent'
                                }`}
                            >
                                {f === 'ALL' ? 'All' : f === 'ALPHA_SIGNAL' ? 'Alpha' : 'Dhan'}
                            </button>
                        ))}
                        <button
                            onClick={refresh}
                            className="ml-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                    </div>
                </div>

                {/* Stat strip */}
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatChip icon={<Zap size={12} className="text-amber-400" />} label="Alpha Signals" value={stats.alphaCount} />
                    <StatChip icon={<Layers size={12} className="text-rose-400" />} label="Dhan Positions" value={stats.positionCount} />
                    <StatChip
                        icon={<TrendingUp size={12} className={stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'} />}
                        label="Live P&L"
                        value={formatINR(stats.totalPnl)}
                        tone={stats.totalPnl >= 0 ? 'emerald' : 'rose'}
                    />
                    <StatChip
                        icon={<Brain size={12} className="text-fuchsia-400" />}
                        label="Alpha Coherence"
                        value={coherence ? `${coherence.coherencePercent.toFixed(0)}%` : '—'}
                        subtitle={coherence ? `${coherence.executedSignals}/${coherence.totalSignals} executed` : ''}
                    />
                </div>
            </div>

            {/* Grid */}
            <div className="rounded-2xl border border-slate-200/50 dark:border-slate-700/50 bg-white/30 dark:bg-slate-900/30 backdrop-blur-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                <th className="px-4 py-3">Ticker</th>
                                <th className="px-4 py-3">Side</th>
                                <th className="px-4 py-3">Source</th>
                                <th className="px-4 py-3 text-right">Entry</th>
                                <th className="px-4 py-3 text-right">Target</th>
                                <th className="px-4 py-3 text-right">Stop</th>
                                <th className="px-4 py-3 text-right">LTP</th>
                                <th className="px-4 py-3 text-right">P&L</th>
                                <th className="px-4 py-3 text-center">Status</th>
                                <th className="px-4 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && rows.length === 0 ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800/50">
                                        <td colSpan={10} className="px-4 py-5">
                                            <div className="h-3 w-1/2 bg-slate-200/40 dark:bg-slate-800/40 rounded animate-pulse" />
                                        </td>
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="px-4 py-12 text-center">
                                        <div className="flex flex-col items-center gap-2 text-slate-500">
                                            <AlertTriangle size={20} />
                                            <span className="text-xs font-bold uppercase tracking-widest">No signals yet</span>
                                            <span className="text-[10px]">Run an Alpha scan in the Intraday Booster to generate signals.</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((row) => (
                                    <motion.tr
                                        key={row.id}
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="border-b border-slate-100/60 dark:border-slate-800/50 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/[0.04] transition-colors"
                                    >
                                        <td className="px-4 py-3">
                                            <TickerLink symbol={row.ticker} variant="badge" onActivate={(s) => setActiveTicker(s)} />
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest ${row.type === 'BUY' ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {row.type === 'BUY' ? <ArrowUpCircle size={12} /> : <ArrowDownCircle size={12} />}
                                                {row.type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${SOURCE_COLOR[row.signalSource] || 'text-slate-500'}`}>
                                                {row.signalSource}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-200">{formatINR(row.entryPrice)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-emerald-500">{formatINR(row.target)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-rose-500">{formatINR(row.stopLoss)}</td>
                                        <td className="px-4 py-3 text-right font-mono text-xs font-bold text-slate-700 dark:text-slate-200">{formatINR(row.currentPrice)}</td>
                                        <td className="px-4 py-3 text-right">
                                            <div className={`font-mono text-xs font-bold ${row.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                {row.pnl >= 0 ? '+' : ''}{formatINR(row.pnl)}
                                            </div>
                                            <div className={`text-[9px] font-mono font-bold ${row.pnlPercent >= 0 ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                                                {row.pnlPercent >= 0 ? '+' : ''}{row.pnlPercent.toFixed(2)}%
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <StatusBadge status={row.status} />
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {row.source === 'ALPHA_SIGNAL' && onImportToJournal && (
                                                <button
                                                    onClick={() => {
                                                        onImportToJournal({
                                                            ticker: row.ticker,
                                                            direction: row.type === 'BUY' ? 'Long' : 'Short',
                                                            entryPrice: row.entryPrice,
                                                            stopLoss: row.stopLoss,
                                                            takeProfit: row.target,
                                                            date: new Date().toISOString().split('T')[0],
                                                            setup: row.setup || `Alpha ${row.signalSource}`,
                                                            notes: `Auto-imported from Swarm Terminal · ${row.signalSource}`,
                                                            isSimulated: true,
                                                        });
                                                        toast.success(`${row.ticker} → Journal prefill ready`);
                                                    }}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors"
                                                >
                                                    <FileText size={11} /> Import
                                                </button>
                                            )}
                                            {row.source === 'DHAN_POSITION' && (
                                                <span className="text-[10px] font-mono font-bold text-rose-500/80 uppercase tracking-widest">Broker</span>
                                            )}
                                        </td>
                                    </motion.tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Coherence breakdown */}
            {coherence && Object.keys(coherence.bySource).length > 0 && (
                <div className="rounded-2xl border border-slate-200/50 dark:border-slate-700/50 bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <BarChart3 size={14} className="text-fuchsia-400" />
                        <h3 className="text-xs font-black tracking-widest uppercase text-slate-700 dark:text-slate-200">Alpha Coherence by Source (30d)</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {Object.entries(coherence.bySource).map(([source, stats], idx) => {
                            const pct = stats.total > 0 ? (stats.executed / stats.total) * 100 : 0;
                            return (
                                <div key={`${source}-${idx}`} className="rounded-xl border border-slate-200/50 dark:border-slate-700/50 p-3 bg-slate-50/40 dark:bg-slate-800/30">
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${SOURCE_COLOR[source] || 'text-slate-500'}`}>{source}</span>
                                        <span className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">{pct.toFixed(0)}%</span>
                                    </div>
                                    <div className="mt-1 h-1.5 bg-slate-200/50 dark:bg-slate-800/50 rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" style={{ width: `${pct}%` }} />
                                    </div>
                                    <div className="mt-1.5 text-[9px] font-mono text-slate-500">{stats.executed}/{stats.total} executed</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

const StatChip: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; subtitle?: string; tone?: 'emerald' | 'rose' | 'default' }> = ({ icon, label, value, subtitle, tone = 'default' }) => {
    const valueColor = tone === 'emerald' ? 'text-emerald-500' : tone === 'rose' ? 'text-rose-500' : 'text-slate-900 dark:text-white';
    return (
        <div className="rounded-xl border border-slate-200/50 dark:border-slate-700/50 bg-white/60 dark:bg-slate-900/40 backdrop-blur p-3">
            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500">
                {icon}{label}
            </div>
            <div className={`mt-1 text-lg font-black font-mono ${valueColor}`}>{value}</div>
            {subtitle && <div className="text-[9px] font-mono text-slate-500">{subtitle}</div>}
        </div>
    );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const color =
        status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-600 border-emerald-500/40' :
        status === 'OPEN' ? 'bg-sky-500/20 text-sky-500 border-sky-500/40' :
        status === 'ACHIEVED' ? 'bg-indigo-500/20 text-indigo-500 border-indigo-500/40' :
        status === 'STOPPED_OUT' ? 'bg-rose-500/20 text-rose-500 border-rose-500/40' :
        'bg-slate-500/20 text-slate-500 border-slate-500/40';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest border ${color}`}>
            {status}
        </span>
    );
};

export default SwarmTradesTerminal;
