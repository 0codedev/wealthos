import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Smile, TrendingUp, TrendingDown, Activity, ChevronUp, ChevronDown } from 'lucide-react';
import {
    computeIVSmile,
    computeSkewMetrics,
    cubicInterpolate,
    findATMStrike,
    type IVSmilePoint
} from '../../services/ivSmewService';
import type { OptionChainSnapshot } from '../../services/OptionChainService';

interface IVSkewChartProps {
    chain: OptionChainSnapshot;
    spot: number;
    height?: number;
}

interface TooltipState {
    visible: boolean;
    x: number;
    y: number;
    point: { strike: number; callIV: number; putIV: number; type: 'CE' | 'PE' } | null;
}

const PAD = { top: 30, right: 24, bottom: 38, left: 48 };

/**
 * Pure-SVG smile / smirk chart.
 *
 * - Strike on X (centered on ATM via translate)
 * - IV% on Y
 * - Two color-coded curves: Call IV (cyan) and Put IV (rose)
 * - ATM dashed line + gradient fill between curves (skew viz)
 * - Cubic spline interpolation for smoothness
 * - Hover glassmorphic tooltip + stats panel (ATM IV, 25Δ, RR, BF)
 */
const IVSkewChart: React.FC<IVSkewChartProps> = ({ chain, spot, height = 320 }) => {
    const [hover, setHover] = useState<TooltipState>({
        visible: false,
        x: 0,
        y: 0,
        point: null
    });

    // Compute smile + metrics
    const smile = useMemo(() => computeIVSmile(chain, spot), [chain, spot]);
    const atm = useMemo(() => findATMStrike(chain, spot), [chain, spot]);
    const metrics = useMemo(() => computeSkewMetrics(chain, spot), [chain, spot]);

    // Build call/put series directly from the chain (not merged) so we
    // can show two distinct curves. Falls back to the merged smile when
    // a side is missing for a strike.
    const callPoints = useMemo(() => {
        const out: { x: number; y: number; raw: IVSmilePoint }[] = [];
        for (const row of chain?.strikes || []) {
            if (row.CE && row.CE.iv > 0) {
                out.push({
                    x: row.strikePrice,
                    y: row.CE.iv,
                    raw: { strike: row.strikePrice, iv: row.CE.iv, type: 'CE', moneyness: spot > 0 ? row.strikePrice / spot : 1 }
                });
            }
        }
        out.sort((a, b) => a.x - b.x);
        return out;
    }, [chain, spot]);

    const putPoints = useMemo(() => {
        const out: { x: number; y: number; raw: IVSmilePoint }[] = [];
        for (const row of chain?.strikes || []) {
            if (row.PE && row.PE.iv > 0) {
                out.push({
                    x: row.strikePrice,
                    y: row.PE.iv,
                    raw: { strike: row.strikePrice, iv: row.PE.iv, type: 'PE', moneyness: spot > 0 ? row.strikePrice / spot : 1 }
                });
            }
        }
        out.sort((a, b) => a.x - b.x);
        return out;
    }, [chain, spot]);

    // Build cubic splines for smooth curves
    const callSpline = useMemo(() => {
        if (callPoints.length < 2) return null;
        try { return cubicInterpolate(callPoints.map(p => ({ x: p.x, y: p.y }))); }
        catch { return null; }
    }, [callPoints]);

    const putSpline = useMemo(() => {
        if (putPoints.length < 2) return null;
        try { return cubicInterpolate(putPoints.map(p => ({ x: p.x, y: p.y }))); }
        catch { return null; }
    }, [putPoints]);

    // X axis: pad ±5% around min/max strike
    const minK = smile.length > 0 ? smile[0].strike : 0;
    const maxK = smile.length > 0 ? smile[smile.length - 1].strike : 100;
    const padK = (maxK - minK) * 0.05 || 1;
    const xLo = minK - padK;
    const xHi = maxK + padK;

    // Y axis: pad 2% IV above and below
    const allIV = smile.map(p => p.iv);
    const yMin = allIV.length > 0 ? Math.max(0, Math.min(...allIV) - 2) : 0;
    const yMax = allIV.length > 0 ? Math.max(...allIV) + 2 : 100;

    const W = 720;
    const H = height;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const xScale = (k: number) => PAD.left + ((k - xLo) / (xHi - xLo)) * innerW;
    const yScale = (iv: number) => PAD.top + (1 - (iv - yMin) / (yMax - yMin)) * innerH;

    // Build smooth path via spline sampling
    const buildPath = (spline: ReturnType<typeof cubicInterpolate> | null, fallback: { x: number; y: number }[]) => {
        if (!spline) {
            if (fallback.length === 0) return '';
            return fallback.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(2)} ${yScale(p.y).toFixed(2)}`).join(' ');
        }
        const samples = 100;
        const xStart = spline.xs[0];
        const xEnd = spline.xs[spline.xs.length - 1];
        const out: string[] = [];
        for (let i = 0; i <= samples; i++) {
            const x = xStart + ((xEnd - xStart) * i) / samples;
            let y = spline.evaluate(x);
            // Clamp to chart
            y = Math.max(yMin, Math.min(yMax, y));
            out.push(`${i === 0 ? 'M' : 'L'} ${xScale(x).toFixed(2)} ${yScale(y).toFixed(2)}`);
        }
        return out.join(' ');
    };

    const callPath = buildPath(callSpline, callPoints);
    const putPath = buildPath(putSpline, putPoints);

    // Fill between call and put (sample the splines, average them)
    const buildFillPath = () => {
        if (!callSpline || !putSpline) return '';
        const samples = 80;
        const xStart = Math.max(callSpline.xs[0], putSpline.xs[0]);
        const xEnd = Math.min(callSpline.xs[callSpline.xs.length - 1], putSpline.xs[putSpline.xs.length - 1]);
        if (xEnd <= xStart) return '';
        const top: string[] = [];
        const bottom: string[] = [];
        for (let i = 0; i <= samples; i++) {
            const x = xStart + ((xEnd - xStart) * i) / samples;
            const callY = callSpline.evaluate(x);
            const putY = putSpline.evaluate(x);
            const upper = Math.max(callY, putY);
            const lower = Math.min(callY, putY);
            top.push(`${i === 0 ? 'M' : 'L'} ${xScale(x).toFixed(2)} ${yScale(upper).toFixed(2)}`);
            bottom.push(`L ${xScale(x).toFixed(2)} ${yScale(lower).toFixed(2)}`);
        }
        return [...top, ...bottom.reverse(), 'Z'].join(' ');
    };

    const fillPath = buildFillPath();

    // ATM dashed line
    const atmX = xScale(atm);
    const atmIVY = yScale(metrics.atmIV);

    // Y-axis ticks
    const yTicks = useMemo(() => {
        const ticks: number[] = [];
        const step = (yMax - yMin) / 4;
        for (let i = 0; i <= 4; i++) ticks.push(yMin + step * i);
        return ticks;
    }, [yMin, yMax]);

    // X-axis ticks (every ~10%)
    const xTicks = useMemo(() => {
        const ticks: number[] = [];
        const step = (xHi - xLo) / 6;
        for (let i = 0; i <= 6; i++) ticks.push(xLo + step * i);
        return ticks;
    }, [xLo, xHi]);

    // Mouse handling — show tooltip with nearest strike data
    const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        if (localX < PAD.left || localX > W - PAD.right) {
            setHover(prev => ({ ...prev, visible: false }));
            return;
        }
        // Convert localX to strike
        const strike = xLo + ((localX - PAD.left) / innerW) * (xHi - xLo);
        // Find nearest chain strike
        let nearest = chain.strikes[0];
        let bestDiff = Infinity;
        for (const row of chain.strikes) {
            const d = Math.abs(row.strikePrice - strike);
            if (d < bestDiff) { bestDiff = d; nearest = row; }
        }
        const callIV = nearest.CE?.iv ?? 0;
        const putIV = nearest.PE?.iv ?? 0;
        setHover({
            visible: true,
            x: xScale(nearest.strikePrice),
            y: e.clientY - rect.top,
            point: { strike: nearest.strikePrice, callIV, putIV, type: 'CE' }
        });
    };

    const handleLeave = () => setHover(prev => ({ ...prev, visible: false }));

    if (smile.length < 2 || spot <= 0) {
        return (
            <div className="border border-slate-800 bg-slate-900/90 p-5 rounded-[32px] flex items-center justify-center text-slate-500 text-xs font-mono"
                style={{ height }}>
                Insufficient chain data for IV smile.
            </div>
        );
    }

    return (
        <div className="border border-slate-800 bg-slate-900/90 p-5 rounded-[32px] relative overflow-hidden">
            {/* Glassmorphic background accent */}
            <div className="absolute -top-20 -right-20 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="flex items-center justify-between mb-3 relative">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <div className="w-1 h-3 bg-indigo-500 rounded-full" />
                    <Smile size={14} className="text-indigo-400" />
                    Real-Time IV Smile &amp; Skew
                </h3>
                <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest">
                    <span className="flex items-center gap-1 text-cyan-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> Calls
                    </span>
                    <span className="flex items-center gap-1 text-rose-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Puts
                    </span>
                    <span className="flex items-center gap-1 text-amber-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> ATM
                    </span>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 relative">
                {/* SVG chart */}
                <div className="flex-1 min-w-0">
                    <svg
                        viewBox={`0 0 ${W} ${H}`}
                        width="100%"
                        height={H}
                        preserveAspectRatio="xMidYMid meet"
                        onMouseMove={handleMove}
                        onMouseLeave={handleLeave}
                        className="cursor-crosshair"
                    >
                        <defs>
                            <linearGradient id="ivFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                            </linearGradient>
                            <linearGradient id="callStroke" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#06b6d4" />
                                <stop offset="100%" stopColor="#22d3ee" />
                            </linearGradient>
                            <linearGradient id="putStroke" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor="#fb7185" />
                                <stop offset="100%" stopColor="#f43f5e" />
                            </linearGradient>
                        </defs>

                        {/* Y grid */}
                        {yTicks.map((tick, i) => (
                            <g key={`y-${i}`}>
                                <line
                                    x1={PAD.left} x2={W - PAD.right}
                                    y1={yScale(tick)} y2={yScale(tick)}
                                    stroke="#1e293b" strokeDasharray="2 4"
                                />
                                <text
                                    x={PAD.left - 8} y={yScale(tick) + 3}
                                    textAnchor="end" fontSize={9} fill="#64748b"
                                    fontFamily="monospace"
                                >
                                    {tick.toFixed(1)}%
                                </text>
                            </g>
                        ))}

                        {/* X ticks */}
                        {xTicks.map((tick, i) => (
                            <g key={`x-${i}`}>
                                <line
                                    x1={xScale(tick)} x2={xScale(tick)}
                                    y1={H - PAD.bottom} y2={PAD.top}
                                    stroke="#1e293b" strokeDasharray="1 6" opacity={0.4}
                                />
                                <text
                                    x={xScale(tick)} y={H - PAD.bottom + 14}
                                    textAnchor="middle" fontSize={9} fill="#64748b"
                                    fontFamily="monospace"
                                >
                                    {tick.toFixed(0)}
                                </text>
                            </g>
                        ))}

                        {/* Skew fill between call & put */}
                        {fillPath && (
                            <path d={fillPath} fill="url(#ivFill)" opacity={0.7} />
                        )}

                        {/* Call curve */}
                        {callPath && (
                            <path
                                d={callPath}
                                stroke="url(#callStroke)" strokeWidth={2.5}
                                fill="none" strokeLinecap="round"
                                style={{ filter: 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.4))' }}
                            />
                        )}

                        {/* Put curve */}
                        {putPath && (
                            <path
                                d={putPath}
                                stroke="url(#putStroke)" strokeWidth={2.5}
                                fill="none" strokeLinecap="round"
                                style={{ filter: 'drop-shadow(0 0 6px rgba(244, 63, 94, 0.4))' }}
                            />
                        )}

                        {/* Raw data points */}
                        {callPoints.map((p, i) => (
                            <circle key={`c-${i}`} cx={xScale(p.x)} cy={yScale(p.y)} r={2} fill="#22d3ee" />
                        ))}
                        {putPoints.map((p, i) => (
                            <circle key={`p-${i}`} cx={xScale(p.x)} cy={yScale(p.y)} r={2} fill="#f43f5e" />
                        ))}

                        {/* ATM dashed line */}
                        {atmX >= PAD.left && atmX <= W - PAD.right && (
                            <>
                                <line
                                    x1={atmX} x2={atmX}
                                    y1={PAD.top} y2={H - PAD.bottom}
                                    stroke="#fbbf24" strokeWidth={1} strokeDasharray="4 3" opacity={0.7}
                                />
                                {metrics.atmIV > 0 && (
                                    <circle
                                        cx={atmX} cy={atmIVY} r={5}
                                        fill="#fbbf24" stroke="#0f172a" strokeWidth={2}
                                    />
                                )}
                                <text
                                    x={atmX + 4} y={PAD.top + 12}
                                    fontSize={9} fill="#fbbf24"
                                    fontFamily="monospace" fontWeight="bold"
                                >
                                    ATM {atm.toFixed(0)}
                                </text>
                            </>
                        )}

                        {/* Hover crosshair */}
                        {hover.visible && hover.x >= PAD.left && hover.x <= W - PAD.right && (
                            <line
                                x1={hover.x} x2={hover.x}
                                y1={PAD.top} y2={H - PAD.bottom}
                                stroke="#a78bfa" strokeWidth={1} strokeDasharray="2 2" opacity={0.6}
                            />
                        )}

                        {/* Axes labels */}
                        <text
                            x={PAD.left + innerW / 2} y={H - 4}
                            textAnchor="middle" fontSize={9} fill="#475569"
                            fontFamily="monospace" fontWeight="bold"
                        >
                            STRIKE PRICE (centered on ATM)
                        </text>
                        <text
                            x={12} y={PAD.top + innerH / 2}
                            transform={`rotate(-90 12 ${PAD.top + innerH / 2})`}
                            textAnchor="middle" fontSize={9} fill="#475569"
                            fontFamily="monospace" fontWeight="bold"
                        >
                            IMPLIED VOLATILITY (%)
                        </text>
                    </svg>
                </div>

                {/* Stats panel */}
                <div className="lg:w-56 flex flex-col gap-2.5">
                    <StatChip
                        icon={<Activity size={12} />}
                        label="ATM IV"
                        value={`${metrics.atmIV.toFixed(2)}%`}
                        sub={`Strike ${atm.toFixed(0)}`}
                        accent="amber"
                    />
                    <StatChip
                        icon={metrics.skew25Delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        label="25Δ SKEW"
                        value={`${metrics.skew25Delta >= 0 ? '+' : ''}${metrics.skew25Delta.toFixed(2)} vol pts`}
                        sub="Put IV − Call IV"
                        accent={metrics.skew25Delta >= 0 ? 'rose' : 'emerald'}
                    />
                    <StatChip
                        icon={metrics.riskReversal >= 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        label="RISK REVERSAL"
                        value={`${metrics.riskReversal >= 0 ? '+' : ''}${metrics.riskReversal.toFixed(2)} vol pts`}
                        sub="Call IV − Put IV"
                        accent="indigo"
                    />
                    <StatChip
                        icon={<Smile size={12} />}
                        label="BUTTERFLY"
                        value={`${metrics.butterfly >= 0 ? '+' : ''}${metrics.butterfly.toFixed(2)} vol pts`}
                        sub="Wing − ATM"
                        accent="violet"
                    />
                    <StatChip
                        icon={<Activity size={12} />}
                        label="CURVATURE"
                        value={(metrics?.curvature ?? 0).toExponential(2)}
                        sub="d²IV/dK² at ATM"
                        accent="slate"
                    />
                </div>
            </div>

            {/* Glassmorphic tooltip */}
            {hover.visible && hover.point && (
                <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute z-30 pointer-events-none"
                    style={{
                        left: Math.min(W - 200, Math.max(0, (hover.x / W) * 100)),
                        top: 12,
                        transform: 'translateX(-50%)'
                    }}
                >
                    <div className="backdrop-blur-xl bg-slate-950/85 border border-slate-700 px-3 py-2 rounded-2xl shadow-2xl">
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
                            Strike {hover.point.strike.toFixed(0)}
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono">
                            <span className="text-cyan-400">Call IV</span>
                            <span className="text-white text-right font-bold">{hover.point.callIV.toFixed(2)}%</span>
                            <span className="text-rose-400">Put IV</span>
                            <span className="text-white text-right font-bold">{hover.point.putIV.toFixed(2)}%</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
};

interface StatChipProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub?: string;
    accent: 'amber' | 'rose' | 'emerald' | 'indigo' | 'violet' | 'slate';
}

const ACCENT: Record<StatChipProps['accent'], { border: string; text: string; bg: string }> = {
    amber:   { border: 'border-amber-500/20',   text: 'text-amber-400',   bg: 'bg-amber-500/5' },
    rose:    { border: 'border-rose-500/20',    text: 'text-rose-400',    bg: 'bg-rose-500/5' },
    emerald: { border: 'border-emerald-500/20', text: 'text-emerald-400', bg: 'bg-emerald-500/5' },
    indigo:  { border: 'border-indigo-500/20',  text: 'text-indigo-400',  bg: 'bg-indigo-500/5' },
    violet:  { border: 'border-violet-500/20',  text: 'text-violet-400',  bg: 'bg-violet-500/5' },
    slate:   { border: 'border-slate-700',      text: 'text-slate-400',   bg: 'bg-slate-800/40' }
};

const StatChip: React.FC<StatChipProps> = ({ icon, label, value, sub, accent }) => {
    const a = ACCENT[accent];
    return (
        <div className={`border ${a.border} ${a.bg} px-3 py-2 rounded-2xl`}>
            <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-slate-500">
                <span className={a.text}>{icon}</span>
                {label}
            </div>
            <div className={`text-sm font-black font-mono ${a.text} mt-0.5`}>{value}</div>
            {sub && <div className="text-[8px] text-slate-500 mt-0.5">{sub}</div>}
        </div>
    );
};

export default IVSkewChart;
