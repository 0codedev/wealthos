import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell
} from 'recharts';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { Brain, Activity, BarChart2 } from 'lucide-react';
import { Trade } from '../../../database';
import { CustomTooltip } from '../../shared/CustomTooltip';
import { useLiteModeStore } from '../../../store/liteModeStore';
import { useShallow } from 'zustand/react/shallow';

interface ExpectancyEngineProps {
    trades: Trade[];
    isVisible?: boolean;
}

export const ExpectancyEngine = React.memo(({ trades, isVisible = true }: ExpectancyEngineProps) => {
    const expectancyStats = useMemo(() => {
        let totalR = 0;
        let winR = 0;
        let lossR = 0;
        let wins = 0;
        let losses = 0;

        const distribution: Record<string, number> = {
            '<-2R': 0,
            '-2R to -1R': 0,
            '-1R to 0R': 0,
            '0R to 1R': 0,
            '1R to 2R': 0,
            '2R to 3R': 0,
            '>3R': 0
        };

        trades.forEach(t => {
            const r = t.riskRewardRatio || 0;
            totalR += r;

            if (r > 0) {
                winR += r;
                wins++;
            } else if (r < 0) {
                lossR += r;
                losses++;
            }

            if (r < -2) distribution['<-2R']++;
            else if (r < -1) distribution['-2R to -1R']++;
            else if (r < 0) distribution['-1R to 0R']++;
            else if (r < 1) distribution['0R to 1R']++;
            else if (r < 2) distribution['1R to 2R']++;
            else if (r < 3) distribution['2R to 3R']++;
            else distribution['>3R']++;
        });

        const count = trades.length || 1;
        const expectancy = totalR / count;
        const avgWinR = wins > 0 ? winR / wins : 0;
        const avgLossR = losses > 0 ? lossR / losses : 0;

        const chartData = Object.entries(distribution).map(([name, val]) => ({ name, value: val }));

        return { expectancy, avgWinR, avgLossR, chartData };
    }, [trades]);

    const isLiteMode = useLiteModeStore(useShallow(state => state.isLiteMode));

    if (isLiteMode) {
        return (
            <div className="bg-slate-950 border border-white/10 rounded-2xl p-6 shadow-xl flex items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                        <Brain className="w-8 h-8 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Expectancy Engine (Lite)</h3>
                        <p className={`text-3xl font-black font-mono mt-1 ${expectancyStats.expectancy >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {expectancyStats.expectancy >= 0 ? '+' : ''}{expectancyStats.expectancy.toFixed(2)}R
                        </p>
                    </div>
                </div>
                <div className="flex gap-6">
                    <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold text-center">Avg Win</p>
                        <p className="text-lg font-bold text-emerald-400 text-center">+{expectancyStats.avgWinR.toFixed(2)}R</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold text-center">Avg Loss</p>
                        <p className="text-lg font-bold text-rose-400 text-center">{expectancyStats.avgLossR.toFixed(2)}R</p>
                    </div>
                </div>
                <div className="px-4 py-2 bg-amber-500/5 border border-amber-500/20 rounded-lg text-[9px] font-black text-amber-500 uppercase tracking-widest">
                    Distribution Chart Hidden
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-slate-950 border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 relative overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Activity size={80} className="text-indigo-500" />
                </div>
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                    <Brain size={16} className="text-indigo-500" /> Expectancy Engine
                </h3>
                <div className="mb-6">
                    <p className="text-xs text-slate-500 mb-1">System Expectancy</p>
                    <p className={`text-4xl font-black font-mono ${expectancyStats.expectancy > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {expectancyStats.expectancy > 0 ? '+' : ''}{expectancyStats.expectancy.toFixed(2)}R
                    </p>
                    <p className="text-xs text-slate-500 mt-2">Avg return per trade risk unit.</p>
                </div>
                <div className="grid grid-cols-2 gap-4 border-t border-slate-900 pt-4">
                    <div>
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Avg Win</p>
                        <p className="text-lg font-bold text-emerald-400">+{expectancyStats.avgWinR.toFixed(2)}R</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase text-slate-500 font-bold">Avg Loss</p>
                        <p className="text-lg font-bold text-rose-400">{expectancyStats.avgLossR.toFixed(2)}R</p>
                    </div>
                </div>
            </div>
            <div className="md:col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 sm:p-5 md:p-6 shadow-xl">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-6">
                    <BarChart2 size={16} className="text-cyan-500" /> R-Multiple Distribution
                </h3>
                <div className="h-48 w-full">
                    <SafeChartContainer height={192}>
                        <BarChart data={expectancyStats.chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip
                                content={<CustomTooltip formatter={(val: number) => val.toString()} />}
                                cursor={{ fill: 'transparent' }}
                            />
                            <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]} isAnimationActive={isVisible}>
                                {expectancyStats.chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={index < 3 ? '#f43f5e' : index === 3 ? '#64748b' : '#10b981'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </SafeChartContainer>
                </div>
            </div>
        </div>
    );
});
