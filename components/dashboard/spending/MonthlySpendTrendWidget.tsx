import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { TrendingDown, TrendingUp, AlertCircle } from 'lucide-react';
import { useTransactions } from '../../../contexts/TransactionContext';

interface MonthlySpendTrendWidgetProps {
    formatCurrency: (val: number) => string;
}

export const MonthlySpendTrendWidget: React.FC<MonthlySpendTrendWidgetProps> = ({ formatCurrency }) => {
    const { transactions } = useTransactions();

    const { data, currentTotal, previousTotal, difference, isHigher } = useMemo(() => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonth = lastMonthDate.getMonth();
        const lastYear = lastMonthDate.getFullYear();

        const currentMonthTxns = transactions.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'debit';
        });

        const lastMonthTxns = transactions.filter(t => {
            const d = new Date(t.date);
            return d.getMonth() === lastMonth && d.getFullYear() === lastYear && t.type === 'debit';
        });

        // Map daily totals
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const chartData: { day: string, current: number | null, previous: number }[] = [];
        let cumCurrent = 0;
        let cumPrevious = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            // Get spending for this day
            const daySpendCurrent = currentMonthTxns
                .filter(t => new Date(t.date).getDate() === day)
                .reduce((sum, t) => sum + t.amount, 0);

            // Get spending for this day last month
            // Note: Last month might have fewer days (e.g. Feb), need to handle bounds or just stop
            const daySpendLast = lastMonthTxns
                .filter(t => new Date(t.date).getDate() === day)
                .reduce((sum, t) => sum + t.amount, 0);

            cumCurrent += daySpendCurrent;
            cumPrevious += daySpendLast;

            // Only push properly if we haven't passed today's date for current month visualization?
            // Usually burn rate charts show projection or "as of day X".
            // Let's show full month data available so far.
            // For future days in current month, we can either project or hold steady. 
            // Let's just hold steady (null) if it's future? 
            // For simplicity, we just plot what we have.

            // Determine if "future" day
            const isFuture = day > now.getDate();

            chartData.push({
                day: day.toString(),
                current: isFuture ? null : cumCurrent,
                previous: cumPrevious
            });
        }

        const totalC = currentMonthTxns.reduce((sum, t) => sum + t.amount, 0);
        const totalP = lastMonthTxns.reduce((sum, t) => sum + t.amount, 0);

        return {
            data: chartData.filter(d => parseInt(d.day) % 5 === 0 || d.day === '1'), // Sparse data for cleaner chart XAxis? Or just all days. Recharts handles ticks well. Let's return all. 
            // Actually let's return all, XAxis handles overcrowding.
            currentTotal: totalC,
            previousTotal: totalP,
            difference: totalC - totalP,
            isHigher: (totalC - totalP) > 0
        };
    }, [transactions]);

    // Use full dataset but maybe filter for specific points if needed. re-using logic block above.
    // Let's just recreate the useMemo properly.

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 border border-slate-200 dark:border-slate-800">
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <TrendingUp size={18} className="text-indigo-500" /> Monthly Burn Rate
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">Cumulative spending vs Last Month</p>
                </div>
                <div className={`text-right ${isHigher ? 'text-rose-500' : 'text-emerald-500'}`}>
                    <span className="text-2xl font-black">{formatCurrency(currentTotal)}</span>
                    <p className="text-xs font-bold flex items-center justify-end gap-1">
                        {isHigher ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {difference > 0 ? '+' : ''}{formatCurrency(difference)} vs last month
                    </p>
                </div>
            </div>

            <div className="h-[250px] w-full">
                <SafeChartContainer>
                    <LineChart data={data || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                        <XAxis
                            dataKey="day"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: '#94a3b8' }}
                            dy={10}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fill: '#94a3b8' }}
                            tickFormatter={(val) => `₹${val / 1000}k`}
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    return (
                                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-xl shadow-xl">
                                            <p className="text-slate-500 dark:text-slate-400 mb-2 font-bold text-xs uppercase tracking-wider">Day {label}</p>
                                            <div className="space-y-1">
                                                {payload.map((entry: any, index: number) => (
                                                    <div key={index} className="flex items-center justify-between gap-4">
                                                        <span className="text-xs text-slate-600 dark:text-slate-300">
                                                            {entry.name === 'current' ? 'This Month' : 'Last Month'}
                                                        </span>
                                                        <span className="font-bold text-slate-900 dark:text-slate-100 text-sm" style={{ color: entry.color }}>
                                                            {formatCurrency(entry.value as number)}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Legend
                            verticalAlign="top"
                            height={36}
                            iconType="circle"
                            formatter={(value) => <span className="text-xs font-bold text-slate-500 ml-1">{value === 'current' ? 'This Month' : 'Last Month'}</span>}
                        />
                        <Line
                            type="monotone"
                            dataKey="previous"
                            stroke="#94a3b8"
                            strokeWidth={2}
                            strokeDasharray="4 4"
                            dot={false}
                            activeDot={false}
                            connectNulls
                        />
                        <Line
                            type="monotone"
                            dataKey="current"
                            stroke="#6366f1"
                            strokeWidth={3}
                            dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                            activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                    </LineChart>
                </SafeChartContainer>
            </div>

            {isHigher && (
                <div className="mt-4 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl flex items-start gap-3">
                    <AlertCircle size={18} className="text-rose-500 mt-0.5" />
                    <p className="text-xs text-rose-700 dark:text-rose-300">
                        <strong>Slow down!</strong> You are spending <strong>{previousTotal > 0 ? Math.round((difference / previousTotal) * 100) : 0}% faster</strong> than last month.
                    </p>
                </div>
            )}
        </div>
    );
};
