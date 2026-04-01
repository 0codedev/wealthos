import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { TrendingUp, Percent, IndianRupee } from 'lucide-react';

export const CAGRCalculator: React.FC = () => {
    const [calcMode, setCalcMode] = useState<'CAGR' | 'TARGET_FV'>('CAGR');

    // CAGR Mode state
    const [initialValue, setInitialValue] = useState(10000);
    const [finalValue, setFinalValue] = useState(50000);
    const [years, setYears] = useState(5);

    // Target Future Value state
    const [targetCAGR, setTargetCAGR] = useState(15);

    const cagrResult = useMemo(() => {
        if (initialValue <= 0 || finalValue <= 0 || years <= 0) return 0;
        const ratio = finalValue / initialValue;
        const cagr = (Math.pow(ratio, 1 / years) - 1) * 100;
        return Number(cagr.toFixed(2));
    }, [initialValue, finalValue, years]);

    const targetFVResult = useMemo(() => {
        if (initialValue <= 0 || targetCAGR < 0 || years <= 0) return 0;
        const fv = initialValue * Math.pow((1 + targetCAGR / 100), years);
        return Math.round(fv);
    }, [initialValue, targetCAGR, years]);

    const absoluteReturn = useMemo(() => {
        if (calcMode === 'CAGR') {
            if (initialValue <= 0) return 0;
            return (((finalValue - initialValue) / initialValue) * 100).toFixed(2);
        } else {
            if (initialValue <= 0) return 0;
            return (((targetFVResult - initialValue) / initialValue) * 100).toFixed(2);
        }
    }, [calcMode, initialValue, finalValue, targetFVResult]);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">CAGR & Returns Engine</h3>
                <div className="flex bg-slate-800 p-1 rounded-lg">
                    <button
                        onClick={() => setCalcMode('CAGR')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${calcMode === 'CAGR' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        Find CAGR
                    </button>
                    <button
                        onClick={() => setCalcMode('TARGET_FV')}
                        className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${calcMode === 'TARGET_FV' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        Find Target FV
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                {/* Inputs */}
                <div className="space-y-5">
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Initial Investment</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                <IndianRupee size={16} />
                            </div>
                            <input
                                type="number"
                                value={initialValue}
                                onChange={(e) => setInitialValue(Number(e.target.value))}
                                className="w-full bg-slate-800 border-none rounded-lg pl-9 pr-4 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                    </div>

                    {calcMode === 'CAGR' && (
                        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Final Value</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                    <IndianRupee size={16} />
                                </div>
                                <input
                                    type="number"
                                    value={finalValue}
                                    onChange={(e) => setFinalValue(Number(e.target.value))}
                                    className="w-full bg-slate-800 border-none rounded-lg pl-9 pr-4 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                        </div>
                    )}

                    {calcMode === 'TARGET_FV' && (
                        <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Expected CAGR (%)</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                    <Percent size={14} />
                                </div>
                                <input
                                    type="number" step="0.5"
                                    value={targetCAGR}
                                    onChange={(e) => setTargetCAGR(Number(e.target.value))}
                                    className="w-full bg-slate-800 border-none rounded-lg pl-9 pr-4 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Time Period (Years)</label>
                        <input
                            type="number" step="0.5"
                            value={years}
                            onChange={(e) => setYears(Number(e.target.value))}
                            className="w-full bg-slate-800 border-none rounded-lg px-4 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                </div>

                {/* Outputs */}
                <div className="bg-slate-800/40 p-6 rounded-2xl border border-slate-700/50 flex flex-col justify-center h-full relative overflow-hidden">
                    <div className="absolute -top-10 -right-10 text-emerald-500/10 pointer-events-none">
                        <TrendingUp size={120} />
                    </div>

                    {calcMode === 'CAGR' ? (
                        <div className="relative z-10">
                            <p className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">Compound Annual Growth</p>
                            <div className="flex items-baseline gap-2">
                                <span className={`text-5xl font-black ${cagrResult >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {cagrResult}%
                                </span>
                            </div>

                            <div className="mt-8 pt-6 border-t border-slate-700/50">
                                <p className="text-xs text-slate-400 mb-1">Absolute Return</p>
                                <p className={`text-xl font-bold ${Number(absoluteReturn) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {absoluteReturn}%
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="relative z-10">
                            <p className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">Target Future Value</p>
                            <div className="flex items-baseline gap-2">
                                <span className="text-4xl font-black text-indigo-400">
                                    {formatCurrency(targetFVResult)}
                                </span>
                            </div>

                            <div className="mt-8 pt-6 border-t border-slate-700/50">
                                <p className="text-xs text-slate-400 mb-1">Absolute Return</p>
                                <p className="text-xl font-bold text-indigo-300">
                                    {absoluteReturn}%
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
