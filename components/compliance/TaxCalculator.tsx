import React from 'react';
import { Calculator, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';

interface TaxCalculatorProps {
    realizedLTCG: number;
    ltcgLimit: number;
    taxableExcess: number;
    saveTax: () => void;
    isEditing: boolean;
    setIsEditing: (val: boolean) => void;
    tempVal: string;
    setTempVal: (val: string) => void;
}

export const TaxCalculator: React.FC<TaxCalculatorProps> = React.memo(({
    realizedLTCG, ltcgLimit, taxableExcess, saveTax, isEditing, setIsEditing, tempVal, setTempVal
}) => {
    return (
        <div className="lg:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <Calculator size={18} className="text-indigo-500" /> LTCG Exemption
                    </h3>
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-slate-500">
                        Limit: {formatCurrency(ltcgLimit)}
                    </span>
                </div>

                <div className="relative pt-2 pb-6">
                    <div className="flex justify-between text-xs font-bold mb-2">
                        <span className="text-slate-500">Used</span>
                        <span className={`${realizedLTCG > ltcgLimit ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {Math.min((realizedLTCG / ltcgLimit) * 100, 100).toFixed(0)}%
                        </span>
                    </div>
                    <div className="w-full h-4 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all duration-1000 ${realizedLTCG > ltcgLimit ? 'bg-rose-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-600'}`}
                            style={{ width: `${Math.min((realizedLTCG / ltcgLimit) * 100, 100)}%` }}
                        ></div>
                    </div>
                    {realizedLTCG > ltcgLimit ? (
                        <p className="text-[10px] text-rose-500 mt-2 font-medium flex items-center gap-1">
                            <AlertTriangle size={12} /> Taxable Excess: {formatCurrency(taxableExcess)}
                        </p>
                    ) : (
                        <p className="text-[10px] text-emerald-500 mt-2 font-medium flex items-center gap-1">
                            <CheckCircle2 size={12} /> {formatCurrency(ltcgLimit - realizedLTCG)} remaining tax-free.
                        </p>
                    )}
                </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Realized Gains (Manual)</p>
                {isEditing ? (
                    <div className="flex gap-2">
                        <input
                            type="number"
                            value={tempVal}
                            onChange={(e) => setTempVal(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-indigo-500 rounded px-2 py-1 text-sm outline-none"
                            autoFocus
                        />
                        <button onClick={saveTax} className="bg-indigo-600 text-white px-3 rounded text-xs font-bold">Save</button>
                    </div>
                ) : (
                    <div className="flex justify-between items-center group cursor-pointer" onClick={() => setIsEditing(true)}>
                        <span className="text-xl font-mono font-bold text-slate-900 dark:text-white border-b border-dashed border-slate-300 dark:border-slate-700">
                            {formatCurrency(realizedLTCG)}
                        </span>
                        <div className="p-1.5 bg-white dark:bg-slate-800 rounded text-slate-400 group-hover:text-indigo-500 transition-colors">
                            <RefreshCw size={14} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

TaxCalculator.displayName = 'TaxCalculator';
