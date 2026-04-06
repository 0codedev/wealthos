import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Wallet, Target, Plus, Edit2, Trash2, Check, X, TrendingUp, TrendingDown,
    AlertTriangle, PiggyBank, ShoppingBag, Home, Car, Utensils, Zap, Film,
    Phone, Heart, GraduationCap, Plane
} from 'lucide-react';

interface BudgetCategory {
    id: string;
    name: string;
    icon: React.ReactNode;
    budgeted: number;
    spent: number;
    color: string;
}

interface BudgetManagerProps {
    formatCurrency?: (val: number) => string;
}

// Default budget categories
const DEFAULT_CATEGORIES: BudgetCategory[] = [
    { id: '1', name: 'Housing', icon: <Home size={14} />, budgeted: 25000, spent: 24000, color: 'indigo' },
    { id: '2', name: 'Food & Dining', icon: <Utensils size={14} />, budgeted: 12000, spent: 14500, color: 'amber' },
    { id: '3', name: 'Transportation', icon: <Car size={14} />, budgeted: 8000, spent: 6200, color: 'emerald' },
    { id: '4', name: 'Utilities', icon: <Zap size={14} />, budgeted: 5000, spent: 4800, color: 'blue' },
    { id: '5', name: 'Shopping', icon: <ShoppingBag size={14} />, budgeted: 10000, spent: 12000, color: 'rose' },
    { id: '6', name: 'Entertainment', icon: <Film size={14} />, budgeted: 5000, spent: 3500, color: 'purple' },
    { id: '7', name: 'Healthcare', icon: <Heart size={14} />, budgeted: 3000, spent: 1500, color: 'pink' },
    { id: '8', name: 'Education', icon: <GraduationCap size={14} />, budgeted: 5000, spent: 5000, color: 'cyan' },
];

const CATEGORY_ICONS = [
    { icon: <Home size={14} />, name: 'Home' },
    { icon: <Utensils size={14} />, name: 'Utensils' },
    { icon: <Car size={14} />, name: 'Car' },
    { icon: <Zap size={14} />, name: 'Zap' },
    { icon: <ShoppingBag size={14} />, name: 'ShoppingBag' },
    { icon: <Film size={14} />, name: 'Film' },
    { icon: <Heart size={14} />, name: 'Heart' },
    { icon: <GraduationCap size={14} />, name: 'GraduationCap' },
    { icon: <Plane size={14} />, name: 'Plane' },
    { icon: <Phone size={14} />, name: 'Phone' },
];

const BudgetManager: React.FC<BudgetManagerProps> = ({ formatCurrency = (v) => `₹${v.toLocaleString()}` }) => {
    const [categories, setCategories] = useState<BudgetCategory[]>(DEFAULT_CATEGORIES);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBudget, setEditBudget] = useState<number>(0);
    const [showAddCategory, setShowAddCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategoryBudget, setNewCategoryBudget] = useState<number>(5000);

    const summary = useMemo(() => {
        const totalBudgeted = categories.reduce((acc, cat) => acc + cat.budgeted, 0);
        const totalSpent = categories.reduce((acc, cat) => acc + cat.spent, 0);
        const overBudget = categories.filter(cat => cat.spent > cat.budgeted);
        const underBudget = categories.filter(cat => cat.spent <= cat.budgeted);

        return { totalBudgeted, totalSpent, overBudget, underBudget };
    }, [categories]);

    const handleStartEdit = (cat: BudgetCategory) => {
        setEditingId(cat.id);
        setEditBudget(cat.budgeted);
    };

    const handleSaveEdit = (id: string) => {
        setCategories(prev => prev.map(cat =>
            cat.id === id ? { ...cat, budgeted: editBudget } : cat
        ));
        setEditingId(null);
    };

    const handleDelete = (id: string) => {
        setCategories(prev => prev.filter(cat => cat.id !== id));
    };

    const handleAddCategory = () => {
        if (!newCategoryName.trim()) return;

        const newCategory: BudgetCategory = {
            id: Date.now().toString(),
            name: newCategoryName.trim(),
            icon: <PiggyBank size={14} />,
            budgeted: newCategoryBudget,
            spent: 0,
            color: ['emerald', 'amber', 'rose', 'blue', 'purple'][Math.floor(Math.random() * 5)]
        };

        setCategories(prev => [...prev, newCategory]);
        setNewCategoryName('');
        setNewCategoryBudget(5000);
        setShowAddCategory(false);
    };

    const getSpentPercentage = (spent: number, budgeted: number) => {
        return Math.min(100, (spent / budgeted) * 100);
    };

    const getStatusColor = (spent: number, budgeted: number) => {
        const ratio = spent / budgeted;
        if (ratio > 1) return 'rose';
        if (ratio > 0.8) return 'amber';
        return 'emerald';
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 via-emerald-950/20 to-slate-900 rounded-3xl border border-emerald-500/20 p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/30">
                        <Wallet size={24} className="text-white" />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-white flex items-center gap-2">
                            Budget Manager
                            <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">LIVE</span>
                        </h3>
                        <p className="text-xs text-emerald-300/60">Track monthly spending limits</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowAddCategory(!showAddCategory)}
                    className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl hover:bg-emerald-500/30 transition-colors"
                >
                    <Plus size={18} />
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Budgeted</p>
                    <p className="text-lg font-black text-white font-mono">{formatCurrency(summary.totalBudgeted)}</p>
                </div>
                <div className={`rounded-xl p-3 border ${summary.totalSpent > summary.totalBudgeted
                        ? 'bg-rose-500/10 border-rose-500/20'
                        : 'bg-emerald-500/10 border-emerald-500/20'
                    }`}>
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Spent</p>
                    <p className={`text-lg font-black font-mono ${summary.totalSpent > summary.totalBudgeted ? 'text-rose-400' : 'text-emerald-400'
                        }`}>
                        {formatCurrency(summary.totalSpent)}
                    </p>
                </div>
                <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Remaining</p>
                    <p className={`text-lg font-black font-mono ${summary.totalBudgeted - summary.totalSpent < 0 ? 'text-rose-400' : 'text-blue-400'
                        }`}>
                        {formatCurrency(summary.totalBudgeted - summary.totalSpent)}
                    </p>
                </div>
            </div>

            {/* Add Category Form */}
            <AnimatePresence>
                {showAddCategory && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mb-4 overflow-hidden"
                    >
                        <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                            <h4 className="text-xs font-bold text-slate-400 mb-3">Add New Category</h4>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Category name"
                                    value={newCategoryName}
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none"
                                />
                                <input
                                    type="number"
                                    placeholder="Budget"
                                    value={newCategoryBudget}
                                    onChange={(e) => setNewCategoryBudget(Number(e.target.value))}
                                    className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:border-emerald-500 outline-none"
                                />
                                <button
                                    onClick={handleAddCategory}
                                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"
                                >
                                    <Check size={16} />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Categories List */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {categories.map((cat) => {
                    const percentage = getSpentPercentage(cat.spent, cat.budgeted);
                    const statusColor = getStatusColor(cat.spent, cat.budgeted);
                    const isEditing = editingId === cat.id;

                    return (
                        <motion.div
                            key={cat.id}
                            layout
                            className={`bg-slate-800/30 rounded-xl p-4 border transition-all ${cat.spent > cat.budgeted
                                    ? 'border-rose-500/30'
                                    : 'border-slate-700/50'
                                }`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <div className={`w-8 h-8 rounded-lg bg-${cat.color}-500/20 flex items-center justify-center text-${cat.color}-400`}>
                                        {cat.icon}
                                    </div>
                                    <span className="text-sm font-semibold text-white">{cat.name}</span>
                                    {cat.spent > cat.budgeted && (
                                        <AlertTriangle size={12} className="text-rose-400" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {isEditing ? (
                                        <>
                                            <input
                                                type="number"
                                                value={editBudget}
                                                onChange={(e) => setEditBudget(Number(e.target.value))}
                                                className="w-24 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-xs"
                                                autoFocus
                                            />
                                            <button onClick={() => handleSaveEdit(cat.id)} className="p-1 text-emerald-400 hover:bg-emerald-500/20 rounded">
                                                <Check size={14} />
                                            </button>
                                            <button onClick={() => setEditingId(null)} aria-label="Cancel edit" className="p-1 text-slate-400 hover:bg-slate-700 rounded">
                                                <X size={14} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button onClick={() => handleStartEdit(cat)} className="p-1 text-slate-500 hover:text-white hover:bg-slate-700 rounded transition-colors">
                                                <Edit2 size={12} />
                                            </button>
                                            <button onClick={() => handleDelete(cat.id)} className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/20 rounded transition-colors">
                                                <Trash2 size={12} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Progress bar */}
                            <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${percentage}%` }}
                                    transition={{ duration: 0.5, ease: "easeOut" }}
                                    className={`h-full rounded-full bg-gradient-to-r ${statusColor === 'rose'
                                            ? 'from-rose-500 to-rose-400'
                                            : statusColor === 'amber'
                                                ? 'from-amber-500 to-amber-400'
                                                : 'from-emerald-500 to-emerald-400'
                                        }`}
                                />
                            </div>

                            {/* Values */}
                            <div className="flex items-center justify-between text-xs">
                                <span className={`font-mono font-bold text-${statusColor}-400`}>
                                    {formatCurrency(cat.spent)}
                                </span>
                                <span className="text-slate-500">
                                    of {formatCurrency(cat.budgeted)}
                                </span>
                                <span className={`font-bold ${cat.budgeted - cat.spent < 0 ? 'text-rose-400' : 'text-slate-400'
                                    }`}>
                                    {cat.budgeted - cat.spent < 0 ? '-' : ''}{formatCurrency(Math.abs(cat.budgeted - cat.spent))} left
                                </span>
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* Insights */}
            <div className="mt-4 p-4 bg-slate-800/30 rounded-xl border border-slate-700/50">
                <div className="flex items-center gap-2 mb-2">
                    <Target size={14} className="text-amber-400" />
                    <span className="text-xs font-bold text-slate-400">INSIGHTS</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="flex items-center gap-2">
                        <TrendingUp size={12} className="text-emerald-400" />
                        <span className="text-slate-300">{summary.underBudget.length} categories on track</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <TrendingDown size={12} className="text-rose-400" />
                        <span className="text-slate-300">{summary.overBudget.length} over budget</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BudgetManager;
