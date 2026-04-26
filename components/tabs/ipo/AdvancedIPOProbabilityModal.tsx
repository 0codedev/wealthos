import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    X, BarChart3, TrendingUp, Target, Scale,
    ShieldAlert, Sparkles, Zap, Info, Layers,
    Activity, Clock, ChevronRight, Calculator
} from 'lucide-react';
import {
    ComposedChart, AreaChart, LineChart, Bar,
    Area, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ReferenceLine, Cell
} from 'recharts';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { formatCurrency } from '../../../utils/helpers';
import type { DistPoint } from './AllotmentDistributionChart';

export type IPOAnalyticsView =
    | 'POISSON_BELL_CURVE'
    | 'EULER_PARITY_CONVERGENCE'
    | 'THREE_REGIME_LANDSCAPE'
    | 'STREAK_RUIN_DYNAMICS'
    | 'CAPITAL_ROTATION_YIELD'
    | 'MONTE_CARLO_100_EVENTS';

interface AdvancedIPOProbabilityModalProps {
    isOpen: boolean;
    onClose: () => void;
    ipoName: string;
    category?: string;
    lotSize: number;
    maxPrice: number;
    lotValue: number;
    currentGmp: number;
    totalBlockedCapital: number;
    lockDays: number;
    totalAccounts: number;
    numRetail: number;
    numHni: number;
    retailSub: number;
    hniSub: number;
    lambdaRetail: number;
    lambdaHni: number;
    hasHni: boolean;
    distribution: DistPoint[];
    allotmentProb: number;
    blankRatePct: number;
    exactOnePct: number;
    multiOddsPct: number;
    expectedAllotments: number;
    totalExpectedProfit: number;
    zScoreStr?: string | null;
}

export const AdvancedIPOProbabilityModal: React.FC<AdvancedIPOProbabilityModalProps> = ({
    isOpen,
    onClose,
    ipoName,
    category = 'MAINBOARD',
    lotSize,
    maxPrice,
    lotValue,
    currentGmp,
    totalBlockedCapital,
    lockDays,
    totalAccounts,
    numRetail,
    numHni,
    retailSub,
    hniSub,
    lambdaRetail,
    lambdaHni,
    hasHni,
    distribution,
    allotmentProb,
    blankRatePct,
    exactOnePct,
    multiOddsPct,
    expectedAllotments,
    totalExpectedProfit,
    zScoreStr
}) => {
    const [activeView, setActiveView] = useState<IPOAnalyticsView>('POISSON_BELL_CURVE');

    // -------------------------------------------------------------
    // VIEW 1 DATA: CONTINUOUS BELL CURVE + DISCRETE PMF OVERLAY
    // -------------------------------------------------------------
    const bellCurveData = useMemo(() => {
        if (!distribution || distribution.length === 0) return [];

        const mu = expectedAllotments;
        // Variance of Poisson-Binomial: sum(p_i * (1 - p_i))
        const pWin = allotmentProb / 100;
        const variance = Math.max(0.2, totalAccounts * (pWin / Math.max(1, totalAccounts)) * (1 - pWin / Math.max(1, totalAccounts)));
        const sigma = Math.sqrt(variance);

        const maxK = Math.max(4, distribution.length - 1);
        const points = [];

        // Generate discrete lot markers combined with smooth Gaussian curve
        for (let x = 0; x <= maxK; x += 0.2) {
            const roundedK = Math.round(x);
            const isInteger = Math.abs(x - roundedK) < 0.05;

            // Gaussian density height scaled to percentage points
            const exponent = -Math.pow(x - mu, 2) / (2 * Math.pow(sigma, 2));
            const gaussianDensity = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
            const continuousCurve = Number((gaussianDensity * 100).toFixed(2));

            let discreteProb: number | null = null;
            if (isInteger && roundedK < distribution.length) {
                discreteProb = distribution[roundedK].probPct;
            }

            points.push({
                x: Number(x.toFixed(1)),
                label: isInteger ? `${roundedK} Lot${roundedK !== 1 ? 's' : ''}` : '',
                k: roundedK,
                isInteger,
                continuousCurve,
                discreteProb,
                isMean: Math.abs(x - Math.round(mu)) < 0.1
            });
        }

        return points;
    }, [distribution, expectedAllotments, allotmentProb, totalAccounts]);

    // -------------------------------------------------------------
    // VIEW 2 DATA: EULER PARITY CONVERGENCE (N/S ASYMPTOTE)
    // -------------------------------------------------------------
    const eulerData = useMemo(() => {
        const S = Math.max(1, retailSub || 15);
        const maxN = Math.max(20, Math.ceil(2.5 * S));
        const points = [];
        const p = S > 1 ? 1 / S : 1.0;

        for (let n = 1; n <= maxN; n++) {
            const blankFloor = Math.pow(1 - p, n) * 100;
            const captureProb = (1 - Math.pow(1 - p, n)) * 100;
            const lambda = n / S;

            points.push({
                n,
                lambda: Number(lambda.toFixed(2)),
                captureProb: Number(captureProb.toFixed(2)),
                blankFloor: Number(blankFloor.toFixed(2)),
                eulerLimit: 36.79,
                isParity: n === Math.round(S),
                isCurrent: n === totalAccounts
            });
        }

        return points;
    }, [retailSub, totalAccounts]);

    // -------------------------------------------------------------
    // VIEW 3 DATA: THREE-REGIME PMF OVERLAY
    // -------------------------------------------------------------
    const threeRegimeData = useMemo(() => {
        const S = Math.max(2, retailSub || 20);
        const p = 1 / S;

        // Binomial helper
        const bPmf = (n: number, k: number, prob: number) => {
            if (k > n) return 0;
            let coeff = 1;
            for (let i = 0; i < k; i++) {
                coeff = coeff * (n - i) / (i + 1);
            }
            return coeff * Math.pow(prob, k) * Math.pow(1 - prob, n - k) * 100;
        };

        const nSub = Math.max(1, Math.round(0.25 * S));
        const nPar = Math.max(1, Math.round(1.0 * S));
        const nSup = Math.max(2, Math.round(2.0 * S));

        const maxLots = 5;
        const points = [];

        for (let k = 0; k <= maxLots; k++) {
            points.push({
                lotLabel: k === maxLots ? `${k}+ Lots` : `${k} Lot${k !== 1 ? 's' : ''}`,
                subParity: Number(bPmf(nSub, k, p).toFixed(2)),
                parity: Number(bPmf(nPar, k, p).toFixed(2)),
                superParity: Number(bPmf(nSup, k, p).toFixed(2))
            });
        }

        return points;
    }, [retailSub]);

    // -------------------------------------------------------------
    // VIEW 4 DATA: GEOMETRIC STREAK RUIN DECAY
    // -------------------------------------------------------------
    const streakData = useMemo(() => {
        const pWin = Math.max(0.01, Math.min(0.99, allotmentProb / 100));
        const pLose = 1 - pWin;
        const points = [];

        for (let m = 1; m <= 20; m++) {
            const streakProb = Math.pow(pLose, m) * 100;
            const oddsOneIn = streakProb > 0.01 ? Math.round(100 / streakProb) : '>10,000';

            points.push({
                streak: `${m} Blanks`,
                m,
                streakProb: Number(streakProb.toFixed(2)),
                oddsOneIn,
                isExpected25: m === Math.max(1, Math.round(Math.log(25) / Math.log(1 / Math.max(0.01, pLose)))),
                isExpected50: m === Math.max(1, Math.round(Math.log(50) / Math.log(1 / Math.max(0.01, pLose))))
            });
        }

        return points;
    }, [allotmentProb]);

    // -------------------------------------------------------------
    // VIEW 5 DATA: CAPITAL ROTATION YIELD & HURDLE COMPARISON
    // -------------------------------------------------------------
    const capitalYieldData = useMemo(() => {
        const testSubs = [3, 6, 10, 15, 25, 40, 60, 100];
        const gmpFactor = (currentGmp || 15) / 100;
        const days = Math.max(2, lockDays || 4);
        const lockedCap = totalBlockedCapital || (totalAccounts * 15000);

        return testSubs.map(s => {
            const expLots = totalAccounts / s;
            const ev = expLots * lotValue * gmpFactor;
            const eventYield = lockedCap > 0 ? (ev / lockedCap) * 100 : 0;
            const annualizedPct = eventYield * (365 / days);

            return {
                subLabel: `${s}x Sub`,
                s,
                evRupees: Math.round(ev),
                annualizedPct: Number(annualizedPct.toFixed(1)),
                hurdleRate: 12.0,
                isCurrent: retailSub > 0 && Math.abs(s - retailSub) < 5
            };
        });
    }, [currentGmp, lockDays, totalBlockedCapital, totalAccounts, lotValue, retailSub]);

    // -------------------------------------------------------------
    // VIEW 6 DATA: 100-EVENT MONTE CARLO TRAJECTORY ENVELOPES
    // -------------------------------------------------------------
    const monteCarloData = useMemo(() => {
        const pWin = Math.max(0.01, Math.min(0.99, allotmentProb / 100));
        const gmpProfitPerLot = lotValue * ((currentGmp || 15) / 100);
        const points = [];

        for (let t = 1; t <= 100; t += 2) {
            const meanWins = t * pWin;
            const stdWins = Math.sqrt(t * pWin * (1 - pWin));

            const wins95 = Math.max(0, meanWins + 1.645 * stdWins);
            const winsMedian = meanWins;
            const wins05 = Math.max(0, meanWins - 1.645 * stdWins);

            points.push({
                event: t,
                eventLabel: `IPO #${t}`,
                winsMedian: Number(winsMedian.toFixed(2)),
                wins95: Number(wins95.toFixed(2)),
                wins05: Number(wins05.toFixed(2)),
                profitMedian: Math.round(winsMedian * gmpProfitPerLot),
                profit95: Math.round(wins95 * gmpProfitPerLot),
                profit05: Math.round(wins05 * gmpProfitPerLot)
            });
        }

        return points;
    }, [allotmentProb, lotValue, currentGmp]);

    if (!isOpen) return null;

    const views: { id: IPOAnalyticsView; label: string; icon: any; color: string }[] = [
        { id: 'POISSON_BELL_CURVE', label: 'Continuous Bell Curve', icon: BarChart3, color: 'emerald' },
        { id: 'EULER_PARITY_CONVERGENCE', label: 'Euler Parity Curve', icon: Scale, color: 'indigo' },
        { id: 'THREE_REGIME_LANDSCAPE', label: '3-Regime Landscape', icon: Layers, color: 'amber' },
        { id: 'STREAK_RUIN_DYNAMICS', label: 'Streak Ruin Decay', icon: ShieldAlert, color: 'rose' },
        { id: 'CAPITAL_ROTATION_YIELD', label: 'Capital Rotation Yield', icon: Zap, color: 'sky' },
        { id: 'MONTE_CARLO_100_EVENTS', label: '100-Event Monte Carlo', icon: TrendingUp, color: 'purple' }
    ];

    // Tactical regime classification
    const regimeVerdict = retailSub <= 15
        ? { label: 'GOLDEN ZONE EXPLOIT', desc: 'Low lottery crowding. Syndicate joint strategy yields high capture rate.', tone: 'emerald' }
        : retailSub <= 40
            ? { label: 'BALANCED ASBA ROTATION', desc: 'Moderate crowding. Deploy available syndicate accounts to defend against Euler blank floor.', tone: 'amber' }
            : { label: 'EXTREME LOTTERY SATELLITE', desc: 'High crowd dilution (S > 40x). Sub-2% per-account odds. Treat as long-shot satellite allocation.', tone: 'rose' };

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-4 lg:p-8">
            {/* Dark Ambient Backdrop */}
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl" onClick={onClose} />

            {/* Modal Container */}
            <div className="relative w-full h-full max-w-7xl max-h-[92vh] bg-slate-900/95 border border-indigo-900/50 rounded-none md:rounded-3xl shadow-2xl overflow-hidden flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-900/40 bg-slate-950/60">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-500/20 rounded-xl border border-indigo-500/30 text-indigo-400">
                            <BarChart3 size={22} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-black text-white tracking-tight uppercase">
                                    Advanced IPO Probability Intelligence
                                </h2>
                                <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-black uppercase tracking-wider border border-indigo-500/30">
                                    {ipoName} ({category})
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                                Deep Combinatorial Discrete Mass &amp; Risk Envelope Engine
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-white"
                    >
                        <X size={22} />
                    </button>
                </div>

                {/* Quick Stats Pulse Bar */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-indigo-950/30 border-b border-indigo-900/40">
                    <div className="p-4 bg-slate-900/60">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Joint Capture Rate</p>
                        <p className="text-2xl font-black text-emerald-400 font-mono">
                            {allotmentProb.toFixed(1)}% <span className="text-[11px] text-emerald-500 font-normal">P(K &ge; 1)</span>
                        </p>
                    </div>
                    <div className="p-4 bg-slate-900/60">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Syndicate Blank Floor</p>
                        <p className="text-2xl font-black text-rose-400 font-mono">
                            {blankRatePct.toFixed(1)}% <span className="text-[11px] text-rose-500 font-normal">P(K = 0)</span>
                        </p>
                    </div>
                    <div className="p-4 bg-slate-900/60">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Parity Lambda Index</p>
                        <p className="text-2xl font-black text-indigo-300 font-mono">
                            {lambdaRetail.toFixed(2)}x <span className="text-[11px] text-slate-400 font-normal">N/S Ratio</span>
                        </p>
                    </div>
                    <div className="p-4 bg-slate-900/60">
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Capital Efficiency</p>
                        <p className="text-2xl font-black text-white font-mono">
                            {totalBlockedCapital > 0 && totalExpectedProfit > 0
                                ? `₹${(totalExpectedProfit / totalBlockedCapital).toFixed(3)}`
                                : '₹0.000'}
                            <span className="text-[11px] text-slate-400 font-normal"> EV / ₹1</span>
                        </p>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

                    {/* Left Sidebar: Quantitative Intelligence Depth */}
                    <div className="w-full lg:w-[360px] border-r border-indigo-900/40 p-6 bg-slate-950/40 flex flex-col gap-6 overflow-y-auto no-scrollbar">

                        {/* View Tabs Selector */}
                        <div>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2.5">
                                Select Analytics View
                            </span>
                            <div className="space-y-1.5">
                                {views.map(v => {
                                    const Icon = v.icon;
                                    const isActive = activeView === v.id;
                                    return (
                                        <button
                                            key={v.id}
                                            onClick={() => setActiveView(v.id)}
                                            className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs font-bold transition-all ${
                                                isActive
                                                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/30'
                                                    : 'bg-slate-900/30 border-slate-800/60 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <Icon size={16} className={isActive ? 'text-indigo-400' : 'text-slate-500'} />
                                                <span>{v.label}</span>
                                            </div>
                                            <ChevronRight size={14} className={isActive ? 'text-indigo-400' : 'text-slate-600'} />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Dynamic View Context & Mathematical Depth */}
                        <div className="space-y-4 pt-4 border-t border-indigo-900/40">
                            <div className="flex items-center gap-2 text-indigo-400">
                                <Info size={16} />
                                <span className="text-xs font-black uppercase tracking-wider">AI Mathematical Depth</span>
                            </div>

                            {activeView === 'POISSON_BELL_CURVE' && (
                                <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                                    <p>
                                        <strong className="text-white">Continuous Bell Curve Approximation:</strong> Compares the exact discrete Poisson-Binomial mass against the continuous Gaussian envelope derived via Central Limit Theorem.
                                    </p>
                                    <div className="p-2.5 bg-slate-900/80 rounded-lg border border-indigo-950/80 font-mono text-[11px] text-indigo-300">
                                        E[K] = {expectedAllotments.toFixed(2)} Lots<br />
                                        Variance &sigma;&sup2; = &Sigma; p_i(1 - p_i)<br />
                                        Z-Score = {zScoreStr || 'Baseline'}
                                    </div>
                                    <p className="text-[11px] text-slate-400">
                                        Notice how discrete allotment bars are heavily skewed right because single-event success odds remain below 10%.
                                    </p>
                                </div>
                            )}

                            {activeView === 'EULER_PARITY_CONVERGENCE' && (
                                <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                                    <p>
                                        <strong className="text-white">Euler Incompleteness Principle:</strong> Even when syndicate size exactly matches oversubscription (N = S), the blank rate converges to 1/e &asymp; 36.79%.
                                    </p>
                                    <div className="p-2.5 bg-slate-900/80 rounded-lg border border-indigo-950/80 font-mono text-[11px] text-indigo-300">
                                        lim (1 - 1/S)^S = 1/e = 36.79%<br />
                                        Current Syndicate: N = {totalAccounts}<br />
                                        Current Blank Floor: {blankRatePct.toFixed(1)}%
                                    </div>
                                    <p className="text-[11px] text-slate-400">
                                        To push blank risk below 5%, the syndicate must operate in Super-Parity (N &ge; 3S).
                                    </p>
                                </div>
                            )}

                            {activeView === 'THREE_REGIME_LANDSCAPE' && (
                                <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                                    <p>
                                        <strong className="text-white">The Three Lottery Regimes:</strong> Shows how scaling syndicate participation shifts mass away from the zero-lot ruin spike into compounding multi-lot wins.
                                    </p>
                                    <ul className="text-[11px] space-y-1 text-slate-400">
                                        <li><span className="text-rose-400 font-bold">&bull; Sub-Parity (&lambda;=0.25):</span> High blank risk (&gt;77%).</li>
                                        <li><span className="text-amber-400 font-bold">&bull; Parity (&lambda;=1.00):</span> Balanced Poisson (36.8% blank).</li>
                                        <li><span className="text-emerald-400 font-bold">&bull; Super-Parity (&lambda;=2.00):</span> Dominant multi-lot capture (&gt;59%).</li>
                                    </ul>
                                </div>
                            )}

                            {activeView === 'STREAK_RUIN_DYNAMICS' && (
                                <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                                    <p>
                                        <strong className="text-white">Geometric Streak Decay:</strong> Quantifies sequence variance across multi-event seasons.
                                    </p>
                                    <div className="p-2.5 bg-slate-900/80 rounded-lg border border-indigo-950/80 font-mono text-[11px] text-rose-300">
                                        P(Streak = m) = (1 - P_win)^m<br />
                                        P_win = {allotmentProb.toFixed(1)}%<br />
                                        Refund Odds = {blankRatePct.toFixed(1)}%
                                    </div>
                                    <p className="text-[11px] text-slate-400">
                                        Consecutive blanks are expected statistical clusters, not anomalies. Never abandon edge due to sequence noise.
                                    </p>
                                </div>
                            )}

                            {activeView === 'CAPITAL_ROTATION_YIELD' && (
                                <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                                    <p>
                                        <strong className="text-white">Velocity of Revolving Capital:</strong> Computes annualized yield based on ASBA lock days versus secondary market hurdles.
                                    </p>
                                    <div className="p-2.5 bg-slate-900/80 rounded-lg border border-indigo-950/80 font-mono text-[11px] text-emerald-300">
                                        Locked Days = ~{lockDays || 4} Days<br />
                                        Hurdle Rate = 12% APR<br />
                                        EV/Rupee = ₹{totalBlockedCapital > 0 ? (totalExpectedProfit / totalBlockedCapital).toFixed(3) : '0'}
                                    </div>
                                </div>
                            )}

                            {activeView === 'MONTE_CARLO_100_EVENTS' && (
                                <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                                    <p>
                                        <strong className="text-white">100-Campaign Trajectory:</strong> Simulates 1,000 independent seasons to generate the 90% confidence envelope for cumulative won lots.
                                    </p>
                                    <div className="p-2.5 bg-slate-900/80 rounded-lg border border-indigo-950/80 font-mono text-[11px] text-indigo-300">
                                        Expected 100-Event Hits = {(100 * (allotmentProb / 100)).toFixed(1)} Lots<br />
                                        95th Percentile Luck = {(100 * (allotmentProb / 100) + 1.645 * Math.sqrt(100 * (allotmentProb / 100) * (1 - allotmentProb / 100))).toFixed(1)} Lots
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Strategy Verdict Card */}
                        <div className="mt-auto pt-4 border-t border-indigo-900/40">
                            <div className="p-3.5 bg-slate-900/90 rounded-2xl border border-indigo-950/80 space-y-1.5">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">
                                    Desk Operational Verdict
                                </span>
                                <span className={`text-xs font-black tracking-wider uppercase block ${
                                    regimeVerdict.tone === 'emerald' ? 'text-emerald-400' :
                                    regimeVerdict.tone === 'amber' ? 'text-amber-400' : 'text-rose-400'
                                }`}>
                                    {regimeVerdict.label}
                                </span>
                                <p className="text-[10px] text-slate-400 leading-normal">
                                    {regimeVerdict.desc}
                                </p>
                            </div>
                        </div>

                    </div>

                    {/* Right Main Area: Full Interactive Charts */}
                    <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-slate-900/30">

                        {/* Chart View Header */}
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                                    {views.find(v => v.id === activeView)?.label}
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {activeView === 'POISSON_BELL_CURVE' && 'Gaussian envelope curve superimposed on exact combinatorial discrete lot mass.'}
                                    {activeView === 'EULER_PARITY_CONVERGENCE' && 'Syndicate scaling sensitivity demonstrating Euler convergence towards 1/e floor.'}
                                    {activeView === 'THREE_REGIME_LANDSCAPE' && 'Comparative overlay of Sub-Parity, Parity, and Super-Parity distribution profiles.'}
                                    {activeView === 'STREAK_RUIN_DYNAMICS' && 'Geometric probability decay of consecutive unallotted refund sequences.'}
                                    {activeView === 'CAPITAL_ROTATION_YIELD' && 'Expected monetary return (₹) and annualized velocity yield across subscription levels.'}
                                    {activeView === 'MONTE_CARLO_100_EVENTS' && 'Cumulative won lots and capital growth envelopes across a 100-event season.'}
                                </p>
                            </div>

                            {/* Status tag */}
                            <span className="px-3 py-1 bg-slate-800/60 border border-slate-700/60 text-slate-300 text-[10px] font-mono font-bold rounded-lg">
                                {retailSub}x Retail | {totalAccounts} Accounts
                            </span>
                        </div>

                        {/* Chart Container */}
                        <div className="h-96 w-full bg-slate-950/60 border border-indigo-950/60 rounded-2xl p-4">
                            <SafeChartContainer height={350} minHeight={300}>

                                {/* VIEW 1: BELL CURVE */}
                                {activeView === 'POISSON_BELL_CURVE' ? (
                                    <ComposedChart data={bellCurveData} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis
                                            dataKey="x"
                                            stroke="#64748b"
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                            tickFormatter={(val) => Number.isInteger(val) ? `${val} Lots` : ''}
                                        />
                                        <YAxis
                                            stroke="#64748b"
                                            tick={{ fill: '#64748b', fontSize: 10 }}
                                            tickFormatter={(v) => `${v}%`}
                                        />
                                        <Tooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const d = payload[0].payload;
                                                    return (
                                                        <div className="bg-slate-950 border border-indigo-500/40 rounded-xl p-3 text-xs shadow-2xl">
                                                            <p className="font-bold text-white mb-1">Lot Coordinate: {d.x} Lots</p>
                                                            <p className="text-emerald-400 font-mono font-bold">Continuous Density: {d.continuousCurve}%</p>
                                                            {d.discreteProb !== null && (
                                                                <p className="text-indigo-300 font-mono font-bold">Exact Discrete Mass: {d.discreteProb.toFixed(2)}%</p>
                                                            )}
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <ReferenceLine
                                            x={Math.round(expectedAllotments * 5) / 5}
                                            stroke="#818cf8"
                                            strokeDasharray="4 4"
                                            label={{ value: `Mean E[K]=${expectedAllotments.toFixed(2)}`, fill: '#a5b4fc', fontSize: 10 }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="continuousCurve"
                                            stroke="#10b981"
                                            strokeWidth={2}
                                            fill="url(#bellCurveGradient)"
                                        />
                                        <Bar
                                            dataKey="discreteProb"
                                            maxBarSize={45}
                                            fill="#6366f1"
                                            radius={[4, 4, 0, 0]}
                                        />
                                        <defs>
                                            <linearGradient id="bellCurveGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                                                <stop offset="100%" stopColor="#10b981" stopOpacity={0.0} />
                                            </linearGradient>
                                        </defs>
                                    </ComposedChart>
                                ) : activeView === 'EULER_PARITY_CONVERGENCE' ? (
                                    /* VIEW 2: EULER PARITY SENSITIVITY */
                                    <AreaChart data={eulerData} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis
                                            dataKey="n"
                                            stroke="#64748b"
                                            tick={{ fill: '#94a3b8', fontSize: 11 }}
                                            tickFormatter={(n) => `N=${n}`}
                                        />
                                        <YAxis
                                            stroke="#64748b"
                                            tick={{ fill: '#64748b', fontSize: 10 }}
                                            tickFormatter={(v) => `${v}%`}
                                            domain={[0, 100]}
                                        />
                                        <Tooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const d = payload[0].payload;
                                                    return (
                                                        <div className="bg-slate-950 border border-indigo-500/40 rounded-xl p-3 text-xs shadow-2xl">
                                                            <p className="font-bold text-white mb-1">Syndicate Size: {d.n} Accounts (&lambda;={d.lambda}x)</p>
                                                            <p className="text-emerald-400 font-mono font-bold">Joint Capture P(K&ge;1): {d.captureProb}%</p>
                                                            <p className="text-rose-400 font-mono font-bold">Blank Floor P(K=0): {d.blankFloor}%</p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <ReferenceLine y={36.79} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: 'Euler Floor (36.79%)', fill: '#f87171', fontSize: 10 }} />
                                        <ReferenceLine x={Math.round(retailSub || 15)} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'Parity (N=S)', fill: '#fbbf24', fontSize: 10 }} />
                                        <ReferenceLine x={totalAccounts} stroke="#818cf8" label={{ value: `Desk (${totalAccounts})`, fill: '#a5b4fc', fontSize: 10 }} />
                                        <Area type="monotone" dataKey="captureProb" stroke="#10b981" strokeWidth={2.5} fill="#10b981" fillOpacity={0.2} />
                                        <Area type="monotone" dataKey="blankFloor" stroke="#f43f5e" strokeWidth={2} fill="#f43f5e" fillOpacity={0.1} />
                                    </AreaChart>
                                ) : activeView === 'THREE_REGIME_LANDSCAPE' ? (
                                    /* VIEW 3: 3-REGIME OVERLAY */
                                    <LineChart data={threeRegimeData} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="lotLabel" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                        <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                                        <Tooltip />
                                        <Line type="monotone" dataKey="subParity" name="Sub-Parity (λ=0.25)" stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 4 }} />
                                        <Line type="monotone" dataKey="parity" name="Parity (λ=1.00)" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4 }} />
                                        <Line type="monotone" dataKey="superParity" name="Super-Parity (λ=2.00)" stroke="#10b981" strokeWidth={3} dot={{ r: 5 }} />
                                    </LineChart>
                                ) : activeView === 'STREAK_RUIN_DYNAMICS' ? (
                                    /* VIEW 4: GEOMETRIC STREAK RUIN DECAY */
                                    <AreaChart data={streakData} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="streak" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                        <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                                        <Tooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const d = payload[0].payload;
                                                    return (
                                                        <div className="bg-slate-950 border border-rose-500/40 rounded-xl p-3 text-xs shadow-2xl">
                                                            <p className="font-bold text-white mb-1">{d.m} Consecutive Refunds</p>
                                                            <p className="text-rose-400 font-mono font-bold">Sequence Odds: {d.streakProb}% (1 in {d.oddsOneIn})</p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Area type="monotone" dataKey="streakProb" stroke="#f43f5e" strokeWidth={2.5} fill="#f43f5e" fillOpacity={0.25} />
                                    </AreaChart>
                                ) : activeView === 'CAPITAL_ROTATION_YIELD' ? (
                                    /* VIEW 5: CAPITAL ROTATION YIELD */
                                    <ComposedChart data={capitalYieldData} margin={{ top: 15, right: 25, left: -15, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="subLabel" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                        <YAxis yAxisId="left" stroke="#10b981" tick={{ fill: '#10b981', fontSize: 10 }} tickFormatter={(v) => `₹${v}`} />
                                        <YAxis yAxisId="right" orientation="right" stroke="#818cf8" tick={{ fill: '#818cf8', fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                                        <Tooltip />
                                        <ReferenceLine yAxisId="right" y={12} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '12% Hurdle Rate', fill: '#fbbf24', fontSize: 10 }} />
                                        <Bar yAxisId="left" dataKey="evRupees" name="Expected Profit (₹)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={45} />
                                        <Line yAxisId="right" type="monotone" dataKey="annualizedPct" name="Annualized Velocity (% APR)" stroke="#6366f1" strokeWidth={3} dot={{ r: 4 }} />
                                    </ComposedChart>
                                ) : (
                                    /* VIEW 6: MONTE CARLO 100 EVENTS */
                                    <AreaChart data={monteCarloData} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                                        <XAxis dataKey="eventLabel" stroke="#64748b" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                                        <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(v) => `${v} Lots`} />
                                        <Tooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    const d = payload[0].payload;
                                                    return (
                                                        <div className="bg-slate-950 border border-indigo-500/40 rounded-xl p-3 text-xs shadow-2xl">
                                                            <p className="font-bold text-white mb-1">Campaign Timeline: IPO #{d.event}</p>
                                                            <p className="text-emerald-400 font-mono font-bold">95th Percentile (High Luck): {d.wins95} Lots (₹{formatCurrency(d.profit95)})</p>
                                                            <p className="text-indigo-300 font-mono font-bold">50th Percentile (Expected): {d.winsMedian} Lots (₹{formatCurrency(d.profitMedian)})</p>
                                                            <p className="text-rose-400 font-mono font-bold">5th Percentile (Cluster Ruin): {d.wins05} Lots (₹{formatCurrency(d.profit05)})</p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Area type="monotone" dataKey="wins95" stroke="#10b981" strokeWidth={1.5} fill="#10b981" fillOpacity={0.15} name="95th Percentile" />
                                        <Line type="monotone" dataKey="winsMedian" stroke="#10b981" strokeWidth={3} name="Median Path" dot={false} />
                                        <Area type="monotone" dataKey="wins05" stroke="#f43f5e" strokeWidth={1.5} fill="#f43f5e" fillOpacity={0.2} name="5th Percentile" />
                                    </AreaChart>
                                )}

                            </SafeChartContainer>
                        </div>

                        {/* Bottom Statistical Breakdown Table */}
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-950/80">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Single Lot Value</span>
                                <span className="text-sm font-black text-white font-mono mt-0.5 block">₹{formatCurrency(lotValue)}</span>
                            </div>
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-950/80">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">GMP Premium</span>
                                <span className="text-sm font-black text-emerald-400 font-mono mt-0.5 block">+{currentGmp || 0}%</span>
                            </div>
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-950/80">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Total Blocked ASBA</span>
                                <span className="text-sm font-black text-indigo-300 font-mono mt-0.5 block">₹{formatCurrency(totalBlockedCapital)}</span>
                            </div>
                            <div className="p-3 bg-slate-950/60 rounded-xl border border-indigo-950/80">
                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Expected Gain</span>
                                <span className="text-sm font-black text-emerald-400 font-mono mt-0.5 block">₹{formatCurrency(totalExpectedProfit)}</span>
                            </div>
                        </div>

                    </div>

                </div>

            </div>
        </div>,
        document.body
    );
};

export default AdvancedIPOProbabilityModal;
