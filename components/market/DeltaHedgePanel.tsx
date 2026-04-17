import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Shield, TrendingUp, TrendingDown, Activity, Zap, BarChart3,
    ArrowDownUp, Sparkles, Loader2, RefreshCw
} from 'lucide-react';
import { portfolioGreeksService, type PortfolioGreeks } from '../../services/PortfolioGreeksService';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import {
    computeHedge,
    simulateHedgedPayoff,
    recommendHedgeStrategy,
    type HedgeResult,
    type PayoffPoint,
    type HedgeStrategy
} from '../../services/deltaHedgingEngine';

const PAD = { top: 16, right: 16, bottom: 24, left: 40 };

interface DeltaHedgePanelProps {
    spot: number;
    indexName?: string;
}

/**
 * Live portfolio-Greeks ticker + futures-hedge calculator.
 *
 * - Pulls PortfolioGreeks from the singleton service
 * - Renders Net Δ, Γ, Θ, Vega as live ticker cards
 * - "Compute Hedge" button runs the delta-hedging engine
 * - Mini SVG payoff: blue = unhedged, green dashed = hedged
 * - Strategy recommendation chip
 */
const DeltaHedgePanel: React.FC<DeltaHedgePanelProps> = ({ spot, indexName = 'NIFTY' }) => {
    const [greeks, setGreeks] = useState<PortfolioGreeks | null>(null);
    const [loading, setLoading] = useState(false);
    const [computing, setComputing] = useState(false);
    const [hedge, setHedge] = useState<HedgeResult | null>(null);
    const [payoff, setPayoff] = useState<PayoffPoint[]>([]);
    const [strategy, setStrategy] = useState<HedgeStrategy | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchGreeks = async () => {
        setLoading(true);
        setError(null);
        try {
            const g = await portfolioGreeksService.calculatePortfolioGreeks();
            setGreeks(g);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchGreeks();
    }, []);

    usePausedInterval(fetchGreeks, 30000, { runImmediately: false });

    const handleCompute = () => {
        if (!greeks) return;
        setComputing(true);
        try {
            const h = computeHedge(greeks.totalDelta, spot, indexName);
            setHedge(h);
            // Simulate the hedged vs unhedged curve
            const sim = simulateHedgedPayoff(
                [{ delta: greeks.totalDelta, gamma: greeks.totalGamma, theta: greeks.totalTheta, vega: greeks.totalVega, quantity: 1 }],
                spot,
                0.15,
                50,
                indexName
            );
            setPayoff(sim.unhedged); // both arrays are identical in structure
            const s = recommendHedgeStrategy(greeks.totalDelta, greeks.totalGamma, spot, greeks.totalVega);
            setStrategy(s);
        } finally {
            setTimeout(() => setComputing(false), 220);
        }
    };

    // Build SVG path for the payoff curves
    const W = 360;
    const H = 160;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const payoffDomain = useMemo(() => {
        if (payoff.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        const xs = payoff.map(p => p.spot);
        const ysUn = payoff.map(p => p.pnlUnhedged);
        const ysHd = payoff.map(p => p.pnlHedged);
        const allY = [...ysUn, ...ysHd];
        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...allY, 0),
            maxY: Math.max(...allY, 0)
        };
    }, [payoff]);

    const xScale = (v: number) =>
        PAD.left + ((v - payoffDomain.minX) / Math.max(1, payoffDomain.maxX - payoffDomain.minX)) * innerW;
    const yScale = (v: number) =>
        PAD.top + (1 - (v - payoffDomain.minY) / Math.max(1, payoffDomain.maxY - payoffDomain.minY)) * innerH;

    const unhedgedPath = useMemo(() => {
        if (payoff.length === 0) return '';
        return payoff.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${xScale(p.spot).toFixed(2)} ${yScale(p.pnlUnhedged).toFixed(2)}`
        ).join(' ');
    }, [payoff, payoffDomain]);

    const hedgedPath = useMemo(() => {
        if (payoff.length === 0) return '';
        return payoff.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${xScale(p.spot).toFixed(2)} ${yScale(p.pnlHedged).toFixed(2)}`
        ).join(' ');
    }, [payoff, payoffDomain]);

    const yZero = payoffDomain.minY < 0 && payoffDomain.maxY > 0
        ? yScale(0)
        : null;

    // Live ticker cards
    const tickerData = greeks
        ? [
            { label: 'Net Δ', value: greeks.totalDelta, color: greeks.totalDelta >= 0 ? 'emerald' : 'rose', icon: <TrendingUp size={12} /> },
            { label: 'Net Γ', value: greeks.totalGamma, color: 'amber', icon: <Activity size={12} /> },
            { label: 'Net Θ', value: greeks.totalTheta, color: greeks.totalTheta >= 0 ? 'emerald' : 'rose', icon: <Zap size={12} /> },
            { label: 'Net Vega', value: greeks.totalVega, color: 'indigo', icon: <BarChart3 size={12} /> }
        ] as const
        : [];

    return (
        <div className="border border-slate-800 bg-slate-900/90 p-5 rounded-[32px] space-y-4 relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-16 -left-16 w-56 h-56 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header */}
            <div className="flex items-center justify-between relative">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <div className="w-1 h-3 bg-emerald-500 rounded-full" />
                    <Shield size={14} className="text-emerald-400" />
                    Delta Hedging Engine
                </h3>
                <button
                    onClick={fetchGreeks}
                    disabled={loading}
                    className="h-7 w-7 flex items-center justify-center border border-slate-800 bg-slate-950 hover:bg-slate-900 rounded-lg transition-colors"
                    title="Refresh Greeks"
                >
                    <RefreshCw size={11} className={loading ? 'animate-spin text-indigo-400' : 'text-slate-400'} />
                </button>
            </div>

            {/* Live Greeks ticker */}
            <div className="grid grid-cols-2 gap-2 relative">
                {loading && !greeks ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-16 bg-slate-950/50 border border-slate-800 rounded-2xl animate-pulse" />
                    ))
                ) : error ? (
                    <div className="col-span-2 text-[10px] text-rose-400 font-mono border border-rose-500/20 bg-rose-500/5 px-3 py-2 rounded-xl">
                        Greeks fetch error: {error}
                    </div>
                ) : (
                    tickerData.map((t) => (
                        <GreeksCard key={t.label} {...t} value={t.value} />
                    ))
                )}
            </div>

            {greeks && (
                <div className="text-[9px] text-slate-500 font-mono uppercase tracking-widest text-center -mt-2">
                    {greeks.positionCount} position{greeks.positionCount === 1 ? '' : 's'} • last sync {new Date(greeks.lastUpdated).toLocaleTimeString()}
                </div>
            )}

            {/* Compute button */}
            <button
                onClick={handleCompute}
                disabled={!greeks || computing}
                className="w-full h-11 flex items-center justify-center gap-2 border border-indigo-500/30 bg-gradient-to-r from-indigo-600/20 to-emerald-500/20 hover:from-indigo-600/30 hover:to-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-[11px] font-black uppercase tracking-widest text-white rounded-2xl"
            >
                {computing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-amber-300" />}
                Compute Hedge
            </button>

            {/* Hedge output */}
            <AnimatePresence>
                {hedge && strategy && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="space-y-3"
                    >
                        {/* Hedge summary */}
                        <div className="border border-slate-800 bg-slate-950/50 p-3 rounded-2xl space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Futures Action</span>
                                <span className={`text-[10px] font-black font-mono px-2 py-0.5 rounded-lg ${
                                    hedge.side === 'BUY'
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                                }`}>
                                    {hedge.side} {Math.abs(hedge.futuresContracts)} × {hedge.lotSize}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <MetricCell label="Hedge Qty" value={hedge.hedgeQty.toLocaleString()} />
                                <MetricCell label="Residual Δ" value={hedge.residualDelta.toFixed(0)} tone={Math.abs(hedge.residualDelta) < 1 ? 'emerald' : 'rose'} />
                                <MetricCell label="Notional" value={`₹${(hedge.notional / 100000).toFixed(1)}L`} />
                            </div>
                            <div className="text-[9px] text-slate-500 font-mono">
                                Est. margin ≈ ₹{hedge.costApprox.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </div>
                        </div>

                        {/* Strategy chip */}
                        <div className="border border-slate-800 bg-slate-950/50 p-3 rounded-2xl">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
                                    <Sparkles size={10} className="text-amber-300" />
                                    Recommended Strategy
                                </span>
                                <StrategyBadge name={strategy.name} />
                            </div>
                            <p className="text-[10px] text-slate-300 leading-relaxed font-sans">
                                {strategy.rationale}
                            </p>
                        </div>

                        {/* Mini payoff SVG */}
                        {payoff.length > 0 && (
                            <div className="border border-slate-800 bg-slate-950/50 p-3 rounded-2xl">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1">
                                        <ArrowDownUp size={10} className="text-cyan-400" />
                                        Hedged vs Unhedged P&L (±15%)
                                    </span>
                                    <div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest">
                                        <span className="flex items-center gap-1 text-sky-400">
                                            <div className="w-2 h-0.5 bg-sky-400" /> Unhedged
                                        </span>
                                        <span className="flex items-center gap-1 text-emerald-400">
                                            <div className="w-2 h-0.5 bg-emerald-400 border-dashed" style={{ borderTop: '1px dashed' }} /> Hedged
                                        </span>
                                    </div>
                                </div>
                                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
                                    <defs>
                                        <linearGradient id="hdFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    {/* Zero line */}
                                    {yZero !== null && (
                                        <line
                                            x1={PAD.left} x2={W - PAD.right}
                                            y1={yZero} y2={yZero}
                                            stroke="#475569" strokeWidth={1} strokeDasharray="2 4"
                                        />
                                    )}
                                    {/* Spot reference */}
                                    {spot > 0 && (
                                        <line
                                            x1={xScale(spot)} x2={xScale(spot)}
                                            y1={PAD.top} y2={H - PAD.bottom}
                                            stroke="#fbbf24" strokeWidth={0.5} strokeDasharray="1 3" opacity={0.5}
                                        />
                                    )}
                                    {/* Unhedged path */}
                                    <path
                                        d={unhedgedPath}
                                        stroke="#38bdf8" strokeWidth={2} fill="none"
                                        strokeLinecap="round"
                                    />
                                    {/* Hedged path (dashed green) */}
                                    <path
                                        d={hedgedPath}
                                        stroke="#10b981" strokeWidth={2} fill="none"
                                        strokeLinecap="round" strokeDasharray="4 3"
                                    />
                                    {/* X-axis label */}
                                    <text
                                        x={PAD.left + innerW / 2} y={H - 4}
                                        textAnchor="middle" fontSize={8} fill="#475569"
                                        fontFamily="monospace"
                                    >
                                        SPOT (-15% → +15%)
                                    </text>
                                </svg>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// ============================================================
// SUBCOMPONENTS
// ============================================================

interface GreeksCardProps {
    label: string;
    value: number;
    color: 'emerald' | 'rose' | 'amber' | 'indigo';
    icon: React.ReactNode;
}

const COLOR_MAP: Record<GreeksCardProps['color'], { border: string; bg: string; text: string; icon: string }> = {
    emerald: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5',  text: 'text-emerald-400', icon: 'text-emerald-400' },
    rose:    { border: 'border-rose-500/20',    bg: 'bg-rose-500/5',     text: 'text-rose-400',    icon: 'text-rose-400' },
    amber:   { border: 'border-amber-500/20',   bg: 'bg-amber-500/5',    text: 'text-amber-400',   icon: 'text-amber-400' },
    indigo:  { border: 'border-indigo-500/20',  bg: 'bg-indigo-500/5',   text: 'text-indigo-400',  icon: 'text-indigo-400' }
};

const GreeksCard: React.FC<GreeksCardProps> = ({ label, value, color, icon }) => {
    const c = COLOR_MAP[color];
    const sign = value >= 0 ? '+' : '';
    return (
        <div className={`border ${c.border} ${c.bg} px-3 py-2.5 rounded-2xl`}>
            <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-slate-500">
                <span className={c.icon}>{icon}</span>
                {label}
            </div>
            <div className={`text-base font-black font-mono ${c.text} mt-0.5`}>
                {sign}{(Number(value) || 0).toFixed(2)}
            </div>
        </div>
    );
};

interface MetricCellProps {
    label: string;
    value: string;
    tone?: 'emerald' | 'rose' | 'slate';
}

const TONE_MAP: Record<NonNullable<MetricCellProps['tone']>, string> = {
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    slate: 'text-white'
};

const MetricCell: React.FC<MetricCellProps> = ({ label, value, tone = 'slate' }) => (
    <div className="border border-slate-850 bg-slate-950/50 px-2 py-1.5 rounded-xl">
        <div className="text-[7px] font-black uppercase tracking-widest text-slate-500">{label}</div>
        <div className={`text-xs font-black font-mono ${TONE_MAP[tone]}`}>{value}</div>
    </div>
);

const STRATEGY_STYLES: Record<HedgeStrategy['name'], { bg: string; text: string; border: string; label: string }> = {
    FUTURES:        { bg: 'bg-indigo-500/10',  text: 'text-indigo-300',  border: 'border-indigo-500/30',  label: 'FUTURES' },
    BUTTERFLY:      { bg: 'bg-amber-500/10',   text: 'text-amber-300',   border: 'border-amber-500/30',   label: 'BUTTERFLY' },
    VERTICAL_SPREAD:{ bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', label: 'VERTICAL SPREAD' },
    NO_HEDGE:       { bg: 'bg-slate-700/30',   text: 'text-slate-300',   border: 'border-slate-600',      label: 'NO HEDGE' },
    STRADDLE:       { bg: 'bg-rose-500/10',    text: 'text-rose-300',    border: 'border-rose-500/30',    label: 'STRADDLE' }
};

const StrategyBadge: React.FC<{ name: HedgeStrategy['name'] }> = ({ name }) => {
    const s = STRATEGY_STYLES[name] || STRATEGY_STYLES.NO_HEDGE;
    return (
        <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border ${s.bg} ${s.text} ${s.border}`}>
            {s.label}
        </span>
    );
};

export default DeltaHedgePanel;
