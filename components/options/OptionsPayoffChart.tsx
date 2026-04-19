import React, { useMemo, useState, useRef, useCallback } from 'react';
import { Target, Shield, Activity, AlertTriangle, Info, Sparkles, Move } from 'lucide-react';
import { formatCurrencyCompact as formatCurrency } from '../../utils/helpers';
import { EmptyState } from '../shared/EmptyState';
import { motion } from 'framer-motion';
import {
    IndianIndexConfig,
    PayoffLeg,
    computePayoffCurve,
    computeBreakevens,
    summarizePayoff,
    probabilityOfProfit,
    INDIAN_INDEX_CONFIG,
    getLotSize
} from '../../utils/optionsMath';

interface OptionsPayoffChartProps {
    spotPrice: number;
    legs: Array<{
        id: string;
        type: 'CE' | 'PE';
        action: 'Buy' | 'Sell';
        strikePrice: number;
        premium: number;
        lotSize: number;
        quantity: number;
        isActive: boolean;
    }>;
    selectedIndex: string;
    /** Optional override for the analytics drift (annualized, decimal). Defaults to 0.07. */
    drift?: number;
    /** Optional IV for the Monte Carlo overlay (decimal). Defaults to 0.16. */
    impliedVolatility?: number;
    /** Number of Monte Carlo paths. Default 500. */
    mcPaths?: number;
    /** Days to expiry for the Greeks readout. */
    daysToExpiry?: number;
}

const WIDTH = 720;
const HEIGHT = 320;
const PAD = { top: 20, right: 24, bottom: 36, left: 64 };

const OptionsPayoffChart: React.FC<OptionsPayoffChartProps> = ({
    spotPrice,
    legs,
    selectedIndex,
    drift = 0.07,
    impliedVolatility = 0.16,
    mcPaths = 500,
    daysToExpiry = 7
}) => {
    const indexConfig: IndianIndexConfig | undefined = INDIAN_INDEX_CONFIG[selectedIndex as keyof typeof INDIAN_INDEX_CONFIG];

    // Enforce lot size from Indian index config — overrides any per-leg value
    const enforcedLotSize = useMemo(() => {
        if (indexConfig) return indexConfig.lotSize;
        try { return getLotSize(selectedIndex); } catch { return 25; }
    }, [indexConfig, selectedIndex]);

    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const [simPrice, setSimPrice] = useState(spotPrice);
    const svgRef = useRef<SVGSVGElement | null>(null);

    // Normalize legs (clamp to enforced lot size, drop inactive)
    const activeLegs: PayoffLeg[] = useMemo(
        () =>
            legs
                .filter(l => l.isActive)
                .map(l => ({
                    type: l.type,
                    action: l.action,
                    strikePrice: l.strikePrice,
                    premium: l.premium,
                    lotSize: enforcedLotSize,
                    quantity: l.quantity
                })),
        [legs, enforcedLotSize]
    );



    // Payoff curve (intrinsic-at-expiry P&L)
    const curve = useMemo(() => computePayoffCurve(spotPrice, activeLegs, 80, 0.15), [spotPrice, activeLegs]);

    // Breakevens, max profit, max loss, R/R
    const breakevens = useMemo(() => computeBreakevens(curve), [curve]);
    const summary = useMemo(() => summarizePayoff(curve), [curve]);

    // Monte Carlo probability of profit (uses timeToExpiry derived from daysToExpiry)
    const mcResult = useMemo(() => {
        if (activeLegs.length === 0) return null;
        const T = Math.max(0.001, (isNaN(daysToExpiry) ? 30 : daysToExpiry) / 365);
        return probabilityOfProfit(
            { spot: spotPrice, drift, volatility: impliedVolatility, timeToExpiry: T, paths: mcPaths },
            activeLegs
        );
    }, [spotPrice, drift, impliedVolatility, daysToExpiry, mcPaths, activeLegs]);

    // P&L at the slider's current simulated price
    const currentPnl = useMemo(() => {
        let total = 0;
        for (const leg of activeLegs) {
            const intrinsic = leg.type === 'CE' ? Math.max(0, simPrice - leg.strikePrice) : Math.max(0, leg.strikePrice - simPrice);
            total += (leg.action === 'Buy' ? 1 : -1) * (intrinsic - leg.premium) * leg.lotSize * leg.quantity;
        }
        return total;
    }, [simPrice, activeLegs]);

    // Build a histogram density from the MC paths for the overlay curve
    const density = useMemo(() => {
        if (!mcResult) return null;
        const bins = 60;
        const lo = spotPrice * 0.85;
        const hi = spotPrice * 1.15;
        const w = (hi - lo) / bins;
        const hist = new Array<number>(bins).fill(0);
        for (const p of mcResult.result.paths) {
            if (p < lo || p > hi) continue;
            const idx = Math.min(bins - 1, Math.max(0, Math.floor((p - lo) / w)));
            hist[idx]++;
        }
        const maxHist = Math.max(1, ...hist);
        return hist.map((c, i) => ({ x: lo + (i + 0.5) * w, y: c / maxHist }));
    }, [mcResult, spotPrice]);

    // Chart viewport scaling
    const xMin = spotPrice * 0.85;
    const xMax = spotPrice * 1.15;
    const yDataMin = Math.min(0, summary.maxLoss);
    const yDataMax = Math.max(0, summary.maxProfit);
    const yPad = (yDataMax - yDataMin) * 0.1 || 1;
    const yMin = yDataMin - yPad;
    const yMax = yDataMax + yPad;

    const xScale = useCallback((p: number) => PAD.left + ((p - xMin) / (xMax - xMin)) * (WIDTH - PAD.left - PAD.right), [xMin, xMax]);
    const yScale = useCallback((v: number) => HEIGHT - PAD.bottom - ((v - yMin) / (yMax - yMin)) * (HEIGHT - PAD.top - PAD.bottom), [yMin, yMax]);

    // Build the path string for the payoff curve
    const curvePath = useMemo(() => {
        if (curve.length === 0) return '';
        return curve
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.price).toFixed(2)} ${yScale(p.pnl).toFixed(2)}`)
            .join(' ');
    }, [curve, xScale, yScale]);

    // Profit/loss split paths (above and below y=0) for separate gradient fills
    const profitPath = useMemo(() => {
        if (curve.length === 0) return '';
        const zeroY = yScale(0);
        let d = '';
        for (let i = 0; i < curve.length; i++) {
            const p = curve[i];
            const px = xScale(p.price);
            const py = yScale(Math.max(0, p.pnl));
            if (i === 0) d += `M ${px.toFixed(2)} ${zeroY.toFixed(2)} `;
            d += `L ${px.toFixed(2)} ${py.toFixed(2)} `;
        }
        d += `L ${xScale(curve[curve.length - 1].price).toFixed(2)} ${zeroY.toFixed(2)} Z`;
        return d;
    }, [curve, xScale, yScale]);

    const lossPath = useMemo(() => {
        if (curve.length === 0) return '';
        const zeroY = yScale(0);
        let d = '';
        for (let i = 0; i < curve.length; i++) {
            const p = curve[i];
            const px = xScale(p.price);
            const py = yScale(Math.min(0, p.pnl));
            if (i === 0) d += `M ${px.toFixed(2)} ${zeroY.toFixed(2)} `;
            d += `L ${px.toFixed(2)} ${py.toFixed(2)} `;
        }
        d += `L ${xScale(curve[curve.length - 1].price).toFixed(2)} ${zeroY.toFixed(2)} Z`;
        return d;
    }, [curve, xScale, yScale]);

    // Build a smooth path for the MC density overlay
    const densityPath = useMemo(() => {
        if (!density) return '';
        const zeroY = yScale(0);
        const topY = PAD.top + 4;
        let d = `M ${xScale(density[0].x).toFixed(2)} ${zeroY.toFixed(2)} `;
        for (let i = 0; i < density.length; i++) {
            const px = xScale(density[i].x);
            const py = zeroY - (zeroY - topY) * density[i].y;
            d += `L ${px.toFixed(2)} ${py.toFixed(2)} `;
        }
        d += `L ${xScale(density[density.length - 1].x).toFixed(2)} ${zeroY.toFixed(2)} Z`;
        return d;
    }, [density, xScale, yScale]);

    // Mouse-to-price mapping for the draggable hover cursor
    const onSvgMouseMove = useCallback(
        (e: React.MouseEvent<SVGSVGElement>) => {
            if (!svgRef.current) return;
            const rect = svgRef.current.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            // Account for the SVG viewBox scaling
            const svgX = ratio * WIDTH;
            const price = xMin + ((svgX - PAD.left) / (WIDTH - PAD.left - PAD.right)) * (xMax - xMin);
            if (price < xMin || price > xMax) {
                setHoverIdx(null);
                return;
            }
            // Find nearest curve point
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < curve.length; i++) {
                const d = Math.abs(curve[i].price - price);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            setHoverIdx(bestIdx);
        },
        [curve, xMin, xMax]
    );

    const onSvgMouseLeave = useCallback(() => setHoverIdx(null), []);

    const hoverPoint = hoverIdx !== null ? curve[hoverIdx] : null;
    const hoverPnl = hoverPoint?.pnl ?? 0;

    // X-axis ticks
    const xTicks = useMemo(() => {
        const ticks: number[] = [];
        const step = (xMax - xMin) / 6;
        for (let i = 0; i <= 6; i++) ticks.push(xMin + i * step);
        return ticks;
    }, [xMin, xMax]);

    // Friendly empty state when no legs are active
    if (activeLegs.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
            >
                <EmptyState
                    type="setup-required"
                    title="Setup required"
                    message="Add a leg (Call, Put, or Spread) to see the payoff curve, breakevens, and probability cone."
                />
            </motion.div>
        );
    }

    return (
        <div className="rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-white/80 dark:bg-slate-900/60 backdrop-blur-xl shadow-sm p-6 transition-shadow hover:shadow-lg">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Activity className="w-4 h-4 text-indigo-500" />
                        Payoff Diagram
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {indexConfig ? (
                            <>Lot size enforced at <b>{indexConfig.lotSize}</b> · Strike interval ₹{indexConfig.strikeInterval} · Expiry {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][indexConfig.expiryWeekday]}</>
                        ) : 'Custom index'}
                    </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80" />
                        <span className="text-slate-600 dark:text-slate-300">Profit</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/80" />
                        <span className="text-slate-600 dark:text-slate-300">Loss</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500/40" />
                        <span className="text-slate-600 dark:text-slate-300">MC density</span>
                    </div>
                </div>
            </div>

            {/* SVG payoff + density overlay */}
            <div className="relative" style={{ contain: 'layout paint' }}>
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    preserveAspectRatio="xMidYMid meet"
                    className="w-full h-auto touch-none select-none"
                    onMouseMove={onSvgMouseMove}
                    onMouseLeave={onSvgMouseLeave}
                    role="img"
                    aria-label={`Options payoff diagram for ${selectedIndex} with ${activeLegs.length} active legs`}
                >
                    <defs>
                        <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.05} />
                            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.55} />
                        </linearGradient>
                        <linearGradient id="mcGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#10b981" />
                            <stop offset="50%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#f43f5e" />
                        </linearGradient>
                    </defs>

                    {/* Y grid */}
                    {[-1, -0.5, 0, 0.5, 1].map(t => {
                        const v = yMin + (yMax - yMin) * (1 - (t + 1) / 2);
                        return (
                            <line
                                key={t}
                                x1={PAD.left}
                                x2={WIDTH - PAD.right}
                                y1={yScale(v)}
                                y2={yScale(v)}
                                stroke="#94a3b8"
                                strokeOpacity={0.18}
                                strokeDasharray="2 4"
                            />
                        );
                    })}

                    {/* Profit & loss area fills */}
                    <path d={profitPath} fill="url(#profitGradient)" />
                    <path d={lossPath} fill="url(#lossGradient)" />

                    {/* MC density overlay */}
                    {densityPath && (
                        <path
                            d={densityPath}
                            fill="url(#mcGradient)"
                            stroke="#6366f1"
                            strokeOpacity={0.4}
                            strokeWidth={1.2}
                            strokeDasharray="3 3"
                        />
                    )}

                    {/* X axis */}
                    <line
                        x1={PAD.left}
                        x2={WIDTH - PAD.right}
                        y1={yScale(0)}
                        y2={yScale(0)}
                        stroke="#94a3b8"
                        strokeOpacity={0.5}
                        strokeWidth={1}
                    />
                    {/* Spot price reference line */}
                    <line
                        x1={xScale(spotPrice)}
                        x2={xScale(spotPrice)}
                        y1={PAD.top}
                        y2={HEIGHT - PAD.bottom}
                        stroke="#6366f1"
                        strokeOpacity={0.6}
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                    />
                    <text
                        x={xScale(spotPrice) + 6}
                        y={PAD.top + 12}
                        fill="#6366f1"
                        fontSize={10}
                        fontWeight={700}
                    >
                        Spot {formatCurrency(spotPrice)}
                    </text>

                    {/* Breakeven reference lines */}
                    {breakevens.map((be, i) => (
                        <g key={`be-${i}`}>
                            <line
                                x1={xScale(be)}
                                x2={xScale(be)}
                                y1={PAD.top}
                                y2={HEIGHT - PAD.bottom}
                                stroke="#f59e0b"
                                strokeOpacity={0.4}
                                strokeDasharray="2 4"
                                strokeWidth={1}
                            />
                            <text
                                x={xScale(be)}
                                y={HEIGHT - PAD.bottom - 4}
                                fill="#f59e0b"
                                fontSize={9}
                                fontWeight={600}
                                textAnchor="middle"
                            >
                                BE {formatCurrency(be)}
                            </text>
                        </g>
                    ))}

                    {/* Payoff curve line */}
                    <path
                        d={curvePath}
                        fill="none"
                        stroke="url(#lineGradient)"
                        strokeWidth={2.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />

                    {/* Hover cursor */}
                    {hoverPoint && (
                        <g>
                            <line
                                x1={xScale(hoverPoint.price)}
                                x2={xScale(hoverPoint.price)}
                                y1={PAD.top}
                                y2={HEIGHT - PAD.bottom}
                                stroke="#6366f1"
                                strokeWidth={1}
                                strokeOpacity={0.7}
                            />
                            <circle
                                cx={xScale(hoverPoint.price)}
                                cy={yScale(hoverPoint.pnl)}
                                r={5}
                                fill={hoverPoint.pnl >= 0 ? '#10b981' : '#f43f5e'}
                                stroke="#fff"
                                strokeWidth={2}
                            />
                        </g>
                    )}

                    {/* X-axis tick labels */}
                    {xTicks.map((t, i) => (
                        <text
                            key={i}
                            x={xScale(t)}
                            y={HEIGHT - 8}
                            fill="#64748b"
                            fontSize={9}
                            textAnchor="middle"
                        >
                            {formatCurrency(t)}
                        </text>
                    ))}

                    {/* Axis labels */}
                    <text x={WIDTH / 2} y={HEIGHT - 0} fill="#64748b" fontSize={10} textAnchor="middle" opacity={0} />
                </svg>

                {/* Hover tooltip */}
                {hoverPoint && (
                    <div
                        className="pointer-events-none absolute z-10 rounded-lg border border-slate-700/60 bg-slate-900/90 backdrop-blur px-3 py-2 text-xs text-white shadow-xl"
                        style={{
                            left: `calc(${((xScale(hoverPoint.price) - PAD.left) / (WIDTH - PAD.left - PAD.right)) * 100}% + 8px)`,
                            top: `${((yScale(hoverPoint.pnl) - PAD.top) / (HEIGHT - PAD.top - PAD.bottom)) * 100}%`,
                            transform: 'translate(0, -100%)'
                        }}
                    >
                        <div className="font-bold mb-0.5">@ {formatCurrency(hoverPoint.price)}</div>
                        <div className={hoverPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            P&amp;L: {formatCurrency(hoverPnl)}
                        </div>
                        {mcResult && (
                            <div className="text-indigo-300 mt-1 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> P(profit) = {(mcResult.probabilityOfProfit * 100).toFixed(1)}%
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Simulated price slider */}
            <div className="mt-5">
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                    <Move className="w-3.5 h-3.5 text-indigo-500" />
                    Simulated spot: {formatCurrency(simPrice)}
                </label>
                <input
                    type="range"
                    min={xMin}
                    max={xMax}
                    step={Math.max(1, Math.round((xMax - xMin) / 200))}
                    value={simPrice}
                    onChange={e => setSimPrice(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    aria-label="Simulated spot price"
                />
            </div>

            {/* Summary tiles */}
            <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 border border-emerald-200/70 dark:border-emerald-800/50">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Target className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Max Profit</span>
                    </div>
                    <p className="text-base font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(summary.maxProfit)}</p>
                </div>
                <div className="p-3 rounded-xl bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-950/30 dark:to-red-950/30 border border-rose-200/70 dark:border-rose-800/50">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Shield className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                        <span className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wide">Max Loss</span>
                    </div>
                    <p className="text-base font-bold text-rose-700 dark:text-rose-300">{formatCurrency(summary.maxLoss)}</p>
                </div>
                <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30 border border-indigo-200/70 dark:border-indigo-800/50">
                    <div className="flex items-center gap-1.5 mb-1">
                        <Activity className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wide">At Sim Price</span>
                    </div>
                    <p className={`text-base font-bold ${currentPnl >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                        {formatCurrency(currentPnl)}
                    </p>
                </div>
                <div className="p-3 rounded-xl bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/30 dark:to-yellow-950/30 border border-amber-200/70 dark:border-amber-800/50">
                    <div className="flex items-center gap-1.5 mb-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Breakeven</span>
                    </div>
                    <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                        {breakevens.length > 0
                            ? breakevens.map(p => formatCurrency(p)).join(' · ')
                            : 'N/A'}
                    </p>
                </div>
            </div>

            {/* Probability + IV readout */}
            {mcResult && (
                <div className="mt-3 p-3 rounded-xl bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-800/70 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                    <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                        <span className="text-slate-600 dark:text-slate-300">P(profit):</span>
                        <b className="text-indigo-600 dark:text-indigo-300">{(mcResult.probabilityOfProfit * 100).toFixed(1)}%</b>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-slate-600 dark:text-slate-300">IV used:</span>
                        <b className="text-slate-700 dark:text-slate-200">{(impliedVolatility * 100).toFixed(1)}%</b>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-slate-600 dark:text-slate-300">DTE:</span>
                        <b className="text-slate-700 dark:text-slate-200">{daysToExpiry}d</b>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-slate-500" />
                        <span className="text-slate-600 dark:text-slate-300">MC paths:</span>
                        <b className="text-slate-700 dark:text-slate-200">{mcPaths.toLocaleString()}</b>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OptionsPayoffChart;
