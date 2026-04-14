import React, { useMemo, useState } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea
} from 'recharts';
import { LineChart, Waves, Receipt, ShieldCheck, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { CustomTooltip } from '../../shared/CustomTooltip';
import { AdvancedEquityModal } from './AdvancedEquityModal';
import { useLiteModeStore } from '../../../store/liteModeStore';

interface EquityCurveCardProps {
    trades: Trade[];
    isVisible?: boolean;
}

const EquityTooltip = ({ active, payload, label, showBenchmark }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700/50 p-3 rounded-xl shadow-2xl ring-1 ring-white/10">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{label}</p>
            {payload.map((entry: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-4 py-0.5">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
                        <span className="text-[11px] text-slate-300">{entry.name}</span>
                    </div>
                    <span className="text-[11px] font-bold font-mono text-white">{formatCurrency(entry.value)}</span>
                </div>
            ))}
        </div>
    );
};

const CustomMistakeDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload.hasMistake) {
        return (
            <g>
                <circle cx={cx} cy={cy} r={3} fill="#f43f5e" stroke="#fff" strokeWidth={1} />
                <text x={cx} y={cy - 10} textAnchor="middle" fill="#f43f5e" fontSize={10} fontWeight="bold">!</text>
            </g>
        );
    }
    return <circle cx={cx} cy={cy} r={0} />;
};

export const EquityCurveCard = React.memo(({ trades, isVisible = true }: EquityCurveCardProps) => {
    const [isNetMode, setIsNetMode] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [showBenchmark, setShowBenchmark] = useState(false);
    const [showMistakes, setShowMistakes] = useState(false);
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    const equityData = useMemo(() => {
        const sorted = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const dailyMap: Record<string, { gross: number; net: number; fees: number }> = {};

        sorted.forEach(t => {
            const date = t.date;
            if (!dailyMap[date]) dailyMap[date] = { gross: 0, net: 0, fees: 0 };

            const net = t.pnl || 0;
            const fees = t.fees || 0;
            const gross = net + fees;

            dailyMap[date].gross += gross;
            dailyMap[date].net += net;
            dailyMap[date].fees += fees;
        });

        let runningGross = 0;
        let runningNet = 0;
        let runningFees = 0;
        let peakGross = 0;
        let peakNet = 0;

        const curve = Object.entries(dailyMap).sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()).map(([date, daily]) => {
            runningGross += daily.gross;
            runningNet += daily.net;
            runningFees += daily.fees;

            const currentTotal = isNetMode ? runningNet : runningGross;
            if (runningGross > peakGross) peakGross = runningGross;
            if (runningNet > peakNet) peakNet = runningNet;

            const drawdown = isNetMode ? (runningNet - peakNet) : (runningGross - peakGross);

            const tradesOnDate = trades.filter(t => t.date === date);
            const hasMistake = tradesOnDate.some(t => t.mistakes && t.mistakes.length > 0);
            const mistakes = tradesOnDate.flatMap(t => t.mistakes || []);

            return {
                date,
                equity: currentTotal,
                grossEquity: runningGross,
                netEquity: runningNet,
                cumulativeFees: runningFees,
                drawdown: drawdown,
                hasMistake,
                mistakes
            };
        });

        if (curve.length === 0) return [];
        return curve;
    }, [trades, isNetMode]);

    const feeLeakage = useMemo(() => {
        const totalNet = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const totalFees = trades.reduce((sum, t) => sum + (t.fees || 0), 0);
        const totalGross = totalNet + totalFees;
        const percentage = totalGross > 0 ? (totalFees / totalGross) * 100 : 0;

        return { totalGross, totalFees, totalNet, percentage };
    }, [trades]);

    const maxDrawdown = useMemo(() => {
        if (equityData.length === 0) return 0;
        return Math.min(...equityData.map(d => d.drawdown));
    }, [equityData]);

    const maxDrawdownPeriod = useMemo(() => {
        if (equityData.length === 0) return { peakDate: '', troughDate: '', value: 0, percent: 0 };
        let peakIdx = 0;
        let worstDd = 0;
        let worstPeakIdx = 0;
        let worstTroughIdx = 0;
        for (let i = 0; i < equityData.length; i++) {
            if (equityData[i].equity > equityData[peakIdx].equity) peakIdx = i;
            const dd = equityData[i].equity - equityData[peakIdx].equity;
            if (dd < worstDd) {
                worstDd = dd;
                worstPeakIdx = peakIdx;
                worstTroughIdx = i;
            }
        }
        const peakVal = equityData[worstPeakIdx].equity;
        const pct = peakVal !== 0 ? (worstDd / Math.abs(peakVal)) * 100 : 0;
        return {
            peakDate: equityData[worstPeakIdx].date,
            troughDate: equityData[worstTroughIdx].date,
            value: worstDd,
            percent: pct,
        };
    }, [equityData]);

    const winRate = useMemo(() => {
        if (trades.length === 0) return 0;
        const wins = trades.filter(t => (t.pnl || 0) > 0).length;
        return (wins / trades.length) * 100;
    }, [trades]);

    const benchmarkData = useMemo(() => {
        if (equityData.length === 0 || !showBenchmark) return [];
        const startEquity = 50000;
        const dailyRate = 0.12 / 365;
        const startDate = new Date(equityData[0].date).getTime();
        return equityData.map(d => {
            const daysElapsed = (new Date(d.date).getTime() - startDate) / (1000 * 60 * 60 * 24);
            const benchmarkValue = startEquity * Math.pow(1 + dailyRate, daysElapsed);
            return { ...d, benchmark: benchmarkValue };
        });
    }, [equityData, showBenchmark]);

    if (isLiteMode) {
        const lastEquity = equityData.length > 0 ? equityData[equityData.length - 1].equity : 0;
        return (
            <div className="bg-slate-950 border border-white/10 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                        <LineChart className="w-8 h-8 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Equity Snapshot (Lite)</h3>
                        <p className={`text-4xl font-black font-mono mt-1 ${lastEquity >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {formatCurrency(lastEquity)}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-4 text-center">
                    <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Max Drawdown</p>
                        <p className="text-lg font-black font-mono text-rose-500">{formatCurrency(maxDrawdownPeriod.value)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Win Rate</p>
                        <p className="text-lg font-black font-mono text-emerald-400">{winRate.toFixed(1)}%</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Efficiency</p>
                        <p className="text-lg font-black font-mono text-blue-400">
                            {(100 - (feeLeakage.totalGross > 0 ? feeLeakage.percentage : 0)).toFixed(1)}%
                        </p>
                    </div>
                </div>
                <div className="px-4 py-2 bg-amber-500/5 border border-amber-500/20 rounded-lg text-[9px] font-black text-amber-500 uppercase tracking-widest">
                    Charts Suspended
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* EQUITY CURVE */}
            <div className="lg:col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                    <div className="group relative">
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <LineChart size={16} className="text-indigo-500" />
                            <span>{isNetMode ? 'Net Equity Curve' : 'The Equity Curve'}</span>
                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${winRate > 55 ? 'bg-emerald-500/20 text-emerald-400' :
                                    winRate >= 40 ? 'bg-amber-500/20 text-amber-400' :
                                        'bg-rose-500/20 text-rose-400'
                                }`}>
                                Win Rate: {winRate.toFixed(1)}%
                            </span>
                            <div className="h-3 w-px bg-slate-800 mx-1" />
                            <label className="flex items-center gap-1.5 cursor-pointer select-none normal-case font-medium">
                                <input
                                    type="checkbox"
                                    checked={showMistakes}
                                    onChange={(e) => setShowMistakes(e.target.checked)}
                                    className="w-3 h-3 rounded-full border border-slate-700 bg-slate-900/60 checked:bg-rose-500 checked:border-rose-400 cursor-pointer appearance-none transition-all duration-200 relative flex items-center justify-center before:content-[''] before:w-[5px] before:h-[5px] before:rounded-full before:bg-white before:scale-0 checked:before:scale-100 before:transition-transform"
                                />
                                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider hover:text-slate-400 transition-colors">Mistakes</span>
                            </label>
                        </h3>
                        <p className="text-xs text-slate-500">
                            {isNetMode ? 'After Fees & Slippage' : 'Cumulative Gross Performance'}
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowBenchmark(!showBenchmark)}
                            className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all border ${showBenchmark
                                    ? 'bg-slate-700 text-slate-200 border-slate-600'
                                    : 'text-slate-500 hover:text-slate-300 border-slate-800 hover:border-slate-700'
                                }`}
                        >
                            vs Nifty 50
                        </button>
                        <div className="relative flex items-center bg-slate-900 rounded-lg p-1 border border-slate-800">
                            <button
                                onClick={() => setIsNetMode(false)}
                                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${!isNetMode ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                GROSS
                            </button>
                            <button
                                onClick={() => setIsNetMode(true)}
                                className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${isNetMode ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                NET
                            </button>
                        </div>

                        {equityData.length > 0 && (
                            <div
                                className={`px-3 py-1 rounded-lg text-sm font-black font-mono shadow-lg ${equityData[equityData.length - 1].equity >= 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
                                {formatCurrency(equityData[equityData.length - 1].equity)}
                            </div>
                        )}
                    </div>
                </div>

                <div
                    className="h-64 w-full cursor-zoom-in transition-transform active:scale-[0.99] group relative"
                    onClick={() => setIsModalOpen(true)}
                    title="Click for Advanced Alpha Intelligence Depth Analysis"
                    style={{ contain: 'layout paint', willChange: 'transform' }}
                >


                    {equityData.length > 0 ? (
                        <SafeChartContainer>
                            <AreaChart data={showBenchmark ? benchmarkData : equityData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    {/* Smooth HSL gradient — uses 3 stops for richer blend than the prior 2-stop fade */}
                                    <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={isNetMode ? "hsl(160, 84%, 50%)" : "hsl(238, 84%, 67%)"} stopOpacity={0.55} />
                                        <stop offset="50%" stopColor={isNetMode ? "hsl(160, 70%, 45%)" : "hsl(248, 70%, 60%)"} stopOpacity={0.25} />
                                        <stop offset="100%" stopColor={isNetMode ? "hsl(160, 60%, 30%)" : "hsl(258, 50%, 25%)"} stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="strokeGlow" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor={isNetMode ? "hsl(160, 84%, 50%)" : "hsl(238, 84%, 67%)"} stopOpacity={0.9} />
                                        <stop offset="100%" stopColor={isNetMode ? "hsl(140, 70%, 55%)" : "hsl(280, 80%, 70%)"} stopOpacity={1} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
                                <XAxis dataKey="date" hide />
                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(val) => `₹${val / 1000}k`} />
                                <Tooltip
                                    content={<EquityTooltip showBenchmark={showBenchmark} />}
                                    cursor={{ stroke: isNetMode ? '#10b981' : '#6366f1', strokeWidth: 1, strokeDasharray: '3 3' }}
                                />
                                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" opacity={0.5} />
                                <Area
                                    type="monotone"
                                    dataKey="equity"
                                    name={isNetMode ? "Net Equity" : "Gross Equity"}
                                    stroke="url(#strokeGlow)"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorEquity)"
                                    dot={showMistakes ? <CustomMistakeDot /> : false}
                                    isAnimationActive={isVisible}
                                />
                                <Line
                                    name="Cumulative Fees"
                                    type="monotone"
                                    dataKey="cumulativeFees"
                                    stroke="#f59e0b"
                                    strokeWidth={2}
                                    strokeDasharray="5 5"
                                    dot={false}
                                    activeDot={false}
                                    isAnimationActive={isVisible}
                                />
                                {showBenchmark && (
                                    <Line
                                        name="Nifty 50 (Simulated)"
                                        type="monotone"
                                        dataKey="benchmark"
                                        stroke="#64748b"
                                        strokeWidth={2}
                                        strokeDasharray="8 4"
                                        dot={false}
                                        activeDot={false}
                                        isAnimationActive={isVisible}
                                    />
                                )}
                            </AreaChart>
                        </SafeChartContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-500 text-sm border-2 border-dashed border-white/5 rounded-xl">
                            Log trades to visualize your curve.
                        </div>
                    )}
                </div>

                {/* MAX DRAWDOWN STAT */}
                {equityData.length > 0 && maxDrawdownPeriod.value < 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-3 flex items-center justify-center gap-2 text-xs"
                    >
                        <span className="text-slate-500 font-bold uppercase tracking-wider">Max Drawdown:</span>
                        <span className="font-mono font-black text-rose-500">
                            {formatCurrency(maxDrawdownPeriod.value)} ({maxDrawdownPeriod.percent.toFixed(1)}%)
                        </span>
                    </motion.div>
                )}

                {/* FEE LEAKAGE STACKED BAR */}
                {trades.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-white/5">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                                <Receipt size={12} className="text-amber-500" />
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">System Cost Impact (Leakage)</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="text-[10px] font-mono">
                                    <span className="text-slate-500">Gross: </span>
                                    <span className={feeLeakage.totalGross >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                        {formatCurrency(feeLeakage.totalGross)}
                                    </span>
                                </div>
                                <div className="text-[10px] font-mono">
                                    <span className="text-slate-500">Fees: </span>
                                    <span className="text-amber-400">-{formatCurrency(feeLeakage.totalFees)}</span>
                                </div>
                            </div>
                        </div>

                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
                            <div
                                style={{ width: `${Math.max(5, Math.min(95, 100 - (feeLeakage.totalGross > 0 ? feeLeakage.percentage : 0)))}%` }}
                                className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                            />
                            <div
                                style={{ width: `${Math.max(5, Math.min(95, (feeLeakage.totalGross > 0 ? feeLeakage.percentage : 20)))}%` }}
                                className="h-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.3)]"
                            />
                        </div>

                        <div className="flex justify-between mt-1 text-[9px] font-bold text-slate-500 uppercase">
                            <span>Efficiency: {(100 - (feeLeakage.totalGross > 0 ? feeLeakage.percentage : (feeLeakage.totalFees / (Math.abs(feeLeakage.totalGross) + feeLeakage.totalFees) * 100))).toFixed(1)}%</span>
                            <span>Cost Ratio: {(feeLeakage.totalGross > 0 ? feeLeakage.percentage : (feeLeakage.totalFees / (Math.abs(feeLeakage.totalGross) + feeLeakage.totalFees) * 100)).toFixed(1)}%</span>
                        </div>
                    </div>
                )}
            </div>

            {/* DRAWDOWN CHART */}
            <div className="lg:col-span-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <Waves size={16} className="text-rose-500" /> Underwater
                        </h3>
                        <p className="text-xs text-slate-500">Drawdown</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Max DD</p>
                        <p className="text-sm font-black font-mono text-rose-500">{formatCurrency(maxDrawdown)}</p>
                    </div>
                </div>
                <div className="h-64 w-full" style={{ contain: 'layout paint' }}>
                    {equityData.length > 0 ? (
                        <SafeChartContainer>
                            <AreaChart data={equityData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorDD" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
                                <XAxis dataKey="date" hide />
                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(val) => `₹${val / 1000}k`} />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ stroke: '#f43f5e', strokeWidth: 1, strokeDasharray: '3 3' }}
                                />
                                <Area
                                    name="Drawdown"
                                    type="step"
                                    dataKey="drawdown"
                                    stroke="#f43f5e"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorDD)"
                                    isAnimationActive={isVisible}
                                />
                            </AreaChart>
                        </SafeChartContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-slate-500 text-sm border-2 border-dashed border-white/5 rounded-xl">
                            No drawdown data.
                        </div>
                    )}
                </div>
            </div>

            {/* Advanced Analytics Modal */}
            <AdvancedEquityModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                trades={trades}
                isVisible={isVisible}
            />
        </div>
    );
});
