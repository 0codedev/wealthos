import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { Layers, PlusCircle, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

export const AveragingCalculator: React.FC = () => {
    const [initialShares, setInitialShares] = useState(100);
    const [initialPrice, setInitialPrice] = useState(150);

    // For calculating how many more to buy
    const [newPrice, setNewPrice] = useState(120);
    const [newShares, setNewShares] = useState(50);

    const result = useMemo(() => {
        const initialInvestment = initialShares * initialPrice;
        const newInvestment = newShares * newPrice;

        const totalShares = initialShares + newShares;
        const totalInvestment = initialInvestment + newInvestment;

        const averagePrice = totalShares > 0 ? totalInvestment / totalShares : 0;

        // Calculate difference in average price
        const priceDiff = averagePrice - initialPrice;
        const percentDiff = initialPrice > 0 ? (priceDiff / initialPrice) * 100 : 0;

        return {
            initialInvestment,
            newInvestment,
            totalShares,
            totalInvestment,
            averagePrice,
            priceDiff,
            percentDiff
        };
    }, [initialShares, initialPrice, newPrice, newShares]);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Layers size={20} className="text-indigo-500" /> Stock Averaging Calculator
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                {/* Inputs */}
                <div className="space-y-6">
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                        <h4 className="text-sm font-bold text-slate-300 mb-4 flex items-center gap-2"><ArrowDownCircle size={16} /> Initial Position</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-slate-400 mb-1 block">Shares / Qty</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={initialShares}
                                    onChange={(e) => setInitialShares(Number(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:border-indigo-500 outline-none transition-colors"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-slate-400 mb-1 block">Buy Price</label>
                                <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={initialPrice}
                                    onChange={(e) => setInitialPrice(Number(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:border-indigo-500 outline-none transition-colors"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-800/50 p-4 rounded-xl border border-indigo-500/30">
                        <h4 className="text-sm font-bold text-indigo-300 mb-4 flex items-center gap-2"><PlusCircle size={16} /> New Position Addition</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-medium text-slate-400 mb-1 block">Shares / Qty</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={newShares}
                                    onChange={(e) => setNewShares(Number(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:border-indigo-500 outline-none transition-colors"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-slate-400 mb-1 block">Buy Price</label>
                                <input
                                    type="number"
                                    min="0" step="0.01"
                                    value={newPrice}
                                    onChange={(e) => setNewPrice(Number(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:border-indigo-500 outline-none transition-colors"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Outputs */}
                <div className="bg-gradient-to-br from-slate-800 to-slate-900/80 p-6 rounded-2xl border border-slate-700 flex flex-col justify-center h-full relative overflow-hidden shadow-inner shadow-black/20">
                    <div className="absolute top-0 right-0 p-6 opacity-30">
                        {result.percentDiff < 0 ? <ArrowDownCircle size={80} className="text-emerald-500" /> : <ArrowUpCircle size={80} className="text-rose-500" />}
                    </div>

                    <div className="relative z-10 mb-8">
                        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">New Average Price</p>
                        <div className="flex items-end gap-3">
                            <span className="text-5xl font-black text-white">{formatCurrency(result.averagePrice)}</span>
                            {result.percentDiff !== 0 && (
                                <span className={`text-sm font-bold mb-1 px-2 py-0.5 rounded ${result.percentDiff < 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                    {result.percentDiff > 0 ? '+' : ''}{result.percentDiff.toFixed(2)}%
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 w-full relative z-10">
                        <div className="flex justify-between items-center py-3 border-b border-slate-700/50">
                            <span className="text-slate-400 text-sm">Total Shares</span>
                            <span className="text-white font-mono font-bold text-lg">{result.totalShares.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 border-b border-slate-700/50">
                            <span className="text-slate-400 text-sm">Initial Investment</span>
                            <span className="text-slate-300 font-mono">{formatCurrency(result.initialInvestment)}</span>
                        </div>
                        <div className="flex justify-between items-center py-3 border-b border-slate-700/50">
                            <span className="text-slate-400 text-sm">Additional Investment</span>
                            <span className="text-indigo-300 font-mono font-bold">+{formatCurrency(result.newInvestment)}</span>
                        </div>
                        <div className="flex justify-between items-center py-4 bg-slate-950/30 -mx-6 px-6 relative mt-2">
                            <span className="text-indigo-400 font-bold uppercase tracking-widest text-xs">Total Capital Deployed</span>
                            <span className="text-white font-mono font-bold text-xl">{formatCurrency(result.totalInvestment)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
