import React, { useMemo } from 'react';
import { Activity, ShieldCheck, TrendingUp, Info } from 'lucide-react';
import { calculateRiskMetrics, RiskMetrics } from '../../services/QuantService';

interface RiskMetricsCardProps {
    returnsHistory?: number[]; // Mocking history for now
}

export const RiskMetricsCard: React.FC<RiskMetricsCardProps> = ({ returnsHistory = [] }) => {
    const metrics: RiskMetrics = useMemo(() => calculateRiskMetrics(returnsHistory), [returnsHistory]);

    const MetricRow = ({ label, value, desc, ideal }: { label: string, value: string | number, desc: string, ideal?: string }) => (
        <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 group">
            <div>
                <div className="flex items-center gap-1">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{label}</p>
                    <div className="relative">
                        <Info size={12} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-help" />
                        <div className="absolute left-full top-0 ml-2 w-48 bg-slate-800 text-white text-[10px] p-2 rounded hidden group-hover:block z-50">
                            {desc}
                        </div>
                    </div>
                </div>
                {ideal && <p className="text-[10px] text-slate-400">Target: {ideal}</p>}
            </div>
            <p className="text-lg font-mono font-bold text-slate-800 dark:text-white">{value}</p>
        </div>
    );

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm h-full">
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg text-violet-600">
                    <Activity size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800 dark:text-white">Risk Engine</h3>
                    <p className="text-xs text-slate-500">Efficiency Adjusted Returns.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                <MetricRow
                    label="Sharpe Ratio"
                    value={metrics.sharpeRatio.toFixed(2)}
                    desc="Return generated per unit of Risk. >1 is Good, >2 is Excellent."
                    ideal="> 1.0"
                />
                <MetricRow
                    label="Sortino Ratio"
                    value={metrics.sortinoRatio.toFixed(2)}
                    desc="Like Sharpe, but only penalizes downside volatility (bad risk)."
                    ideal="> 1.5"
                />
                <MetricRow
                    label="Beta"
                    value={metrics.beta.toFixed(2)}
                    desc="Volatility relative to Market (1.0). <1 means less volatile."
                    ideal="0.8 - 1.1"
                />
                <MetricRow
                    label="Alpha"
                    value={`${metrics.alpha > 0 ? '+' : ''}${metrics.alpha.toFixed(1)}%`}
                    desc="Excess return over benchmark."
                    ideal="Positive"
                />
                <MetricRow
                    label="Max Drawdown"
                    value={`${metrics.maxDrawdown.toFixed(1)}%`}
                    desc="Maximum observed loss from a peak to a trough."
                    ideal="< 20%"
                />
                <MetricRow
                    label="Volatility (StdDev)"
                    value={`${metrics.volatility.toFixed(1)}%`}
                    desc="Standard Deviation of returns."
                    ideal="< 15%"
                />
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-500" />
                    <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Portfolio Health: A+</p>
                </div>
                <p className="text-[10px] text-slate-400">Based on 3Y Rolling Returns</p>
            </div>
        </div>
    );
};
