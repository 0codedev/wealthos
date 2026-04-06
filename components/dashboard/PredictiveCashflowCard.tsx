import React, { useState, useMemo } from 'react';
import { TrendingUp, AlertTriangle, ShieldCheck, Calendar, Zap, ArrowDownRight, Sparkles } from 'lucide-react';
import { computeCashflowRunway, CashflowForecastResult } from '../../utils/cashflowPredictor';
import { formatCurrency } from '../../utils/helpers';

interface PredictiveCashflowCardProps {
    currentCash?: number;
}

export const PredictiveCashflowCard: React.FC<PredictiveCashflowCardProps> = ({ currentCash = 185000 }) => {
    const [horizon, setHorizon] = useState<30 | 60 | 90>(60);
    const forecast: CashflowForecastResult = useMemo(
        () => computeCashflowRunway(currentCash, 160000, 1, [], 50000, horizon),
        [currentCash, horizon]
    );

    // SVG Chart points
    const { minVal, maxVal, svgPoints, bufferY } = useMemo(() => {
        const balances = forecast.timeline.map(d => d.projectedBalance);
        const min = Math.min(...balances, forecast.safetyThreshold * 0.7);
        const max = Math.max(...balances, currentCash * 1.15);
        const range = max - min || 1;
        const width = 500;
        const height = 110;

        const points = balances.map((val, idx) => {
            const x = (idx / (balances.length - 1)) * width;
            const y = height - ((val - min) / range) * (height - 20) - 10;
            return `${x},${y}`;
        }).join(' ');

        const bufY = height - ((forecast.safetyThreshold - min) / range) * (height - 20) - 10;

        return { minVal: min, maxVal: max, svgPoints: points, bufferY: bufY };
    }, [forecast, currentCash]);

    return (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <Sparkles size={18} />
                    </div>
                    <div>
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                            AI Liquidity Forecaster
                        </span>
                        <h3 className="text-base font-bold text-white font-display">
                            Predictive {horizon}-Day Cashflow Runway
                        </h3>
                    </div>
                </div>

                {/* Horizon Switcher */}
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    {[30, 60, 90].map((days) => (
                        <button
                            key={days}
                            onClick={() => setHorizon(days as 30 | 60 | 90)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono transition-all ${
                                horizon === days ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                            }`}
                        >
                            {days}D
                        </button>
                    ))}
                </div>
            </div>

            {/* Key Metrics Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Current Liquidity</div>
                    <div className="text-lg font-black text-white font-mono mt-0.5">
                        ₹{forecast.currentLiquidity.toLocaleString('en-IN')}
                    </div>
                </div>

                <div className={`p-3.5 rounded-2xl border ${
                    forecast.hasLiquidityRisk 
                        ? 'bg-rose-500/10 border-rose-500/30' 
                        : 'bg-emerald-500/10 border-emerald-500/30'
                }`}>
                    <div className="text-[10px] uppercase font-bold text-slate-400">Projected Lowest Dip</div>
                    <div className={`text-lg font-black font-mono mt-0.5 ${
                        forecast.hasLiquidityRisk ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                        ₹{forecast.minimumProjectedBalance.toLocaleString('en-IN')}
                    </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-800/40 border border-slate-800">
                    <div className="text-[10px] uppercase font-bold text-slate-400">Lowest Dip Date</div>
                    <div className="text-xs font-bold text-slate-200 font-mono mt-1">
                        {new Date(forecast.lowestBalanceDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ({forecast.daysUntilLowest}d away)
                    </div>
                </div>
            </div>

            {/* SVG Visual Runway Chart */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>Today</span>
                    <span className="text-indigo-400 flex items-center gap-1">
                        <span className="w-2 h-0.5 bg-indigo-500" /> Projected Balance
                    </span>
                    <span className="text-amber-400 flex items-center gap-1">
                        <span className="w-2 h-0.5 bg-amber-500 border border-dashed" /> ₹50k Safety Threshold
                    </span>
                    <span>+{horizon} Days</span>
                </div>

                <div className="relative w-full h-28">
                    <svg viewBox="0 0 500 110" preserveAspectRatio="none" className="w-full h-full overflow-visible">
                        {/* Safety Buffer Line */}
                        <line 
                            x1="0" 
                            y1={bufferY} 
                            x2="500" 
                            y2={bufferY} 
                            stroke="#f59e0b" 
                            strokeDasharray="4 4" 
                            strokeWidth="1.2" 
                        />

                        {/* Forecast Trend Line */}
                        <polyline
                            fill="none"
                            stroke="#6366f1"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={svgPoints}
                        />
                    </svg>
                </div>
            </div>
        </div>
    );
};
