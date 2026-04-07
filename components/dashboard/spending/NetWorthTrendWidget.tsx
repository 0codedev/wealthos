import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { TrendingUp, ArrowUpRight, TrendingDown, ArrowDownRight } from 'lucide-react';
import { useTransactions } from '../../../contexts/TransactionContext';
import { CHART_COLORS, CHART_DEFAULTS } from '../../../utils/chartTheme';

interface NetWorthTrendWidgetProps {
    formatCurrency: (val: number) => string;
}

export const NetWorthTrendWidget: React.FC<NetWorthTrendWidgetProps> = ({ formatCurrency }) => {
    const { transactions } = useTransactions();
    const [range, setRange] = useState<'1M' | '3M' | '6M'>('1M');

    // Process transactions to get balance history
    const chartData = useMemo(() => {
        if (!transactions || transactions.length === 0) return [];
        const balanceMap = new Map<string, number>();

        // Sort transactions by date ascending
        const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        sorted.forEach(t => {
            if (t.balance !== undefined) {
                const date = new Date(t.date);
                // Format: "D MMM" e.g., "1 Dec"
                const dateKey = `${date.getDate()} ${date.toLocaleString('default', { month: 'short' })}`;
                balanceMap.set(dateKey, t.balance);
            }
        });

        // Convert map to array
        let data = Array.from(balanceMap.entries()).map(([date, value]) => ({ date, value }));

        // If no data, provide at least one point
        if (data.length === 0) return [{ date: 'Today', value: 0 }];

        // Filter based on range
        if (range === '1M') data = data.slice(-30);
        if (range === '3M') data = data.slice(-90);
        if (range === '6M') data = data.slice(-180);

        return data;
    }, [transactions, range]);

    const currentNetWorth = chartData.length > 0 ? chartData[chartData.length - 1].value : 0;
    const startNetWorth = chartData.length > 0 ? chartData[0].value : 0;
    const growth = startNetWorth > 0 ? ((currentNetWorth - startNetWorth) / startNetWorth * 100).toFixed(1) : '0';
    const isPositive = parseFloat(growth) >= 0;

    if (!transactions || transactions.length === 0) {
        return (
            <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-xl h-[410px] flex items-center justify-center">
                <div className="animate-pulse flex flex-col items-center gap-4">
                    <div className="w-12 h-12 bg-slate-800 rounded-full"></div>
                    <div className="h-4 w-48 bg-slate-800 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-xl relative overflow-hidden group hover:border-slate-700 transition-colors">
            {/* Background Glow */}
            <div className={`absolute -top-10 -right-10 w-40 h-40 blur-[80px] rounded-full pointer-events-none opacity-20 transition-colors duration-1000 ${isPositive ? 'bg-emerald-500' : 'bg-rose-500'}`} />

            <div className="flex items-center justify-between mb-8 relative z-10">
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp size={16} className={isPositive ? "text-emerald-400" : "text-rose-400"} />
                        Net Worth
                    </h3>
                    <div className="flex items-baseline gap-3 mt-1">
                        <span className="text-3xl font-black text-white tracking-tight drop-shadow-lg">
                            {formatCurrency(currentNetWorth)}
                        </span>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${isPositive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                            {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />} {Math.abs(Number(growth))}%
                        </div>
                    </div>
                </div>

                {/* Time Range Toggle */}
                <div className="flex bg-slate-950/50 p-1 rounded-xl border border-slate-800 backdrop-blur-sm">
                    {(['1M', '3M', '6M'] as const).map(r => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${range === r
                                ? 'bg-slate-800 text-white shadow-sm ring-1 ring-white/10'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            {r}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-[250px] w-full relative z-10 -ml-2">
                <SafeChartContainer>
                    <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isPositive ? CHART_COLORS.profit : CHART_COLORS.loss} stopOpacity={0.4} />
                                <stop offset="95%" stopColor={isPositive ? CHART_COLORS.profit : CHART_COLORS.loss} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="strokeGradient" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor={isPositive ? CHART_COLORS.profit : CHART_COLORS.loss} />
                                <stop offset="100%" stopColor={isPositive ? CHART_COLORS.profit : CHART_COLORS.loss} opacity={0.8} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid {...CHART_DEFAULTS.grid} />
                        <XAxis
                            dataKey="date"
                            {...CHART_DEFAULTS.axis}
                            dy={10}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            {...CHART_DEFAULTS.axis}
                            width={0} // Hide Y Axis labels/width for cleaner look
                            domain={['auto', 'auto']}
                        />
                        <Tooltip
                            {...CHART_DEFAULTS.tooltip}
                            formatter={((value: number | undefined) => value ? [formatCurrency(value), 'Net Worth'] : ['', '']) as any}
                            cursor={{ stroke: isPositive ? CHART_COLORS.profit : CHART_COLORS.loss, strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke="url(#strokeGradient)"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorValue)"
                            animationDuration={1500}
                        />
                    </AreaChart>
                </SafeChartContainer>
            </div>
        </div>
    );
};
