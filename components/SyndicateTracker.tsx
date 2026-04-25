
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { liveQuery } from 'dexie';
import { useToast } from './shared/ToastProvider';
import { db, IPOApplication, Friend, Trade, RealizedTransaction } from '../database';
import { Investment, InvestmentType } from '../types';
import { Users, RefreshCw, ShieldCheck, Plus, Trash2, BarChart4, Rocket, CheckCircle2, ArrowRight, Wallet, ChevronDown, ChevronRight, LayoutList, GripVertical } from 'lucide-react';
import { formatCurrency } from '../utils/helpers';
import {
    ListingDayEvent, CapitalStack, SyndicateForm, SyndicateTable, ArchivedList, AutocompleteInput, StatusBadge, ActionButtons, AllotmentModal
} from './ipo';
import { IPOCalendarWidget } from './market/IPOCalendarWidget';
import { IPOVaultWidget } from './market/IPOVaultWidget';
import { findMatchingVaultFriend, normalizeSyndicateName } from '../services/SyndicateNameResolver';
import { syncEngine } from '../services/SyncEngine';

interface SyndicateTrackerProps {
    totalCash: number;
    onPortfolioRefresh?: () => void;
    onDataChange?: () => void;
    onSelectIpo?: (ipo: any) => void;
}

const cleanIpoName = (name: string): string => {
    return (name || '').trim().replace(/\s+/g, ' ');
};

const SyndicateTracker: React.FC<SyndicateTrackerProps> = ({ totalCash, onPortfolioRefresh, onDataChange, onSelectIpo }) => {
    const { toast } = useToast();
    const [applications, setApplications] = useState<IPOApplication[]>([]);
    const [formData, setFormData] = useState<Partial<IPOApplication>>({
        status: 'BLOCKED',
        amount: 15000,
        quota: 'RETAIL',
        ipoType: 'MAINBOARD',
        appliedDate: new Date().toISOString().split('T')[0]
    });
    const [formError, setFormError] = useState<string | null>(null);

    // Vault Integration
    const [friends, setFriends] = useState<Friend[]>([]);

    useEffect(() => {
        const subscription = liveQuery(() => db.friends.toArray()).subscribe(items => {
            setFriends((items || []).filter(f => !(f as any).isDeleted));
        });
        return () => subscription.unsubscribe();
    }, []);

    // View Mode: 'LIST' or 'GROUPED' (Default to 'GROUPED' as requested)
    const [viewMode, setViewMode] = useState<'LIST' | 'GROUPED'>('GROUPED');
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

    // Allotment Capital Modal State
    const [allotmentModalApp, setAllotmentModalApp] = useState<IPOApplication | null>(null);
    const [isAllotmentModalOpen, setIsAllotmentModalOpen] = useState(false);

    // Listing Day Logic State
    const [selectedIPO, setSelectedIPO] = useState<string>('');
    const [listingMode, setListingMode] = useState<'PERCENT' | 'PRICE'>('PERCENT');
    const [listingGainPct, setListingGainPct] = useState<string>('');
    const [listingPrice, setListingPrice] = useState<string>('');
    const [issuePrice, setIssuePrice] = useState<string>('');
    const [isSyncing, setIsSyncing] = useState(false);

    const [syncSuccess, setSyncSuccess] = useState(false);
    const [realizedGains, setRealizedGains] = useState(0);

    const applicantInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadApplications();
        const handleCloudRestored = () => {
            loadApplications();
        };
        window.addEventListener('wealthos-cloud-restored', handleCloudRestored);
        return () => {
            window.removeEventListener('wealthos-cloud-restored', handleCloudRestored);
        };
    }, []);

    const loadApplications = async () => {
        const raw = await db.ipo_applications.toArray();
        const data = raw.filter(a => !(a as any).isDeleted);
        
        // Auto-migrate: Map missing quota, ipoType, AND sanitize ipoName (trim trailing/leading spaces & collapse multi-spaces)
        for (const app of data) {
            let updates: any = {};
            if (!app.quota) {
                app.quota = 'RETAIL';
                updates.quota = 'RETAIL';
            }
            if (!app.ipoType) {
                app.ipoType = 'MAINBOARD';
                updates.ipoType = 'MAINBOARD';
            }
            if (app.ipoName) {
                const cleaned = cleanIpoName(app.ipoName);
                if (cleaned !== app.ipoName) {
                    app.ipoName = cleaned;
                    updates.ipoName = cleaned;
                }
            }
            if (Object.keys(updates).length > 0) {
                await db.ipo_applications.update(app.id!, updates);
            }
        }

        // Sort by date descending (newest first)
        data.sort((a, b) => new Date(b.appliedDate).getTime() - new Date(a.appliedDate).getTime());
        setApplications(data);

        // Calculate Realized Gains from Investments (Platform = Syndicate)
        const syndicateInv = await db.investments.where('platform').equals('Syndicate').toArray();

        // --- CLEANUP LOGIC (Cycle 17.1 Fixing Data Integrity) ---
        // Instead of hard-deleting orphans (which caused data loss during restores),
        // we flag them or filter them gracefully. A true fix requires a soft-delete mechanism.
        
        // Clean up any zero refund trades that were mistakenly logged into db.trades
        try {
            const zeroRefundTrades = await db.trades
                .filter((t: any) => {
                    const tickerUpper = (t.ticker || '').toUpperCase();
                    const notesUpper = (t.notes || '').toUpperCase();
                    const isRefundTicker = tickerUpper.includes('REFUND');
                    const isRefundNote = notesUpper.includes('REFUND') || notesUpper.includes('CAPITAL REFUND');
                    const isRefundTag = Array.isArray(t.tags) && t.tags.some((tag: string) => (tag || '').toUpperCase().includes('REFUND'));
                    return isRefundTicker || isRefundNote || isRefundTag;
                })
                .toArray();
            if (zeroRefundTrades.length > 0) {
                const ids = zeroRefundTrades.map((t: any) => t.id).filter((id): id is number => typeof id === 'number');
                await db.trades.bulkDelete(ids);
            }
        } catch (err) {
            console.warn('Failed to cleanup zero refund trades:', err);
        }

        const validListedIPONames = new Set(
            data.filter(app => app.status === 'LISTED').map(app => cleanIpoName(app.ipoName).toLowerCase())
        );

        // Identify orphan investments (those with no matching listed application)
        const orphanInvestments = syndicateInv.filter(inv => {
            // Investment name format is "IPO Gain: [IPOName]"
            const ipoNameClean = cleanIpoName(inv.name.replace('IPO Gain: ', '')).toLowerCase();
            return !validListedIPONames.has(ipoNameClean) && inv.status !== 'ARCHIVED';
        });

        // Soft-delete: Mark orphans as ARCHIVED to remove them from active totals
        // without destroying the historical record, ensuring restores don't lose data.
        if (orphanInvestments.length > 0) {
            const updatePromises = orphanInvestments.map(inv => 
                db.investments.update(inv.id, { status: 'ARCHIVED' })
            );
            await Promise.all(updatePromises);
            console.log(`Soft-deleted ${orphanInvestments.length} orphaned IPO investments.`);
        }

        // Use ALL syndicate investments for calculation, filtering out newly archived orphans
        const validInv = syndicateInv.filter(inv => !orphanInvestments.includes(inv));

        // Fetch realized transactions to get accurate archived gains
        const validInvIds = validInv.map(inv => inv.id);
        const realizedTxs = await db.realized_transactions.where('investmentId').anyOf(validInvIds).toArray();
        const realizedPlMap: Record<string, number> = {};
        realizedTxs.forEach(tx => {
            realizedPlMap[tx.investmentId] = (realizedPlMap[tx.investmentId] || 0) + tx.realizedPL;
        });

        // Calculate total realized profit perfectly matching the Portfolio Hub logic
        let totalRealized = 0;
        validInv.forEach(inv => {
            if (inv.status === 'ARCHIVED') {
                // If it's archived, profit relies on the realized_transaction log
                totalRealized += (realizedPlMap[inv.id as string] || 0);
            } else {
                // If active, profit is the current value minus invested amount
                // Also check if there's any partial realized profit logged
                const partialRealized = realizedPlMap[inv.id as string] || 0;
                totalRealized += (inv.currentValue - inv.investedAmount) + partialRealized;
            }
        });

        setRealizedGains(totalRealized);

        if (onDataChange) onDataChange();
    };

    const blockedCapital = applications
        .filter(app => app.status === 'BLOCKED')
        .reduce((acc, curr) => acc + curr.amount, 0);

    // Group active applications logic
    // USER REQUEST: Group exclusively by clean IPO name (case-insensitive & whitespace normalized)
    const displayApplications = applications;

    // Capital stats should exclude LISTED (Realized) as that money is liquid again
    const capitalApps = applications.filter(app => app.status !== 'LISTED');
    const totalActiveCapital = capitalApps.reduce((acc, curr) => acc + curr.amount, 0);

    // Fix: Use totalActiveCapital as fallback for displayTotal to prevent NaN/Overflow if totalCash is 0 or < active amount
    const displayTotal = Math.max(totalCash || 0, totalActiveCapital);
    const availableCapital = totalCash - blockedCapital;
    const isCapitalDanger = availableCapital < 0;

    const groupedApps = useMemo(() => {
        const groups: Record<string, { displayName: string; apps: IPOApplication[] }> = {};
        displayApplications.forEach(app => {
            if (!app.ipoName) return;
            const cleaned = cleanIpoName(app.ipoName);
            const key = cleaned.toLowerCase();
            if (!groups[key]) {
                groups[key] = { displayName: cleaned, apps: [] };
            }
            groups[key].apps.push(app);
        });

        const finalGroups: Record<string, IPOApplication[]> = {};
        Object.values(groups).forEach(({ displayName, apps }) => {
            finalGroups[displayName] = apps;
        });
        return finalGroups;
    }, [displayApplications]);

    // Stack Visualizer Data (Includes all historical applications for complete win rate & allotment intelligence)
    const stackData = useMemo(() => {
        const allGroups: Record<string, { displayName: string; allApps: IPOApplication[]; totalAmount: number }> = {};
        displayApplications.forEach(app => {
            if (!app.ipoName) return;
            const cleaned = cleanIpoName(app.ipoName);
            const key = cleaned.toLowerCase();
            if (!allGroups[key]) {
                allGroups[key] = { displayName: cleaned, allApps: [], totalAmount: 0 };
            }
            allGroups[key].allApps.push(app);
            allGroups[key].totalAmount += (app.allottedAmount ?? app.amount);
        });

        return Object.values(allGroups).map(({ displayName, allApps, totalAmount }) => ({
            name: displayName,
            amount: totalAmount,
            count: allApps.length,
            apps: allApps
        })).sort((a, b) => b.amount - a.amount);
    }, [displayApplications]);

    // Unique IPOs available for listing (must have at least one ALLOTTED)
    const availableForListing = useMemo(() => {
        const allottedMap = new Map<string, string>(); // key -> displayName
        applications
            .filter(app => app.status === 'ALLOTTED')
            .forEach(app => {
                if (app.ipoName) {
                    const cleaned = cleanIpoName(app.ipoName);
                    const key = cleaned.toLowerCase();
                    if (!allottedMap.has(key)) {
                        allottedMap.set(key, cleaned);
                    }
                }
            });
        return Array.from(allottedMap.values());
    }, [applications]);

    // Memory for Autocomplete
    const pastApplicants = useMemo(() => Array.from(new Set(applications.map(a => a.applicantName?.trim()).filter(Boolean))), [applications]);
    const pastIPONames = useMemo(() => Array.from(new Set(applications.map(a => cleanIpoName(a.ipoName)).filter(Boolean))), [applications]);
    const pastUPIs = useMemo(() => Array.from(new Set(applications.map(a => a.upiHandle?.trim()).filter(Boolean))), [applications]);

    // Map each applicant to their last known UPI handle for 1-click auto-fill
    const applicantUpiMap = useMemo(() => {
        const map: Record<string, string> = {};
        [...applications].reverse().forEach(app => {
            if (app.applicantName && app.upiHandle) {
                map[app.applicantName.trim().toLowerCase()] = app.upiHandle.trim();
            }
        });
        return map;
    }, [applications]);

    // Track applicants already entered for the currently selected IPO in the form
    const appliedApplicantsForCurrentIpo = useMemo(() => {
        if (!formData.ipoName) return new Set<string>();
        const targetClean = cleanIpoName(formData.ipoName).toLowerCase();
        const set = new Set<string>();
        applications.forEach(app => {
            if (app.ipoName && cleanIpoName(app.ipoName).toLowerCase() === targetClean && app.applicantName) {
                set.add(app.applicantName.trim().toLowerCase());
            }
        });
        return set;
    }, [formData.ipoName, applications]);

    // Vault: Filter friends with enough balance (optional visual cue, logic is strict)
    const activeFriends = useMemo(() => friends || [], [friends]);

    const STACK_COLORS = ['bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500'];


    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.applicantName || !formData.ipoName || !formData.upiHandle || !formData.amount) {
            setFormError("All fields required");
            return;
        }

        const cleanInputIpoName = cleanIpoName(formData.ipoName);
        const normKey = cleanInputIpoName.toLowerCase();
        const existingApp = applications.find(a => a.ipoName && cleanIpoName(a.ipoName).toLowerCase() === normKey);
        const finalIpoName = existingApp ? cleanIpoName(existingApp.ipoName) : cleanInputIpoName;

        const nowMs = Date.now();
        const payload: Partial<IPOApplication> = {
            ...formData,
            ipoName: finalIpoName,
            applicantName: formData.applicantName.trim(),
            upiHandle: formData.upiHandle.trim(),
            updated_at: nowMs
        } as any;

        // VAULT LOGIC: Auto-Debit
        const friend = findMatchingVaultFriend(payload.applicantName || '', friends);
        if (friend) {
            const newBalance = friend.balance - (payload.amount || 0);
            await db.friends.update(friend.id!, {
                balance: newBalance,
                updated_at: nowMs,
                history: [
                    ...(friend.history || []),
                    {
                        date: new Date().toISOString(),
                        amount: payload.amount || 0,
                        type: 'BLOCKED',
                        notes: `Applied for ${payload.ipoName}`
                    }
                ]
            } as any);
            if (friend.balance < (payload.amount || 0)) {
                toast.warning(`Debited ₹${payload.amount} from ${friend.name}'s Vault (Low Balance: ₹${formatCurrency(newBalance)})`);
            } else {
                toast.success(`Debited ₹${payload.amount} from ${friend.name}'s Vault`);
            }
        }

        await db.ipo_applications.add(payload as IPOApplication);
        syncEngine.notifyDataChanged('friends');
        syncEngine.notifyDataChanged('ipo_applications');

        // Smart Reset for Bulk Entry
        const currentAmount = payload.amount;

        setFormData({
            status: 'BLOCKED',
            amount: currentAmount, // Keep amount same
            applicantName: '', // Reset applicant
            ipoName: finalIpoName, // Keep canonical IPO name
            upiHandle: '', // Reset UPI
            quota: 'RETAIL',
            ipoType: 'MAINBOARD',
            appliedDate: new Date().toISOString().split('T')[0]
        });
        setFormError(null);
        loadApplications();

        // Auto-expand the group we just added to
        setExpandedGroups(prev => {
            const exists = prev.some(g => cleanIpoName(g).toLowerCase() === normKey);
            return exists ? prev : [...prev, finalIpoName];
        });

        // Focus back on applicant name for rapid entry
        applicantInputRef.current?.focus();
    };

    const updateStatus = useCallback(async (id: number, status: IPOApplication['status']) => {
        // Vault Logic: Handle Refunds/Revocations in an atomic transaction
        const app = await db.ipo_applications.get(id);
        if (app) {
            if (status === 'ALLOTTED') {
                setAllotmentModalApp(app);
                setIsAllotmentModalOpen(true);
                return;
            }

            // Determine if money should be returned
            const isRefund = status === 'REFUNDED' || status === 'Revoked' as any; // Handle loose typing if needed
            const wasBlockedOrAllotted = app.status === 'BLOCKED' || app.status === 'ALLOTTED';

            const nowMs = Date.now();
            await db.transaction('rw', [db.friends, db.ipo_applications], async () => {
                if (isRefund && wasBlockedOrAllotted) {
                    const allFriends = await db.friends.toArray();
                    const friend = findMatchingVaultFriend(app.applicantName || '', allFriends);
                    if (friend) {
                        const refundAmount = app.allottedAmount ?? app.amount;
                        const alreadyRefunded = friend.history?.some(h =>
                            h.type === 'REFUND' && h.notes?.includes(`Refund/Revoke: ${app.ipoName}`) && h.amount === refundAmount
                        );

                        if (!alreadyRefunded) {
                            await db.friends.update(friend.id!, {
                                balance: friend.balance + refundAmount,
                                updated_at: nowMs,
                                history: [
                                    ...(friend.history || []),
                                    {
                                        date: new Date().toISOString(),
                                        amount: refundAmount,
                                        type: 'REFUND',
                                        notes: `Refund/Revoke: ${app.ipoName}`
                                    }
                                ]
                            } as any);
                        }
                    }
                }
                await db.ipo_applications.update(id, { status, updated_at: nowMs } as any);
            });
            syncEngine.notifyDataChanged('friends');
            syncEngine.notifyDataChanged('ipo_applications');
        } else {
            await db.ipo_applications.update(id, { status, updated_at: Date.now() } as any);
            syncEngine.notifyDataChanged('ipo_applications');
        }
        loadApplications();
    }, [toast]);

    const confirmAllotment = useCallback(async (appId: number, allottedAmount: number) => {
        const app = await db.ipo_applications.get(appId);
        if (!app) return;

        const appliedAmount = app.amount;
        const isPartialAllotment = allottedAmount < appliedAmount;
        const partialRefund = isPartialAllotment ? appliedAmount - allottedAmount : 0;
        const nowMs = Date.now();

        await db.transaction('rw', [db.friends, db.ipo_applications], async () => {
            if (partialRefund > 0) {
                const allFriends = await db.friends.toArray();
                const friend = findMatchingVaultFriend(app.applicantName || '', allFriends);
                if (friend) {
                    await db.friends.update(friend.id!, {
                        balance: friend.balance + partialRefund,
                        updated_at: nowMs,
                        history: [
                            ...(friend.history || []),
                            {
                                date: new Date().toISOString(),
                                amount: partialRefund,
                                type: 'REFUND',
                                notes: `Partial Allotment Refund: ${app.ipoName} (Retained ₹${allottedAmount.toLocaleString('en-IN')})`
                            }
                        ]
                    } as any);
                }
            }

            await db.ipo_applications.update(appId, {
                status: 'ALLOTTED',
                allottedAmount: allottedAmount,
                updated_at: nowMs
            } as any);
        });

        syncEngine.notifyDataChanged('friends');
        syncEngine.notifyDataChanged('ipo_applications');
        toast.success(`Allotment confirmed for ${app.applicantName} (₹${allottedAmount.toLocaleString('en-IN')})`);
        loadApplications();
    }, [toast]);

    const deleteApp = useCallback(async (id: number) => {
        // Fix #21: Vault Reversal on early deletion wrapped in atomic transaction
        const app = await db.ipo_applications.get(id);
        const nowMs = Date.now();
        if (app && (app.status === 'BLOCKED' || app.status === 'ALLOTTED')) {
            await db.transaction('rw', [db.friends, db.ipo_applications], async () => {
                const allFriends = await db.friends.toArray();
                const friend = findMatchingVaultFriend(app.applicantName || '', allFriends);
                if (friend) {
                    const refundAmount = app.status === 'ALLOTTED' ? (app.allottedAmount ?? app.amount) : app.amount;
                    await db.friends.update(friend.id!, {
                        balance: friend.balance + refundAmount, // Restore balance
                        updated_at: nowMs,
                        history: [
                            ...(friend.history || []),
                            {
                                date: new Date().toISOString(),
                                amount: refundAmount,
                                type: 'REFUND',
                                notes: `App Deleted: ${app.ipoName}`
                            }
                        ]
                    } as any);
                }
                await syncEngine.notifyDeleted('ipo_applications', id);
                await db.ipo_applications.delete(id);
            });
            syncEngine.notifyDataChanged('friends');
        } else {
            await syncEngine.notifyDeleted('ipo_applications', id);
            await db.ipo_applications.delete(id);
        }
        loadApplications();
    }, [loadApplications]);

    const toggleGroup = useCallback((targetName: string) => {
        const targetClean = cleanIpoName(targetName).toLowerCase();
        setExpandedGroups(prev => {
            const exists = prev.some(n => cleanIpoName(n).toLowerCase() === targetClean);
            if (exists) {
                return prev.filter(n => cleanIpoName(n).toLowerCase() !== targetClean);
            } else {
                return [...prev, targetName];
            }
        });
    }, []);

    // --- LISTING DAY LOGIC ---
    const handleRealizeGains = async () => {
        if (!selectedIPO) return;

        let calculatedGainMultiplier = 0;

        if (listingMode === 'PERCENT') {
            if (!listingGainPct) return;
            calculatedGainMultiplier = parseFloat(listingGainPct) / 100;
        } else {
            if (!listingPrice || !issuePrice) return;
            const open = parseFloat(listingPrice);
            const issue = parseFloat(issuePrice);
            if (issue <= 0) return;
            calculatedGainMultiplier = (open - issue) / issue;
        }

        // Fix #6: Negative listing gain validation
        if (calculatedGainMultiplier < 0) {
            toast.warning("Recording negative listing P/L for this IPO into portfolio.");
        }

        setIsSyncing(true);

        // 1. Calculate stats using allottedAmount if present
        const allottedApps = applications.filter(app => app.ipoName === selectedIPO && app.status === 'ALLOTTED');
        if (allottedApps.length === 0) {
            toast.error("No allotted applications found to realize.");
            setIsSyncing(false);
            return;
        }

        // Fix #18: Deduplication guard
        const existingGain = await db.investments.where('name').equals(`IPO Gain: ${selectedIPO}`).first();
        if (existingGain) {
            toast.error("Gains for this IPO have already been realized and recorded.");
            setIsSyncing(false);
            return;
        }

        const totalInvested = allottedApps.reduce((acc, curr) => acc + (curr.allottedAmount ?? curr.amount), 0);
        const profit = totalInvested * calculatedGainMultiplier;
        const totalCurrentValue = totalInvested + profit;

        try {
            // 2. Add to Main Portfolio (Instantly Archived as a realized listing gain)
            const newInvestment: Investment = {
                id: crypto.randomUUID(),
                name: `IPO Gain: ${selectedIPO}`,
                type: InvestmentType.IPO,
                platform: 'Syndicate',
                investedAmount: 0, // Record only the gain, as capital is returned
                currentValue: profit,
                status: 'ARCHIVED',
                lastUpdated: new Date().toISOString()
            };
            await db.investments.add(newInvestment);

            await db.transaction('rw', [db.friends, db.ipo_applications, db.trades, db.realized_transactions], async () => {
                // 2a. Add to Realized Transactions for complete portfolio archive tracking
                const realizedTx: RealizedTransaction = {
                    investmentId: newInvestment.id,
                    assetName: `IPO Gain: ${selectedIPO}`,
                    type: 'FULL_EXIT',
                    saleDate: new Date().toISOString().split('T')[0],
                    saleAmount: profit,
                    costBasis: 0,
                    realizedPL: profit,
                    realizedPLPercent: 100,
                    notes: `Listing Day Realization: ${selectedIPO} (+₹${profit.toFixed(0)})`
                };
                await db.realized_transactions.add(realizedTx);

                // 2b. Automatically log to Trade Journal Calendar (db.trades)
                const issuePriceNum = parseFloat(issuePrice) || 150;
                const listingPriceNum = parseFloat(listingPrice) || (issuePriceNum * (1 + calculatedGainMultiplier));
                const calculatedQty = Math.max(1, Math.round(totalInvested / (issuePriceNum || 1)));

                const ipoTrade: Trade = {
                    ticker: cleanIpoName(selectedIPO),
                    entryPrice: issuePriceNum,
                    exitPrice: listingPriceNum,
                    quantity: calculatedQty,
                    direction: 'Long',
                    date: new Date().toISOString().split('T')[0],
                    entryTime: '09:15',
                    moodEntry: 'Focused',
                    moodExit: profit >= 0 ? 'Satisfied' : 'Regret',
                    mistakes: [],
                    setup: 'Breakout',
                    pnl: profit,
                    fees: 20,
                    assetClass: 'Equity',
                    tags: ['IPO', 'Syndicate', 'ListingGain', cleanIpoName(selectedIPO)],
                    notes: `IPO Listing Day Realization: ${selectedIPO}. Total Allotted Capital: ₹${totalInvested.toLocaleString('en-IN')}, Net Listing Gain: ₹${profit.toFixed(0)}`
                };
                await db.trades.add(ipoTrade);

                // 3. Archive Applications (Mark as LISTED) & Credit Vault
                const allFriends = await db.friends.toArray();
                const updatePromises = allottedApps.map(async (app) => {
                    // Vault Credit Logic based on actual allotted capital paid
                    const friend = findMatchingVaultFriend(app.applicantName || '', allFriends);
                    const nowMs = Date.now();
                    if (friend) {
                        const effectiveCapital = app.allottedAmount ?? app.amount;
                        const totalReturn = effectiveCapital + (effectiveCapital * calculatedGainMultiplier);
                        const profitAmount = effectiveCapital * calculatedGainMultiplier;

                        await db.friends.update(friend.id!, {
                            balance: friend.balance + totalReturn,
                            totalProfits: (friend.totalProfits || 0) + profitAmount,
                            updated_at: nowMs,
                            history: [
                                ...(friend.history || []),
                                {
                                    date: new Date().toISOString(),
                                    amount: totalReturn,
                                    type: 'PROFIT',
                                    notes: `Listing Gain: ${app.ipoName} (+₹${profitAmount.toFixed(0)})`
                                }
                            ]
                        } as any);
                    }
                    return db.ipo_applications.update(app.id!, { status: 'LISTED', updated_at: nowMs } as any);
                });
                await Promise.all(updatePromises);
            });
            syncEngine.notifyDataChanged('friends');
            syncEngine.notifyDataChanged('ipo_applications');
            syncEngine.notifyDataChanged('investments');
            syncEngine.notifyDataChanged('realized_transactions');
            syncEngine.notifyDataChanged('trades');

            // 4. Reset & Notify
            setIsSyncing(false);
            setSyncSuccess(true);
            loadApplications();

            // --- TRIGGER PARENT REFRESH ---
            if (onPortfolioRefresh) {
                onPortfolioRefresh();
            }

            setTimeout(() => {
                setSyncSuccess(false);
                setSelectedIPO('');
                setListingGainPct('');
                setListingPrice('');
                setIssuePrice('');
            }, 3000);

        } catch (err) {
            console.error(err);
            toast.error('Failed to sync with portfolio. Please try again.');
            setIsSyncing(false);
        }
    };

    const previewProfit = useMemo(() => {
        if (!selectedIPO) return 0;
        const totalInvested = applications
            .filter(app => app.ipoName === selectedIPO && app.status === 'ALLOTTED')
            .reduce((acc, curr) => acc + (curr.allottedAmount ?? curr.amount), 0);

        if (listingMode === 'PERCENT') {
            if (!listingGainPct) return 0;
            return totalInvested * (parseFloat(listingGainPct) / 100);
        } else {
            if (!listingPrice || !issuePrice) return 0;
            const open = parseFloat(listingPrice);
            const issue = parseFloat(issuePrice);
            if (issue <= 0) return 0;
            return totalInvested * ((open - issue) / issue);
        }
    }, [selectedIPO, listingMode, listingGainPct, listingPrice, issuePrice, applications]);

    // Computed list of archived apps for display and checking
    const listedApps = useMemo(() => applications.filter(app => app.status === 'LISTED'), [applications]);

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* ALLOTMENT CAPITAL CONFIRMATION MODAL */}
            <AllotmentModal
                app={allotmentModalApp}
                isOpen={isAllotmentModalOpen}
                onClose={() => {
                    setIsAllotmentModalOpen(false);
                    setAllotmentModalApp(null);
                }}
                onConfirm={confirmAllotment}
            />

            {/* LISTING DAY SIMULATOR */}
            <ListingDayEvent
                availableForListing={availableForListing}
                syncSuccess={syncSuccess}
                selectedIPO={selectedIPO}
                setSelectedIPO={setSelectedIPO}
                listingMode={listingMode}
                setListingMode={setListingMode}
                listingGainPct={listingGainPct}
                setListingGainPct={setListingGainPct}
                listingPrice={listingPrice}
                setListingPrice={setListingPrice}
                issuePrice={issuePrice}
                setIssuePrice={setIssuePrice}
                previewProfit={previewProfit}
                handleRealizeGains={handleRealizeGains}
                isSyncing={isSyncing}
                applications={applications}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <div className="lg:col-span-2 min-h-[640px] h-[640px]">
                    <IPOCalendarWidget onSelectIpo={onSelectIpo} />
                </div>
                <div className="lg:col-span-1 min-h-[640px] h-[640px]">
                    <IPOVaultWidget />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">

                {/* VISUALIZER: CAPITAL STACK */}
                <CapitalStack
                    totalCash={totalCash}
                    availableCapital={availableCapital}
                    displayTotal={displayTotal}
                    isCapitalDanger={isCapitalDanger}
                    stackData={stackData}
                />

                {/* Add Application Form */}
                <SyndicateForm
                    formData={formData}
                    setFormData={setFormData}
                    handleAdd={handleAdd}
                    formError={formError}
                    applicantInputRef={applicantInputRef}
                    pastApplicants={pastApplicants}
                    pastUPIs={pastUPIs}
                    pastIPONames={pastIPONames}
                    appliedApplicants={appliedApplicantsForCurrentIpo}
                    applicantUpiMap={applicantUpiMap}
                    setFormError={setFormError}
                    friends={friends}
                />

                {/* Active Syndicate Table */}
                <SyndicateTable
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                    displayApplications={displayApplications}
                    groupedApps={groupedApps}
                    expandedGroups={expandedGroups}
                    toggleGroup={toggleGroup}
                    updateStatus={updateStatus}
                    deleteApp={deleteApp}
                />

                {/* Archived / Listed History */}
                <ArchivedList
                    listedApps={listedApps}
                    realizedGains={realizedGains}
                />
            </div>
        </div>
    );
};

// Local components moved to ./ipo/index.ts

export default SyndicateTracker;
