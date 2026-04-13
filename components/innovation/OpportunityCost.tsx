import React, { useState } from 'react';
import { Calculator, Calendar, ArrowRight, TrendingUp, DollarSign, Smartphone, Car, Coffee, AlertCircle } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';

// Approximate Historical Price Data (Normalized or CAGR based)
// Ideally this would come from an API
interface AssetHistory {
    id: string;
    name: string;
    cagr: number; // Average annualized return
    color: string;
}

const COMPARASION_ASSETS: AssetHistory[] = [
    { id: 'nifty', name: 'Nifty 50', cagr: 0.12, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
    { id: 'gold', name: 'Gold', cagr: 0.09, color: 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30' },
    { id: 'bitcoin', name: 'Bitcoin', cagr: 0.50, color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30' }, // Very rough avg since 2015
    { id: 'fd', name: 'Fixed Deposit', cagr: 0.06, color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30' },
];

const PRESETS = [
    { name: 'iPhone X', cost: 89000, year: 2017, icon: Smartphone },
    { name: 'Royal Enfield', cost: 150000, year: 2015, icon: Car },
    { name: 'Starbucks Daily', cost: 300 * 365, year: 2020, icon: Coffee }, // Annual cost
];

export const OpportunityCost: React.FC = () => {
    const [itemName, setItemName] = useState('');
    const [cost, setCost] = useState<number | ''>('');
    const [purchaseYear, setPurchaseYear] = useState<number>(new Date().getFullYear() - 1);

    const currentYear = new Date().getFullYear();
    const yearsElapsed = currentYear - purchaseYear;

    const calculateValue = (cagr: number) => {
        if (typeof cost !== 'number') return 0;
        return cost * Math.pow(1 + cagr, yearsElapsed);
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
            <div className="mb-8 text-center max-w-2xl mx-auto">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent flex items-center justify-center gap-3">
                    <HistoryIcon />
                    Opportunity Cost Engine
                </h1>
                <p className="text-slate-600 dark:text-slate-400 mt-2 text-lg">
                    "The most expensive things in life are the investments you didn't make."
                </p>
            </div>

            <div className="max-w-4xl mx-auto w-full grid grid-cols-1 md:grid-cols-2 gap-8">

                {/* Input Card */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-800">
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-6 flex items-center gap-2">
                        <Calculator className="text-violet-500" />
                        What did you buy?
                    </h3>

                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-500 mb-2">Item Name</label>
                            <input
                                type="text"
                                value={itemName}
                                onChange={(e) => setItemName(e.target.value)}
                                placeholder="e.g., Gaming Laptop"
                                className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border-transparent focus:border-violet-500 focus:ring-0 rounded-xl text-slate-900 dark:text-white transition-all"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-500 mb-2">Cost (₹)</label>
                                <input
                                    type="number"
                                    value={cost}
                                    onChange={(e) => setCost(Number(e.target.value))}
                                    placeholder="50000"
                                    className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border-transparent focus:border-violet-500 focus:ring-0 rounded-xl text-slate-900 dark:text-white transition-all input-number-no-spin"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-500 mb-2">Year Bought</label>
                                <select
                                    value={purchaseYear}
                                    onChange={(e) => setPurchaseYear(Number(e.target.value))}
                                    className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border-transparent focus:border-violet-500 focus:ring-0 rounded-xl text-slate-900 dark:text-white transition-all"
                                >
                                    {Array.from({ length: 20 }, (_, i) => currentYear - i).map(year => (
                                        <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Popular Regrets</p>
                        <div className="flex flex-wrap gap-2">
                            {PRESETS.map(p => (
                                <button
                                    key={p.name}
                                    onClick={() => {
                                        setItemName(p.name);
                                        setCost(p.cost);
                                        setPurchaseYear(p.year);
                                    }}
                                    className="px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-violet-50 dark:hover:bg-violet-900/20 text-slate-600 dark:text-slate-300 rounded-lg text-sm flex items-center gap-2 transition-colors"
                                >
                                    <p.icon size={14} />
                                    {p.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Results Card */}
                <div className="space-y-4">
                    <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200 dark:border-slate-800/50 text-center">
                        <p className="text-slate-500 text-sm">You spent</p>
                        <p className="text-3xl font-bold text-slate-800 dark:text-white my-1">{formatCurrency(Number(cost) || 0)}</p>
                        <p className="text-slate-500 text-sm">in {purchaseYear} ({yearsElapsed} years ago)</p>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center justify-center -z-10">
                            <div className="w-0.5 h-full bg-slate-200 dark:bg-slate-800"></div>
                        </div>

                        <div className="flex items-center justify-center my-4">
                            <span className="bg-slate-50 dark:bg-slate-950 px-2 text-xs text-slate-400 font-mono">VS</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {COMPARASION_ASSETS.map(asset => {
                            const value = calculateValue(asset.cagr);
                            const multiple = Number(cost) > 0 ? (value / Number(cost)).toFixed(1) : '0.0';

                            return (
                                <div key={asset.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/50 p-4 rounded-xl flex items-center justify-between shadow-sm hover:shadow-md transition-all transform hover:-translate-y-0.5">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${asset.color}`}>
                                            {asset.name[0]}
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-800 dark:text-slate-100">{asset.name}</p>
                                            <p className="text-xs text-slate-500">~{(asset.cagr * 100).toFixed(0)}% CAGR</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-mono font-bold text-lg text-slate-800 dark:text-emerald-400">
                                            {formatCurrency(value)}
                                        </p>
                                        <div className="flex items-center justify-end gap-1 text-xs text-slate-500">
                                            <span>{multiple}x</span>
                                            {Number(multiple) > 1 && <TrendingUp size={12} className="text-emerald-500" />}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>

            <div className="mt-8 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-full text-xs font-medium">
                    <AlertCircle size={14} />
                    <span>Past performance does not guarantee future results. Don't be too hard on yourself!</span>
                </div>
            </div>
        </div>
    );
};

const HistoryIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <path d="M12 7v5l4 2" />
    </svg>
);

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(OpportunityCost);
