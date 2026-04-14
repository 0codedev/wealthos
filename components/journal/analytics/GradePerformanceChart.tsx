import React, { useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, ReferenceLine, ComposedChart, Line
} from 'recharts';
import { GraduationCap, BarChart as BarChartIcon } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface GradePerformanceChartProps {
    trades: Trade[];
    isVisible?: boolean;
}

export const GradePerformanceChart = React.memo(({ trades, isVisible = true }: GradePerformanceChartProps) => {
    const data = useMemo(() => {
        const gradeOrder = ['A+', 'A', 'B', 'C', 'D', 'F', 'Unrated'];
        const map: Record<string, { pnl: number; count: number; win: number }> = {
            'A+': { pnl: 0, count: 0, win: 0 },
            'A': { pnl: 0, count: 0, win: 0 },
            'B': { pnl: 0, count: 0, win: 0 },
            'C': { pnl: 0, count: 0, win: 0 },
            'D': { pnl: 0, count: 0, win: 0 },
            'F': { pnl: 0, count: 0, win: 0 },
            'Unrated': { pnl: 0, count: 0, win: 0 },
        };

        trades.forEach(t => {
            const grade = t.grade || 'Unrated';
            if (!map[grade]) map[grade] = { pnl: 0, count: 0, win: 0 };
            
            const pnl = t.pnl || 0;
            map[grade].pnl += pnl;
            map[grade].count++;
            if (pnl > 0) map[grade].win++;
        });

        const activeGrades = gradeOrder
            .filter(grade => map[grade].count > 0)
            .map(grade => ({
                grade,
                pnl: map[grade].pnl,
                avgPnL: map[grade].count > 0 ? map[grade].pnl / map[grade].count : 0,
                winRate: map[grade].count > 0 ? (map[grade].win / map[grade].count) * 100 : 0,
                count: map[grade].count
            }));

        return activeGrades;
    }, [trades]);

    if (!data || data.length === 0) return null;

    return (
        <div className="bg-slate-950 border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl w-full h-full flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
                <GraduationCap size={150} className="text-emerald-500" />
            </div>

            <div className="flex justify-between items-start mb-6 shrink-0 relative z-10">
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <GraduationCap size={16} className="text-emerald-500" /> Grade Quality Matrix
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">Setup Quality vs Realized PnL</p>
                </div>
            </div>
            
            <div className="flex-1 w-full min-h-[200px] relative z-10" style={{ contain: 'layout' }}>
                <SafeChartContainer>
                    <ComposedChart data={data} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.3} />
                        <XAxis dataKey="grade" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#cbd5e1', fontWeight: 'bold' }} />
                        <YAxis yAxisId="left" tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(val) => `${val}%`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                        <ReferenceLine y={0} yAxisId="left" stroke="#64748b" strokeDasharray="3 3" opacity={0.5} />
                        <Bar yAxisId="left" dataKey="pnl" name="Total PnL" radius={[4, 4, 0, 0]} isAnimationActive={isVisible}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#10b981' : '#f43f5e'} />
                            ))}
                        </Bar>
                        <Line yAxisId="right" type="monotone" dataKey="winRate" name="Win Rate" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 6 }} isAnimationActive={isVisible} />
                    </ComposedChart>
                </SafeChartContainer>
            </div>
        </div>
    );
});
