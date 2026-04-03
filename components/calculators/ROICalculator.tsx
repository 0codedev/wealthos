import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { formatCurrency } from '../../utils/helpers';
import { Percent, IndianRupee, PieChart as PieChartIcon, TrendingUp } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';

export const ROICalculator: React.FC = () => {
    const [investedValue, setInvestedValue] = useState(100000);
    const [percentageReturn, setPercentageReturn] = useState(15);

    const result = useMemo(() => {
        const totalProfit = investedValue * (percentageReturn / 100);
        const totalValue = investedValue + totalProfit;

        return {
            totalProfit,
            totalValue
        };
    }, [investedValue, percentageReturn]);

    const chartData = [
        { name: 'Invested', value: Math.max(0, investedValue) },
        { name: 'Profits', value: Math.max(0, result.totalProfit) }
    ];

    // Using emerald for profit, slate for invested
    const COLORS = ['#64748b', '#10b981'];
    // If profit is negative, change coloring appropriately
    if (result.totalProfit < 0) {
        chartData[1].value = Math.abs(result.totalProfit);
        COLORS[1] = '#f43f5e'; // Rose for loss
    }

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Percent className="text-emerald-500" size={24} /> Simple ROI Calculator
            </h3>

            <div className="space-y-8">
                {/* Inputs */}
                <div className="space-y-5">
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Total Invested Value</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                <IndianRupee size={16} />
                            </div>
                            <input
                                type="number"
                                value={investedValue}
                                onChange={(e) => setInvestedValue(Number(e.target.value))}
                                className="w-full bg-slate-800 border-none rounded-lg pl-9 pr-4 py-2 text-white font-mono focus:ring-2 focus:ring-emerald-500 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Expected / Realized Return (%)</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                <Percent size={14} />
                            </div>
                            <input
                                type="number" step="0.5"
                                value={percentageReturn}
                                onChange={(e) => setPercentageReturn(Number(e.target.value))}
                                className={`w-full bg-slate-800 border-none rounded-lg pl-9 pr-4 py-2 font-mono focus:ring-2 outline-none ${percentageReturn >= 0 ? 'text-emerald-400 focus:ring-emerald-500' : 'text-rose-400 focus:ring-rose-500'}`}
                            />
                        </div>
                    </div>
                </div>

                {/* Outputs */}
                <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 flex flex-col items-center">

                    <div className="w-full flex justify-between items-center mb-6">
                        <div className="text-left">
                            <p className="text-xs text-slate-400 mb-1">Total Profits</p>
                            <p className={`text-xl font-black ${result.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {result.totalProfit >= 0 ? '+' : ''}{formatCurrency(result.totalProfit)}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-slate-400 mb-1">Total Value</p>
                            <p className="text-2xl font-black text-white">
                                {formatCurrency(result.totalValue)}
                            </p>
                        </div>
                    </div>

                    <div className="h-40 w-full relative">
                        {investedValue > 0 ? (
                            <SafeChartContainer>
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={45}
                                        outerRadius={70}
                                        paddingAngle={5}
                                        dataKey="value"
                                        stroke="transparent"
                                        cornerRadius={4}
                                    >
                                        {chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <RechartsTooltip
                                        formatter={(value: any) => formatCurrency(Number(value) || 0)}
                                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                                        itemStyle={{ color: '#fff' }}
                                    />
                                </PieChart>
                            </SafeChartContainer>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <p className="text-sm text-slate-500 font-medium">Enter an investment to view chart.</p>
                            </div>
                        )}

                        {investedValue > 0 && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <TrendingUp className={result.totalProfit >= 0 ? 'text-emerald-500/50' : 'text-rose-500/50'} size={24} />
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};
