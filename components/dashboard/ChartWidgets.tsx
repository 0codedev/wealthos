import React, { useMemo } from 'react';
import { PieChart, Layers } from 'lucide-react';
import {
    PieChart as RechartsPie, Pie, Cell, Tooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { Investment, AggregatedData } from '../../types';

import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { CursorFollowTooltip } from '../shared/CursorFollowTooltip';

const FALLBACK_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#10b981', '#3b82f6', '#f59e0b'];

interface CommonWidgetProps {
    id?: string;
    dragHandle?: boolean;
    onClick?: () => void;
}

export const ExposureChartWidget: React.FC<CommonWidgetProps & {
    allocationData: AggregatedData[];
    investments: Investment[];
    CustomTooltip: any;
    isPrivacyMode: boolean;
    formatCurrency: (val: number) => string;
    calculatePercentage: (a: number, b: number) => string;
}> = ({ allocationData, CustomTooltip }) => {
    const isVisible = usePageVisibility();

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 h-full flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
                <PieChart size={80} className="text-slate-400" />
            </div>
            <div className="flex justify-between items-center mb-0 relative z-10">
                <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Asset Allocation</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Diversification Check</p>
                </div>
                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700/50">
                    <PieChart size={16} />
                </div>
            </div>

            <div className="flex-1 w-full relative z-10 flex items-center justify-center mt-4">
                <SafeChartContainer height={220} minHeight={220}>
                        <RechartsPie>
                            <Pie
                                data={allocationData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                cornerRadius={40}
                                paddingAngle={4}
                                stroke="none"
                                isAnimationActive={isVisible}
                            >
                                {allocationData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip content={<CursorFollowTooltip />} cursor={{ fill: 'transparent' }} isAnimationActive={false} />
                        </RechartsPie>
                </SafeChartContainer>
            </div>
        </div>
    );
};

export const PlatformChartWidget: React.FC<CommonWidgetProps & {
    platformData: AggregatedData[];
    isDarkMode: boolean;
    isPrivacyMode: boolean;
    CustomTooltip: any;
}> = ({ platformData, CustomTooltip }) => {
    const isVisible = usePageVisibility();

    const sortedData = useMemo(() => {
        return [...platformData].sort((a, b) => b.value - a.value);
    }, [platformData]);

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 h-full flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
                <Layers size={80} className="text-indigo-400" />
            </div>
            <div className="flex justify-between items-center mb-6 relative z-10">
                <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Platform Diversification</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Risk Concentration</p>
                </div>
                <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700/50">
                    <Layers size={16} />
                </div>
            </div>

            <div className="flex-1 w-full min-h-[220px] relative z-10">
                <SafeChartContainer height="100%" minHeight={220}>
                        <BarChart
                            layout="vertical"
                            data={sortedData}
                            margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="currentColor" className="text-slate-200 dark:text-slate-800" opacity={0.3} />
                            <XAxis type="number" hide />
                            <YAxis
                                dataKey="name"
                                type="category"
                                width={80}
                                tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'currentColor', className: 'text-slate-100 dark:text-slate-800', opacity: 0.2 }} />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={isVisible}>
                                {sortedData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color || '#6366f1'} />
                                ))}
                            </Bar>
                        </BarChart>
                </SafeChartContainer>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 relative z-10 flex justify-between items-center text-xs text-slate-500">
                <span>Top Concentration</span>
                <span className="font-bold text-slate-900 dark:text-white">
                    {sortedData.length > 0 ? `${sortedData[0].name} (${sortedData[0].percentage}%)` : 'None'}
                </span>
            </div>
        </div>
    );
};
