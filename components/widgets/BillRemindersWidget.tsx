import React, { useState } from 'react';
import { Bell, Plus, X, Calendar, Trash2, Check, AlertTriangle } from 'lucide-react';

interface BillReminder {
    id: string;
    name: string;
    amount: number;
    dueDate: string;
    recurring: boolean;
    frequency: 'monthly' | 'quarterly' | 'yearly';
    paid: boolean;
}

interface BillRemindersWidgetProps {
    formatCurrency?: (val: number) => string;
}

export const BillRemindersWidget: React.FC<BillRemindersWidgetProps> = ({
    formatCurrency = (v) => `₹${v.toLocaleString('en-IN')}`
}) => {
    const [bills, setBills] = useState<BillReminder[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [newBill, setNewBill] = useState({
        name: '',
        amount: '',
        dueDate: '',
        recurring: true,
        frequency: 'monthly' as const
    });

    const handleAddBill = () => {
        if (newBill.name && newBill.amount && newBill.dueDate) {
            setBills([
                ...bills,
                {
                    id: crypto.randomUUID(),
                    name: newBill.name,
                    amount: parseFloat(newBill.amount),
                    dueDate: newBill.dueDate,
                    recurring: newBill.recurring,
                    frequency: newBill.frequency,
                    paid: false
                }
            ]);
            setNewBill({ name: '', amount: '', dueDate: '', recurring: true, frequency: 'monthly' });
            setIsAdding(false);
        }
    };

    const togglePaid = (id: string) => {
        setBills(bills.map(b => b.id === id ? { ...b, paid: !b.paid } : b));
    };

    const deleteBill = (id: string) => {
        setBills(bills.filter(b => b.id !== id));
    };

    const totalBills = bills.length;
    const overdueBills = bills.filter(b => !b.paid && new Date(b.dueDate) < new Date()).length;
    const monthlyTotal = bills.filter(b => !b.paid).reduce((sum, b) => sum + b.amount, 0);

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-rose-100 dark:bg-rose-500/20 rounded-lg">
                        <Bell size={18} className="text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 dark:text-white">Bill Reminders</h3>
                        <p className="text-xs text-slate-500">Never miss a payment</p>
                    </div>
                </div>
                <button
                    type="button"
                    aria-label="Add a new bill reminder"
                    onClick={() => setIsAdding(true)}
                    className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-medium flex items-center gap-1 hover:bg-emerald-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                    <Plus size={14} /> Add Bill
                </button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center">
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{totalBills}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Total Bills</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center">
                    <p className={`text-lg font-bold ${overdueBills > 0 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                        {overdueBills}
                    </p>
                    <p className="text-[10px] text-slate-500 uppercase">Overdue</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center">
                    <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(monthlyTotal)}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Monthly Total</p>
                </div>
            </div>

            {/* Add Bill Form */}
            {isAdding && (
                <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-xl space-y-3">
                    <input
                        type="text"
                        placeholder="Bill name (e.g., Netflix)"
                        value={newBill.name}
                        onChange={(e) => setNewBill({ ...newBill, name: e.target.value })}
                        className="w-full p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <input
                            type="number"
                            placeholder="Amount (₹)"
                            value={newBill.amount}
                            onChange={(e) => setNewBill({ ...newBill, amount: e.target.value })}
                            className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                        />
                        <input
                            type="date"
                            value={newBill.dueDate}
                            onChange={(e) => setNewBill({ ...newBill, dueDate: e.target.value })}
                            className="p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleAddBill}
                            className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                        >
                            Add Bill
                        </button>
                        <button
                            type="button"
                            aria-label="Cancel adding bill"
                            onClick={() => setIsAdding(false)}
                            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Bills List */}
            {bills.length === 0 ? (
                <div className="text-center py-8">
                    <Bell size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm text-slate-500 font-medium">No Reminders</p>
                    <p className="text-xs text-slate-400">Add your recurring bills and subscriptions</p>
                </div>
            ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {bills.map(bill => {
                        const isOverdue = !bill.paid && new Date(bill.dueDate) < new Date();
                        return (
                            <div
                                key={bill.id}
                                className={`flex items-center justify-between p-3 rounded-xl ${bill.paid
                                        ? 'bg-emerald-50 dark:bg-emerald-500/10'
                                        : isOverdue
                                            ? 'bg-rose-50 dark:bg-rose-500/10'
                                            : 'bg-slate-50 dark:bg-slate-800'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        aria-label={bill.paid ? `Mark ${bill.name} as unpaid` : `Mark ${bill.name} as paid`}
                                        aria-pressed={bill.paid}
                                        onClick={() => togglePaid(bill.id)}
                                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${bill.paid
                                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                                : 'border-slate-300 dark:border-slate-600'
                                            }`}
                                    >
                                        {bill.paid && <Check size={14} />}
                                    </button>
                                    <div>
                                        <p className={`text-sm font-medium ${bill.paid ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {bill.name}
                                        </p>
                                        <p className="text-xs text-slate-500 flex items-center gap-1">
                                            <Calendar size={10} /> {new Date(bill.dueDate).toLocaleDateString()}
                                            {isOverdue && <AlertTriangle size={10} className="text-rose-500 ml-1" />}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                        {formatCurrency(bill.amount)}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`Delete bill ${bill.name}`}
                                        onClick={() => deleteBill(bill.id)}
                                        className="p-1 text-slate-400 hover:text-rose-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60 rounded"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default BillRemindersWidget;
