
import React, { useState, useEffect, useMemo } from 'react';
import { db, Dividend } from '../database';
import { Plus, Trash2, AlertTriangle, TrendingUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../utils/helpers';
import { useFiscalYear } from '../hooks/useFiscalYear';

const DividendTracker: React.FC = () => {
    const [dividends, setDividends] = useState<Dividend[]>([]);
    const [formData, setFormData] = useState<Partial<Dividend>>({
        date: new Date().toISOString().split('T')[0],
        credited: true
    });

    // Use Central Fiscal Engine Hook
    const { startDate, endDate, label, prevYear, nextYear, offset } = useFiscalYear();

    // Load Data
    useEffect(() => {
        loadDividends();
    }, []);

    const loadDividends = async () => {
        const data = await db.dividends.orderBy('date').reverse().toArray();
        setDividends(data);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.ticker || !formData.amount) return;

        await db.dividends.add(formData as Dividend);
        setFormData({ date: new Date().toISOString().split('T')[0], ticker: '', amount: 0, credited: true });
        loadDividends();
    };

    const handleDelete = async (id?: number) => {
        if (id) {
            await db.dividends.delete(id);
            loadDividends();
        }
    };

    // Filter Dividends based on hook's dates
    const filteredDividends = useMemo(() => {
        return dividends.filter(d => {
            const dDate = new Date(d.date);
            return dDate >= startDate && dDate <= endDate;
        });
    }, [dividends, startDate, endDate]);

    const fyTotal = filteredDividends.reduce((acc, curr) => acc + curr.amount, 0);

    const isTaxAlert = fyTotal > 5000;

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <TrendingUp size={20} className="text-emerald-600 dark:text-emerald-500" /> Dividend Ledger
                </h3>

                {/* FY Toggler linked to Hook */}
                <div className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-1 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    <button
                        onClick={prevYear}
                        className="p-1 hover:bg-emerald-200 dark:hover:bg-emerald-800/50 rounded transition-colors"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs font-bold px-1 min-w-[60px] text-center select-none">
                        {label}
                    </span>
                    <button
                        onClick={nextYear}
                        disabled={offset >= 0}
                        className={`p-1 rounded transition-colors ${offset >= 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-emerald-200 dark:hover:bg-emerald-800/50'}`}
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Form */}
                <div className="md:col-span-1 space-y-4">
                    <form onSubmit={handleSubmit} className="space-y-3 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase">Ticker</label>
                            <input
                                type="text"
                                value={formData.ticker || ''}
                                onChange={e => setFormData({ ...formData, ticker: e.target.value.toUpperCase() })}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm outline-none"
                                placeholder="ITC"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase">Amount (₹)</label>
                            <input
                                type="number"
                                value={formData.amount || ''}
                                onChange={e => setFormData({ ...formData, amount: parseFloat(e.target.value) })}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm outline-none"
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase">Date</label>
                            <input
                                type="date"
                                value={formData.date}
                                onChange={e => setFormData({ ...formData, date: e.target.value })}
                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-2 text-sm outline-none"
                            />
                        </div>
                        <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                            <Plus size={16} /> Log Dividend
                        </button>
                    </form>

                    {/* Total Card */}
                    <div className={`p-4 rounded-xl border ${isTaxAlert ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800'}`}>
                        <p className="text-xs text-slate-500 uppercase font-bold">Total Income ({label})</p>
                        <p className="text-2xl font-mono font-bold text-slate-900 dark:text-white mt-1">{formatCurrency(fyTotal)}</p>
                        {isTaxAlert && (
                            <div className="mt-2 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                <span>Limit Exceeded ({'>'}₹5k). Amount added to income slab. TDS might apply.</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* List */}
                <div className="md:col-span-2">
                    <div className="max-h-72 overflow-y-auto pr-2 space-y-2">
                        {filteredDividends.length === 0 ? (
                            <p className="text-center text-slate-400 text-sm py-10 italic">
                                No dividends recorded for {label}.
                            </p>
                        ) : (
                            filteredDividends.map(d => (
                                <div key={d.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-100 dark:border-slate-800 group">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded">
                                            <TrendingUp size={16} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-800 dark:text-white">{d.ticker}</p>
                                            <p className="text-xs text-slate-500">{d.date}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(d.amount)}</span>
                                        <button onClick={() => handleDelete(d.id)} className="text-slate-300 hover:text-rose-500 transition-colors">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DividendTracker;
