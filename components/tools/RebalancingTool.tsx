import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { AggregatedData, ASSET_CLASS_COLORS } from '../../types';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { ArrowRight, RefreshCw, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown } from 'lucide-react';

import { usePageVisibility } from '../../contexts/PageVisibilityContext';

interface RebalancingToolProps {
    allocationData: AggregatedData[]; // Current allocation (Asset Class level)
    totalValue: number;
    formatCurrency: (val: number) => string;
    onClose: () => void;
}

interface RebalanceItem {
    name: string;
    currentValue: number;
    currentPercent: number;
    targetPercent: number;
    targetValue: number;
    difference: number; // + means Buy, - means Sell
}

export const RebalancingTool: React.FC<RebalancingToolProps> = ({
    allocationData,
    totalValue,
    formatCurrency,
    onClose
}) => {
    const isVisible = usePageVisibility();
    // Local state for targets
    const [targets, setTargets] = useState<Record<string, number>>({});
    const [status, setStatus] = useState<'IDLE' | 'SAVED'>('IDLE');

    // Initialize inputs with current allocation if no saved targets
    useEffect(() => {
        // Try to load from localStorage
        const saved = localStorage.getItem('rebalance-targets');
        if (saved) {
            try {
                setTargets(JSON.parse(saved));
            } catch {
                // Use defaults below
            }
        } else {
            // Default to current allocation rounded
            const defaults: Record<string, number> = {};
            allocationData.forEach(d => {
                defaults[d.name] = Math.round((d.value / totalValue) * 100);
            });
            setTargets(defaults);
        }
    }, [allocationData, totalValue]);

    // Calculate Data
    const tableData: RebalanceItem[] = useMemo(() => {
        return allocationData.map(d => {
            const currentPercent = (d.value / totalValue) * 100;
            const targetPercent = targets[d.name] || 0;
            const targetValue = (targetPercent / 100) * totalValue;
            const difference = targetValue - d.value;

            return {
                name: d.name,
                currentValue: d.value,
                currentPercent,
                targetPercent,
                targetValue,
                difference
            };
        });
    }, [allocationData, totalValue, targets]);

    const totalTargetPercent = Object.values(targets).reduce((acc, curr) => acc + curr, 0);
    const totalCurrentPercent = allocationData.reduce((acc, curr) => acc + (curr.value / totalValue) * 100, 0);
    const actionableRows = tableData.filter((item) => Math.abs(item.difference) >= 100);
    const topAction = actionableRows.slice().sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))[0] || null;

    const handleTargetChange = (name: string, val: string) => {
        const num = parseFloat(val) || 0;
        setTargets(prev => ({ ...prev, [name]: num }));
        setStatus('IDLE');
    };

    const saveTargets = () => {
        localStorage.setItem('rebalance-targets', JSON.stringify(targets));
        setStatus('SAVED');
        setTimeout(() => setStatus('IDLE'), 2000);
    };

    return (
        <div className="flex flex-col h-full max-h-[80vh] bg-white dark:bg-transparent">
            {/* Header */}
            <div className="flex justify-between items-center mb-6 px-1 shrink-0">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic">Portfolio Rebalance</h2>
                    <p className="text-sm text-slate-500 font-medium">Adjust target weights to derive precision buy/sell directives.</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Aggregate Book Value</p>
                    <p className="text-2xl font-black font-mono text-indigo-600 dark:text-indigo-400 tracking-tighter">{formatCurrency(totalValue)}</p>
                </div>
            </div>

            {/* Validation Banner */}
            {Math.abs(totalTargetPercent - 100) > 0.1 && (
                <div className="mb-6 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-500/30 p-4 rounded-2xl flex items-center gap-3 text-sm text-amber-700 dark:text-amber-300 shadow-sm animate-in slide-in-from-top-2">
                    <AlertTriangle size={20} className="shrink-0" />
                    <span className="font-medium">Total Target Allocation is <strong>{totalTargetPercent.toFixed(1)}%</strong>. System requires normalization to 100% for execution accuracy.</span>
                </div>
            )}

            <div className="mb-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 p-5 shadow-inner backdrop-blur-sm">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Tactical Intelligence Brief</p>
                {Math.abs(totalTargetPercent - 100) > 0.1 ? (
                    <>
                        <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span>
                            Calibration Required
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">Adjust individual class percentages until the total aggregate returns to 100%.</p>
                    </>
                ) : topAction ? (
                    <>
                        <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                            Optimization Directives Ready
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                            System detected {actionableRows.length} material deviations. Primary move: <strong className={topAction.difference > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{topAction.difference > 0 ? 'Inject' : 'Extract'} {topAction.name}</strong>.
                        </p>
                    </>
                ) : (
                    <>
                        <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                            Equilibrium Achieved
                        </p>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">Portfolio is strictly aligned with target strategy. No material rebalance actions recommended.</p>
                    </>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1 overflow-hidden min-h-0">
                {/* Visualizer */}
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-3xl p-8 flex flex-col items-center justify-center relative border border-slate-200 dark:border-slate-800 shadow-inner">
                    <h3 className="text-[10px] font-black text-slate-500 dark:text-slate-400 mb-6 uppercase tracking-[0.2em] relative z-10">Target Distribution</h3>
                    <div className="w-full h-56 relative z-10">
                        <SafeChartContainer>
                            <PieChart>
                                <Pie
                                    data={tableData.map(d => ({ name: d.name, targetValue: d.targetValue }))}
                                    dataKey="targetValue"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={85}
                                    stroke="none"
                                    isAnimationActive={isVisible}
                                    paddingAngle={2}
                                >
                                    {tableData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={ASSET_CLASS_COLORS[entry.name] || '#64748b'} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    contentStyle={{ backgroundColor: 'var(--glass-surface)', borderColor: 'var(--glass-border)', borderRadius: '12px', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)' }}
                                    itemStyle={{ color: 'var(--text-slate-900)', fontWeight: 800, fontSize: 11 }}
                                    formatter={((val: number | undefined) => val ? formatCurrency(val) : '') as any} 
                                />
                            </PieChart>
                        </SafeChartContainer>
                    </div>
                </div>

                {/* Table & Inputs */}
                <div className="md:col-span-2 overflow-y-auto pr-2 custom-scrollbar">
                    <table className="w-full text-sm text-left border-separate border-spacing-y-2">
                        <thead className="bg-slate-100/50 dark:bg-slate-800/80 text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 sticky top-0 z-10 backdrop-blur-md">
                            <tr>
                                <th className="px-5 py-3 rounded-l-xl tracking-widest">Asset Class</th>
                                <th className="px-5 py-3 text-right tracking-widest">Actual</th>
                                <th className="px-5 py-3 text-right tracking-widest">Target %</th>
                                <th className="px-5 py-3 text-right tracking-widest">Vector</th>
                                <th className="px-5 py-3 rounded-r-xl text-right tracking-widest">Trade Value</th>
                            </tr>
                        </thead>
                        <tbody className="">
                            {tableData.map((item) => (
                                <tr key={item.name} className="group bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all border border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm">
                                    <td className="px-5 py-4 font-bold flex items-center gap-3 rounded-l-2xl border-l border-y border-slate-100 dark:border-slate-800">
                                        <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: ASSET_CLASS_COLORS[item.name] || '#64748b' }}></div>
                                        <span className="text-slate-900 dark:text-slate-200">{item.name}</span>
                                    </td>
                                    <td className="px-5 py-4 text-right font-mono text-xs font-bold text-slate-500 dark:text-slate-400 border-y border-slate-100 dark:border-slate-800">
                                        {item.currentPercent.toFixed(1)}%
                                    </td>
                                    <td className="px-5 py-4 text-right border-y border-slate-100 dark:border-slate-800">
                                        <input
                                            type="number"
                                            value={targets[item.name] ?? item.currentPercent.toFixed(0)}
                                            onChange={(e) => handleTargetChange(item.name, e.target.value)}
                                            className="w-16 text-right bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none font-black text-slate-900 dark:text-white transition-all shadow-inner"
                                        />
                                    </td>
                                    <td className="px-5 py-4 text-right border-y border-slate-100 dark:border-slate-800">
                                        {Math.abs(item.difference) < 100 ? (
                                            <span className="text-slate-400 font-black">—</span>
                                        ) : item.difference > 0 ? (
                                            <span className="text-emerald-600 dark:text-emerald-400 font-black flex items-center justify-end gap-1.5 text-[10px] uppercase">
                                                BUY <TrendingUp size={14} />
                                            </span>
                                        ) : (
                                            <span className="text-rose-600 dark:text-rose-400 font-black flex items-center justify-end gap-1.5 text-[10px] uppercase">
                                                SELL <TrendingDown size={14} />
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-5 py-4 text-right font-mono font-black text-sm rounded-r-2xl border-r border-y border-slate-100 dark:border-slate-800 tracking-tighter">
                                        <span className={item.difference > 100 ? 'text-emerald-600 dark:text-emerald-400' : item.difference < -100 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}>
                                            {formatCurrency(Math.abs(item.difference))}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="">
                            <tr className="bg-slate-50 dark:bg-slate-950/50 rounded-xl">
                                <td className="px-5 py-4 font-black text-slate-900 dark:text-white uppercase tracking-widest text-[10px] rounded-l-xl">System Total</td>
                                <td className="px-5 py-4 text-right font-black text-slate-500 dark:text-slate-400 font-mono">{totalCurrentPercent.toFixed(0)}%</td>
                                <td className={`px-5 py-4 text-right font-black font-mono ${Math.abs(totalTargetPercent - 100) > 0.1 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                    {totalTargetPercent.toFixed(1)}%
                                </td>
                                <td colSpan={2} className="rounded-r-xl"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Actions for Modal */}
            <div className="mt-8 flex items-center justify-between gap-4 pt-6 border-t border-slate-100 dark:border-slate-800 shrink-0">
                <div className="flex-1">
                    {status === 'SAVED' && (
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-50 dark:bg-emerald-900/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                            <CheckCircle2 size={16} />
                            Strategic targets updated.Directives reflected in Holdings view.
                        </div>
                    )}
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={saveTargets}
                        className="flex items-center gap-2 px-5 py-3 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-xl transition-all text-xs font-black uppercase tracking-widest border border-indigo-100 dark:border-indigo-800"
                    >
                        {status === 'SAVED' ? <CheckCircle2 size={16} /> : <RefreshCw size={16} />}
                        {status === 'SAVED' ? 'Committed' : 'Commit Strategy'}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-8 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl hover:bg-black dark:hover:bg-slate-100 font-black text-xs uppercase tracking-[0.2em] shadow-lg transition-all active:scale-95"
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
};
