import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTransactions } from '../../../contexts/TransactionContext';
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { TrendingUp, TrendingDown, Info, ArrowUpRight, ArrowDownRight, CreditCard, ChevronRight, Plus, X, Lock, Pencil, Trash2, RefreshCw } from 'lucide-react';
import { UPITrackerWidget, CreditCardOptimizer } from '../../shared/GodTierFeatures';
import { ExpenseInsights } from '../ExpenseInsights';
import { SubscriptionTracker } from './SubscriptionTracker';
import { BudgetWidget } from './BudgetWidget';
import { RecurringPatternsWidget } from './RecurringPatternsWidget';
import { AnomaliesWidget } from './AnomaliesWidget';
import { CashFlowHeader } from './CashFlowHeader';
// Additional Widgets
import { CorpusGoalWidget } from '../../widgets/CorpusGoalWidget';
import { MonthlyBudgetSummary } from '../../widgets/MonthlyBudgetSummary';
import { SpendingLimitsWidget } from '../../widgets/SpendingLimitsWidget';
import { BillRemindersWidget } from '../../widgets/BillRemindersWidget';
import { SpendingInsightsWidget } from '../../widgets/SpendingInsightsWidget';

interface SpendingOverviewProps {
    formatCurrency: (val: number) => string;
}

interface Account {
    id: number;
    bank: string;
    type: string;
    number: string;
    bal: number;
    color: string;
    isEditing: boolean;
}

export const SpendingOverview: React.FC<SpendingOverviewProps> = ({ formatCurrency }) => {
    const { totalSpending, transactions, spendingByCategory, clearTransactions } = useTransactions();
    const [isAddAccountOpen, setIsAddAccountOpen] = useState(false);
    const [isManaging, setIsManaging] = useState(false);

    // Account Editing State
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);
    const [editForm, setEditForm] = useState({ bank: '', number: '', type: 'Savings', bal: '' });

    const [accounts, setAccounts] = useState<Account[]>([
        { id: 1, bank: 'SBI', type: 'Savings', number: 'XXXX6743', bal: 45000, color: 'bg-blue-600', isEditing: false },
        { id: 2, bank: 'ICICI', type: 'Credit Card', number: 'XXXX8901', bal: -12450, color: 'bg-orange-600', isEditing: false }
    ]);

    // Derived stats for the "Insight Feed" (horizontal scroll)
    const stats = useMemo(() => {
        const merchantMap = new Map<string, number>();
        transactions.forEach(t => {
            if (t.merchant) merchantMap.set(t.merchant, (merchantMap.get(t.merchant) || 0) + t.amount);
        });
        const topMerchant = Array.from(merchantMap.entries()).sort((a, b) => b[1] - a[1])[0];
        return { topMerchant };
    }, [transactions]);

    const handleEditAccount = (acc: Account) => {
        setEditingAccount(acc);
        setEditForm({
            bank: acc.bank,
            number: acc.number.replace('XXXX', ''),
            type: acc.type,
            bal: acc.bal.toString()
        });
        setIsAddAccountOpen(true);
    };

    const handleSaveAccount = () => {
        if (editingAccount) {
            // Update existing
            setAccounts(accounts.map(a => a.id === editingAccount.id ? {
                ...a,
                bank: editForm.bank,
                number: 'XXXX' + editForm.number, // Simple mock masking
                type: editForm.type,
                bal: parseFloat(editForm.bal) || 0
            } : a));
        } else {
            // Add new
            const newId = Math.max(...accounts.map(a => a.id), 0) + 1;
            const colors = ['bg-indigo-600', 'bg-emerald-600', 'bg-purple-600', 'bg-rose-600'];
            setAccounts([...accounts, {
                id: newId,
                bank: editForm.bank || 'New Bank',
                type: editForm.type || 'Savings',
                number: 'XXXX' + (editForm.number || '0000'),
                bal: parseFloat(editForm.bal) || 0,
                color: colors[newId % colors.length],
                isEditing: false
            }]);
        }
        setIsAddAccountOpen(false);
        setEditingAccount(null);
        setEditForm({ bank: '', number: '', type: 'Savings', bal: '' }); // Reset
    };

    const addAccountModalRef = useModalKeyboard({
        isOpen: isAddAccountOpen,
        onClose: () => setIsAddAccountOpen(false),
        onSubmit: handleSaveAccount
    });

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* 1. Cash Flow Header with Time Filters */}
            <CashFlowHeader formatCurrency={formatCurrency} />

            {/* 2. Smart Insights Feed (Fold Style Horizontal Scroll) */}
            <div className="space-y-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Info size={18} className="text-indigo-500" /> Quick Shifts
                </h3>

                <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
                    {/* Top Merchant Insight */}
                    {stats.topMerchant && (
                        <div className="min-w-[280px] bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm snap-center">
                            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 mb-3">
                                <TrendingUp size={20} />
                            </div>
                            <p className="text-slate-500 text-xs font-semibold uppercase mb-1">Top Spend</p>
                            <p className="text-slate-900 dark:text-white font-medium text-sm leading-snug">
                                You spent <span className="font-bold text-slate-900 dark:text-white">{formatCurrency(stats.topMerchant[1])}</span> on <span className="text-indigo-500">{stats.topMerchant[0]}</span> this month.
                            </p>
                        </div>
                    )}

                    {/* Category Alert */}
                    {spendingByCategory.length > 0 && (
                        <div className="min-w-[280px] bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm snap-center">
                            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 mb-3">
                                <CreditCard size={20} />
                            </div>
                            <p className="text-slate-500 text-xs font-semibold uppercase mb-1">Category Alert</p>
                            <p className="text-slate-900 dark:text-white font-medium text-sm leading-snug">
                                <span className="font-bold">{spendingByCategory[0].category}</span> is your highest expense ({Math.round(spendingByCategory[0].amount / totalSpending * 100)}%).
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* 3. Linked Accounts Management */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <CreditCard size={18} className="text-slate-400" /> Linked Accounts
                    </h3>
                    <button
                        onClick={() => { setIsManaging(!isManaging); setEditingAccount(null); }}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-500 flex items-center transition-colors"
                    >
                        {isManaging ? 'Done' : 'Manage'} <ChevronRight size={14} className={isManaging ? 'rotate-90 transition-transform' : 'transition-transform'} />
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Dynamic Accounts */}
                    {accounts.map(acc => (
                        <div key={acc.id} className={`rounded-xl p-5 text-white flex justify-between items-center shadow-lg relative group overflow-hidden ${acc.color}`}>
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-8 bg-white/20 rounded ml-1 border border-white/10 backdrop-blur-sm"></div>
                                <div>
                                    <p className="font-bold text-sm">{acc.bank}</p>
                                    <p className="text-xs text-white/70">{acc.number} • {acc.type}</p>
                                </div>
                            </div>
                            <span className="text-xs font-mono font-bold">
                                {acc.bal != null
                                    ? (acc.bal > 0 ? `₹${acc.bal.toLocaleString()}` : `-₹${Math.abs(acc.bal).toLocaleString()}`)
                                    : '₹0'
                                }
                            </span>

                            {/* Management Overlays */}
                            {isManaging && (
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center gap-3 animate-in fade-in duration-200">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleEditAccount(acc); }}
                                        className="bg-white text-indigo-600 p-2 rounded-lg shadow-lg hover:bg-slate-50 transition-colors"
                                        title="Edit Details"
                                    >
                                        <Pencil size={18} />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm('Remove this account?')) {
                                                setAccounts(prev => prev.filter(a => a.id !== acc.id));
                                            }
                                        }}
                                        className="bg-white text-rose-600 p-2 rounded-lg shadow-lg hover:bg-rose-50 transition-colors"
                                        title="Remove Account"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Add Account Button */}
                    <button
                        onClick={() => { setEditingAccount(null); setEditForm({ bank: '', number: '', type: 'Savings', bal: '' }); setIsAddAccountOpen(true); }}
                        className="bg-white dark:bg-slate-900 rounded-xl p-5 flex justify-between items-center border border-slate-200 dark:border-slate-800 border-dashed hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                    >
                        <p className="text-sm font-medium text-slate-500 group-hover:text-indigo-500 transition-colors">Add Bank Account</p>
                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/30">
                            <Plus size={16} className="text-slate-400 group-hover:text-indigo-500" />
                        </div>
                    </button>
                </div>
            </div>

            {/* 4. Top Widgets Row - Goals, Budget Summary, Spending Limits */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
                <CorpusGoalWidget formatCurrency={formatCurrency} />
                <MonthlyBudgetSummary formatCurrency={formatCurrency} />
                <SpendingLimitsWidget />
            </div>

            {/* 5. Bill Reminders & AI Insights Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <BillRemindersWidget />
                <SpendingInsightsWidget />
            </div>

            {/* 6. Integrated Widgets Grid (3-Column Layout) */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pt-4">
                {/* Column 1: Savings & Anomalies */}
                <div className="space-y-6">
                    <ExpenseInsights />
                    <AnomaliesWidget />
                </div>

                {/* Column 2: Recurring & Spending */}
                <div className="space-y-6">
                    <RecurringPatternsWidget />
                    <BudgetWidget formatCurrency={formatCurrency} />
                </div>

                {/* Column 3: Stats & Optimization */}
                <div className="space-y-6">
                    <UPITrackerWidget />
                    <CreditCardOptimizer />

                    {/* Clear Data Button (Hidden in plain sight) */}
                    <div className="pt-8 flex justify-center opacity-50 hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => { if (confirm('Are you sure you want to clear ALL transaction data? This cannot be undone.')) clearTransactions(); }}
                            className="text-xs text-rose-500 hover:text-rose-600 flex items-center gap-1 font-medium"
                        >
                            <Trash2 size={12} /> Clear All App Data
                        </button>
                    </div>
                </div>
            </div>

            {/* Add/Edit Account Modal */}
            {isAddAccountOpen && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-md z-[9999] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200" onClick={() => setIsAddAccountOpen(false)}>
                    <div ref={addAccountModalRef} className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 my-auto overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <h3 className="font-bold text-lg text-slate-900 dark:text-white font-display">
                                {editingAccount ? 'Edit Account Details' : 'Add Bank Account'}
                            </h3>
                            <button onClick={() => setIsAddAccountOpen(false)} aria-label="Close add account dialog"><X size={20} className="text-slate-400 hover:text-slate-900 dark:hover:text-white" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Bank Name</label>
                                <input
                                    type="text"
                                    value={editForm.bank}
                                    onChange={e => setEditForm({ ...editForm, bank: e.target.value })}
                                    placeholder="e.g. HDFC, SBI"
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Last 4 Digits</label>
                                    <input
                                        type="text"
                                        maxLength={4}
                                        value={editForm.number}
                                        onChange={e => setEditForm({ ...editForm, number: e.target.value })}
                                        placeholder="1234"
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Balance (₹)</label>
                                    <input
                                        type="number"
                                        value={editForm.bal}
                                        onChange={e => setEditForm({ ...editForm, bal: e.target.value })}
                                        placeholder="0.00"
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Account Type</label>
                                <select
                                    value={editForm.type}
                                    onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 text-slate-700 dark:text-slate-300"
                                >
                                    <option value="Savings">Savings Account</option>
                                    <option value="Current">Current Account</option>
                                    <option value="Credit Card">Credit Card</option>
                                    <option value="Investment">Investment Account</option>
                                </select>
                            </div>

                            <button
                                onClick={handleSaveAccount}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl mt-4 transition-all shadow-lg shadow-indigo-500/20 text-xs"
                            >
                                {editingAccount ? 'Save Changes' : 'Link Securely'}
                            </button>
                            <p className="text-center text-[10px] text-slate-400 flex items-center justify-center gap-1">
                                <Lock size={10} /> End-to-end encrypted connection
                            </p>
                        </div>
                    </div>
                </div>,
                document.body
            )}

        </div>
    );
};
