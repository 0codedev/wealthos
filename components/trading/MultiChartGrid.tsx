import React, { useState } from 'react';
import { LayoutGrid, Maximize2, SplitSquareVertical, Columns, RefreshCw, BarChart2, Eye } from 'lucide-react';
import { motion } from 'framer-motion';
import { useQuickLookStore } from '../../hooks/useQuickLook';

export type ChartGridLayout = '1x1' | '1x2' | '2x2' | '3x1';

interface ChartPanelConfig {
    id: string;
    symbol: string;
    timeframe: '1m' | '5m' | '15m' | '1D';
    ltp: number;
    pctChange: number;
    rFactor: number;
    sparkline: number[];
}

const DEFAULT_CHARTS: ChartPanelConfig[] = [
    { id: 'c1', symbol: 'NIFTY 50', timeframe: '5m', ltp: 24852.15, pctChange: 0.72, rFactor: 2.45, sparkline: [10, 14, 13, 17, 19, 18, 22, 25, 27] },
    { id: 'c2', symbol: 'NIFTY BANK', timeframe: '5m', ltp: 53120.40, pctChange: 1.15, rFactor: 3.10, sparkline: [20, 22, 21, 26, 28, 31, 35, 34, 38] },
    { id: 'c3', symbol: 'NIFTY METAL', timeframe: '15m', ltp: 9450.80, pctChange: 1.85, rFactor: 3.80, sparkline: [15, 18, 17, 24, 26, 30, 32, 36, 40] },
    { id: 'c4', symbol: 'NIFTY IT', timeframe: '15m', ltp: 41200.10, pctChange: -0.45, rFactor: 1.10, sparkline: [30, 28, 29, 27, 25, 24, 23, 22, 21] }
];

export const MultiChartGrid: React.FC = () => {
    const [layout, setLayout] = useState<ChartGridLayout>('2x2');
    const [charts, setCharts] = useState<ChartPanelConfig[]>(DEFAULT_CHARTS);
    const [syncedHoverIndex, setSyncedHoverIndex] = useState<number | null>(null);
    const { openQuickLook } = useQuickLookStore();

    const activeChartCount = layout === '1x1' ? 1 : layout === '1x2' ? 2 : layout === '3x1' ? 3 : 4;
    const visibleCharts = charts.slice(0, activeChartCount);

    const renderChartCanvas = (chart: ChartPanelConfig, idx: number) => {
        const isPositive = chart.pctChange >= 0;
        const data = chart.sparkline;
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const width = 320;
        const height = 120;

        const points = data
            .map((val, i) => {
                const x = (i / (data.length - 1)) * width;
                const y = height - ((val - min) / range) * (height - 20) - 10;
                return `${x},${y}`;
            })
            .join(' ');

        const hoveredX = syncedHoverIndex !== null ? (syncedHoverIndex / (data.length - 1)) * width : null;

        return (
            <div 
                key={chart.id}
                className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between hover:border-slate-700 transition-all relative overflow-hidden group"
                onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const relX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
                    const step = Math.round((relX / rect.width) * (data.length - 1));
                    setSyncedHoverIndex(step);
                }}
                onMouseLeave={() => setSyncedHoverIndex(null)}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-2.5">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-white font-display tracking-wide">
                            {chart.symbol}
                        </span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                            {chart.timeframe}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono font-black ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ₹{chart.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })} ({isPositive ? '+' : ''}{chart.pctChange.toFixed(2)}%)
                        </span>
                        <button
                            onClick={() => openQuickLook({
                                type: 'STOCK',
                                data: {
                                    symbol: chart.symbol,
                                    ltp: chart.ltp,
                                    pctChange: chart.pctChange,
                                    rFactor: chart.rFactor,
                                    sparkline: chart.sparkline
                                }
                            })}
                            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100"
                            title="Open QuickLook"
                        >
                            <Eye size={13} />
                        </button>
                    </div>
                </div>

                {/* SVG Chart with Synced Crosshair */}
                <div className="py-4 relative flex items-center justify-center">
                    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 overflow-visible">
                        {/* Grid lines */}
                        <line x1="0" y1="20" x2={width} y2="20" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
                        <line x1="0" y1="60" x2={width} y2="60" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
                        <line x1="0" y1="100" x2={width} y2="100" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />

                        {/* Trend line */}
                        <polyline
                            fill="none"
                            stroke={isPositive ? '#10b981' : '#f43f5e'}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={points}
                        />

                        {/* Synced Timeline Crosshair */}
                        {hoveredX !== null && (
                            <line
                                x1={hoveredX}
                                y1="0"
                                x2={hoveredX}
                                y2={height}
                                stroke="#818cf8"
                                strokeWidth="1.5"
                                strokeDasharray="2 2"
                            />
                        )}
                    </svg>
                </div>

                {/* Footer Metrics */}
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 border-t border-slate-800/60 pt-2">
                    <span className="flex items-center gap-1">
                        R-Factor: <strong className="text-amber-400">{chart.rFactor.toFixed(2)}</strong>
                    </span>
                    <span className="text-slate-500">Live Tick Stream</span>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-4">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between p-3 bg-slate-900/60 border border-slate-800 rounded-2xl">
                <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        <BarChart2 size={16} />
                    </span>
                    <span className="text-xs font-bold text-white font-display">
                        Multi-Chart Institutional Grid
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                        • Synced Timeline Crosshairs Active
                    </span>
                </div>

                {/* Layout Switcher Buttons */}
                <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                    <button
                        onClick={() => setLayout('1x1')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            layout === '1x1' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                        title="1x1 Single Chart"
                    >
                        1x1
                    </button>
                    <button
                        onClick={() => setLayout('1x2')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            layout === '1x2' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                        title="1x2 Split Dual"
                    >
                        1x2
                    </button>
                    <button
                        onClick={() => setLayout('2x2')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            layout === '2x2' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                        title="2x2 Quad Grid"
                    >
                        2x2
                    </button>
                    <button
                        onClick={() => setLayout('3x1')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            layout === '3x1' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                        title="3x1 Triple Strip"
                    >
                        3x1
                    </button>
                </div>
            </div>

            {/* Grid Layout Container */}
            <div className={`grid gap-4 ${
                layout === '1x1' 
                    ? 'grid-cols-1' 
                    : layout === '1x2' 
                        ? 'grid-cols-1 md:grid-cols-2' 
                        : layout === '3x1'
                            ? 'grid-cols-1 md:grid-cols-3'
                            : 'grid-cols-1 md:grid-cols-2'
            }`}>
                {visibleCharts.map((chart, idx) => renderChartCanvas(chart, idx))}
            </div>
        </div>
    );
};
