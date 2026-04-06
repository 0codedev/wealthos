import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTransactions, Transaction } from '../../../contexts/TransactionContext';
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { Upload, X, FileText, Brain, Check, FileUp, PlusCircle, ArrowUpRight, ArrowDownLeft, Calendar, Tag, Building, DollarSign } from 'lucide-react';

interface BankImportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CATEGORIES = [
    'Food & Dining',
    'Groceries',
    'Shopping',
    'Bills & Utilities',
    'Transport',
    'Entertainment',
    'Investment',
    'Transfer',
    'Income',
    'Health & Medical',
    'Miscellaneous'
];

export const BankImportModal: React.FC<BankImportModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<'import' | 'manual'>('import');
    
    // Import state
    const [parsing, setParsing] = useState(false);
    const [parsed, setParsed] = useState(false);
    const [parsedCount, setParsedCount] = useState(0);
    
    // Manual transaction state
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [txnType, setTxnType] = useState<'debit' | 'credit'>('debit');
    const [category, setCategory] = useState('Food & Dining');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [bankName, setBankName] = useState('HDFC Bank');
    const [notes, setNotes] = useState('');
    const [manualSuccess, setManualSuccess] = useState(false);

    const { spendingByCategory, parseAndAddFromFile, addTransaction, lastImportResult } = useTransactions();

    const handleCreateManualSubmit = () => {
        const numAmount = parseFloat(amount);
        if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
            alert('Please enter a valid positive amount.');
            return;
        }
        if (!description.trim()) {
            alert('Please enter a transaction description.');
            return;
        }

        const newTxn: Transaction = {
            id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: new Date(date).toISOString(),
            description: description.trim(),
            amount: numAmount,
            category: category,
            type: txnType,
            bankName: bankName.trim() || undefined,
            notes: notes.trim() || undefined,
            merchant: description.trim()
        };

        addTransaction(newTxn);
        setManualSuccess(true);
        setTimeout(() => {
            setManualSuccess(false);
            setAmount('');
            setDescription('');
            setNotes('');
            onClose();
        }, 1200);
    };

    const modalRef = useModalKeyboard({
        isOpen,
        onClose,
        onSubmit: activeTab === 'manual' ? handleCreateManualSubmit : undefined,
        onTabChange: (idx) => setActiveTab(idx === 0 ? 'import' : 'manual'),
        maxTabs: 2
    });

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setParsing(true);

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            const fileType = file.name.endsWith('.csv') ? 'csv' : 'text';

            // Simulate AI analysis delay
            setTimeout(() => {
                try {
                    const count = parseAndAddFromFile(content, fileType);
                    setParsed(true);
                    setParsedCount(count);
                } catch (err) {
                    console.error('Failed to parse bank file:', err);
                } finally {
                    setParsing(false);
                }
            }, 1200);
        };

        reader.onerror = () => {
            setParsing(false);
            alert('Failed to read file');
        };

        reader.readAsText(file);
    };

    const handleAddManualTransaction = (e: React.FormEvent) => {
        e.preventDefault();
        handleCreateManualSubmit();
    };

    if (!isOpen || typeof document === 'undefined') return null;

    return createPortal(
        <div 
            className="fixed inset-0 bg-slate-950/75 backdrop-blur-md z-[9999] flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200" 
            onClick={onClose}
        >
            <div 
                ref={modalRef}
                className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 my-auto overflow-hidden animate-in zoom-in-95 duration-200" 
                onClick={e => e.stopPropagation()}
            >
                {/* Header with Mode Tabs */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2 font-display">
                            <FileText className="text-indigo-500" size={22} />
                            Add Spending & Transactions
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">Import bank statements or add custom transactions</p>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
                        aria-label="Close modal"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Tab Switcher */}
                <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-1.5 gap-1.5">
                    <button
                        onClick={() => { setActiveTab('import'); setParsed(false); setManualSuccess(false); }}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'import'
                                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                        }`}
                    >
                        <Upload size={15} /> Import Files (Statement/CSV)
                    </button>
                    <button
                        onClick={() => { setActiveTab('manual'); setManualSuccess(false); }}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'manual'
                                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                        }`}
                    >
                        <PlusCircle size={15} /> Add Manual Transaction
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-6">
                    {activeTab === 'import' ? (
                        !parsed ? (
                            <div className="text-center space-y-4">
                                <label className="block relative border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-8 hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10 transition-all cursor-pointer group">
                                    <div className="flex flex-col items-center justify-center pointer-events-none">
                                        <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-inner">
                                            <Upload className="text-indigo-600 dark:text-indigo-400" size={30} />
                                        </div>
                                        <p className="text-slate-900 dark:text-white font-bold text-base mb-1 font-display">
                                            Click to Upload Bank Statement
                                        </p>
                                        <p className="text-xs text-slate-500 group-hover:text-indigo-500 transition-colors">
                                            Supports CSV, PDF, XLS, TXT statements
                                        </p>
                                    </div>
                                    <input
                                        type="file"
                                        accept=".csv,.txt,.xls,.xlsx,.pdf"
                                        onChange={handleFileUpload}
                                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                                    />
                                </label>

                                {parsing && (
                                    <div className="mt-4 flex items-center justify-center gap-3 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/50 p-4 rounded-2xl animate-in fade-in">
                                        <Brain className="animate-spin text-indigo-500" size={22} />
                                        <span className="font-medium text-xs animate-pulse">AI is parsing statement and categorizing transactions...</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
                                <div className="text-center mb-6">
                                    <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-emerald-300 dark:border-emerald-700/50">
                                        <Check size={28} className="text-emerald-600 dark:text-emerald-400" />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display">Statement Imported Successfully!</h3>
                                    <div className="flex justify-center gap-3 mt-3 text-xs">
                                        <span className="px-3 py-1.5 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 rounded-xl font-bold">
                                            ✅ {lastImportResult?.added || parsedCount} new
                                        </span>
                                        <span className="px-3 py-1.5 bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50 rounded-xl font-bold">
                                            🔄 {lastImportResult?.updated || 0} updated
                                        </span>
                                        <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl font-bold">
                                            ⏭️ {lastImportResult?.skipped || 0} skipped
                                        </span>
                                    </div>
                                </div>

                                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl p-4 mb-6 max-h-48 overflow-y-auto space-y-2 border border-slate-100 dark:border-slate-800">
                                    {spendingByCategory.slice(0, 5).map((t, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/50 shadow-sm text-xs">
                                            <span className="font-medium text-slate-700 dark:text-slate-200">{t.category}</span>
                                            <span className="font-mono font-bold text-slate-900 dark:text-white">₹{t.amount.toLocaleString()}</span>
                                        </div>
                                    ))}
                                    {spendingByCategory.length > 5 && (
                                        <p className="text-[11px] text-center text-slate-400 pt-1 font-medium">and {spendingByCategory.length - 5} more categories...</p>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { setParsed(false); setParsedCount(0); }}
                                        className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 text-xs"
                                    >
                                        <FileUp size={16} /> Import Another File
                                    </button>
                                    <button
                                        onClick={onClose}
                                        className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 transition-all text-xs"
                                    >
                                        View Analytics
                                    </button>
                                </div>
                            </div>
                        )
                    ) : (
                        /* Manual Transaction Form */
                        manualSuccess ? (
                            <div className="py-8 text-center animate-in zoom-in-95 duration-200">
                                <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-emerald-300 dark:border-emerald-700/50">
                                    <Check size={28} className="text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display">Transaction Added!</h3>
                                <p className="text-xs text-slate-500 mt-1">Your spending dashboard has been updated instantly.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleAddManualTransaction} className="space-y-4">
                                {/* Type Toggle: Expense vs Income */}
                                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                                    <button
                                        type="button"
                                        onClick={() => setTxnType('debit')}
                                        className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                                            txnType === 'debit'
                                                ? 'bg-rose-500 text-white shadow-md'
                                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                                        }`}
                                    >
                                        <ArrowUpRight size={15} /> Expense (Debit)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setTxnType('credit')}
                                        className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                                            txnType === 'credit'
                                                ? 'bg-emerald-500 text-white shadow-md'
                                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                                        }`}
                                    >
                                        <ArrowDownLeft size={15} /> Income (Credit)
                                    </button>
                                </div>

                                {/* Amount & Description */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                            <DollarSign size={13} className="text-indigo-500" /> Amount (₹) *
                                        </label>
                                        <input
                                            type="number"
                                            step="any"
                                            required
                                            value={amount}
                                            onChange={e => setAmount(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                            <Tag size={13} className="text-indigo-500" /> Category *
                                        </label>
                                        <select
                                            value={category}
                                            onChange={e => setCategory(e.target.value)}
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            {CATEGORIES.map(cat => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                                        Description / Merchant *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        placeholder="e.g. Swiggy Order, Grocery Store, Salary"
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                            <Calendar size={13} className="text-indigo-500" /> Date
                                        </label>
                                        <input
                                            type="date"
                                            value={date}
                                            onChange={e => setDate(e.target.value)}
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                                            <Building size={13} className="text-indigo-500" /> Bank / Account
                                        </label>
                                        <input
                                            type="text"
                                            value={bankName}
                                            onChange={e => setBankName(e.target.value)}
                                            placeholder="e.g. HDFC, Paytm, Cash"
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 mb-1.5">
                                        Notes (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={notes}
                                        onChange={e => setNotes(e.target.value)}
                                        placeholder="Add extra context or details..."
                                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg shadow-indigo-500/25 transition-all text-xs flex items-center justify-center gap-2 mt-2"
                                >
                                    <PlusCircle size={16} /> Add Transaction Instantly
                                </button>
                            </form>
                        )
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default BankImportModal;
