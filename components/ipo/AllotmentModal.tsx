import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, X, RefreshCw, Banknote } from 'lucide-react';
import { IPOApplication } from '../../database';
import { formatCurrency } from '../../utils/helpers';

interface AllotmentModalProps {
    app: IPOApplication | null;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (appId: number, allottedAmount: number) => Promise<void>;
}

export const AllotmentModal: React.FC<AllotmentModalProps> = ({
    app,
    isOpen,
    onClose,
    onConfirm
}) => {
    const [allottedAmountInput, setAllottedAmountInput] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (app) {
            // Default value logic: if app.amount > 15000 (e.g. HNI/Shareholder applied 2,00,000), default to 15000 or full amount
            const defaultAmt = app.allottedAmount ?? (app.amount > 15000 ? 15000 : app.amount);
            setAllottedAmountInput(defaultAmt.toString());
        }
    }, [app]);

    // Escape key listener & Body Scroll Lock
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen || !app) return null;

    const appliedAmount = app.amount;
    const numVal = parseFloat(allottedAmountInput) || 0;
    const isPartialAllotment = numVal < appliedAmount;
    const partialRefund = Math.max(0, appliedAmount - numVal);
    const isValid = numVal > 0 && numVal <= appliedAmount;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid || isSubmitting) return;

        setIsSubmitting(true);
        try {
            await onConfirm(app.id!, numVal);
            onClose();
        } catch (e) {
            console.error(e);
        } finally {
            setIsSubmitting(false);
        }
    };

    const modalContent = (
        <div 
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
        >
            <div className="w-full max-w-lg bg-white dark:bg-wa-card-elevated border border-slate-200 dark:border-wa-border rounded-wa-lg shadow-2xl p-6 relative overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            <ShieldCheck size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-900 dark:text-white">Confirm Allotment Capital</h3>
                            <p className="text-xs text-slate-500">{app.applicantName} &bull; {app.ipoName}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                    {/* Applied Blocked Amount Readonly */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Applied / Blocked Amount</label>
                        <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono font-bold text-sm text-slate-600 dark:text-slate-400">
                            {formatCurrency(appliedAmount)}
                        </div>
                    </div>

                    {/* Allotted Amount Input */}
                    <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                            Amount Paid / Retained for Allotment (₹)
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <Banknote size={16} />
                            </div>
                            <input
                                type="number"
                                value={allottedAmountInput}
                                onChange={(e) => setAllottedAmountInput(e.target.value)}
                                placeholder="e.g. 15000"
                                className="w-full pl-9 pr-4 py-3 rounded-xl bg-white dark:bg-slate-950 border border-indigo-500/50 text-slate-900 dark:text-white font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            />
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1">
                            Enter the actual rupees retained for your allotted shares (e.g. ₹15,000 for 1 retail lot).
                        </p>
                    </div>

                    {/* Breakdown Summary */}
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Allotted Share Capital:</span>
                            <span className="font-mono font-bold text-emerald-500">{formatCurrency(numVal)}</span>
                        </div>
                        {isPartialAllotment && (
                            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 pt-1.5 border-t border-slate-200 dark:border-slate-800">
                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                                    <RefreshCw size={12} /> Instant Vault Refund:
                                </span>
                                <span className="font-mono font-bold text-emerald-500">+{formatCurrency(partialRefund)}</span>
                            </div>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-1/2 py-2.5 rounded-wa-md border border-slate-200 dark:border-wa-border text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!isValid || isSubmitting}
                            className="w-1/2 py-2.5 rounded-wa-md bg-wa-accent hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                            Confirm Allotment
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
