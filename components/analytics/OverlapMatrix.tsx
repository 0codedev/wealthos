import React, { useMemo } from 'react';
import { Layers, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Investment } from '../../types';
import { calculateOverlap, OverlapResult } from '../../services/QuantService';

interface OverlapMatrixProps {
    investments: Investment[];
}

export const OverlapMatrix: React.FC<OverlapMatrixProps> = ({ investments }) => {
    // 1. Filter Mutual Funds
    const funds = useMemo(() => investments.filter(i => i.type.includes('Mutual Fund') || i.type.includes('Equity')), [investments]);

    // 2. Calculate Overlap for each pair
    const overlaps = useMemo(() => {
        const results: OverlapResult[] = [];
        for (let i = 0; i < funds.length; i++) {
            for (let j = i + 1; j < funds.length; j++) {
                const res = calculateOverlap(funds[i].name, funds[j].name);
                if (res.overlapPercentage > 0.1) { // Only show significant overlap
                    results.push(res);
                }
            }
        }
        return results.sort((a, b) => b.overlapPercentage - a.overlapPercentage);
    }, [funds]);

    if (funds.length < 2) return null;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm h-full">
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600">
                    <Layers size={20} />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800 dark:text-white">Portfolio Redundancy</h3>
                    <p className="text-xs text-slate-500">Detecting fake diversification.</p>
                </div>
            </div>

            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                {overlaps.length === 0 ? (
                    <div className="text-center py-8 opacity-60">
                        <CheckCircle2 size={40} className="mx-auto text-emerald-500 mb-2" />
                        <p className="text-sm font-medium">No significant overlap detected.</p>
                        <p className="text-xs">Your diversification looks genuine.</p>
                    </div>
                ) : (
                    overlaps.map((ov, idx) => (
                        <div key={idx} className="bg-slate-50 dark:bg-slate-950 rounded-xl p-4 border border-slate-200 dark:border-slate-800 relative overflow-hidden group hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors">
                            {/* Progress Bar Background */}
                            <div className="absolute bottom-0 left-0 h-1 bg-indigo-500" style={{ width: `${ov.overlapPercentage * 100}%` }}></div>

                            <div className="flex justify-between items-start mb-2">
                                <div className="space-y-1">
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Fund A</p>
                                    <p className="font-bold text-slate-800 dark:text-white text-sm line-clamp-1">{ov.fundA}</p>
                                </div>
                                <div className="text-right space-y-1">
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Fund B</p>
                                    <p className="font-bold text-slate-800 dark:text-white text-sm line-clamp-1">{ov.fundB}</p>
                                </div>
                            </div>

                            <div className="mt-3 flex items-center justify-center gap-2">
                                <span className={`text-xs font-bold px-2 py-1 rounded ${ov.overlapPercentage > 0.4 ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                                    {(ov.overlapPercentage * 100).toFixed(0)}% Overlap
                                </span>
                                {ov.overlapPercentage > 0.4 && (
                                    <span className="flex items-center gap-1 text-[10px] text-rose-500 font-bold">
                                        <AlertTriangle size={10} />
                                        REDUNDANT
                                    </span>
                                )}
                            </div>

                            {ov.commonHoldings.length > 0 && (
                                <p className="text-[10px] text-slate-400 text-center mt-2">
                                    Common: {ov.commonHoldings.map(c => c.ticker).slice(0, 3).join(', ')}...
                                </p>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
