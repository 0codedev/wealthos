import React from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { Sliders } from 'lucide-react';
import {
    ComposedChart, Area, Line, ReferenceLine,
    CartesianGrid, XAxis, YAxis, Tooltip
} from 'recharts';
import { CustomTooltip } from '../shared/CustomTooltip';
import { CHART_COLORS, CHART_DEFAULTS } from '../../utils/chartTheme';

import { usePageVisibility } from '../../contexts/PageVisibilityContext';

interface WealthSimulatorProps {
    projectionData: any[];
    isDarkMode: boolean;
    formatCurrency: (val: number) => string;
}

const WealthSimulator: React.FC<WealthSimulatorProps> = ({ projectionData, isDarkMode, formatCurrency }) => {
    const isVisible = usePageVisibility();

    if (!projectionData || projectionData.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 mb-6 h-[400px] flex items-center justify-center">
                <div className="animate-pulse flex flex-col items-center gap-4">
                    <div className="w-12 h-12 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                    <div className="h-4 w-48 bg-slate-200 dark:bg-slate-800 rounded"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 mb-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Sliders size={20} className="text-indigo-500" /> The Wealth Simulator
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Monte Carlo Projection (1000 Iterations) • Impact of Life Events</p>
                </div>
                <div className="flex gap-4 text-xs font-bold">
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: `${CHART_COLORS.primary}33` }}></div> Bull Case (P90)</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: CHART_COLORS.primary }}></div> Base Case (P50)</div>
                    <div className="flex items-center gap-1"><div className="w-3 h-3 rounded" style={{ backgroundColor: `${CHART_COLORS.loss}33` }}></div> Bear Case (P10)</div>
                </div>
            </div>

            <div className="h-80 w-full">
                <SafeChartContainer>
                    <ComposedChart data={projectionData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="bullRange" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.2} />
                                <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="bearRange" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CHART_COLORS.loss} stopOpacity={0.2} />
                                <stop offset="95%" stopColor={CHART_COLORS.loss} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid {...CHART_DEFAULTS.grid} />
                        <XAxis
                            dataKey="date"
                            {...CHART_DEFAULTS.axis}
                            tickFormatter={(val) => val ? val.slice(0, 4) : ''}
                            interval={90} // Approx quarterly labels
                        />
                        <YAxis
                            {...CHART_DEFAULTS.axis}
                            tickFormatter={(val) => `₹${(val / 100000).toFixed(1)}L`}
                        />
                        <Tooltip
                            content={<CustomTooltip />}
                            cursor={CHART_DEFAULTS.tooltip.cursor}
                        />

                        {/* P90 Area */}
                        <Area type="monotone" dataKey="bull" stroke="none" fill="url(#bullRange)" isAnimationActive={isVisible} />

                        {/* P10 Area (Red) */}
                        <Area type="monotone" dataKey="bear" stroke="none" fill="url(#bearRange)" isAnimationActive={isVisible} />

                        {/* P50 Line (Median) */}
                        <Line type="monotone" dataKey="base" stroke={CHART_COLORS.primary} strokeWidth={3} dot={false} isAnimationActive={isVisible} />

                        {/* Life Event Markers */}
                        {projectionData.map((entry, index) => {
                            if (entry.eventMarker) {
                                return <ReferenceLine key={index} x={entry.date} stroke={CHART_COLORS.loss} strokeDasharray="3 3" label={{ position: 'top', value: 'Event', fill: CHART_COLORS.loss, fontSize: 10, fontWeight: 600 }} />;
                            }
                            return null;
                        })}

                    </ComposedChart>
                </SafeChartContainer>
            </div>
        </div>
    );
};

export default WealthSimulator;
