import React, { useState } from 'react';
import { AlertCircle, Plus, X, Bell, Trash2 } from 'lucide-react';

interface SpendingLimit {
    id: string;
    category: string;
    limit: number;
    spent: number;
}

interface SpendingLimitsWidgetProps {
    formatCurrency?: (val: number) => string;
}

const CATEGORIES = [
    'Food & Dining', 'Shopping', 'Entertainment', 'Transport',
    'Bills & Utilities', 'Investment', 'Health', 'Education', 'Others'
];

export const SpendingLimitsWidget: React.FC<SpendingLimitsWidgetProps> = ({
    formatCurrency = (v) => `₹${v.toLocaleString('en-IN')}`
}) => {
    const [limits, setLimits] = useState<SpendingLimit[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [newLimit, setNewLimit] = useState({ category: CATEGORIES[0], limit: '' });

    const handleAddLimit = () => {
        if (newLimit.limit && parseFloat(newLimit.limit) > 0) {
            setLimits([
                ...limits,
                {
                    id: crypto.randomUUID(),
                    category: newLimit.category,
                    limit: parseFloat(newLimit.limit),
                    spent: 0
                }
            ]);
            setNewLimit({ category: CATEGORIES[0], limit: '' });
            setIsAdding(false);
        }
    };

    const handleDelete = (id: string) => {
        setLimits(limits.filter(l => l.id !== id));
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-amber-100 dark:bg-amber-500/20 rounded-lg">
                        <AlertCircle size={18} className="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">Spending Limits</h3>
                        <p className="text-xs text-slate-500">Get alerts before overspending</p>
                    </div>
                </div>
                <button
                    type="button"
                    aria-label="Add a new spending limit"
                    onClick={() => setIsAdding(true)}
                    className="p-2 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-500/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                >
                    <Plus size={16} />
                </button>
            </div>

            {/* Add New Limit Form */}
            {isAdding && (
                <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-3">
                    <select
                        value={newLimit.category}
                        onChange={(e) => setNewLimit({ ...newLimit, category: e.target.value })}
                        className="w-full p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    >
                        {CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        placeholder="Monthly limit (₹)"
                        value={newLimit.limit}
                        onChange={(e) => setNewLimit({ ...newLimit, limit: e.target.value })}
                        className="w-full p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    />
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleAddLimit}
                            className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                        >
                            Add Limit
                        </button>
                        <button
                            type="button"
                            aria-label="Cancel adding limit"
                            onClick={() => setIsAdding(false)}
                            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Limits List */}
            {limits.length === 0 ? (
                <div className="text-center py-8">
                    <Bell size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500">No spending limits set</p>
                    <p className="text-xs text-slate-400">Add limits to stay on budget</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {limits.map(limit => {
                        const percent = (limit.spent / limit.limit) * 100;
                        const isOver = percent >= 100;
                        const isWarning = percent >= 80;

                        return (
                            <div key={limit.id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                                        {limit.category}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs font-bold ${isOver ? 'text-rose-500' : isWarning ? 'text-amber-500' : 'text-slate-500'}`}>
                                            {formatCurrency(limit.spent)} / {formatCurrency(limit.limit)}
                                        </span>
                                        <button
                                            type="button"
                                            aria-label={`Delete limit for ${limit.category}`}
                                            onClick={() => handleDelete(limit.id)}
                                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60 rounded"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                                <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all ${isOver ? 'bg-rose-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${Math.min(100, percent)}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default SpendingLimitsWidget;
