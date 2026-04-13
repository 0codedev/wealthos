import React, { useState, useEffect, useCallback } from 'react';
import { ShoppingBag, Clock, TrendingUp, AlertTriangle, CheckCircle, XCircle, BarChart2 } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';

// Storage key for impulse tracking
const IMPULSE_STORAGE_KEY = 'impulse_check_history';

interface ImpulseEntry {
    id: string;
    price: number;
    decision: 'bought' | 'skipped';
    futureValue: number;
    hoursOfLife: number;
    timestamp: Date;
}

export const ImpulseCheck: React.FC = () => {
    const [price, setPrice] = useState<number | ''>('');
    const [income, setIncome] = useState<number>(100000);
    const [showResult, setShowResult] = useState(false);

    // Impulse tracking history
    const [history, setHistory] = useState<ImpulseEntry[]>(() => {
        try {
            const saved = localStorage.getItem(IMPULSE_STORAGE_KEY);
            if (saved) {
                return JSON.parse(saved).map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
            }
        } catch (e) {
            console.warn('Failed to load impulse history');
        }
        return [];
    });

    // Save history to localStorage
    useEffect(() => {
        if (history.length > 0) {
            try {
                localStorage.setItem(IMPULSE_STORAGE_KEY, JSON.stringify(history));
            } catch (e) {
                console.warn('Failed to save impulse history');
            }
        }
    }, [history]);

    // Constants
    const HOURS_PER_MONTH = 160;
    const OPPORTUNITY_RATE = 0.12;
    const YEARS = 20;

    const hourlyRate = income / HOURS_PER_MONTH;
    const hoursOfLife = typeof price === 'number' ? price / hourlyRate : 0;
    const futureValue = typeof price === 'number' ? price * Math.pow(1 + OPPORTUNITY_RATE, YEARS) : 0;

    const handleCheck = () => {
        if (!price) return;
        setShowResult(true);
    };

    const handleDecision = useCallback((decision: 'bought' | 'skipped') => {
        if (typeof price === 'number') {
            const entry: ImpulseEntry = {
                id: Date.now().toString(),
                price,
                decision,
                futureValue,
                hoursOfLife,
                timestamp: new Date()
            };
            setHistory(prev => [entry, ...prev].slice(0, 50)); // Keep last 50
        }
        setPrice('');
        setShowResult(false);
    }, [price, futureValue, hoursOfLife]);

    // Stats
    const skippedTotal = history.filter(h => h.decision === 'skipped').reduce((sum, h) => sum + h.price, 0);
    const skippedFutureValue = history.filter(h => h.decision === 'skipped').reduce((sum, h) => sum + h.futureValue, 0);
    const impulseScore = history.length > 0
        ? Math.round((history.filter(h => h.decision === 'skipped').length / history.length) * 100)
        : 0;

    return (
        <div className="flex flex-col items-center justify-center p-6 h-full bg-slate-50 dark:bg-slate-950 overflow-y-auto">
            <div className="w-full max-w-md">

                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-slate-800 dark:text-white mb-2">The Reality Check</h1>
                    <p className="text-slate-500">Before you buy, calculate the true cost.</p>
                </div>

                {!showResult ? (
                    <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 space-y-6 animate-in zoom-in-95 duration-300">
                        <div>
                            <label className="block text-sm font-medium text-slate-500 mb-2">Item Price (₹)</label>
                            <input
                                type="number"
                                value={price}
                                onChange={(e) => setPrice(Number(e.target.value))}
                                placeholder="e.g., 20000"
                                className="w-full text-center text-3xl font-bold px-4 py-4 bg-slate-100 dark:bg-slate-800 border-transparent focus:border-rose-500 focus:ring-0 rounded-2xl text-slate-900 dark:text-white transition-all input-number-no-spin"
                                autoFocus
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-500 mb-2">Monthly Income (₹)</label>
                            <input
                                type="number"
                                value={income}
                                onChange={(e) => setIncome(Number(e.target.value))}
                                className="w-full text-center px-4 py-3 bg-slate-100 dark:bg-slate-800 border-transparent focus:border-rose-500 focus:ring-0 rounded-xl text-slate-900 dark:text-white transition-all"
                            />
                        </div>

                        <button
                            onClick={handleCheck}
                            disabled={!price}
                            className="w-full py-4 bg-rose-500 hover:bg-rose-600 active:scale-95 disabled:opacity-50 disabled:active:scale-100 text-white font-bold rounded-2xl shadow-lg shadow-rose-500/30 transition-all flex items-center justify-center gap-2 text-lg"
                        >
                            <AlertTriangle size={24} />
                            Should I Buy This?
                        </button>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 space-y-8 animate-in zoom-in-95 duration-500">

                        {/* Result 1: Time */}
                        <div className="text-center">
                            <div className="w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Clock size={32} />
                            </div>
                            <h3 className="text-slate-500 font-medium uppercase tracking-wider text-xs">Cost in Life Energy</h3>
                            <p className="text-4xl font-black text-rose-600 dark:text-rose-500 mt-2">
                                {hoursOfLife.toFixed(1)} Hours
                            </p>
                            <p className="text-sm text-slate-500 mt-2">
                                You have to work <strong>{(hoursOfLife / 8).toFixed(1)} days</strong> to pay for this.
                            </p>
                        </div>

                        <div className="border-t border-slate-100 dark:border-slate-800"></div>

                        {/* Result 2: Future Wealth */}
                        <div className="text-center">
                            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <TrendingUp size={32} />
                            </div>
                            <h3 className="text-slate-500 font-medium uppercase tracking-wider text-xs">If Invested for 20 Years</h3>
                            <p className="text-4xl font-black text-indigo-600 dark:text-indigo-400 mt-2">
                                {formatCurrency(futureValue)}
                            </p>
                            <p className="text-sm text-slate-500 mt-2">
                                At 12% annual return.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-4">
                            <button
                                onClick={() => handleDecision('bought')}
                                className="py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 hover:text-white text-slate-600 dark:text-slate-300 font-bold rounded-xl transition-all flex items-center justify-center gap-2 group"
                            >
                                <ShoppingBag size={18} className="group-hover:scale-110 transition-transform" />
                                Bought It
                            </button>
                            <button
                                onClick={() => handleDecision('skipped')}
                                className="py-3 px-4 bg-emerald-50 dark:bg-emerald-900/10 hover:bg-emerald-500 hover:text-white text-emerald-600 dark:text-emerald-400 font-bold rounded-xl transition-all flex items-center justify-center gap-2 group"
                            >
                                <XCircle size={18} className="group-hover:scale-110 transition-transform" />
                                Skipped It
                            </button>
                        </div>
                        <p className="text-xs text-center text-slate-400">Your decision will be tracked.</p>
                    </div>
                )}

                {/* Impulse Stats */}
                {history.length > 0 && (
                    <div className="mt-6 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
                        <h3 className="text-sm font-bold text-slate-600 dark:text-slate-400 flex items-center gap-2 mb-3">
                            <BarChart2 size={16} /> Your Impulse Score
                        </h3>
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-2xl font-black text-emerald-600">{impulseScore}%</p>
                                <p className="text-xs text-slate-500">Willpower</p>
                            </div>
                            <div>
                                <p className="text-2xl font-black text-indigo-600">{formatCurrency(skippedTotal)}</p>
                                <p className="text-xs text-slate-500">Saved</p>
                            </div>
                            <div>
                                <p className="text-2xl font-black text-amber-600">{formatCurrency(skippedFutureValue)}</p>
                                <p className="text-xs text-slate-500">Future Value</p>
                            </div>
                        </div>
                        <p className="text-[10px] text-center text-slate-400 mt-2">{history.length} decisions tracked</p>
                    </div>
                )}
            </div>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(ImpulseCheck);
