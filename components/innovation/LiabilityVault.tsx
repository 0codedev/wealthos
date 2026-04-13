import React, { useState, useMemo, useEffect } from 'react';
import { CreditCard, BookOpen, Trash2, Plus, TrendingUp, History, Edit2 } from 'lucide-react';
import { PieChart, Pie, Cell } from 'recharts';
import { formatCurrency } from '../../utils/helpers';
import { motion, AnimatePresence } from 'framer-motion';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';

const STORAGE_KEY = 'liability-vault-data';

interface Liability {
    id: string;
    name: string;
    category: 'SUBSCRIPTION' | 'COURSE' | 'OTHER';
    amount: number;
    frequency: 'MONTHLY' | 'YEARLY' | 'ONCE';
    startDate: string;
    description: string;
}

const DEMO_ITEMS: Liability[] = [
    {
        id: '1',
        name: 'Netflix Premium',
        category: 'SUBSCRIPTION',
        amount: 649,
        frequency: 'MONTHLY',
        startDate: '2022-01-01',
        description: 'Entertainment'
    },
    {
        id: '2',
        name: 'Advanced Trading Masterclass',
        category: 'COURSE',
        amount: 45000,
        frequency: 'ONCE',
        startDate: '2023-06-15',
        description: 'Institutional trading patterns'
    }
];

export const LiabilityVault: React.FC = () => {
    const isVisible = usePageVisibility();
    const [liabilities, setLiabilities] = useState<Liability[]>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) return JSON.parse(stored);
        } catch { /* fall through */ }
        return DEMO_ITEMS;
    });

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [newLiability, setNewLiability] = useState<Partial<Liability>>({
        category: 'SUBSCRIPTION',
        frequency: 'MONTHLY',
        amount: 0,
        name: '',
        description: '',
        startDate: new Date().toISOString().split('T')[0]
    });

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(liabilities));
        } catch { /* storage full or unavailable */ }
    }, [liabilities]);

    const stats = useMemo(() => {
        const monthlyTotal = liabilities
            .filter(l => l.frequency === 'MONTHLY')
            .reduce((acc, curr) => acc + curr.amount, 0);
        
        const yearlyTotal = liabilities
            .filter(l => l.frequency === 'YEARLY')
            .reduce((acc, curr) => acc + curr.amount, 0) + (monthlyTotal * 12);

        const lifetimeSunk = liabilities.reduce((acc, curr) => {
            if (curr.frequency === 'ONCE') return acc + curr.amount;
            // Rough calculation: Months since start
            const months = Math.max(1, Math.floor((new Date().getTime() - new Date(curr.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30)));
            return acc + (curr.frequency === 'MONTHLY' ? curr.amount * months : (curr.amount / 12) * months);
        }, 0);

        return { monthlyTotal, yearlyTotal, lifetimeSunk };
    }, [liabilities]);

    const categoryData = useMemo(() => {
        const totals: Record<string, number> = { SUBSCRIPTION: 0, COURSE: 0, OTHER: 0 };
        liabilities.forEach(l => {
            const lifetime = l.frequency === 'ONCE' ? l.amount :
                l.frequency === 'MONTHLY' ? l.amount * 12 : l.amount;
            totals[l.category] = (totals[l.category] || 0) + lifetime;
        });
        return [
            { name: 'SUBSCRIPTION', value: totals.SUBSCRIPTION, color: '#6366f1' },
            { name: 'COURSE', value: totals.COURSE, color: '#10b981' },
            { name: 'OTHER', value: totals.OTHER, color: '#f59e0b' },
        ].filter(d => d.value > 0);
    }, [liabilities]);

    const handleAdd = () => {
        if (!newLiability.name || !newLiability.amount) return;
        
        if (editingId) {
            setLiabilities(liabilities.map(l => l.id === editingId ? {
                ...l,
                name: newLiability.name!,
                category: newLiability.category as any,
                amount: Number(newLiability.amount),
                frequency: newLiability.frequency as any,
                description: newLiability.description || ''
            } : l));
        } else {
            const liability: Liability = {
                id: Math.random().toString(36).substr(2, 9),
                name: newLiability.name,
                category: newLiability.category as any,
                amount: Number(newLiability.amount),
                frequency: newLiability.frequency as any,
                startDate: newLiability.startDate || new Date().toISOString().split('T')[0],
                description: newLiability.description || ''
            };
            setLiabilities([...liabilities, liability]);
        }
        
        handleCloseModal();
    };

    const handleEdit = (liability: Liability) => {
        setEditingId(liability.id);
        setNewLiability({
            name: liability.name,
            category: liability.category,
            amount: liability.amount,
            frequency: liability.frequency,
            description: liability.description,
            startDate: liability.startDate
        });
        setIsAddModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsAddModalOpen(false);
        setEditingId(null);
        setNewLiability({ category: 'SUBSCRIPTION', frequency: 'MONTHLY', amount: 0, name: '', description: '', startDate: new Date().toISOString().split('T')[0] });
    };

    const handleDelete = (id: string) => {
        setLiabilities(liabilities.filter(l => l.id !== id));
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-y-auto">
            <div className="flex justify-between items-start mb-8">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent flex items-center gap-3">
                        <History className="text-indigo-500" />
                        Sunk Cost & Liability Vault
                    </h1>
                    <p className="text-slate-600 dark:text-slate-400 mt-2">
                        Track every subscription, paid course, and recurring liability. Transparency into your lifelong financial leaks.
                    </p>
                </div>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/25"
                >
                    <Plus size={18} />
                    Log Expense
                </button>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CreditCard size={48} />
                    </div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Monthly Burn</p>
                    <p className="text-3xl font-black text-rose-500">{formatCurrency(stats.monthlyTotal)}</p>
                    <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-tighter">Automated Subscriptions</p>
                </div>
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <TrendingUp size={48} />
                    </div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Yearly Liability</p>
                    <p className="text-3xl font-black text-indigo-500">{formatCurrency(stats.yearlyTotal)}</p>
                    <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-tighter">Projected Annual Drain</p>
                </div>
                <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden group border-t-indigo-500/50">
                    <div className="absolute top-0 right-0 p-4 opacity-20">
                        <BookOpen size={48} className="text-indigo-400" />
                    </div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 text-indigo-400">Lifetime Sunk Cost</p>
                    <p className="text-3xl font-black text-white">{formatCurrency(stats.lifetimeSunk)}</p>
                    <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-tighter italic font-mono text-emerald-500/80">Total Capital Transferred</p>
                </div>
            </div>

            {/* Expense Breakdown Pie Chart */}
            {categoryData.length > 0 && (
                <div className="mb-8">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Expense Breakdown</p>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
                        <PieChart width={400} height={160}>
                            <Pie
                                data={categoryData}
                                cx="50%"
                                cy="50%"
                                innerRadius={40}
                                outerRadius={70}
                                paddingAngle={2}
                                dataKey="value"
                                label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                                isAnimationActive={isVisible}
                            >
                                {categoryData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} stroke="none" />
                                ))}
                            </Pie>
                        </PieChart>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 dark:text-slate-200">Logged Liabilities</h3>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                            SUB: {liabilities.filter(l => l.category === 'SUBSCRIPTION').length}
                        </span>
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300">
                            COURSE: {liabilities.filter(l => l.category === 'COURSE').length}
                        </span>
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            OTHER: {liabilities.filter(l => l.category === 'OTHER').length}
                        </span>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                                <th className="px-6 py-4">Item</th>
                                <th className="px-6 py-4">Type</th>
                                <th className="px-6 py-4">Amount</th>
                                <th className="px-6 py-4">Frequency</th>
                                <th className="px-6 py-4">Started</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {liabilities.map((l) => (
                                <tr key={l.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900 dark:text-white">{l.name}</div>
                                        <div className="text-[10px] text-slate-500">{l.description}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                            l.category === 'SUBSCRIPTION' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300' :
                                            l.category === 'COURSE' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300' :
                                            'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                                        }`}>
                                            {l.category}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 font-mono font-bold text-slate-900 dark:text-white">
                                        {formatCurrency(l.amount)}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-tighter">
                                            {l.frequency}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-xs font-mono text-slate-500">
                                        {new Date(l.startDate).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 text-right flex items-center justify-end gap-1">
                                        <button 
                                            onClick={() => handleEdit(l)}
                                            className="p-2 text-slate-400 hover:text-indigo-500 transition-colors"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button 
                                            onClick={() => handleDelete(l.id)}
                                            className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {liabilities.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic text-sm font-medium">
                                        No liabilities logged. Add your first subscription or course.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add Modal */}
            <AnimatePresence>
                {isAddModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                            onClick={handleCloseModal}
                        />
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 20 }}
                            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                        >
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">{editingId ? 'Update Liability' : 'Log Lifetime Liability'}</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Item Name</label>
                                        <input
                                            type="text"
                                            value={newLiability.name}
                                            onChange={(e) => setNewLiability({ ...newLiability, name: e.target.value })}
                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/50"
                                            placeholder="e.g. Netflix, Trading Course"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Category</label>
                                            <select
                                                value={newLiability.category}
                                                onChange={(e) => setNewLiability({ ...newLiability, category: e.target.value as any })}
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/50"
                                            >
                                                <option value="SUBSCRIPTION">Subscription</option>
                                                <option value="COURSE">Paid Course</option>
                                                <option value="OTHER">Other Expense</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Frequency</label>
                                            <select
                                                value={newLiability.frequency}
                                                onChange={(e) => setNewLiability({ ...newLiability, frequency: e.target.value as any })}
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/50"
                                            >
                                                <option value="MONTHLY">Monthly</option>
                                                <option value="YEARLY">Yearly</option>
                                                <option value="ONCE">One-time</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Amount</label>
                                        <input
                                            type="number"
                                            value={newLiability.amount}
                                            onChange={(e) => setNewLiability({ ...newLiability, amount: Number(e.target.value) })}
                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 font-mono font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Start Date</label>
                                        <input
                                            type="date"
                                            value={newLiability.startDate || new Date().toISOString().split('T')[0]}
                                            onChange={(e) => setNewLiability({ ...newLiability, startDate: e.target.value })}
                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/50"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Description (Optional)</label>
                                        <textarea
                                            value={newLiability.description}
                                            onChange={(e) => setNewLiability({ ...newLiability, description: e.target.value })}
                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/50 h-20 resize-none"
                                            placeholder="What is this for?"
                                        />
                                    </div>
                                </div>
                                <div className="mt-6 flex gap-3">
                                    <button
                                        onClick={handleCloseModal}
                                        className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-800 rounded-xl font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleAdd}
                                        className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/25 transition-all"
                                    >
                                        {editingId ? 'Save Changes' : 'Add to Vault'}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default LiabilityVault;
