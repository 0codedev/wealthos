import React, { useState, useCallback, useMemo, useEffect, Suspense, useRef } from 'react';
import { useToast } from '../shared/ToastProvider';
import { COPY } from '../../utils/appCopy';
import { consumeUndo } from '../../lib/undoStack';
import {
    Wallet, PieChart, Coins, Plus, Search, RefreshCw, Scale, ArrowUpRight,
    Circle, LayoutList, Table as TableIcon, Zap, ShieldAlert, Shuffle, Layers,
    ExternalLink, Minimize2, Pin, ChevronDown, MoreVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { PortfolioTabView, PortfolioTabKey } from './portfolio/PortfolioTabView';
import { CompareAssetsModal } from './portfolio/CompareAssetsModal';
import { SyncHoldingsButton } from './portfolio/SyncHoldingsButton';
import { useMarketSentiment } from '../../hooks/useMarketSentiment';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { Investment, InvestmentType, ASSET_CLASS_COLORS } from '../../types';
import { Tabs } from '../ui/AnimatedTabs';
import { AnimatedToggle } from '../ui/AnimatedToggle';
import { ToggleGroup } from '../ui/toggle-group';
import { ContextMenu, ContextMenuItem } from '../ui/ContextMenu';
import { useFamily } from '../../contexts/FamilyContext';
import { useNavigationIntentStore } from '../../store/navigationIntentStore';
import { PortfolioActionProposal } from '../../services/PortfolioActionService';
import { acknowledgeCommandInsight } from '../../services/CommandCenterAcknowledgementService';
import { PortfolioNavRefresh } from '../portfolio/PortfolioNavRefresh';
import { getMfStatus, MfHolding } from '../../services/mfNavRefreshService';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';

// Lazy Loaded Modals for Performance
const AssetSimulatorModal = React.lazy(() => import('../AssetSimulatorModal'));
const BookProfitModal = React.lazy(() => import('../modals/BookProfitModal').then(module => ({ default: module.BookProfitModal }))); // NEW
const RebalancingTool = React.lazy(() => import('../tools/RebalancingTool').then(module => ({ default: module.RebalancingTool })));

import { db, RealizedTransaction, Trade } from '../../database'; // Import DB
import { usePortfolioStore } from '../../store/portfolioStore';
import { useSettingsStore } from '../../store/settingsStore';
import { formatCurrency, calculatePercentage } from '../../utils/helpers';
import { PrivacyValue } from '../shared/PrivacyComponents';
import { useShallow } from 'zustand/react/shallow';
import { usePortfolioEntityView } from '../../hooks/usePortfolioEntityView';

// Type-safe Portfolio Stats interface
interface PortfolioStats {
    totalInvested: number;
    totalCurrent: number;
    totalValue?: number;
    totalPL: number;
    totalPLPercent: number | string; // Can be string from toFixed()
    loanBalance?: number;
    investmentCount?: number;
    totalAssets?: number;
    diversityScore?: number;
    distributionData?: { name: string; value: number }[];
    [key: string]: any; // Allow additional properties from App.tsx
}

interface CustomDropdownProps<T extends string> {
    label: string;
    value: T;
    onChange: (val: T) => void;
    options: { id: T; label: string; icon?: React.ReactNode; colorDot?: string }[];
    designPreset?: string;
}

function CustomDropdown<T extends string>({ label, value, onChange, options, designPreset = 'wealthos-classic' }: CustomDropdownProps<T>) {
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedOption = options.find(o => o.id === value);

    const buttonClass = isAstryx
        ? 'rounded-[6px] border border-white/10 bg-[#262626] text-xs font-semibold text-[#d4d4d4] hover:bg-[#303030] hover:text-white px-2 py-1 md:px-2.5 md:py-1'
        : isReui
        ? 'rounded-md border border-border bg-secondary text-xs font-medium text-secondary-foreground hover:bg-secondary/80 px-2 py-1 md:px-2.5 md:py-1'
        : 'rounded-lg md:rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 text-[10px] md:text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 px-2 py-1 md:px-3 md:py-1.5';

    const menuClass = isAstryx
        ? 'bg-[#262626] border border-white/10 rounded-[8px] text-white shadow-xl'
        : isReui
        ? 'bg-popover border border-border rounded-lg text-popover-foreground shadow-lg'
        : 'bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl';

    return (
        <div ref={containerRef} className="relative z-40 shrink-0">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-1.5 md:gap-2 transition-colors shadow-sm ${buttonClass}`}
            >
                <span className="hidden min-[450px]:inline">{label}:</span>
                <span className="flex items-center gap-1">
                    {selectedOption?.colorDot && (
                        <span className="relative flex h-1.5 w-1.5 md:h-2 md:w-2">
                            {selectedOption.id === 'LOSS' && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                            )}
                            {selectedOption.id === 'PROFIT' && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            )}
                            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 md:h-2 md:w-2 ${selectedOption.colorDot}`}></span>
                        </span>
                    )}
                    {selectedOption?.label}
                </span>
                <ChevronDown className={`text-slate-400 transition-transform duration-200 w-3 h-3 md:w-3.5 md:h-3.5 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className={`absolute right-0 left-auto mt-1.5 min-w-[110px] p-1 flex flex-col gap-0.5 z-50 shadow-xl ${menuClass}`}
                    >
                        {options.map((opt) => {
                            const isSel = opt.id === value;
                            const itemClass = isAstryx
                                ? (isSel ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/5 hover:text-white')
                                : isReui
                                ? (isSel ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')
                                : (isSel ? 'bg-indigo-50 text-indigo-650 dark:bg-indigo-500/10 dark:text-indigo-400' : 'text-slate-650 hover:bg-slate-50 dark:text-slate-450 dark:hover:bg-slate-900/60 dark:hover:text-slate-200');

                            return (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => {
                                        onChange(opt.id);
                                        setIsOpen(false);
                                    }}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold text-left transition-colors ${itemClass}`}
                                >
                                    {opt.colorDot && (
                                        <span className="relative flex h-2 w-2 shrink-0">
                                            {opt.id === 'LOSS' && (
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                                            )}
                                            {opt.id === 'PROFIT' && (
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            )}
                                            <span className={`relative inline-flex rounded-full h-2 w-2 ${opt.colorDot}`}></span>
                                        </span>
                                    )}
                                    {opt.label}
                                </button>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}


interface PortfolioTabProps {
    onAddAsset: () => void;
    onEditAsset: (inv: Investment, e: React.MouseEvent) => void;
    isPrivacyMode: boolean;
    onNavigate?: (tab: string) => void;
}

export const PortfolioTab: React.FC<PortfolioTabProps> = ({
    onAddAsset, onEditAsset, isPrivacyMode, onNavigate
}) => {
    const { toast } = useToast();
    const { isMobile } = useBreakpoint();
    const { status: marketStatus, vix: marketVix } = useMarketSentiment();
    const { activeEntity } = useFamily();
    const navigationIntent = useNavigationIntentStore((state) => state.intent);
    const clearNavigationIntent = useNavigationIntentStore((state) => state.clearIntent);

    const updateInvestment = usePortfolioStore(s => s.updateInvestment);
    const deleteInvestment = usePortfolioStore(s => s.deleteInvestment);
    const enableMutualFunds = useSettingsStore(s => s.enableMutualFunds);
    const designPreset = useSettingsStore(s => s.designPreset) || 'wealthos-classic';
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const entityView = usePortfolioEntityView(activeEntity);
    const investments = entityView.investments;
    const stats = entityView.stats;
    const allocationData = entityView.allocationData;



    const [activeTab, setActiveTab] = useState<PortfolioTabKey>('HOLDINGS');
    const [simulatorAsset, setSimulatorAsset] = useState<Investment | null>(null);
    const [isRebalanceOpen, setIsRebalanceOpen] = useState(false);
    const [isCompareOpen, setIsCompareOpen] = useState(false);
    const [isActionsOpen, setIsActionsOpen] = useState(false);

    // Profit Booking State
    const [bookingProfitAsset, setBookingProfitAsset] = useState<Investment | null>(null);

    const [selectedForCompare, setSelectedForCompare] = useState<Investment[]>([]);

    // Undo Delete State
    const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(new Set());

    // --- Hoisted State for Unified Toolbar ---
    const [searchTerm, setSearchTerm] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [filterType, setFilterType] = useState<'ALL' | 'PROFIT' | 'LOSS'>('ALL');
    const [groupBy, setGroupBy] = useState<'NONE' | 'TYPE' | 'PLATFORM'>('NONE');
    const [viewMode, setViewMode] = useState<'CARD' | 'TERMINAL'>('CARD');
    const [isSpotlightEnabled, setIsSpotlightEnabled] = useState(true);
    const [highlightDiagnostics, setHighlightDiagnostics] = useState(false);
    const [focusActionCategory, setFocusActionCategory] = useState<'rebalance' | 'deploy-cash' | 'trim' | 'tax-harvest' | null>(null);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, tab: string } | null>(null);

    // Split Active vs Archived
    const activeInvestments = useMemo(() =>
        investments.filter(inv => inv.status !== 'ARCHIVED' && !pendingDeletes.has(inv.id)),
        [investments, pendingDeletes]);

    const archivedInvestments = useMemo(() =>
        investments.filter(inv => inv.status === 'ARCHIVED' && !pendingDeletes.has(inv.id)),
        [investments, pendingDeletes]);

    // Use active investments for searching/filtering in tabs
    const filteredInvestments = useMemo(() =>
        activeInvestments.filter(inv => !pendingDeletes.has(inv.id)),
        [activeInvestments, pendingDeletes]);

    // CC53: derive the list of amfi codes the user holds (unique, MF only).
    // When the MF kill switch is OFF, return an empty list so the effect below
    // short-circuits before issuing any setState. This is the primary fix for
    // the "Maximum update depth exceeded" loop on the Portfolio Hub.
    const mfCodes = useMemo(() => {
        if (!enableMutualFunds) return [];
        const set = new Set<string>();
        for (const inv of investments) {
            if (inv.amfiCode && inv.type === 'Mutual Fund') set.add(inv.amfiCode);
        }
        return Array.from(set);
    }, [investments, enableMutualFunds]);

    // CC53: latest NAV map for eCAS drift badge (keyed by amfiCode).
    // Effect is fully gated on `enableMutualFunds` so flipping the kill switch
    // off in Settings → Desktop View stops all MF bridge calls instantly. The
    // previous version could enter a feedback loop when the bridge returned
    // `holdings: []` and the parent re-rendered — see Portfolio Hub render
    // loop incident 2026-06-19.
    const [latestNavs, setLatestNavs] = useState<Record<string, number>>({});
    useEffect(() => {
        if (!enableMutualFunds) {
            // Hard kill switch: never call the bridge, never setState, just bail.
            // (Keep `latestNavs` in its current shape; the drift badge in
            //  HoldingsView also short-circuits on `enableMutualFunds`.)
            return;
        }
        if (mfCodes.length === 0) {
            // Only clear once; returning `{}` unconditionally forces a re-render
            // every time the parent re-renders, which can blow past React's
            // max-update-depth limit on the Portfolio Hub.
            setLatestNavs(prev => (Object.keys(prev).length === 0 ? prev : {}));
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const s = await getMfStatus(mfCodes);
                if (cancelled) return;
                const map: Record<string, number> = {};
                for (const h of s.holdings) map[h.scheme_code] = h.nav;

                // Empty holdings (cold cache, no MF data yet) is a stable
                // state — do not call setState when nothing has changed.
                if (Object.keys(map).length === 0) return;

                setLatestNavs(prev => {
                    const keys1 = Object.keys(map);
                    const keys2 = Object.keys(prev);
                    if (keys1.length !== keys2.length) return map;
                    for (const k of keys1) {
                        if (map[k] !== prev[k]) return map;
                    }
                    return prev;
                });
            } catch {
                // silent — drift badge will be hidden for missing schemes
            }
        })();
        return () => { cancelled = true; };
    }, [mfCodes, enableMutualFunds]);


    // Smart SIP Verification Handler
    const handleAutoSip = useCallback(() => {
        if (!updateInvestment) return;

        // Calculate expected vs applied installments for each SIP
        const sipAssets = filteredInvestments.filter(inv =>
            inv.recurring?.isEnabled && inv.recurring.amount > 0
        );

        if (sipAssets.length === 0) {
            toast.info(COPY.toasts.noActiveSIPs);
            return;
        }

        const today = new Date();
        const todayDay = today.getDate();
        let totalMissed = 0;
        let totalPending = 0;
        let sipsCaughtUp = 0;

        sipAssets.forEach(inv => {
            const recurring = inv.recurring!;
            const sipDay = recurring.sipDay || 5;
            const startDate = recurring.startDate || inv.lastUpdated;
            const appliedInstallments = recurring.installmentsApplied || 0;

            // Calculate expected installments since start date
            const start = new Date(startDate);
            const startYear = start.getFullYear();
            const startMonth = start.getMonth();
            const todayYear = today.getFullYear();
            const todayMonth = today.getMonth();

            let expectedInstallments = 0;
            const totalMonths = (todayYear - startYear) * 12 + (todayMonth - startMonth);

            for (let m = 0; m <= totalMonths; m++) {
                const checkDate = new Date(startYear, startMonth + m, sipDay);
                if (checkDate <= today) {
                    if (m === 0 && start.getDate() > sipDay) continue;
                    expectedInstallments++;
                }
            }

            const missedInstallments = Math.max(0, expectedInstallments - appliedInstallments);

            if (missedInstallments > 0) {
                totalMissed += missedInstallments;
                totalPending += missedInstallments * recurring.amount;

                // Apply all missed installments
                const totalToAdd = missedInstallments * recurring.amount;
                updateInvestment(inv.id, {
                    currentValue: inv.currentValue + totalToAdd,
                    investedAmount: inv.investedAmount + totalToAdd,
                    recurring: {
                        ...recurring,
                        installmentsApplied: expectedInstallments
                    }
                });
                sipsCaughtUp++;
            }
        });

        if (totalMissed > 0) {
            const formattedAmount = new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: 'INR',
                maximumFractionDigits: 0
            }).format(totalPending);

            toast.success(
                `✅ Caught up ${sipsCaughtUp} SIP${sipsCaughtUp > 1 ? 's' : ''}: ${totalMissed} installment${totalMissed > 1 ? 's' : ''} (${formattedAmount}) applied!`,
                { duration: 5000 }
            );
        } else {
            toast.success(`✅ All ${sipAssets.length} SIP${sipAssets.length > 1 ? 's' : ''} are up to date!`);
        }
    }, [filteredInvestments, updateInvestment, toast]);

    // Realized Profit State
    const [realizedPlMap, setRealizedPlMap] = useState<Record<string, { pl: number, cost: number }>>({});

    const fetchRealizedTransactions = useCallback(async () => {
        try {
            const txs = await db.realized_transactions.toArray();
            const map: Record<string, { pl: number, cost: number }> = {};

            txs.forEach(tx => {
                if (!map[tx.investmentId]) {
                    map[tx.investmentId] = { pl: 0, cost: 0 };
                }
                map[tx.investmentId].pl += tx.realizedPL;
                map[tx.investmentId].cost += tx.costBasis;
            });
            
            setRealizedPlMap(prev => {
                const keys1 = Object.keys(map);
                const keys2 = Object.keys(prev);
                if (keys1.length !== keys2.length) return map;
                for (const k of keys1) {
                    if (!prev[k] || map[k].pl !== prev[k].pl || map[k].cost !== prev[k].cost) {
                        return map;
                    }
                }
                return prev;
            });
        } catch (error) {
            console.error("Failed to fetch realized transactions", error);
        }
    }, []);

    useEffect(() => {
        fetchRealizedTransactions();
    }, [fetchRealizedTransactions]);

    useEffect(() => {
        if (!navigationIntent || navigationIntent.target !== 'portfolio') return;

        if (navigationIntent.action === 'broker-sync') {
            if (activeTab !== 'HOLDINGS') {
                setActiveTab('HOLDINGS');
            }
            setHighlightDiagnostics(true);
            setFocusActionCategory(null);
            clearNavigationIntent();
        } else if (
            navigationIntent.action === 'rebalance' ||
            navigationIntent.action === 'deploy-cash' ||
            navigationIntent.action === 'idle-cash' ||
            navigationIntent.action === 'trim' ||
            navigationIntent.action === 'tax-harvest'
        ) {
            if (activeTab !== 'ANALYTICS') {
                setActiveTab('ANALYTICS');
            }
            setHighlightDiagnostics(false);
            setFocusActionCategory(
                navigationIntent.action === 'idle-cash'
                    ? 'deploy-cash'
                    : navigationIntent.action as 'rebalance' | 'deploy-cash' | 'trim' | 'tax-harvest'
            );
            clearNavigationIntent();
        } else if (navigationIntent.action === 'add-from-alpha' || navigationIntent.action === 'open-add-trade-modal') {
            if (activeTab !== 'HOLDINGS') {
                setActiveTab('HOLDINGS');
            }
            // Let App.tsx handle pre-filling and clearing the intent
        } else {
            // Clear any other unhandled intent targeting portfolio to prevent loops
            clearNavigationIntent();
        }
    }, [clearNavigationIntent, navigationIntent, activeTab]);

    useEffect(() => {
        if (!highlightDiagnostics) return;
        const timeout = window.setTimeout(() => setHighlightDiagnostics(false), 5000);
        return () => window.clearTimeout(timeout);
    }, [highlightDiagnostics]);

    const handlePortfolioActionFollowUp = useCallback((proposal: PortfolioActionProposal) => {
        acknowledgeCommandInsight({
            id: `proposal-${proposal.id}`,
            title: proposal.title,
            description: proposal.summary,
            priority: proposal.priority,
            lane: 'portfolio',
            action: proposal.category,
        });
        setFocusActionCategory(proposal.category);

        if (proposal.category === 'rebalance') {
            setActiveTab('REBALANCE');
            return;
        }

        setActiveTab('HOLDINGS');
        if (proposal.target) {
            setSearchTerm(proposal.target);
        }

        if (proposal.category === 'tax-harvest') {
            setFilterType('LOSS');
        } else {
            setFilterType('ALL');
        }
    }, []);

    const handleConfirmBookProfit = async (transaction: Omit<RealizedTransaction, 'id'>, updatedInvestment: Partial<Investment>) => {
        if (!updateInvestment || !bookingProfitAsset) return;

        try {
            // 1. Save Transaction to DB
            await db.realized_transactions.add(transaction as RealizedTransaction);

            // 2. Automatically log to Trade Journal Calendar (db.trades)
            const exitDate = transaction.saleDate || new Date().toISOString().split('T')[0];
            const cleanTicker = bookingProfitAsset.name.replace(/^IPO Gain:\s*/i, '').trim();
            const costBasisNum = transaction.costBasis > 0 ? transaction.costBasis : (transaction.saleAmount || 100);
            const saleAmountNum = transaction.saleAmount || costBasisNum;

            const tradeEntry: Trade = {
                ticker: cleanTicker,
                entryPrice: costBasisNum,
                exitPrice: saleAmountNum,
                quantity: 1,
                direction: 'Long',
                date: exitDate,
                entryTime: '09:15',
                moodEntry: 'Focused',
                moodExit: transaction.realizedPL >= 0 ? 'Satisfied' : 'Regret',
                mistakes: [],
                setup: 'Breakout',
                pnl: transaction.realizedPL,
                fees: 20,
                assetClass: 'Equity',
                tags: ['PortfolioExit', bookingProfitAsset.type, bookingProfitAsset.name.toLowerCase().includes('ipo') ? 'IPO' : 'Holding', cleanTicker],
                notes: `Portfolio Exit for ${bookingProfitAsset.name}. Realized P&L: ₹${transaction.realizedPL.toFixed(0)} (${transaction.type})`
            };
            await db.trades.add(tradeEntry);

            // 3. Update Investment (this updates App state and DB via App's handler)
            updateInvestment(bookingProfitAsset.id, updatedInvestment);

            // 4. Refresh Realized Stats
            fetchRealizedTransactions();

            toast.success(
                transaction.type === 'FULL_EXIT'
                    ? `Profit booked! ${bookingProfitAsset.name} moved to Archive & Trade Journal.`
                    : `Profit booked for ${bookingProfitAsset.name} & Trade Journal updated.`
            );
        } catch (error) {
            console.error("Failed to book profit:", error);
            toast.error("Failed to record transaction");
        }
    };

    const handleSyncInvestmentToJournal = useCallback(async (inv: Investment) => {
        try {
            const cleanName = inv.name.replace(/^IPO Gain:\s*/i, '').trim();
            const dateStr = inv.lastUpdated ? (inv.lastUpdated.includes('T') ? inv.lastUpdated.split('T')[0] : inv.lastUpdated) : new Date().toISOString().split('T')[0];
            const gainVal = inv.currentValue || (inv.currentValue - inv.investedAmount);
            const entryCost = inv.investedAmount > 0 ? inv.investedAmount : (gainVal > 0 ? gainVal : 15000);
            const exitCost = inv.investedAmount > 0 ? inv.currentValue : (gainVal * 2 || 30000);

            const tradeEntry: Trade = {
                ticker: cleanName,
                entryPrice: entryCost,
                exitPrice: exitCost,
                quantity: 1,
                direction: 'Long',
                date: dateStr,
                entryTime: '09:15',
                moodEntry: 'Focused',
                moodExit: gainVal >= 0 ? 'Satisfied' : 'Regret',
                mistakes: [],
                setup: 'Breakout',
                pnl: gainVal,
                fees: 20,
                assetClass: 'Equity',
                tags: ['IPO', 'PortfolioSync', inv.type, cleanName],
                notes: `Synced from Portfolio: ${inv.name}. Value: ₹${inv.currentValue.toLocaleString('en-IN')}, Return: +₹${gainVal.toLocaleString('en-IN')}`
            };

            await db.trades.add(tradeEntry);

            // Automatically archive in portfolio
            if (inv.status !== 'ARCHIVED') {
                updateInvestment(inv.id, { status: 'ARCHIVED' });
                const existingTx = await db.realized_transactions.where('investmentId').equals(inv.id).first();
                if (!existingTx) {
                    await db.realized_transactions.add({
                        investmentId: inv.id,
                        assetName: inv.name,
                        type: 'FULL_EXIT',
                        saleDate: dateStr,
                        saleAmount: inv.currentValue,
                        costBasis: inv.investedAmount,
                        realizedPL: gainVal,
                        realizedPLPercent: inv.investedAmount > 0 ? (gainVal / inv.investedAmount) * 100 : 100,
                        notes: `Synced to Trade Journal & Archived: ${inv.name}`
                    });
                }
                fetchRealizedTransactions();
            }

            toast.success(`✅ Synced "${cleanName}" (+₹${gainVal.toLocaleString('en-IN')}) to Trade Journal & moved to Archive!`);
        } catch (err) {
            console.error("Failed to sync investment to journal:", err);
            toast.error("Failed to sync to Trade Journal");
        }
    }, [toast, updateInvestment, fetchRealizedTransactions]);

    const handleSyncAllIposToJournal = useCallback(async () => {
        try {
            const ipoAssets = investments.filter(inv =>
                inv.type === InvestmentType.IPO ||
                inv.name.toLowerCase().startsWith('ipo') ||
                inv.platform === 'Syndicate'
            );

            if (ipoAssets.length === 0) {
                toast.info("No IPO assets found to sync.");
                return;
            }

            let count = 0;
            for (const inv of ipoAssets) {
                const cleanName = inv.name.replace(/^IPO Gain:\s*/i, '').trim();
                const dateStr = inv.lastUpdated ? (inv.lastUpdated.includes('T') ? inv.lastUpdated.split('T')[0] : inv.lastUpdated) : new Date().toISOString().split('T')[0];
                const gainVal = inv.currentValue || (inv.currentValue - inv.investedAmount);
                const entryCost = inv.investedAmount > 0 ? inv.investedAmount : (gainVal > 0 ? gainVal : 15000);
                const exitCost = inv.investedAmount > 0 ? inv.currentValue : (gainVal * 2 || 30000);

                const tradeEntry: Trade = {
                    ticker: cleanName,
                    entryPrice: entryCost,
                    exitPrice: exitCost,
                    quantity: 1,
                    direction: 'Long',
                    date: dateStr,
                    entryTime: '09:15',
                    moodEntry: 'Focused',
                    moodExit: gainVal >= 0 ? 'Satisfied' : 'Regret',
                    mistakes: [],
                    setup: 'Breakout',
                    pnl: gainVal,
                    fees: 20,
                    assetClass: 'Equity',
                    tags: ['IPO', 'Syndicate', 'ListingGain', cleanName],
                    notes: `Bulk Synced from Portfolio: ${inv.name}. Realized Gain: ₹${gainVal.toLocaleString('en-IN')}`
                };
                await db.trades.add(tradeEntry);

                // Automatically archive in portfolio
                if (inv.status !== 'ARCHIVED') {
                    updateInvestment(inv.id, { status: 'ARCHIVED' });
                    const existingTx = await db.realized_transactions.where('investmentId').equals(inv.id).first();
                    if (!existingTx) {
                        await db.realized_transactions.add({
                            investmentId: inv.id,
                            assetName: inv.name,
                            type: 'FULL_EXIT',
                            saleDate: dateStr,
                            saleAmount: inv.currentValue,
                            costBasis: inv.investedAmount,
                            realizedPL: gainVal,
                            realizedPLPercent: inv.investedAmount > 0 ? (gainVal / inv.investedAmount) * 100 : 100,
                            notes: `Bulk Synced to Trade Journal & Archived: ${inv.name}`
                        });
                    }
                }
                count++;
            }

            fetchRealizedTransactions();
            toast.success(`🚀 Synced and archived ${count} IPO holding(s) to Trade Journal Calendar!`);
        } catch (err) {
            console.error("Failed to bulk sync IPOs:", err);
            toast.error("Failed to bulk sync to Trade Journal");
        }
    }, [investments, toast, updateInvestment, fetchRealizedTransactions]);

    const downloadCSV = useCallback(() => {
        const headers = ["Name", "Type", "Platform", "Invested", "Current", "Last Updated", "Owner"];
        const rows = filteredInvestments.map(i => [i.name, i.type, i.platform, i.investedAmount, i.currentValue, i.lastUpdated, i.owner || 'Self']);
        const csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `wealth_aggregator_${activeEntity}_data.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [filteredInvestments, activeEntity]);

    // Context Menu Trigger
    const handleTabContextMenu = (e: React.MouseEvent, tab: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, tab });
    };

    const contextMenuItems: ContextMenuItem[] = [
        {
            label: "Open in New Window",
            icon: <ExternalLink size={14} />,
            onClick: () => toast.info(`Opening ${contextMenu?.tab} in new window...`)
        },
        {
            label: "Focus Mode",
            icon: <Minimize2 size={14} />,
            onClick: () => toast.info("Focus mode enabled")
        },
        {
            label: "Pin Tab",
            icon: <Pin size={14} />,
            onClick: () => toast.success("Tab pinned to sidebar")
        }
    ];

    // Top-10 #2 — recoverable delete via deleteWithUndo + 30s Undo toast.
    // The store's liveQuery subscription will reflect the soft-delete on
    // the next tick; we no longer need the local pendingDeletes set.
    const handleUndoableDelete = useCallback((inv: Investment, e: React.MouseEvent) => {
        e.stopPropagation();
        deleteInvestment(inv.id)
            .then((entryId) => {
                if (!entryId) {
                    toast.error(COPY.undo.failed);
                    return;
                }
                toast.success(COPY.undo.investmentDeleted(inv.name), {
                    duration: 30000,
                    action: {
                        label: 'Undo',
                        onClick: () => {
                            void consumeUndo(entryId)?.undo();
                        },
                    },
                });
            })
            .catch(() => toast.error(COPY.undo.failed));
    }, [deleteInvestment, toast]);

    return (
        <div className="page-shell space-y-6 animate-in fade-in duration-300 pb-24 md:pb-0 font-sans">
            <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as any)} layoutId="portfolio-sub-nav" motionPreset="luxe">
                {/* Unified Toolbar - Preset-Aware & Non-Squashing Layout */}
                <div
                    className={`relative md:sticky md:top-0 z-30 mb-4 transition-all ${
                        isAstryx
                            ? 'bg-[#1b1b1b] border border-[rgba(255,255,255,0.102)] rounded-[10px] p-1.5 shadow-none'
                            : isReui
                            ? 'bg-card border border-border rounded-xl p-1.5 shadow-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                            : 'bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl p-1.5 md:p-2 rounded-2xl border border-white/20 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.05)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
                    }`}
                    style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}
                >
                    <div className="flex flex-col gap-2 w-full">
                        {/* 1. Navigation Tabs & Asset Count (Full-width dedicated Row 1) */}
                        <div className="flex items-center justify-between gap-2 min-w-0 w-full border-b border-slate-200/50 dark:border-white/[0.06] pb-1.5">
                            <Tabs.List className="flex-nowrap items-center overflow-x-auto scrollbar-hide gap-1 w-full sm:w-auto min-h-[30px] md:min-h-[34px] p-0.5">
                                <Tabs.Trigger value="HOLDINGS" icon={<Wallet size={13} />} title="View Portfolio" className="shrink-0 px-2.5 md:px-3 py-0 text-[10px] md:text-[11px] min-h-[26px] md:min-h-[28px] flex items-center justify-center">Holdings</Tabs.Trigger>
                                <Tabs.Trigger value="ANALYTICS" icon={<PieChart size={13} />} title="Analytics Dashboard" className="shrink-0 px-2.5 md:px-3 py-0 text-[10px] md:text-[11px] min-h-[26px] md:min-h-[28px] flex items-center justify-center">Analytics</Tabs.Trigger>
                                <Tabs.Trigger value="RISK" icon={<ShieldAlert size={13} />} title="Risk Intelligence" className="shrink-0 px-2.5 md:px-3 py-0 text-[10px] md:text-[11px] min-h-[26px] md:min-h-[28px] flex items-center justify-center">Risk</Tabs.Trigger>
                                <Tabs.Trigger value="XRAY" icon={<Layers size={13} />} title="Portfolio X-Ray" className="shrink-0 px-2.5 md:px-3 py-0 text-[10px] md:text-[11px] min-h-[26px] md:min-h-[28px] flex items-center justify-center">X-Ray</Tabs.Trigger>
                                <Tabs.Trigger value="PASSIVE" icon={<Coins size={13} />} title="Passive Income" className="shrink-0 px-2.5 md:px-3 py-0 text-[10px] md:text-[11px] min-h-[26px] md:min-h-[28px] flex items-center justify-center">Passive</Tabs.Trigger>
                                <Tabs.Trigger value="REBALANCE" icon={<Shuffle size={13} />} title="Rebalance Lab" className="shrink-0 px-2.5 md:px-3 py-0 text-[10px] md:text-[11px] min-h-[26px] md:min-h-[28px] flex items-center justify-center">Rebalance</Tabs.Trigger>
                                <div className="w-px h-3.5 bg-slate-200 dark:bg-slate-800 mx-0.5 self-center shrink-0" />
                                <Tabs.Trigger value="KILL_SWITCH" icon={<Zap size={13} className="text-amber-500" />} title="EMERGENCY PANIC" className="shrink-0 px-2.5 md:px-3 py-0 text-[10px] md:text-[11px] min-h-[26px] md:min-h-[28px] flex items-center justify-center">Panic</Tabs.Trigger>
                            </Tabs.List>
                            <span className={`text-[10px] md:text-[11px] font-mono px-2.5 py-0.5 rounded-full font-bold shrink-0 hidden sm:inline-flex items-center ${
                                isAstryx 
                                    ? 'bg-[#262626] text-[#9e9e9e] border border-white/10' 
                                    : isReui 
                                    ? 'bg-secondary text-secondary-foreground border border-border' 
                                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            }`}>
                                {filteredInvestments.length} Assets
                            </span>
                        </div>

                        {/* 2. Actions Hub Toolbar (Full-width dedicated Row 2) */}
                        <div className="flex items-center justify-between gap-2 w-full">
                            <AnimatePresence mode="wait">
                                {activeTab === 'HOLDINGS' ? (
                                    <motion.div
                                        key="holdings-actions"
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 10 }}
                                        className="flex items-center justify-between gap-2 w-full flex-wrap sm:flex-nowrap"
                                    >
                                        {/* Search & Add */}
                                        <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                                            {/* Search Bar */}
                                            <div className={`relative transition-all duration-300 ease-out ${isSearchFocused || searchTerm ? 'flex-1 sm:flex-initial' : 'shrink-0'}`}>
                                                <div className={`flex items-center rounded-lg md:rounded-xl py-1 md:py-1.5 transition-all duration-300 ${
                                                    isAstryx 
                                                        ? 'bg-[#262626] border border-white/10 focus-within:border-white/30' 
                                                        : isReui 
                                                        ? 'bg-muted/50 border border-border focus-within:border-ring' 
                                                        : 'bg-slate-100/80 dark:bg-slate-900/60 border border-transparent focus-within:border-indigo-500/50 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:shadow-[0_0_15px_rgba(99,102,241,0.15)]'
                                                } ${
                                                    isSearchFocused || searchTerm
                                                        ? 'w-full sm:w-44 px-2.5'
                                                        : 'w-8 sm:w-8 px-1.5 justify-center'
                                                }`}>
                                                    <Search
                                                        size={14}
                                                        className={`${isAstryx ? 'text-zinc-400' : isReui ? 'text-muted-foreground' : 'text-slate-400 dark:text-slate-500'} shrink-0 cursor-pointer`}
                                                        onClick={() => searchInputRef.current?.focus()}
                                                    />
                                                    <input
                                                        ref={searchInputRef}
                                                        type="text"
                                                        placeholder="Search..."
                                                        value={searchTerm}
                                                        onFocus={() => setIsSearchFocused(true)}
                                                        onBlur={() => setIsSearchFocused(false)}
                                                        onChange={(e) => setSearchTerm(e.target.value)}
                                                        className={`bg-transparent border-none outline-none text-xs font-medium transition-all duration-300 ${
                                                            isAstryx ? 'text-white placeholder:text-zinc-500' : isReui ? 'text-foreground placeholder:text-muted-foreground' : 'text-slate-900 dark:text-white placeholder:text-slate-400'
                                                        } ${
                                                            isSearchFocused || searchTerm
                                                                ? 'opacity-100 ml-1.5 w-full'
                                                                : 'opacity-0 w-0 pointer-events-none ml-0'
                                                        }`}
                                                    />
                                                </div>
                                            </div>

                                            {/* Add Asset Button (Clamped to 24px matching ToggleGroup and Dropdown) */}
                                            <motion.button
                                                onClick={onAddAsset}
                                                whileHover={{ scale: 1.03 }}
                                                whileTap={{ scale: 0.97 }}
                                                className={`shrink-0 flex items-center justify-center gap-1 transition-all h-[24px] min-h-[24px] max-h-[24px] px-2 !py-0 text-[10px] font-bold leading-none ${
                                                    isAstryx
                                                        ? 'rounded-full bg-white text-black hover:bg-slate-200'
                                                        : isReui
                                                        ? 'rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm'
                                                        : 'bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-sm shadow-indigo-500/20'
                                                }`}
                                                title="Add Asset"
                                            >
                                                <Plus size={12} strokeWidth={2.5} />
                                                <span>Add</span>
                                            </motion.button>

                                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold shrink-0 sm:hidden inline-flex items-center ${
                                                isAstryx 
                                                    ? 'bg-[#262626] text-[#9e9e9e] border border-white/10' 
                                                    : isReui 
                                                    ? 'bg-secondary text-secondary-foreground border border-border' 
                                                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                            }`}>
                                                {filteredInvestments.length}
                                            </span>
                                        </div>

                                        {/* Actions & Controls */}
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <ToggleGroup
                                                options={[
                                                    { value: 'CARD', icon: <LayoutList size={13} />, label: 'Card' },
                                                    { value: 'TERMINAL', icon: <TableIcon size={13} />, label: 'Table' }
                                                ]}
                                                value={viewMode}
                                                onChange={(id) => setViewMode(id as any)}
                                                layoutId="portfolioViewMode"
                                                size="xs"
                                                ariaLabel="Portfolio layout mode"
                                            />
                                            <CustomDropdown
                                                label="Filter"
                                                value={filterType}
                                                onChange={(val) => setFilterType(val as any)}
                                                designPreset={designPreset}
                                                options={[
                                                    { id: 'ALL', label: 'All' },
                                                    { id: 'PROFIT', label: 'Gain', colorDot: 'bg-emerald-500' },
                                                    { id: 'LOSS', label: 'Loss', colorDot: 'bg-violet-500' }
                                                ]}
                                            />
                                            <div className="hidden sm:block">
                                                <CustomDropdown
                                                    label="Group"
                                                    value={groupBy}
                                                    onChange={(val) => setGroupBy(val as any)}
                                                    designPreset={designPreset}
                                                    options={[
                                                        { id: 'NONE', label: 'List' },
                                                        { id: 'TYPE', label: 'Type' },
                                                        { id: 'PLATFORM', label: 'App' }
                                                    ]}
                                                />
                                            </div>
                                            <div className={`hidden sm:flex items-center gap-1 pl-1.5 border-l ${isAstryx ? 'border-white/10' : isReui ? 'border-border' : 'border-slate-200 dark:border-slate-800'}`}>
                                                <PortfolioNavRefresh amfiCodes={mfCodes} />
                                                <SyncHoldingsButton />
                                                <Tooltip content="Smart SIP Check (Catch Up)">
                                                    <Button variant="ghost" size="icon-sm" onClick={handleAutoSip} aria-label="Smart SIP check"><RefreshCw size={14} /></Button>
                                                </Tooltip>
                                                <Tooltip content="Compare Assets">
                                                    <Button variant="ghost" size="icon-sm" onClick={() => setIsCompareOpen(true)} aria-label="Compare assets"><Scale size={14} /></Button>
                                                </Tooltip>
                                                <Tooltip content="Export Portfolio CSV">
                                                    <Button variant="ghost" size="icon-sm" onClick={downloadCSV} aria-label="Export portfolio CSV"><ArrowUpRight size={14} /></Button>
                                                </Tooltip>
                                            </div>
                                        </div>
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="other-actions"
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 10 }}
                                        className="flex items-center gap-2"
                                    >
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={downloadCSV}
                                            title="Export CSV"
                                        >
                                            <ArrowUpRight size={16} />
                                        </Button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {/* Content Area with Optimized AnimatePresence */}
                <div className="relative min-h-[400px]">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 12, scale: 0.995 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.998 }}
                            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                            style={{ willChange: 'transform, opacity' }}
                        >
                            <PortfolioTabView
                                activeTab={activeTab}
                                filteredInvestments={filteredInvestments}
                                archivedInvestments={archivedInvestments}
                                totalAssets={stats.totalAssets ?? 0}
                                allocationData={allocationData}
                                formatCurrency={formatCurrency}
                                isPrivacyMode={isPrivacyMode}
                                focusActionCategory={focusActionCategory}
                                onAddAsset={onAddAsset}
                                onEditAsset={onEditAsset}
                                onDeleteAsset={handleUndoableDelete}
                                onQuickUpdate={updateInvestment}
                                onBookProfit={setBookingProfitAsset}
                                onPortfolioActionFollowUp={handlePortfolioActionFollowUp}
                                onNavigate={onNavigate}
                                setSimulatorAsset={setSimulatorAsset}
                                setActiveTab={setActiveTab}
                                searchTerm={searchTerm}
                                filterType={filterType}
                                groupBy={groupBy}
                                viewMode={viewMode}
                                isSpotlightEnabled={isSpotlightEnabled}
                                highlightDiagnostics={highlightDiagnostics}
                                realizedPlMap={realizedPlMap}
                                calculatePercentage={calculatePercentage}
                                PrivacyValue={PrivacyValue}
                                latestNavs={latestNavs}
                                onSyncToJournal={handleSyncInvestmentToJournal}
                                onSyncAllIposToJournal={handleSyncAllIposToJournal}
                            />
                        </motion.div>
                    </AnimatePresence>
                </div>
            </Tabs.Root>

            {/* Context Menu Portal */}
            <AnimatePresence>
                {contextMenu && (
                    <ContextMenu
                        x={contextMenu.x}
                        y={contextMenu.y}
                        items={contextMenuItems}
                        onClose={() => setContextMenu(null)}
                    />
                )}
            </AnimatePresence>

            {/* Modals with Suspense */}
            <Suspense fallback={null}>
                {simulatorAsset && (
                    <AssetSimulatorModal
                        investment={simulatorAsset}
                        onClose={() => setSimulatorAsset(null)}
                    />
                )}

                {bookingProfitAsset && (
                    <BookProfitModal
                        isOpen={!!bookingProfitAsset}
                        investment={bookingProfitAsset}
                        onClose={() => setBookingProfitAsset(null)}
                        onConfirm={handleConfirmBookProfit}
                        formatCurrency={formatCurrency}
                    />
                )}


                {isRebalanceOpen && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsRebalanceOpen(false)}>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-5xl h-[85vh] shadow-2xl border border-slate-200 dark:border-slate-800 p-6" onClick={e => e.stopPropagation()}>
                            <RebalancingTool
                                allocationData={allocationData}
                                totalValue={stats?.totalAssets || 0}
                                formatCurrency={formatCurrency}
                                onClose={() => setIsRebalanceOpen(false)}
                            />
                        </div>
                    </div>
                )}
            </Suspense>

            {/* Asset Comparison Modal */}
            <CompareAssetsModal
                isOpen={isCompareOpen}
                onClose={() => setIsCompareOpen(false)}
                investments={filteredInvestments}
                selectedForCompare={selectedForCompare}
                setSelectedForCompare={setSelectedForCompare}
                formatCurrency={formatCurrency}
            />
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(PortfolioTab);



