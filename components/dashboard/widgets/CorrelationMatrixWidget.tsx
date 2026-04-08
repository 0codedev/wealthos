import React, { useMemo, useState } from 'react';
import { GitBranch, Info, Activity, Zap } from 'lucide-react';
import { useLiteModeStore } from '../../../store/liteModeStore';

interface CorrelationMatrixWidgetProps {
    investments?: { name: string; assetClass?: string }[];
}

// Asset classes for correlation display
const ASSET_CLASSES = ['Equity', 'Debt', 'Gold', 'Real Est', 'Cash'];

// Pre-computed correlation values (simplified for display)
const CORRELATIONS: Record<string, Record<string, number>> = {
    'Equity': { 'Equity': 1.0, 'Debt': 0.15, 'Gold': -0.1, 'Real Est': 0.4, 'Cash': 0.05 },
    'Debt': { 'Equity': 0.15, 'Debt': 1.0, 'Gold': 0.2, 'Real Est': 0.25, 'Cash': 0.6 },
    'Gold': { 'Equity': -0.1, 'Debt': 0.2, 'Gold': 1.0, 'Real Est': 0.1, 'Cash': 0.15 },
    'Real Est': { 'Equity': 0.4, 'Debt': 0.25, 'Gold': 0.1, 'Real Est': 1.0, 'Cash': 0.2 },
    'Cash': { 'Equity': 0.05, 'Debt': 0.6, 'Gold': 0.15, 'Real Est': 0.2, 'Cash': 1.0 },
};

const getCorrelationColor = (value: number) => {
    if (value === 1) return 'bg-slate-105 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'; // Self
    if (value >= 0.7) return 'bg-rose-50 dark:bg-rose-500/20 border-rose-200 dark:border-rose-500/50 text-rose-600 dark:text-rose-400 font-bold'; // High Positive
    if (value >= 0.4) return 'bg-amber-50 dark:bg-amber-500/20 border-amber-200 dark:border-amber-500/50 text-amber-600 dark:text-amber-400'; // Moderate Positive
    if (value >= 0.1) return 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'; // Low Positive
    return 'bg-emerald-50 dark:bg-emerald-500/20 border-emerald-200 dark:border-emerald-500/50 text-emerald-600 dark:text-emerald-400'; // Negative/Uncorrelated (Good Diversification)
};

const CorrelationMatrixWidgetBase: React.FC<CorrelationMatrixWidgetProps> = ({ investments = [] }) => {
    const [hoveredCell, setHoveredCell] = useState<{ row: string, col: string } | null>(null);
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    const diversificationScore = useMemo(() => {
        const uniqueClasses = new Set(investments.map(i => i.assetClass || 'Equity'));
        return Math.min(100, Math.max(20, uniqueClasses.size * 20)); // Simulated score
    }, [investments]);

    return (
        <div className="bg-white/60 dark:bg-slate-950/50 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xl relative overflow-hidden h-full flex flex-col group hover:border-cyan-500/30 transition-colors duration-500">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-cyan-50 dark:bg-cyan-950/50 rounded-xl flex items-center justify-center border border-cyan-100 dark:border-cyan-500/20 shadow-lg shadow-cyan-900/20">
                        <Activity size={20} className="text-cyan-600 dark:text-cyan-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Asset DNA</h3>
                        <p className="text-[10px] text-cyan-600 dark:text-cyan-400/80 font-mono">Correlation Matrix</p>
                    </div>
                </div>

                {/* Score Badge */}
                <div className="flex flex-col items-end">
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Diversity Score</span>
                    <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500" style={{ width: `${diversificationScore}%` }} />
                        </div>
                        <span className="text-sm font-black text-slate-900 dark:text-white">{diversificationScore}</span>
                    </div>
                </div>
            </div>

            {/* Matrix Container */}
            <div className="flex-1 flex flex-col justify-center relative z-10">
                {isLiteMode ? (
                    <div className="p-4 bg-white/60 dark:bg-slate-900/50 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex flex-col items-center justify-center gap-2">
                        <Zap size={24} className="text-amber-500 opacity-50" />
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest text-center">
                            Lite Mode: Matrix Frozen
                        </p>
                        <p className="text-[10px] text-slate-600 text-center">
                            Diversification is healthy across {new Set(investments.map(i => i.assetClass)).size || 3} asset classes.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto pb-1 scrollbar-none">
                        <div className="min-w-[260px]">
                            {/* Column Headers */}
                            <div className="flex mb-2">
                                <div className="w-12 shrink-0" />
                                {ASSET_CLASSES.map(cls => (
                                    <div key={cls} className={`flex-1 text-center transition-opacity duration-300 ${hoveredCell?.col === cls ? 'opacity-100 scale-110' : 'opacity-60'}`}>
                                        <span className={`text-[9px] font-bold uppercase rotate-0 block ${hoveredCell?.col === cls ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{cls}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Rows */}
                            {ASSET_CLASSES.map(rowClass => (
                                <div key={rowClass} className="flex mb-2 items-center">
                                    {/* Row Header */}
                                    <div className={`w-12 shrink-0 transition-opacity duration-300 ${hoveredCell?.row === rowClass ? 'opacity-100 translate-x-1' : 'opacity-60'}`}>
                                        <span className={`text-[9px] font-bold uppercase ${hoveredCell?.row === rowClass ? 'text-slate-900 dark:text-white' : 'text-slate-500'}`}>{rowClass}</span>
                                    </div>

                                    {/* Cells */}
                                    {ASSET_CLASSES.map(colClass => {
                                        const value = CORRELATIONS[rowClass][colClass];
                                        const isHovered = hoveredCell?.row === rowClass && hoveredCell?.col === colClass;
                                        const isRelated = hoveredCell?.row === rowClass || hoveredCell?.col === colClass;

                                        return (
                                            <div key={colClass} className="flex-1 px-0.5">
                                                <div
                                                    onMouseEnter={() => setHoveredCell({ row: rowClass, col: colClass })}
                                                    onMouseLeave={() => setHoveredCell(null)}
                                                    className={`
                                                        h-8 rounded-lg border flex items-center justify-center cursor-crosshair transition-all duration-300
                                                        ${getCorrelationColor(value)}
                                                        ${isHovered ? 'scale-110 shadow-lg z-10 ring-2 ring-slate-400/20 dark:ring-white/20' : ''}
                                                        ${hoveredCell && !isRelated && !isHovered ? 'opacity-20 blur-[1px]' : 'opacity-100'}
                                                    `}
                                                >
                                                    {/* Show value only on simple view or specific conditions to avoid clutter, or always small */}
                                                    <span className={`text-[9px] font-mono transition-opacity ${isHovered ? 'opacity-100' : 'opacity-80'}`}>
                                                        {value === 1 ? '—' : value.toFixed(1)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Legend / Insight */}
            <div className="mt-2 bg-white/60 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center gap-3 justify-center">
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[9px] text-slate-600 dark:text-slate-400">Diversifier</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-[9px] text-slate-600 dark:text-slate-400">High Risk</span>
                </div>
                {!isLiteMode && (
                    <>
                        <div className="h-3 w-px bg-slate-300 dark:bg-slate-700" />
                        <span className="text-[9px] text-slate-500 italic">Select cells to analyze pairs</span>
                    </>
                )}
            </div>

            {/* Background Decor */}
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(CorrelationMatrixWidgetBase);
