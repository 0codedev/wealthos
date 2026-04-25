import React, { useState } from 'react';
import { Settings, Plus, X, Trash2, Tag, ArrowRight } from 'lucide-react';
import { useCategoryRulesStore } from '../../store/categoryRulesStore';

interface CategoryRulesManagerProps {
    formatCurrency?: (val: number) => string;
}

const CATEGORIES = [
    'Food & Dining', 'Shopping', 'Entertainment', 'Transport',
    'Bills & Utilities', 'Investment', 'Health', 'Education',
    'Transfer', 'Earnings', 'Others'
];

export const CategoryRulesManager: React.FC<CategoryRulesManagerProps> = () => {
    const { rules, addRule, removeRule } = useCategoryRulesStore();
    const [isAdding, setIsAdding] = useState(false);
    const [newRule, setNewRule] = useState({ keyword: '', category: CATEGORIES[0] });

    const handleAddRule = () => {
        if (newRule.keyword.trim()) {
            addRule({
                pattern: newRule.keyword.toLowerCase().trim(),
                category: newRule.category,
                type: 'contains'
            });
            setNewRule({ keyword: '', category: CATEGORIES[0] });
            setIsAdding(false);
        }
    };

    const handleDeleteRule = (id: string) => {
        removeRule(id);
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-100 dark:bg-purple-500/20 rounded-lg">
                        <Settings size={18} className="text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">Category Rules</h3>
                        <p className="text-xs text-slate-500">Auto-categorize transactions by keyword</p>
                    </div>
                </div>
                <button
                    onClick={() => setIsAdding(true)}
                    className="p-2 bg-purple-100 dark:bg-purple-500/20 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-200 transition-colors"
                >
                    <Plus size={16} />
                </button>
            </div>

            {/* Add New Rule Form */}
            {isAdding && (
                <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-3">
                    <input
                        type="text"
                        placeholder="Keyword (e.g., 'amazon', 'spotify')"
                        value={newRule.keyword}
                        onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })}
                        className="w-full p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    />
                    <select
                        value={newRule.category}
                        onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}
                        className="w-full p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    >
                        {CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                    <div className="flex gap-2">
                        <button
                            onClick={handleAddRule}
                            className="flex-1 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
                        >
                            Add Rule
                        </button>
                        <button
                            onClick={() => setIsAdding(false)}
                            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Rules List */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {(rules || []).map(rule => (
                    <div
                        key={rule.id}
                        className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-xl group"
                    >
                        <div className="flex items-center gap-3">
                            <Tag size={14} className="text-slate-400" />
                            <span className="text-sm font-mono text-slate-700 dark:text-slate-300">
                                "{rule.pattern}"
                            </span>
                            <ArrowRight size={14} className="text-slate-400" />
                            <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                                {rule.category}
                            </span>
                        </div>
                        <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="p-1 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>

            {(rules?.length ?? 0) === 0 && (
                <div className="text-center py-8 text-slate-500">
                    <Tag size={32} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm">No rules yet</p>
                    <p className="text-xs text-slate-400">Add keywords to auto-categorize transactions</p>
                </div>
            )}
        </div>
    );
};

export default CategoryRulesManager;
