import React, { useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip,
    Cell, ReferenceLine, CartesianGrid
} from 'recharts';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { BarChart3, ShieldAlert, Sparkles, Target, Zap, Maximize2 } from 'lucide-react';
import AdvancedIPOProbabilityModal from './AdvancedIPOProbabilityModal';

export interface DistPoint {
    k: number;
    probPct: number;
    probDecimal: number;
    cumProbPct: number;
}

interface AllotmentDistributionChartProps {
    distribution: DistPoint[];
    expectedAllotments: number;
    blankRatePct: number;
    captureOddsPct: number;
    multiOddsPct: number;
    totalAccounts: number;
    lambdaRetail?: number;
    lambdaHni?: number;
    hasHni?: boolean;
    // Extended parameters for deep intelligence modal
    ipoName?: string;
    category?: string;
    lotSize?: number;
    maxPrice?: number;
    lotValue?: number;
    currentGmp?: number;
    totalBlockedCapital?: number;
    lockDays?: number;
    numRetail?: number;
    numHni?: number;
    retailSub?: number;
    hniSub?: number;
    totalExpectedProfit?: number;
    zScoreStr?: string | null;
}

const BAR_COLORS = [
    '#f43f5e', // k=0 (Rose/Red - Blank Risk)
    '#10b981', // k=1 (Emerald - Single Hit)
    '#06b6d4', // k=2 (Cyan - Double Hit)
    '#6366f1', // k=3 (Indigo - Multi Hit)
    '#8b5cf6', // k=4 (Violet - Rare Multi)
    '#ec4899', // k=5+ (Pink - Jackpot)
];

const getBarColor = (k: number, isMax: boolean) => {
    if (k === 0) return '#f43f5e';
    if (isMax && k > 1) return '#ec4899';
    return BAR_COLORS[Math.min(k, BAR_COLORS.length - 1)];
};

export const AllotmentDistributionChart: React.FC<AllotmentDistributionChartProps> = ({
    distribution,
    expectedAllotments,
    blankRatePct,
    captureOddsPct,
    multiOddsPct,
    totalAccounts,
    lambdaRetail,
    lambdaHni,
    hasHni,
    ipoName = 'IPO Issue',
    category = 'MAINBOARD',
    lotSize = 0,
    maxPrice = 0,
    lotValue = 0,
    currentGmp = 0,
    totalBlockedCapital = 0,
    lockDays = 4,
    numRetail,
    numHni,
    retailSub = 0,
    hniSub = 0,
    totalExpectedProfit = 0,
    zScoreStr
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    if (!distribution || distribution.length === 0) return null;

    const maxK = distribution.length - 1;

    // Custom Recharts Tooltip
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data: DistPoint = payload[0].payload;
            const isZero = data.k === 0;
            const isJackpot = data.k === maxK && maxK > 1;

            return (
                <div className="bg-slate-950/95 border border-indigo-500/40 rounded-xl p-3.5 shadow-2xl backdrop-blur-md max-w-xs text-xs">
                    <div className="flex items-center justify-between gap-3 border-b border-indigo-900/40 pb-2 mb-2">
                        <span className="font-black text-white flex items-center gap-1.5">
                            {isZero ? (
                                <ShieldAlert size={14} className="text-rose-400" />
                            ) : (
                                <Target size={14} className="text-emerald-400" />
                            )}
                            {data.k === 0 ? '0 Lots (All Blank)' : `${data.k} Lot${data.k > 1 ? 's' : ''} Won`}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            isZero ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' :
                            isJackpot ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                            'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        }`}>
                            {isZero ? 'Blank Floor' : isJackpot ? 'Full Jackpot' : 'Hit'}
                        </span>
                    </div>

                    <div className="space-y-1.5 text-slate-300">
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">Exact Probability:</span>
                            <span className="font-mono font-bold text-white text-sm">
                                {data.probPct.toFixed(2)}%
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-slate-400">Cumulative P(K &ge; {data.k}):</span>
                            <span className="font-mono font-bold text-indigo-300">
                                {data.cumProbPct.toFixed(2)}%
                            </span>
                        </div>
                        <div className="pt-1.5 border-t border-slate-800 text-[10px] text-slate-400">
                            {isZero ? (
                                'Probability that none of the syndicate accounts receive an allotment.'
                            ) : (
                                `Probability of exactly ${data.k} of ${totalAccounts} syndicate application(s) getting allotted.`
                            )}
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <>
            <div className="bg-slate-950/50 border border-indigo-950/60 rounded-2xl p-5 space-y-4">
                {/* Header with Title and Quick Badges */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-indigo-900/30 pb-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <BarChart3 size={16} className="text-indigo-400" />
                            <h4 className="text-sm font-black text-white uppercase tracking-wider">
                                Allotment Distribution &amp; Bell Curve
                            </h4>
                            <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-[9px] font-black text-indigo-300 tracking-wider uppercase">
                                Poisson-Binomial PMF
                            </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            Exact discrete probability mass function across {totalAccounts} syndicate account{totalAccounts > 1 ? 's' : ''}.
                        </p>
                    </div>

                    {/* Action buttons & Parity Lambda Indicators */}
                    <div className="flex items-center gap-2">
                        {lambdaRetail !== undefined && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-indigo-900/50 text-[10px]">
                                <span className="text-slate-400 font-bold uppercase">&lambda; Retail:</span>
                                <span className={`font-mono font-black ${
                                    lambdaRetail >= 1.0 ? 'text-emerald-400' :
                                    lambdaRetail >= 0.5 ? 'text-amber-400' : 'text-rose-400'
                                }`}>
                                    {lambdaRetail.toFixed(2)}x
                                </span>
                            </div>
                        )}
                        {hasHni && lambdaHni !== undefined && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-purple-900/50 text-[10px]">
                                <span className="text-purple-400 font-bold uppercase">&lambda; sNII:</span>
                                <span className={`font-mono font-black ${
                                    lambdaHni >= 1.0 ? 'text-purple-300' :
                                    lambdaHni >= 0.5 ? 'text-amber-400' : 'text-rose-400'
                                }`}>
                                    {lambdaHni.toFixed(2)}x
                                </span>
                            </div>
                        )}

                        {/* Expand Depth Analysis Button */}
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-500/10 cursor-pointer group"
                            title="Click for Advanced Deep Intelligence Modal"
                        >
                            <Maximize2 size={13} className="text-indigo-400 group-hover:scale-110 transition-transform" />
                            <span>Depth Analysis</span>
                        </button>
                    </div>
                </div>

                {/* Top Stat Matrix */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    <div className="bg-slate-900/60 border border-indigo-950/80 rounded-xl p-2.5 text-center">
                        <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest">Expected Allotments</span>
                        <span className="text-sm font-black text-white font-mono">{expectedAllotments.toFixed(2)} Lots</span>
                    </div>
                    <div className="bg-slate-900/60 border border-rose-950/60 rounded-xl p-2.5 text-center">
                        <span className="block text-[8px] font-black text-rose-400/80 uppercase tracking-widest">Blank Floor P(K=0)</span>
                        <span className="text-sm font-black text-rose-400 font-mono">{blankRatePct.toFixed(1)}%</span>
                    </div>
                    <div className="bg-slate-900/60 border border-emerald-950/60 rounded-xl p-2.5 text-center">
                        <span className="block text-[8px] font-black text-emerald-400/80 uppercase tracking-widest">Win Odds P(K&ge;1)</span>
                        <span className="text-sm font-black text-emerald-400 font-mono">{captureOddsPct.toFixed(1)}%</span>
                    </div>
                    <div className="bg-slate-900/60 border border-indigo-950/60 rounded-xl p-2.5 text-center">
                        <span className="block text-[8px] font-black text-indigo-400/80 uppercase tracking-widest">Multi-Win P(K&ge;2)</span>
                        <span className="text-sm font-black text-indigo-300 font-mono">{multiOddsPct.toFixed(1)}%</span>
                    </div>
                    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5 text-center col-span-2 sm:col-span-1">
                        <span className="block text-[8px] font-black text-slate-400 uppercase tracking-widest">Euler Limit (1/e)</span>
                        <span className="text-sm font-black text-slate-300 font-mono">36.79%</span>
                    </div>
                </div>

                {/* Recharts Bar Chart inside SafeChartContainer with Zoom Affordance */}
                <div
                    className="h-56 w-full pt-1 cursor-zoom-in group relative transition-transform active:scale-[0.99]"
                    onClick={() => setIsModalOpen(true)}
                    title="Click for Advanced Deep Statistical Analysis"
                >
                    <div className="absolute top-2 right-4 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-slate-900/90 border border-indigo-500/40 px-2.5 py-1 rounded-lg text-[10px] font-bold text-indigo-300 pointer-events-none shadow-xl">
                        Click to open Advanced Depth Analysis
                    </div>

                    <SafeChartContainer height={220} minHeight={180}>
                        <BarChart
                            data={distribution}
                            margin={{ top: 15, right: 15, left: -20, bottom: 0 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                            <XAxis
                                dataKey="k"
                                stroke="#64748b"
                                tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 700 }}
                                tickFormatter={(k) => (k === 0 ? '0 Lots (Blank)' : `${k} Lot${k > 1 ? 's' : ''}`)}
                            />
                            <YAxis
                                stroke="#64748b"
                                tick={{ fill: '#64748b', fontSize: 10 }}
                                tickFormatter={(v) => `${v}%`}
                                domain={[0, (dataMax: number) => Math.min(100, Math.ceil((dataMax + 10) / 10) * 10)]}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <ReferenceLine
                                x={Math.min(maxK, Math.round(expectedAllotments))}
                                stroke="#818cf8"
                                strokeDasharray="4 4"
                                label={{
                                    value: `E[K] = ${expectedAllotments.toFixed(2)}`,
                                    fill: '#a5b4fc',
                                    fontSize: 10,
                                    position: 'top',
                                    fontWeight: 'bold'
                                }}
                            />
                            <Bar
                                dataKey="probPct"
                                radius={[6, 6, 0, 0]}
                                maxBarSize={55}
                            >
                                {distribution.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={getBarColor(entry.k, entry.k === maxK)}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </SafeChartContainer>
                </div>

                {/* Bottom Insights Footer */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] pt-1 border-t border-indigo-950/40 text-slate-400">
                    <div className="flex items-center gap-1.5">
                        <Sparkles size={12} className="text-indigo-400 shrink-0" />
                        <span>
                            <strong>Euler Floor Principle:</strong> At exact parity (N = S), the blank chance never drops below 36.79% (1/e) due to Poisson dispersion.
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 sm:justify-end">
                        <Zap size={12} className="text-amber-400 shrink-0" />
                        <span>
                            {blankRatePct > 50
                                ? 'High Variance Regime: Expect frequent blanks; bank on rare multi-lot clusters.'
                                : 'Favorable Regime: Syndicate joint probability exceeds 50% threshold.'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Advanced Probability Depth Modal */}
            <AdvancedIPOProbabilityModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                ipoName={ipoName}
                category={category}
                lotSize={lotSize}
                maxPrice={maxPrice}
                lotValue={lotValue}
                currentGmp={currentGmp}
                totalBlockedCapital={totalBlockedCapital}
                lockDays={lockDays}
                totalAccounts={totalAccounts}
                numRetail={numRetail ?? totalAccounts}
                numHni={numHni ?? 0}
                retailSub={retailSub}
                hniSub={hniSub}
                lambdaRetail={lambdaRetail ?? 0}
                lambdaHni={lambdaHni ?? 0}
                hasHni={!!hasHni}
                distribution={distribution}
                allotmentProb={captureOddsPct}
                blankRatePct={blankRatePct}
                exactOnePct={Math.max(0, captureOddsPct - multiOddsPct)}
                multiOddsPct={multiOddsPct}
                expectedAllotments={expectedAllotments}
                totalExpectedProfit={totalExpectedProfit}
                zScoreStr={zScoreStr}
            />
        </>
    );
};

export default AllotmentDistributionChart;
