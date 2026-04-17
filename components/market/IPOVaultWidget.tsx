import React, { useState, useEffect, useMemo } from 'react';
import { liveQuery } from 'dexie';
import { db, Friend } from '../../database';
import { useToast } from '../shared/ToastProvider';
import {
    Users, Plus, Wallet, ArrowUpRight, ArrowDownLeft,
    Trash2, History, ChevronRight, Rocket, Send, ShieldCheck,
    TrendingUp, ArrowRightLeft, Sparkles, CheckCircle2, AlertCircle, RefreshCw,
    Pencil, Check, X
} from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { motion, AnimatePresence } from 'framer-motion';
import { SyndicatePassbookModal } from '../ipo/SyndicatePassbookModal';
import { normalizeSyndicateName } from '../../services/SyndicateNameResolver';
import { reconcileVaultBalances } from '../../services/SyndicateLedgerReconciler';
import { syncEngine } from '../../services/SyncEngine';

export const IPOVaultWidget: React.FC = () => {
    const { toast } = useToast();
    const [friends, setFriends] = useState<Friend[]>([]);
    const [isAddMode, setIsAddMode] = useState(false);
    const [newFriendName, setNewFriendName] = useState('');
    const [initialBalance, setInitialBalance] = useState('');
    const [friendUpi, setFriendUpi] = useState('');

    const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
    const [transferMode, setTransferMode] = useState<'TRANSFER_TO_MEMBER' | 'RETURN_TO_SELF' | 'DIRECT_DEPOSIT'>('TRANSFER_TO_MEMBER');
    const [transferAmount, setTransferAmount] = useState<string>('');
    const [transferNote, setTransferNote] = useState<string>('');
    const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
    const [transferError, setTransferError] = useState<string | null>(null);
    const [isReconciling, setIsReconciling] = useState(false);
    const [isEditingBalance, setIsEditingBalance] = useState(false);
    const [customBalanceInput, setCustomBalanceInput] = useState('');

    // Passbook Modal state
    const [isPassbookOpen, setIsPassbookOpen] = useState(false);

    // Live reactive selected friend
    const selectedFriend = useMemo(() => {
        if (!selectedFriendId) return null;
        return friends.find(f => f.id === selectedFriendId) || null;
    }, [selectedFriendId, friends]);

    const handleSaveCustomBalance = async () => {
        if (!selectedFriend) return;
        const newBal = parseFloat(customBalanceInput);
        if (isNaN(newBal) || newBal < 0) {
            toast.error("Please enter a valid balance amount.");
            return;
        }
        const now = new Date().toISOString();
        const nowMs = Date.now();

        await db.friends.update(selectedFriend.id!, {
            balance: newBal,
            updated_at: nowMs,
            history: [
                ...(selectedFriend.history || []),
                {
                    date: now,
                    amount: newBal,
                    type: 'CALIBRATION' as any,
                    notes: `Direct Balance Calibration (Set to ₹${formatCurrency(newBal)})`
                }
            ]
        } as any);
        syncEngine.notifyDataChanged('friends');
        setIsEditingBalance(false);
        setCustomBalanceInput('');
        toast.success(`Updated ${selectedFriend.name}'s balance to ₹${formatCurrency(newBal)}`);
    };

    const handleReconcile = async () => {
        setIsReconciling(true);
        try {
            const result = await reconcileVaultBalances();
            if (result.accountsCorrected > 0) {
                toast.success(`⚡ Reconciled ${result.accountsCorrected} accounts from transaction ledger.`);
            } else {
                toast.success(`✓ All accounts are 100% in sync with transaction history.`);
            }
        } catch (e) {
            console.error(e);
            toast.error("Reconciliation failed.");
        } finally {
            setIsReconciling(false);
        }
    };

    useEffect(() => {
        const subscription = liveQuery(() => db.friends.toArray()).subscribe(async (items) => {
            const activeItems = (items || []).filter(f => !(f as any).isDeleted);
            setFriends(activeItems);
            // Auto-ensure Self account exists if empty
            if (activeItems && activeItems.length > 0 && !activeItems.some(f => f.name.toLowerCase() === 'self')) {
                await db.friends.add({
                    name: 'Self',
                    balance: 100000,
                    color: '#6366f1',
                    history: [{
                        date: new Date().toISOString(),
                        amount: 100000,
                        type: 'DEPOSIT',
                        notes: 'Self Master Treasury Initialized'
                    }]
                });
            }
        });
        return () => subscription.unsubscribe();
    }, []);

    // Master Self Account
    const selfAccount = useMemo(() => {
        return friends.find(f => f.name.toLowerCase() === 'self') || null;
    }, [friends]);

    const selfBalance = selfAccount?.balance || 0;
    const totalVaultValue = friends.reduce((acc, curr) => acc + curr.balance, 0) || 0;

    // Filtered friends (excluding Self from member list for cleaner view, but Self is featured at top)
    const memberFriends = useMemo(() => {
        return friends.filter(f => f.name.toLowerCase() !== 'self');
    }, [friends]);

    const handleAddFriend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFriendName) return;

        const canonicalName = normalizeSyndicateName(newFriendName);
        const amount = parseFloat(initialBalance) || 0;

        const nowMs = Date.now();
        const newFriendId = await db.friends.add({
            name: canonicalName,
            balance: amount,
            color: `hsl(${Math.floor(Math.random() * 360)}, 75%, 45%)`,
            updated_at: nowMs,
            history: amount > 0 ? [{
                date: new Date().toISOString(),
                amount: amount,
                type: 'DEPOSIT',
                notes: friendUpi ? `Initial Balance (UPI: ${friendUpi})` : 'Initial Balance'
            }] : []
        } as any);

        // If initial balance was provided and Self has balance, deduct from Self
        if (amount > 0 && selfAccount && selfAccount.balance >= amount) {
            await db.friends.update(selfAccount.id!, {
                balance: selfAccount.balance - amount,
                updated_at: nowMs,
                history: [
                    ...(selfAccount.history || []),
                    {
                        date: new Date().toISOString(),
                        amount: amount,
                        type: 'WITHDRAW',
                        notes: `Initial Funding to ${canonicalName}`
                    }
                ]
            } as any);
        }

        syncEngine.notifyDataChanged('friends');
        setIsAddMode(false);
        setNewFriendName('');
        setInitialBalance('');
        setFriendUpi('');
    };

    const handleTransferExecute = async () => {
        setTransferError(null);
        const amount = parseFloat(transferAmount);
        if (isNaN(amount) || amount <= 0) {
            setTransferError("Please enter a valid transfer amount.");
            return;
        }

        const now = new Date().toISOString();
        const nowMs = Date.now();

        if (transferMode === 'TRANSFER_TO_MEMBER') {
            if (!selectedFriend || !selfAccount) return;
            if (selfAccount.balance < amount) {
                const msg = `Insufficient funds in Self Treasury (Available: ₹${formatCurrency(selfAccount.balance)})`;
                setTransferError(msg);
                toast.error(msg);
                return;
            }

            // 1. Deduct from Self
            await db.friends.update(selfAccount.id!, {
                balance: selfAccount.balance - amount,
                updated_at: nowMs,
                history: [
                    ...(selfAccount.history || []),
                    {
                        date: now,
                        amount: amount,
                        type: 'WITHDRAW',
                        notes: transferNote || `Transferred to ${selectedFriend.name}`
                    }
                ]
            } as any);

            // 2. Credit to Member
            await db.friends.update(selectedFriend.id!, {
                balance: selectedFriend.balance + amount,
                updated_at: nowMs,
                history: [
                    ...(selectedFriend.history || []),
                    {
                        date: now,
                        amount: amount,
                        type: 'DEPOSIT',
                        notes: transferNote || `Received from Self Treasury`
                    }
                ]
            } as any);

            syncEngine.notifyDataChanged('friends');
            const successMsg = `Transferred ₹${formatCurrency(amount)} from Self to ${selectedFriend.name}`;
            setTransferSuccess(successMsg);
            toast.success(successMsg);
        } else if (transferMode === 'RETURN_TO_SELF') {
            if (!selectedFriend || !selfAccount) return;
            if (selectedFriend.balance < amount) {
                const msg = `Insufficient balance in ${selectedFriend.name}'s account (Available: ₹${formatCurrency(selectedFriend.balance)})`;
                setTransferError(msg);
                toast.error(msg);
                return;
            }

            // 1. Deduct from Member
            await db.friends.update(selectedFriend.id!, {
                balance: selectedFriend.balance - amount,
                updated_at: nowMs,
                history: [
                    ...(selectedFriend.history || []),
                    {
                        date: now,
                        amount: amount,
                        type: 'WITHDRAW',
                        notes: transferNote || `Returned to Self Treasury`
                    }
                ]
            } as any);

            // 2. Credit to Self
            await db.friends.update(selfAccount.id!, {
                balance: selfAccount.balance + amount,
                updated_at: nowMs,
                history: [
                    ...(selfAccount.history || []),
                    {
                        date: now,
                        amount: amount,
                        type: 'DEPOSIT',
                        notes: transferNote || `Returned from ${selectedFriend.name}`
                    }
                ]
            } as any);

            syncEngine.notifyDataChanged('friends');
            const successMsg = `Returned ₹${formatCurrency(amount)} from ${selectedFriend.name} to Self Treasury`;
            setTransferSuccess(successMsg);
            toast.success(successMsg);
        } else if (transferMode === 'DIRECT_DEPOSIT') {
            // Direct deposit from external bank to Self
            if (!selfAccount) return;
            await db.friends.update(selfAccount.id!, {
                balance: selfAccount.balance + amount,
                updated_at: nowMs,
                history: [
                    ...(selfAccount.history || []),
                    {
                        date: now,
                        amount: amount,
                        type: 'DEPOSIT',
                        notes: transferNote || `External Bank Deposit`
                    }
                ]
            } as any);
            syncEngine.notifyDataChanged('friends');
            const successMsg = `₹${formatCurrency(amount)} added to Self Treasury!`;
            setTransferSuccess(successMsg);
            toast.success(successMsg);
        }

        setTransferAmount('');
        setTransferNote('');
        setTimeout(() => setTransferSuccess(null), 3500);
    };

    const handleDelete = async (id: number) => {
        await syncEngine.notifyDeleted('friends', id);
        await db.friends.delete(id);
        setSelectedFriendId(null);
        toast.success("Partner removed from Syndicate Vault");
    };

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 h-full flex flex-col shadow-sm">
            {/* Widget Header */}
            <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="p-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl border border-indigo-500/20 shadow-xs shrink-0">
                        <Users size={16} />
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                            <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                                Syndicate Vault
                            </h3>
                            <span className="text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.2 rounded-md border border-indigo-200 dark:border-indigo-800/60 shrink-0">
                                {friends.length} Accounts
                            </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">Track pooled member capital</p>
                    </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {/* Quick Reconcile Button */}
                    <button
                        onClick={handleReconcile}
                        disabled={isReconciling}
                        title="Audit & reconcile member balances with active IPOs & ledger"
                        className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl transition-all border border-slate-200/60 dark:border-slate-700/60 disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={isReconciling ? 'animate-spin' : ''} />
                    </button>
                    {/* Passbook Button */}
                    <button
                        onClick={() => setIsPassbookOpen(true)}
                        title="View Syndicate Passbook & Transaction Ledger"
                        className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-xl transition-all border border-slate-200/60 dark:border-slate-700/60"
                    >
                        <History size={14} />
                    </button>
                    {!isAddMode && (
                        <button
                            onClick={() => setIsAddMode(true)}
                            title="Add New Partner"
                            className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all shadow-xs"
                        >
                            <Plus size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Treasury Balance Master Card */}
            <div className="mb-3.5 p-3.5 rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 text-white shadow-md shadow-indigo-500/20 relative overflow-hidden shrink-0">
                <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
                <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] font-bold text-indigo-100 uppercase tracking-wider flex items-center gap-1.5">
                        <Wallet size={13} className="text-indigo-200" />
                        Total Capital
                    </span>
                    <div className="text-[10px] font-bold bg-white/15 px-2 py-0.5 rounded-full border border-white/10 flex items-center gap-1 shrink-0">
                        <Rocket size={10} className="text-indigo-200" />
                        <span>{Math.floor(totalVaultValue / 15000)} Lots</span>
                    </div>
                </div>
                <div className="flex items-baseline justify-between mt-0.5">
                    <h2 className="text-2xl font-black font-mono tracking-tight">{formatCurrency(totalVaultValue)}</h2>
                </div>

                {/* Self Treasury Sub-bar */}
                {selfAccount && (
                    <div className="mt-2.5 pt-2 border-t border-white/15 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-indigo-100 text-[11px] font-medium">Self Treasury:</span>
                        </div>
                        <span className="font-mono font-bold text-emerald-300 text-xs sm:text-sm">
                            {formatCurrency(selfAccount.balance)}
                        </span>
                    </div>
                )}
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 min-h-[220px]">
                {isAddMode ? (
                    <form onSubmit={handleAddFriend} className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2.5 animate-in fade-in">
                        <div className="flex justify-between items-center">
                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Add Syndicate Member</h4>
                            <button type="button" onClick={() => setIsAddMode(false)} className="text-xs text-rose-500 font-bold hover:underline">Cancel</button>
                        </div>
                        <input
                            type="text"
                            placeholder="Full Name (e.g. Bhanudeep, Mom)"
                            value={newFriendName}
                            onChange={(e) => setNewFriendName(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-indigo-500 font-medium"
                            autoFocus
                            required
                        />
                        <input
                            type="text"
                            placeholder="Default UPI ID (e.g. name@oksbi - optional)"
                            value={friendUpi}
                            onChange={(e) => setFriendUpi(e.target.value)}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-indigo-500 font-mono"
                        />
                        <div className="relative">
                            <span className="absolute left-3 top-1.5 text-slate-400 text-xs font-mono">₹</span>
                            <input
                                type="number"
                                placeholder="Initial Capital from Self (e.g. 15000)"
                                value={initialBalance}
                                onChange={(e) => setInitialBalance(e.target.value)}
                                className="w-full pl-6 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-indigo-500 font-mono"
                            />
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-500/20">
                            Register Partner & Fund
                        </button>
                    </form>
                ) : selectedFriend ? (
                    <div className="p-3.5 bg-slate-50/90 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col justify-between space-y-3 animate-in fade-in">
                        {/* Member Header */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <button
                                    onClick={() => setSelectedFriendId(null)}
                                    className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                    ← Back to Members
                                </button>
                                {selectedFriend.name.toLowerCase() !== 'self' && (
                                    <button onClick={() => handleDelete(selectedFriend.id!)} className="text-slate-400 hover:text-rose-500 transition-colors" title="Delete member">
                                        <Trash2 size={13} />
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/60">
                                <div
                                    className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-xs shrink-0"
                                    style={{ backgroundColor: selectedFriend.color || '#6366f1' }}
                                >
                                    {selectedFriend.name[0]}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">{selectedFriend.name}</h4>
                                    <p className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                                        <span>Won: <strong className="text-emerald-600">+{formatCurrency(selectedFriend.totalProfits || 0)}</strong></span>
                                        <span>&bull; {Math.floor(selectedFriend.balance / 15000)} Lot(s)</span>
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    {isEditingBalance ? (
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                autoFocus
                                                value={customBalanceInput}
                                                placeholder={String(selectedFriend.balance)}
                                                onChange={(e) => setCustomBalanceInput(e.target.value)}
                                                className="w-20 px-1.5 py-0.5 text-xs font-mono font-bold bg-slate-100 dark:bg-slate-800 border border-indigo-400 rounded-lg outline-none text-slate-900 dark:text-white"
                                            />
                                            <button
                                                onClick={handleSaveCustomBalance}
                                                className="p-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs"
                                                title="Save Balance"
                                            >
                                                <Check size={11} />
                                            </button>
                                            <button
                                                onClick={() => setIsEditingBalance(false)}
                                                className="p-1 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300"
                                                title="Cancel"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 justify-end">
                                            <div>
                                                <p className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400">
                                                    {formatCurrency(selectedFriend.balance)}
                                                </p>
                                                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">Balance</span>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    setCustomBalanceInput(String(selectedFriend.balance));
                                                    setIsEditingBalance(true);
                                                }}
                                                title="Directly calibrate balance"
                                                className="p-1 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-md transition-colors"
                                            >
                                                <Pencil size={11} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Transfer Action Selector */}
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-xl">
                                <button
                                    type="button"
                                    onClick={() => setTransferMode('TRANSFER_TO_MEMBER')}
                                    className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all ${transferMode === 'TRANSFER_TO_MEMBER' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
                                >
                                    Send from Self
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTransferMode('RETURN_TO_SELF')}
                                    className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all ${transferMode === 'RETURN_TO_SELF' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
                                >
                                    Return to Self
                                </button>
                            </div>

                            {/* Quick Lot Presets - Square Action Buttons */}
                            <div className="grid grid-cols-4 gap-1.5">
                                {[
                                    { label: '1 Lot', sub: '₹15k', val: '15000' },
                                    { label: '2 Lots', sub: '₹30k', val: '30000' },
                                    { label: '5 Lots', sub: '₹75k', val: '75000' },
                                    { 
                                        label: 'Max', 
                                        sub: 'All', 
                                        val: transferMode === 'TRANSFER_TO_MEMBER' ? String(selfBalance) : String(selectedFriend.balance) 
                                    },
                                ].map((preset) => {
                                    const isSelected = transferAmount === preset.val && preset.val !== '' && preset.val !== '0';
                                    const activeGradient = transferMode === 'TRANSFER_TO_MEMBER'
                                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/30 scale-[1.03]'
                                        : 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white border-emerald-500 shadow-md ring-2 ring-emerald-500/30 scale-[1.03]';

                                    return (
                                        <button
                                            key={preset.label}
                                            type="button"
                                            onClick={() => setTransferAmount(preset.val)}
                                            className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border text-center transition-all duration-150 cursor-pointer ${
                                                isSelected
                                                    ? activeGradient
                                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                                            }`}
                                        >
                                            <span className={`text-[11px] font-bold tracking-tight ${isSelected ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>
                                                {preset.label}
                                            </span>
                                            <span className={`text-[9px] font-mono font-bold mt-0.5 ${isSelected ? 'text-white/80' : 'text-slate-400 dark:text-slate-500'}`}>
                                                {preset.sub}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Amount Input */}
                            <div className="space-y-1.5">
                                <div className="relative">
                                    <span className="absolute left-3 top-2 text-slate-400 text-xs font-mono font-bold">₹</span>
                                    <input
                                        type="number"
                                        placeholder="Enter amount to transfer"
                                        value={transferAmount}
                                        onChange={(e) => setTransferAmount(e.target.value)}
                                        className="w-full pl-7 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Optional note (e.g. IPO Lot transfer)"
                                    value={transferNote}
                                    onChange={(e) => setTransferNote(e.target.value)}
                                    className="w-full px-3 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] outline-none focus:border-indigo-500 text-slate-600 dark:text-slate-300"
                                />
                            </div>

                            {/* Success / Error Notice */}
                            {transferSuccess && (
                                <div className="p-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 text-[11px] flex items-center gap-1.5 font-medium animate-in fade-in">
                                    <CheckCircle2 size={13} className="shrink-0" />
                                    <span>{transferSuccess}</span>
                                </div>
                            )}
                            {transferError && (
                                <div className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-[11px] flex items-center gap-1.5 font-medium animate-in fade-in">
                                    <AlertCircle size={13} className="shrink-0" />
                                    <span>{transferError}</span>
                                </div>
                            )}

                            {/* Execute Button */}
                            <button
                                onClick={handleTransferExecute}
                                disabled={!transferAmount || parseFloat(transferAmount) <= 0}
                                className={`w-full py-2 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 transition-all shadow-sm ${transferMode === 'TRANSFER_TO_MEMBER'
                                        ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20 disabled:opacity-50'
                                        : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20 disabled:opacity-50'
                                    }`}
                            >
                                <Send size={12} />
                                {transferMode === 'TRANSFER_TO_MEMBER'
                                    ? `Deduct from Self & Send to ${selectedFriend.name}`
                                    : `Deduct from ${selectedFriend.name} & Return to Self`}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {/* Featured Self Card */}
                        {selfAccount && (
                            <div
                                onClick={() => setSelectedFriendId(selfAccount.id!)}
                                className="flex items-center justify-between p-3 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/50 cursor-pointer hover:border-indigo-400 transition-all group"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-2xl flex items-center justify-center text-xs font-black text-white bg-indigo-600 shadow-xs">
                                        S
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-xs font-black text-indigo-950 dark:text-indigo-200">Self (Master Treasury)</p>
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-indigo-200/60 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300">
                                                Primary
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            {selfAccount.history?.filter(h => h.type === 'PROFIT').length || 0} IPOs Won &bull; Realized: +{formatCurrency(selfAccount.totalProfits || 0)}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-mono font-black text-emerald-600 dark:text-emerald-400">
                                        {formatCurrency(selfAccount.balance)}
                                    </p>
                                    <span className="text-[10px] text-indigo-500 font-bold group-hover:underline flex items-center justify-end gap-0.5">
                                        Manage <ChevronRight size={12} />
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Other Syndicate Members */}
                        {memberFriends.map(friend => (
                            <div
                                key={friend.id}
                                onClick={() => setSelectedFriendId(friend.id!)}
                                className="flex items-center justify-between p-2.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-transparent hover:border-slate-200 dark:hover:border-slate-700/80 cursor-pointer transition-all group"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div
                                        className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-xs shrink-0"
                                        style={{ backgroundColor: friend.color || '#6366f1' }}
                                    >
                                        {friend.name[0]}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                            {friend.name}
                                        </p>
                                        <p className="text-[10px] text-slate-400 truncate">
                                            {Math.floor(friend.balance / 15000)} Lot(s) &bull; {friend.history?.filter(h => h.type === 'PROFIT').length || 0} Wins
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className={`text-xs font-mono font-bold ${friend.balance > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                        {formatCurrency(friend.balance)}
                                    </p>
                                    <ChevronRight size={13} className="ml-auto text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </div>
                        ))}

                        {memberFriends.length === 0 && (
                            <div className="text-center py-6 text-slate-400">
                                <Users size={24} className="mx-auto mb-1.5 opacity-40 text-indigo-400" />
                                <p className="text-xs font-medium">No partner accounts registered yet.</p>
                                <button onClick={() => setIsAddMode(true)} className="text-xs text-indigo-500 font-bold mt-1.5 hover:underline">
                                    + Add First Partner
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Passbook History Modal */}
            <SyndicatePassbookModal
                isOpen={isPassbookOpen}
                onClose={() => setIsPassbookOpen(false)}
                friends={friends}
            />
        </div>
    );
};
export default IPOVaultWidget;
