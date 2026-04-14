import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Cell, CartesianGrid, ReferenceLine, Legend, LabelList
} from 'recharts';
import { Calendar as CalendarIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface DayOfWeekPerformanceProps {
    trades: Trade[];
    isVisible?: boolean;
}

export const DayOfWeekPerformance = React.memo(({ trades, isVisible = true }: DayOfWeekPerformanceProps) => {
    const data = useMemo(() => {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const map: Record<string, { pnl: number; count: number; win: number }> = {
            'Monday': { pnl: 0, count: 0, win: 0 },
            'Tuesday': { pnl: 0, count: 0, win: 0 },
            'Wednesday': { pnl: 0, count: 0, win: 0 },
            'Thursday': { pnl: 0, count: 0, win: 0 },
            'Friday': { pnl: 0, count: 0, win: 0 },
            'Saturday': { pnl: 0, count: 0, win: 0 },
            'Sunday': { pnl: 0, count: 0, win: 0 },
        };

        let maxPnL = 0;
        let minPnL = 0;

        trades.forEach(t => {
            const dateObj = new Date(t.date);
            if (!isNaN(dateObj.getTime())) {
                const dayName = days[dateObj.getDay()];
                const pnl = t.pnl || 0;
                map[dayName].pnl += pnl;
                map[dayName].count++;
                if (pnl > 0) map[dayName].win++;
            }
        });

        const sorted = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
            .filter(day => map[day].count > 0)
            .map(day => {
                const itemPnL = map[day].pnl;
                if (itemPnL > maxPnL) maxPnL = itemPnL;
                if (itemPnL < minPnL) minPnL = itemPnL;

                return {
                    day: day.substring(0, 3), // Mon, Tue
                    fullname: day,
                    pnl: itemPnL,
                    winRate: map[day].count > 0 ? (map[day].win / map[day].count) * 100 : 0,
                    count: map[day].count
                };
            });
            
        return { chartData: sorted, best: sorted.reduce((max, obj) => max.pnl > obj.pnl ? max : obj, sorted[0]), worst: sorted.reduce((min, obj) => min.pnl < obj.pnl ? min : obj, sorted[0]) };
    }, [trades]);

    if (!data.chartData || data.chartData.length === 0) return null;

    return (
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl w-full h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <CalendarIcon size={16} className="text-indigo-500" /> Day of Week Rhythm
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Which days are most profitable?</p>
                </div>
            </div>
            
            <div className="flex-1 w-full min-h-[200px] mb-4" style={{ contain: 'layout' }}>
                <SafeChartContainer>
                    <ComposedChart data={data.chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis yAxisId="left" tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6366f1' }} domain={[0, 100]} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                        <ReferenceLine yAxisId="left" y={0} stroke="#64748b" strokeDasharray="3 3" opacity={0.5} />
                        <Bar yAxisId="left" dataKey="pnl" name="Total PnL" radius={[4, 4, 0, 0]} isAnimationActive={isVisible}>
                            {data.chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                            ))}
                            <LabelList
                                dataKey="count"
                                position="top"
                                formatter={(val: any) => val > 0 ? `${val}T` : ''}
                                style={{ fontSize: '9px', fill: '#64748b', fontWeight: 800 }}
                            />
                        </Bar>
                        <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="winRate"
                            name="Win Rate %"
                            stroke="#6366f1"
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
                            activeDot={{ r: 5, strokeWidth: 0 }}
                            isAnimationActive={isVisible}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', color: '#64748b' }} />
                    </ComposedChart>
                </SafeChartContainer>
            </div>

            {/* Quick Insights */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5 shrink-0">
                {data.best && (
                    <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                        <p className="text-xs text-emerald-400 font-bold uppercase mb-1 flex items-center gap-1">
                            <TrendingUp size={12} /> Best ({data.best.day})
                        </p>
                        <p className="text-sm font-black font-mono text-emerald-400">{formatCurrency(data.best.pnl)}</p>
                        <p className="text-[10px] text-emerald-500/70 mt-0.5">
                            {data.best.count} trades • {data.best.winRate.toFixed(0)}% WR
                        </p>
                    </div>
                )}
                {data.worst && (
                    <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20">
                        <p className="text-xs text-rose-400 font-bold uppercase mb-1 flex items-center gap-1">
                            <TrendingDown size={12} /> Worst ({data.worst.day})
                        </p>
                        <p className="text-sm font-black font-mono text-rose-400">{formatCurrency(data.worst.pnl)}</p>
                        <p className="text-[10px] text-rose-500/70 mt-0.5">
                            {data.worst.count} trades • {data.worst.winRate.toFixed(0)}% WR
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
});
