import React, { useState } from 'react';
import { Scissors, X, Plus, Trash2 } from 'lucide-react';
import { Transaction } from '../../contexts/TransactionContext';

interface SplitItem {
    id: string;
    amount: number;
    category: string;
    note: string;
}

interface SplitTransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    transaction?: Transaction;
    onSplit?: (originalId: string, splits: SplitItem[]) => void;
    formatCurrency?: (val: number) => string;
}

const CATEGORIES = [
    'Food & Dining', 'Shopping', 'Entertainment', 'Transport',
    'Bills & Utilities', 'Investment', 'Health', 'Education', 'Others'
];

export const SplitTransactionModal: React.FC<SplitTransactionModalProps> = ({
    isOpen,
    onClose,
    transaction,
    onSplit,
    formatCurrency = (v) => `₹${((v ?? 0) || 0).toLocaleString('en-IN')}`
}) => {
    const [splits, setSplits] = useState<SplitItem[]>([
        { id: '1', amount: 0, category: CATEGORIES[0], note: '' },
        { id: '2', amount: 0, category: CATEGORIES[0], note: '' }
    ]);

    if (!isOpen || !transaction) return null;

    const totalSplit = splits.reduce((sum, s) => sum + s.amount, 0);
    const remaining = (transaction?.amount || 0) - totalSplit;
    const isValid = Math.abs(remaining) < 0.01 && splits.every(s => s.amount > 0);

    const handleAddSplit = () => {
        setSplits([
            ...splits,
            { 
                id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString() + Math.random().toString(36).slice(2)), 
                amount: 0, 
                category: CATEGORIES[0], 
                note: '' 
            }
        ]);
    };

    const handleRemoveSplit = (id: string) => {
        if (splits.length > 2) {
            setSplits(splits.filter(s => s.id !== id));
        }
    };

    const handleUpdateSplit = (id: string, field: keyof SplitItem, value: string | number) => {
        setSplits(splits.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    const handleSave = () => {
        if (isValid && onSplit) {
            onSplit(transaction.id, splits);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/20 rounded-lg">
                            <Scissors size={18} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-900 dark:text-white">Split Transaction</h3>
                            <p className="text-xs text-slate-500">{transaction.description}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                        <X size={20} className="text-slate-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    {/* Original Amount */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                        <p className="text-xs text-slate-500 mb-1">Original Amount</p>
                        <p className="text-xl font-bold text-slate-900 dark:text-white">
                            {formatCurrency(transaction.amount)}
                        </p>
                    </div>

                    {/* Splits */}
                    <div className="space-y-3">
                        {splits.map((split, idx) => (
                            <div key={split.id} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-500">Split #{idx + 1}</span>
                                    {splits.length > 2 && (
                                        <button
                                            onClick={() => handleRemoveSplit(split.id)}
                                            className="p-1 text-slate-400 hover:text-rose-500"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="number"
                                        placeholder="Amount"
                                        value={split.amount || ''}
                                        onChange={(e) => handleUpdateSplit(split.id, 'amount', parseFloat(e.target.value) || 0)}
                                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                                    />
                                    <select
                                        value={split.category}
                                        onChange={(e) => handleUpdateSplit(split.id, 'category', e.target.value)}
                                        className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                                    >
                                        {CATEGORIES.map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Note (optional)"
                                    value={split.note}
                                    onChange={(e) => handleUpdateSplit(split.id, 'note', e.target.value)}
                                    className="w-full p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                                />
                            </div>
                        ))}
                    </div>

                    {/* Add More */}
                    <button
                        onClick={handleAddSplit}
                        className="w-full py-2 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-slate-500 text-sm flex items-center justify-center gap-2 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
                    >
                        <Plus size={16} /> Add Another Split
                    </button>

                    {/* Remaining */}
                    <div className={`p-3 rounded-xl ${Math.abs(remaining) < 0.01 ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-rose-50 dark:bg-rose-500/10'}`}>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-600 dark:text-slate-400">Remaining</span>
                            <span className={`font-bold ${Math.abs(remaining) < 0.01 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {formatCurrency(remaining)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                    <button
                        onClick={onClose}
                        className="flex-1 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!isValid}
                        className={`flex-1 py-2 rounded-xl font-medium ${isValid
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        Split Transaction
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SplitTransactionModal;
