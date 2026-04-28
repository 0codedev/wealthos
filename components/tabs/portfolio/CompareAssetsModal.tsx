import React from 'react';
import { Scale, X } from 'lucide-react';
import { Investment } from '../../../types';

export interface CompareAssetsModalProps {
    isOpen: boolean;
    onClose: () => void;
    investments: Investment[];
    selectedForCompare: Investment[];
    setSelectedForCompare: (next: Investment[]) => void;
    formatCurrency: (val: number) => string;
}

export const CompareAssetsModal: React.FC<CompareAssetsModalProps> = ({
    isOpen,
    onClose,
    investments,
    selectedForCompare,
    setSelectedForCompare,
    formatCurrency,
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-slate-800 transition-all duration-300" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-slate-50 dark:bg-slate-900 p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between z-10 backdrop-blur-md">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-500 border border-emerald-100 dark:border-emerald-800">
                             <Scale size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Compare Assets</h2>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Statistical Side-by-Side Review</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-8">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6 ml-1">Select up to 3 assets to compare</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                        {[0, 1, 2].map(idx => (
                            <select
                                key={idx}
                                value={selectedForCompare[idx]?.id || ''}
                                onChange={(e) => {
                                    const asset = investments.find(i => i.id === e.target.value);
                                    const newSelected = [...selectedForCompare];
                                    if (asset) newSelected[idx] = asset;
                                    else newSelected.splice(idx, 1);
                                    setSelectedForCompare(newSelected.filter(Boolean));
                                }}
                                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-inner"
                            >
                                <option value="">Select Asset {idx + 1}</option>
                                {investments.map(inv => (
                                    <option key={inv.id} value={inv.id} disabled={selectedForCompare.some(s => s.id === inv.id)}>
                                        {inv.name}
                                    </option>
                                ))}
                            </select>
                        ))}
                    </div>

                    {selectedForCompare.length >= 2 && (
                        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/30">
                                        <th className="text-left p-4 text-[10px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest">Benchmark Metric</th>
                                        {(selectedForCompare || []).map(asset => (
                                            <th key={asset.id} className="text-center p-4 text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">{asset.name}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 bg-white dark:bg-transparent">
                                    <tr>
                                        <td className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Invested Capital</td>
                                        {(selectedForCompare || []).map(asset => (
                                            <td key={asset.id} className="text-center p-4 font-mono text-sm text-slate-900 dark:text-white font-bold">{formatCurrency(asset.investedAmount)}</td>
                                        ))}
                                    </tr>
                                    <tr>
                                        <td className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Current Market Value</td>
                                        {(selectedForCompare || []).map(asset => (
                                            <td key={asset.id} className="text-center p-4 font-mono font-black text-sm text-indigo-600 dark:text-indigo-400">{formatCurrency(asset.currentValue)}</td>
                                        ))}
                                    </tr>
                                    <tr>
                                        <td className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Unrealized P/L</td>
                                        {(selectedForCompare || []).map(asset => {
                                            const pl = asset.currentValue - asset.investedAmount;
                                            return (
                                                <td key={asset.id} className={`text-center p-4 font-mono font-black text-sm ${pl >= 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'}`}>
                                                    {pl >= 0 ? '+' : ''}{formatCurrency(pl)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                    <tr>
                                        <td className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Yield / Performance</td>
                                        {(selectedForCompare || []).map(asset => {
                                            const pl = asset.currentValue - asset.investedAmount;
                                            const pct = (pl / asset.investedAmount) * 100;
                                            return (
                                                <td key={asset.id} className={`text-center p-4 font-mono font-black text-sm ${pl >= 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'}`}>
                                                    {pl >= 0 ? '+' : ''}{pct.toFixed(2)}%
                                                </td>
                                            );
                                        })}
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                    {selectedForCompare.length < 2 && (
                        <div className="text-center py-20 bg-slate-50 dark:bg-slate-950/20 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                            <Scale size={48} className="mx-auto mb-4 opacity-10 text-slate-900 dark:text-white" />
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Select at least 2 assets to compare</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
