import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, TrendingUp, AlertTriangle, ArrowRight, DollarSign, Calendar, Calculator } from 'lucide-react';
import { Investment } from '../../types';
import { RealizedTransaction } from '../../database';

interface BookProfitModalProps {
    isOpen: boolean;
    onClose: () => void;
    investment: Investment | null;
    onConfirm: (
        transaction: Omit<RealizedTransaction, 'id'>,
        updatedInvestment: Partial<Investment>
    ) => void;
    formatCurrency: (val: number) => string;
}

export const BookProfitModal: React.FC<BookProfitModalProps> = ({
    isOpen, onClose, investment, onConfirm, formatCurrency
}) => {
    const [exitType, setExitType] = useState<'PARTIAL' | 'FULL'>('PARTIAL');
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    // Reset state when opening
    useEffect(() => {
        if (isOpen && investment) {
            setExitType('PARTIAL');
            setWithdrawAmount('');
            setSaleDate(new Date().toISOString().split('T')[0]);
            setNotes('');
        }
    }, [isOpen, investment]);

    if (!isOpen || !investment) return null;

    // Calculations
    const currentVal = investment.currentValue;
    const investedVal = investment.investedAmount;

    // Use user input for both exits (amount is pre-filled on toggle)
    const amount = parseFloat(withdrawAmount) || 0;

    // Validation
    const isValidAmount = amount > 0 && (exitType === 'FULL' || amount <= currentVal);
    const isPayDay = amount > 0; // Just check if amount is entered

    // Calculate P/L
    let costBasisRemoved = 0;
    let proportion = 0;

    if (exitType === 'FULL') {
        costBasisRemoved = investedVal;
        proportion = 1;
    } else {
        // Proportional logic: Selling X% of current value means selling X% of cost basis
        proportion = currentVal > 0 ? amount / currentVal : 0;
        costBasisRemoved = investedVal * proportion;
    }

    const realizedPL = amount - costBasisRemoved;
    const realizedPLPercent = costBasisRemoved > 0 ? (realizedPL / costBasisRemoved) * 100 : 0;

    // Remaining Values
    const remainingInvested = Math.max(0, investedVal - costBasisRemoved);
    const remainingCurrent = Math.max(0, currentVal - amount);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidAmount) return;

        const transaction: Omit<RealizedTransaction, 'id'> = {
            investmentId: investment.id,
            assetName: investment.name,
            type: exitType === 'FULL' ? 'FULL_EXIT' : 'PARTIAL_EXIT',
            saleDate,
            saleAmount: amount,
            costBasis: costBasisRemoved,
            realizedPL,
            realizedPLPercent,
            notes
        };

        const updatedInvestment: Partial<Investment> = {
            investedAmount: remainingInvested,
            currentValue: remainingCurrent,
            status: exitType === 'FULL' ? 'ARCHIVED' : 'ACTIVE'
        };

        onConfirm(transaction, updatedInvestment);
        onClose();
    };

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-150">
            <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start bg-slate-50/50 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <TrendingUp className="text-indigo-500" size={24} />
                            Record Exit
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            Record a withdrawal or exit for <span className="font-semibold text-slate-700 dark:text-slate-300">{investment.name}</span>
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                    {/* Exit Type Toggle */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button
                            type="button"
                            onClick={() => { setExitType('PARTIAL'); setWithdrawAmount(''); }}
                            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${exitType === 'PARTIAL'
                                ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-white'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            Partial Withdrawal
                        </button>
                        <button
                            type="button"
                            onClick={() => { setExitType('FULL'); setWithdrawAmount(currentVal.toString()); }}
                            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${exitType === 'FULL'
                                ? 'bg-white dark:bg-slate-700 shadow-sm text-amber-600 dark:text-amber-400'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            Full Exit
                        </button>
                    </div>

                    {/* Amount Input */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                            {exitType === 'FULL' ? 'Final Redemption Value (Editable)' : 'Amount to Withdraw'}
                        </label>
                        <div className="relative">
                            <div className="absolute left-4 top-3.5 text-slate-400 font-bold">₹</div>
                            <input
                                type="number"
                                value={withdrawAmount}
                                onChange={(e) => setWithdrawAmount(e.target.value)}
                                className={`w-full pl-10 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border ${exitType === 'FULL' ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 object-pulse' : 'border-slate-200 dark:border-slate-700'} rounded-xl font-mono text-xl font-bold outline-none focus:ring-2 focus:ring-indigo-500 transition-all`}
                                placeholder="0.00"
                            />
                        </div>
                        {exitType === 'PARTIAL' && (
                            <div className="flex justify-end gap-2 mt-2">
                                <button type="button" onClick={() => setWithdrawAmount((currentVal * 0.25).toFixed(0))} className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400">25%</button>
                                <button type="button" onClick={() => setWithdrawAmount((currentVal * 0.50).toFixed(0))} className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400">50%</button>
                                <button type="button" onClick={() => setWithdrawAmount((currentVal * 0.75).toFixed(0))} className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400">75%</button>
                            </div>
                        )}
                    </div>

                    {/* Date Picker */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Transaction Date</label>
                        <div className="relative">
                            <Calendar className="absolute left-4 top-3 text-slate-400" size={18} />
                            <input
                                type="date"
                                value={saleDate}
                                onChange={(e) => setSaleDate(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    {/* Impact Analysis Card */}
                    <div className="bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-500/20 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Calculator size={14} /> Transaction Impact
                        </h4>

                        <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                            <div>
                                <p className="text-xs text-slate-500 mb-1">{realizedPL >= 0 ? 'Realized Gain' : 'Realized Loss'}</p>
                                <p className={`text-lg font-bold font-mono ${realizedPL >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {realizedPL >= 0 ? '+' : ''}{formatCurrency(realizedPL)}
                                </p>
                                <p className={`text-xs font-medium ${realizedPL >= 0 ? 'text-emerald-600/70' : 'text-rose-600/70'}`}>
                                    {realizedPL >= 0 ? '+' : ''}{realizedPLPercent.toFixed(2)}% return
                                </p>
                            </div>

                            <div>
                                <p className="text-xs text-slate-500 mb-1">Cost Basis Removed</p>
                                <p className="text-lg font-bold font-mono text-slate-700 dark:text-slate-300">
                                    {formatCurrency(costBasisRemoved)}
                                </p>
                                <p className="text-xs text-slate-400">
                                    {(proportion * 100).toFixed(1)}% of holdings
                                </p>
                            </div>

                            <div className="col-span-2 pt-3 border-t border-indigo-100 dark:border-indigo-500/20">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-slate-500">Remaining Investment</span>
                                    <div className="text-right">
                                        <span className="font-bold text-slate-900 dark:text-white block">{formatCurrency(remainingCurrent)}</span>
                                        <span className="text-xs text-slate-400 block">Inv: {formatCurrency(remainingInvested)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {exitType === 'FULL' && (
                        <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-xl text-amber-800 dark:text-amber-200">
                            <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                            <p className="text-xs">
                                <strong>Archiving Asset:</strong> This asset will be moved to the "Archived" section. It will no longer appear in your main portfolio totals.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50/50 dark:bg-slate-900/50">
                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!isValidAmount}
                        className={`px-6 py-2.5 rounded-xl font-bold text-white shadow-lg transition-all flex items-center gap-2 ${isValidAmount ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/25' : 'bg-slate-300 cursor-not-allowed'}`}
                    >
                        Confirm Transaction <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
