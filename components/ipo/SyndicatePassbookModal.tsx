import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    X, History, Search, ArrowDownLeft, ArrowUpRight, 
    Rocket, RefreshCw, Lock, Wallet, Filter, Calendar, Users, Sparkles
} from 'lucide-react';
import { Friend, IPOApplication } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { useToast } from '../shared/ToastProvider';
import { reconcileVaultBalances } from '../../services/SyndicateLedgerReconciler';

export interface PassbookEntry {
    id: string;
    date: string;
    timestamp: number;
    memberName: string;
    memberColor?: string;
    amount: number;
    type: 'TRANSFER_IN' | 'TRANSFER_OUT' | 'PROFIT' | 'REFUND' | 'BLOCKED' | 'DEPOSIT' | 'WITHDRAW' | 'CALIBRATION';
    title: string;
    subtitle?: string;
    notes?: string;
    isCredit: boolean;
}

interface SyndicatePassbookModalProps {
    isOpen: boolean;
    onClose: () => void;
    friends: Friend[];
    applications?: IPOApplication[];
}

export const SyndicatePassbookModal: React.FC<SyndicatePassbookModalProps> = ({
    isOpen,
    onClose,
    friends = [],
    applications = []
}) => {
    const { toast } = useToast();
    const [selectedMember, setSelectedMember] = useState<string>('ALL');
    const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'TRANSFERS' | 'PROFITS' | 'REFUNDS_BLOCKS'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [isReconciling, setIsReconciling] = useState(false);

    const handleReconcile = async () => {
        setIsReconciling(true);
        try {
            const result = await reconcileVaultBalances();
            if (result.accountsCorrected > 0) {
                toast.success(`⚡ Reconciled: Updated balances for ${result.accountsCorrected} account(s) using exact transaction history.`);
            } else {
                toast.success(`✓ All ${result.totalAccountsAudited} accounts are 100% in sync with transaction history.`);
            }
        } catch (e) {
            console.error(e);
            toast.error("Reconciliation failed.");
        } finally {
            setIsReconciling(false);
        }
    };

    // Aggregate all history entries from all friends and applications
    const allPassbookEntries = useMemo(() => {
        const entries: PassbookEntry[] = [];

        // 1. Collect history from all friends
        friends.forEach(friend => {
            const historyList = friend.history || [];
            historyList.forEach((h, idx) => {
                const dateObj = new Date(h.date || Date.now());
                const timeMs = isNaN(dateObj.getTime()) ? Date.now() - idx * 1000 : dateObj.getTime();
                const hType = (h.type as string) || '';
                const isCredit = ['DEPOSIT', 'PROFIT', 'REFUND', 'CALIBRATION'].includes(hType) || 
                    (hType === 'TRANSFER_IN') ||
                    (h.notes?.toLowerCase().includes('from self') ?? false);

                let entryType: PassbookEntry['type'] = h.type as any;
                let title = `${friend.name}`;

                if (hType === 'CALIBRATION' || h.notes?.toLowerCase().includes('calibration')) {
                    entryType = 'CALIBRATION';
                    title = `Direct Balance Calibration`;
                } else if (hType === 'PROFIT') {
                    title = `Listing Profit: ${h.notes?.replace(/^Listing Gain:\s*/i, '').replace(/\s*\(\+₹.*\)$/, '') || friend.name}`;
                } else if (h.type === 'REFUND') {
                    title = `Mandate Refund: ${h.notes || friend.name}`;
                } else if (h.type === 'BLOCKED') {
                    title = `IPO Mandate Blocked`;
                } else if (h.notes?.toLowerCase().includes('from self')) {
                    entryType = 'TRANSFER_IN';
                    title = `Transfer Received from Self`;
                } else if (h.notes?.toLowerCase().includes('to ') || h.notes?.toLowerCase().includes('transfer to')) {
                    entryType = 'TRANSFER_OUT';
                    title = `Transfer Sent to ${friend.name}`;
                } else if (h.notes?.toLowerCase().includes('return to self') || h.notes?.toLowerCase().includes('withdrawn to self')) {
                    entryType = 'TRANSFER_OUT';
                    title = `Returned to Self Treasury`;
                } else if (h.type === 'DEPOSIT') {
                    title = `Capital Deposit`;
                } else if (h.type === 'WITHDRAW') {
                    title = `Capital Withdrawal`;
                }

                entries.push({
                    id: `friend-${friend.id}-${idx}-${timeMs}`,
                    date: h.date,
                    timestamp: timeMs,
                    memberName: friend.name,
                    memberColor: friend.color || '#6366f1',
                    amount: Math.abs(h.amount),
                    type: entryType,
                    title: title,
                    subtitle: friend.name !== 'Self' ? `Member: ${friend.name}` : undefined,
                    notes: h.notes,
                    isCredit: isCredit
                });
            });
        });

        // 2. Sort reverse chronological
        return entries.sort((a, b) => b.timestamp - a.timestamp);
    }, [friends]);

    // Filter entries
    const filteredEntries = useMemo(() => {
        return allPassbookEntries.filter(entry => {
            // Member filter
            if (selectedMember !== 'ALL' && entry.memberName.toLowerCase() !== selectedMember.toLowerCase()) {
                return false;
            }

            // Category filter
            if (categoryFilter === 'TRANSFERS') {
                if (entry.type !== 'TRANSFER_IN' && entry.type !== 'TRANSFER_OUT' && !entry.notes?.toLowerCase().includes('self')) {
                    return false;
                }
            } else if (categoryFilter === 'PROFITS') {
                if (entry.type !== 'PROFIT') return false;
            } else if (categoryFilter === 'REFUNDS_BLOCKS') {
                if (entry.type !== 'REFUND' && entry.type !== 'BLOCKED') return false;
            }

            // Search query
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matchName = entry.memberName.toLowerCase().includes(q);
                const matchTitle = entry.title.toLowerCase().includes(q);
                const matchNotes = (entry.notes || '').toLowerCase().includes(q);
                if (!matchName && !matchTitle && !matchNotes) return false;
            }

            return true;
        });
    }, [allPassbookEntries, selectedMember, categoryFilter, searchQuery]);

    // Statistics
    const stats = useMemo(() => {
        const totalProfit = allPassbookEntries
            .filter(e => e.type === 'PROFIT')
            .reduce((acc, curr) => acc + curr.amount, 0);
        
        const totalTransfers = allPassbookEntries
            .filter(e => e.type === 'TRANSFER_IN' || e.type === 'TRANSFER_OUT' || e.notes?.toLowerCase().includes('self'))
            .length;

        const totalVaultBalance = friends.reduce((acc, curr) => acc + curr.balance, 0);

        return { totalProfit, totalTransfers, totalVaultBalance };
    }, [allPassbookEntries, friends]);

    // Escape key listener & Body Scroll Lock
    React.useEffect(() => {
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

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div 
                onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
                className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 pt-14 sm:pt-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto"
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 15 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 15 }}
                    className="w-full max-w-4xl max-h-[86vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden my-auto"
                >
                    {/* Modal Header */}
                    <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-900/80 shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-2xl border border-indigo-500/20 shadow-sm">
                                <History size={20} />
                            </div>
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                                    Syndicate Vault Passbook
                                    <span className="text-xs font-mono font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800/60">
                                        {allPassbookEntries.length} Transactions
                                    </span>
                                </h3>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleReconcile}
                                disabled={isReconciling}
                                title="Audit and reconcile all member balances against their transaction history without adding duplicates"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 text-xs font-bold transition-all shadow-xs disabled:opacity-50"
                            >
                                <RefreshCw size={13} className={isReconciling ? 'animate-spin' : ''} />
                                <span>{isReconciling ? 'Reconciling...' : 'Reconcile Balances'}</span>
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    {/* Quick Stats Bar */}
                    <div className="grid grid-cols-3 gap-3 p-4 sm:p-5 bg-gradient-to-r from-indigo-50/60 via-purple-50/40 to-slate-50 dark:from-indigo-950/20 dark:via-purple-950/10 dark:to-slate-900/40 border-b border-slate-100 dark:border-slate-800 text-xs">
                        <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Vault Balance</span>
                            <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-0.5 block">
                                {formatCurrency(stats.totalVaultBalance)}
                            </span>
                        </div>
                        <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Realized Profits</span>
                            <span className="text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                                +{formatCurrency(stats.totalProfit)}
                            </span>
                        </div>
                        <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 shadow-sm">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Members</span>
                            <span className="text-base sm:text-lg font-black text-indigo-600 dark:text-indigo-400 mt-0.5 block">
                                {friends.length} Accounts
                            </span>
                        </div>
                    </div>

                    {/* Filter & Search Toolbar */}
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3 items-center justify-between">
                        {/* Search */}
                        <div className="relative w-full sm:w-64">
                            <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search by name, note, IPO..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500"
                            />
                        </div>

                        {/* Category Chips */}
                        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                            <button
                                onClick={() => setCategoryFilter('ALL')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${categoryFilter === 'ALL' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}`}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setCategoryFilter('TRANSFERS')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${categoryFilter === 'TRANSFERS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}`}
                            >
                                Transfers
                            </button>
                            <button
                                onClick={() => setCategoryFilter('PROFITS')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${categoryFilter === 'PROFITS' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}`}
                            >
                                Profits
                            </button>
                            <button
                                onClick={() => setCategoryFilter('REFUNDS_BLOCKS')}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${categoryFilter === 'REFUNDS_BLOCKS' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'}`}
                            >
                                IPO Events
                            </button>

                            {/* Member Dropdown */}
                            <select
                                value={selectedMember}
                                onChange={(e) => setSelectedMember(e.target.value)}
                                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 outline-none focus:border-indigo-500 shrink-0"
                            >
                                <option value="ALL">All Members</option>
                                {friends.map(f => (
                                    <option key={f.id} value={f.name}>{f.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Passbook Transactions List */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 divide-y divide-slate-100 dark:divide-slate-800/60">
                        {filteredEntries.length > 0 ? (
                            filteredEntries.map(entry => (
                                <div 
                                    key={entry.id}
                                    className="pt-3 first:pt-0 flex items-center justify-between gap-4 group"
                                >
                                    <div className="flex items-center gap-3.5 min-w-0">
                                        {/* Icon Badge */}
                                        <div className={`p-2.5 rounded-2xl shrink-0 flex items-center justify-center ${
                                            entry.type === 'CALIBRATION'
                                                ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60'
                                                : entry.type === 'PROFIT'
                                                ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                                                : entry.isCredit
                                                ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60'
                                                : 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60'
                                        }`}>
                                            {entry.type === 'CALIBRATION' ? (
                                                <Sparkles size={18} />
                                            ) : entry.type === 'PROFIT' ? (
                                                <Rocket size={18} />
                                            ) : entry.type === 'REFUND' ? (
                                                <RefreshCw size={18} />
                                            ) : entry.type === 'BLOCKED' ? (
                                                <Lock size={18} />
                                            ) : entry.isCredit ? (
                                                <ArrowDownLeft size={18} />
                                            ) : (
                                                <ArrowUpRight size={18} />
                                            )}
                                        </div>

                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                                                    {entry.title}
                                                </p>
                                                <span 
                                                    className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-xs"
                                                    style={{ backgroundColor: entry.memberColor }}
                                                >
                                                    {entry.memberName}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                                <span className="flex items-center gap-1 font-mono">
                                                    <Calendar size={10} />
                                                    {new Date(entry.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                </span>
                                                {entry.notes && (
                                                    <span className="truncate max-w-[240px] sm:max-w-md text-slate-500 dark:text-slate-400">
                                                        &bull; {entry.notes}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Amount Badge */}
                                    <div className="text-right shrink-0">
                                        <p className={`text-sm sm:text-base font-mono font-black ${
                                            entry.type === 'PROFIT' || entry.isCredit
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : 'text-rose-600 dark:text-rose-400'
                                        }`}>
                                            {entry.isCredit ? '+' : '-'}{formatCurrency(entry.amount)}
                                        </p>
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            {entry.type}
                                        </span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-16 text-slate-400">
                                <History size={36} className="mx-auto mb-3 opacity-40 text-indigo-400" />
                                <p className="text-sm font-bold text-slate-600 dark:text-slate-300">No passbook transactions found</p>
                                <p className="text-xs text-slate-400 mt-1">Try changing your search query or category filter</p>
                            </div>
                        )}
                    </div>

                    {/* Modal Footer */}
                    <div className="p-4 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs text-slate-500">
                        <span>Showing {filteredEntries.length} of {allPassbookEntries.length} entries</span>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-md shadow-indigo-500/20"
                        >
                            Done
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
export default SyndicatePassbookModal;
