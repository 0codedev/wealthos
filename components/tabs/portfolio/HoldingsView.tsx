import React, { useState, useMemo, useEffect, useDeferredValue, useCallback } from 'react';
import {
    Wallet, ChevronDown, ChevronRight, TrendingUp, Zap, Sparkles,
    LayoutDashboard, Edit2, Trash2, AlertTriangle, ArrowUpRight,
    Keyboard, RefreshCw, Box, ShieldAlert, Info, Activity, Columns, BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Investment, InvestmentType } from '../../../types';
import { RiskEngine } from '../../../services/RiskEngine';
import { useSettingsStore } from '../../../store/settingsStore';
import Sparkline from '../../Sparkline';
import { NoiseTexture } from '../../ui/NoiseTexture';
import { LivePositionsPanel } from '../../portfolio/LivePositionsPanel';
import { LiveMcsMonitor } from '../../portfolio/LiveMcsMonitor';
import { DhanDiagnosticsPanel } from '../../portfolio/DhanDiagnosticsPanel';
import { TradingJournalPnLCard } from '../../portfolio/TradingJournalPnLCard';
import { PortfolioAllocOptWidget } from '../../portfolio/PortfolioAllocOptWidget';
import { upstoxMarketDataService } from '../../../services/UpstoxMarketDataService';
import { useNavigationIntentStore } from '../../../store/navigationIntentStore';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { SkeletonTable, SkeletonCard } from '../../ui/Skeleton';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Tooltip } from '../../ui/tooltip';
import { Card, CardContent } from '../../ui/card';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface HoldingsViewProps {
    investments: Investment[];
    totalAssets: number;
    isLoading?: boolean;
    onAddAsset: () => void;
    onEditAsset: (inv: Investment, e: React.MouseEvent) => void;
    onDeleteAsset: (inv: Investment, e: React.MouseEvent) => void;
    onQuickUpdate?: (id: string, invData: Partial<Investment>) => void;
    onRefreshRecurring?: () => void;
    downloadCSV?: () => void;
    formatCurrency: (val: number) => string;
    calculatePercentage: (part: number, total: number) => string;
    isPrivacyMode: boolean;
    PrivacyValue: React.FC<{ value: string | number, isPrivacyMode: boolean, className?: string }>;
    setSimulatorAsset: (inv: Investment | null) => void;
    latestNavs?: Record<string, number>;

    // Props passed from Parent
    searchTerm: string;
    filterType: 'ALL' | 'PROFIT' | 'LOSS';
    groupBy: 'NONE' | 'TYPE' | 'PLATFORM';
    viewMode: 'CARD' | 'TERMINAL';
    isSpotlightEnabled?: boolean;

    // New Props for Profit Booking
    onBookProfit?: (inv: Investment) => void;
    archivedInvestments?: Investment[];
    realizedPlMap?: Record<string, { pl: number, cost: number }>;
    onNavigate?: (tab: string) => void;
    highlightDiagnostics?: boolean;
    onSyncToJournal?: (inv: Investment) => void;
    onSyncAllIposToJournal?: () => void;
}

interface GroupedData {
    totalInv: number;
    totalCurr: number;
    items: Investment[];
}

interface StockFundamentals {
    score: number;
    pe: number;
    roe: number;
    promoter: number;
    fiiTrend: 'UP' | 'DOWN' | 'FLAT';
    eps: number;
    fairValue: number;
    marginOfSafety: number;
    description: string;
    industry: string;
}

// ============================================================================
// Component
// ============================================================================

export const HoldingsView: React.FC<HoldingsViewProps> = ({
    investments, totalAssets, isLoading, onAddAsset, onEditAsset, onDeleteAsset, onQuickUpdate, onRefreshRecurring,
    formatCurrency, calculatePercentage, isPrivacyMode,
    PrivacyValue, setSimulatorAsset,
    searchTerm, filterType, groupBy, viewMode, isSpotlightEnabled = true,
    onBookProfit, archivedInvestments = [], realizedPlMap = {}, onNavigate, highlightDiagnostics = false,
    latestNavs = {},
    onSyncToJournal,
    onSyncAllIposToJournal,
}) => {
    const isIpoAsset = (inv: Investment) => inv.type === InvestmentType.IPO || inv.name.toLowerCase().includes('ipo') || inv.platform === 'Syndicate';

    const ipoHoldingsCount = useMemo(() => {
        return investments.filter(inv => isIpoAsset(inv)).length;
    }, [investments]);

    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [selectedRowIndex, setSelectedRowIndex] = useState<number>(-1);
    const [editingCell, setEditingCell] = useState<{ id: string, field: 'investedAmount' | 'currentValue' } | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [showArchived, setShowArchived] = useState(false);
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    useEffect(() => {
        if (highlightDiagnostics) {
            setShowDiagnostics(true);
        }
    }, [highlightDiagnostics]);

    const deferredSearchTerm = useDeferredValue(searchTerm);

    // Responsive tiering: the min-w-[850px] terminal table cannot fit a phone,
    // so the card layout becomes automatic below md (768px). Desktop keeps the
    // user's explicit CARD/TERMINAL choice untouched — zero lg+ regression.
    const isMobileViewport = useIsMobile();
    const effectiveViewMode: 'CARD' | 'TERMINAL' = isMobileViewport ? 'CARD' : viewMode;

    const designPreset = useSettingsStore((s) => s.designPreset) || 'wealthos-classic';
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const [visibleColumns, setVisibleColumns] = useState<string[]>(['platform', 'invested', 'current', 'fairValue', 'pl', 'trend', 'alloc', 'actions']);
    const [showColumnToggle, setShowColumnToggle] = useState(false);

    const toggleColumn = (col: string) => {
        setVisibleColumns(prev =>
            prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
        );
    };

    const calculateColSpan = () => {
        let span = 1; // Asset is always visible
        if (visibleColumns.includes('platform')) span++;
        if (visibleColumns.includes('invested')) span++;
        if (visibleColumns.includes('current')) span++;
        if (visibleColumns.includes('fairValue')) span++;
        if (visibleColumns.includes('pl')) span++;
        if (visibleColumns.includes('trend')) span++;
        if (visibleColumns.includes('alloc')) span++;
        if (visibleColumns.includes('actions')) span++;
        return span;
    };

    const bullionCap = useSettingsStore(state => state.bullionCap);
    const greedKillerRoi = useSettingsStore(state => state.greedKillerRoi);
    const enableMutualFunds = useSettingsStore(state => state.enableMutualFunds);

    const riskEngine = useMemo(() => new RiskEngine({
        bullionCap,
        profitThreshold: greedKillerRoi
    }), [bullionCap, greedKillerRoi]);

    // Fundamentals Aggregation & Background Loader
    const [fundamentalsMap, setFundamentalsMap] = useState<Record<string, StockFundamentals>>({});
    const [loadingFundamentals, setLoadingFundamentals] = useState(false);
    const [discrepanciesMap, setDiscrepanciesMap] = useState<Record<string, any>>({});

    useEffect(() => {
        const fetchDiscrepancies = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const res = await fetch('/api/python-nse/api/discrepancies');
                if (res.ok) {
                    const data = await res.json();
                    const map: Record<string, any> = {};
                    (data || []).forEach((d: any) => {
                        const symbol = d.canonical_id.split(":").pop() || d.canonical_id;
                        map[symbol.toUpperCase()] = d;
                    });
                    setDiscrepanciesMap(map);
                }
            } catch (err) {
                console.warn('Failed to fetch discrepancies in HoldingsView:', err);
            }
        };
        fetchDiscrepancies();
        let interval: ReturnType<typeof setInterval> | null = null;
        const startTimer = () => {
            if (interval) clearInterval(interval);
            interval = setInterval(fetchDiscrepancies, 60000);
        };
        if (typeof document !== 'undefined' && !document.hidden) {
            startTimer();
        }
        const onVisibility = () => {
            if (typeof document !== 'undefined' && !document.hidden) {
                void fetchDiscrepancies();
                startTimer();
            } else if (interval) {
                clearInterval(interval);
                interval = null;
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            if (interval) clearInterval(interval);
        };
    }, []);

    const stockInvestments = useMemo(() => {
        return investments.filter(inv => inv.type === InvestmentType.STOCKS && inv.status !== 'ARCHIVED');
    }, [investments]);

    useEffect(() => {
        let isMounted = true;
        // Snapshot `fundamentalsMap` once on effect entry. The effect MUST only
        // re-run when the STOCK LIST changes (the deps array), not when our
        // own state write changes `fundamentalsMap`. Writing inside the
        // effect with a closed-over ref that we then re-derive on the next
        // render = a guaranteed update loop once the parent re-renders
        // frequently (Portfolio Hub render-loop incident 2026-06-19).
        let fundamentalsSnapshot: Record<string, StockFundamentals> = {};
        const loadStockFundamentals = async () => {
            if (stockInvestments.length === 0) return;

            // Only fetch for stocks not already in the map to avoid redundant network calls.
            // Read from the snapshot, not the closed-over `fundamentalsMap` state, so the
            // effect's dep list stays narrow.
            const missingStocks = stockInvestments.filter(inv => !fundamentalsSnapshot[inv.id]);
            if (missingStocks.length === 0) return;

            setLoadingFundamentals(true);
            const newMap: Record<string, StockFundamentals> = { ...fundamentalsSnapshot };

            try {
                // Batch processing to avoid slamming the API
                const batchSize = 3;
                for (let i = 0; i < missingStocks.length; i += batchSize) {
                    if (!isMounted) break;
                    const batch = missingStocks.slice(i, i + batchSize);

                    await Promise.all(batch.map(async (inv) => {
                        const symbol = inv.ticker || inv.name;
                        const isin = inv.dhanSecurityId || 'MOCK_' + symbol;

                        let resolvedIsin = isin;
                        let resolvedSymbol = symbol;
                        try {
                            const resolved = await upstoxMarketDataService.resolveSymbol(symbol);
                            if (resolved?.isin) {
                                resolvedIsin = resolved.isin;
                                resolvedSymbol = resolved.symbol;
                            }
                        } catch (err) { /* ignore */ }

                        try {
                            const [profile, ratios, shareholding, competitors] = await Promise.all([
                                upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'profile', resolvedSymbol),
                                upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'key-ratios', resolvedSymbol),
                                upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'shareholding', resolvedSymbol),
                                upstoxMarketDataService.getCompanyFundamentals(resolvedIsin, 'competitors', resolvedSymbol)
                            ]);

                            if (ratios && shareholding && isMounted) {
                                let score = 0;
                                if (ratios.roe > 15) score += 20;
                                if (ratios.roce > 15) score += 15;
                                if (ratios.debt_to_equity < 0.5) score += 15;
                                if (ratios.revenue_growth_yoy > 10) score += 20;
                                if (ratios.profit_margin_improvement) score += 15;

                                const q = shareholding.quarters;
                                let fiiTrend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
                                if (q && q.length >= 2) {
                                    const latestFii = q[q.length - 1].fii;
                                    const prevFii = q[q.length - 2].fii;
                                    if (latestFii > prevFii) {
                                        score += 15;
                                        fiiTrend = 'UP';
                                    } else if (latestFii < prevFii) {
                                        fiiTrend = 'DOWN';
                                    }
                                }

                                let sectorPE = 25.0;
                                if (competitors && competitors.length > 1) {
                                    const peers = competitors.filter((c: any) => c.symbol !== resolvedSymbol && c.pe > 0);
                                    if (peers.length > 0) {
                                        const sumPE = peers.reduce((sum: number, p: any) => sum + p.pe, 0);
                                        sectorPE = sumPE / peers.length;
                                    }
                                }

                                const eps = ratios.eps || (ratios.net_profit_ttm ? ratios.net_profit_ttm / 50 : 0);
                                const fairValue = eps * sectorPE;
                                const currentPrice = inv.quantity && inv.quantity > 0
                                    ? inv.currentValue / inv.quantity
                                    : inv.currentValue;

                                const marginOfSafety = fairValue > 0
                                    ? (fairValue - currentPrice) / fairValue
                                    : 0;

                                newMap[inv.id] = {
                                    score,
                                    pe: ratios.pe_ratio || 0,
                                    roe: ratios.roe || 0,
                                    promoter: shareholding.promoter || 0,
                                    fiiTrend,
                                    eps,
                                    fairValue,
                                    marginOfSafety,
                                    description: profile?.description || '',
                                    industry: profile?.industry || ''
                               };
                            }
                        } catch (err) {
                            console.error(`Failed to fetch fundamentals for stock: ${symbol}`, err);
                        }
                    }));

                    if (isMounted) {
                        setFundamentalsMap(prev => {
                            // Functional updater: merge into PREVIOUS state so two batches
                            // writing in quick succession don't clobber each other, and so
                            // the write never depends on a closed-over ref that becomes
                            // stale mid-async.
                            const merged = { ...prev, ...newMap };
                            // Skip the setState entirely if nothing actually changed —
                            // prevents a no-op write from triggering a re-render that
                            // would re-evaluate the effect's deps.
                            const prevKeys = Object.keys(prev);
                            const newKeys = Object.keys(merged);
                            if (prevKeys.length === newKeys.length) {
                                let same = true;
                                for (const k of newKeys) {
                                    if (prev[k] !== merged[k]) { same = false; break; }
                                }
                                if (same) return prev;
                            }
                            return merged;
                        });
                    }
                    // Small delay between batches to keep the main thread responsive
                    await new Promise(r => setTimeout(r, 100));
                }
            } catch (err) {
                console.error("Error loading holdings stock fundamentals:", err);
            } finally {
                if (isMounted) setLoadingFundamentals(false);
            }
        };

        // Capture the snapshot ONLY after the first state read is committed for
        // this effect run. Reading `fundamentalsMap` from props at effect entry
        // is safe because the effect's dep list is `[stockInvestments]` and
        // this only changes when the list of stocks changes — never when our
        // own state write changes the map.
        fundamentalsSnapshot = { ...(typeof window !== 'undefined' ? (window as any).__hv_fundamentalsCache || {} : {}) };

        // Use the functional setter's first-call read for the snapshot. We
        // can't read state directly here without a ref, so we read the
        // current value via the functional updater trick on mount.
        setFundamentalsMap(prev => {
            fundamentalsSnapshot = prev;
            return prev; // identity — no actual update
        });

        loadStockFundamentals();
        return () => { isMounted = false; };
    }, [stockInvestments]);

    const { portfolioQualityScore, totalStockValue, averageMarginOfSafety } = useMemo(() => {
        let totalWeightedScore = 0;
        let totalWeightedMos = 0;
        let totalStockVal = 0;
        
        stockInvestments.forEach(inv => {
            const stats = fundamentalsMap[inv.id];
            if (stats) {
                totalWeightedScore += stats.score * inv.currentValue;
                totalWeightedMos += stats.marginOfSafety * inv.currentValue;
                totalStockVal += inv.currentValue;
            }
        });
        
        const portfolioQualityScore = totalStockVal > 0 
            ? Math.round(totalWeightedScore / totalStockVal) 
            : 0;
            
        const averageMarginOfSafety = totalStockVal > 0
            ? totalWeightedMos / totalStockVal
            : 0;
            
        return { portfolioQualityScore, totalStockValue: totalStockVal, averageMarginOfSafety };
    }, [stockInvestments, fundamentalsMap]);

    const toggleGroup = (groupName: string) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupName]: !expandedGroups[groupName]
        }));
    };

    const filteredInvestments = useMemo(() => {
        return investments.filter(inv => {
            const matchesSearch = inv.name.toLowerCase().includes(deferredSearchTerm.toLowerCase()) ||
                inv.platform.toLowerCase().includes(deferredSearchTerm.toLowerCase());
            const profit = inv.currentValue - inv.investedAmount;
            const matchesFilter = filterType === 'ALL' ? true :
                filterType === 'PROFIT' ? profit >= 0 : profit < 0;
            return matchesSearch && matchesFilter;
        });
    }, [investments, deferredSearchTerm, filterType]);


    // Sorting State
    const [sortConfig, setSortConfig] = useState<{ key: keyof Investment | 'profit'; direction: 'asc' | 'desc' } | null>(null);

    const handleSort = (key: keyof Investment | 'profit') => {
        setSortConfig(current => {
            if (!current || current.key !== key) {
                return { key, direction: 'asc' };
            }
            if (current.direction === 'asc') {
                return { key, direction: 'desc' };
            }
            return null; // Reset to default
        });
    };

    const sortedInvestments = useMemo(() => {
        let sortableItems = [...filteredInvestments];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let aValue: any = a[sortConfig.key as keyof Investment];
                let bValue: any = b[sortConfig.key as keyof Investment];

                // Special handling for Profit
                if (sortConfig.key === 'profit') {
                    aValue = a.currentValue - a.investedAmount;
                    bValue = b.currentValue - b.investedAmount;
                }

                // Handle strings (case-insensitive)
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'asc'
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                }

                // Handle numbers
                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [filteredInvestments, sortConfig]);

    const sortedArchivedInvestments = useMemo(() => {
        let sortableItems = [...archivedInvestments];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                let aValue: any = a[sortConfig.key as keyof Investment];
                let bValue: any = b[sortConfig.key as keyof Investment];

                // Special handling for Profit (Realized)
                if (sortConfig.key === 'profit') {
                    aValue = realizedPlMap[a.id]?.pl ?? 0;
                    bValue = realizedPlMap[b.id]?.pl ?? 0;
                }
                // Special handling for Current Value (Exit Value = Cost + Profit)
                else if (sortConfig.key === 'currentValue') {
                    const aCost = realizedPlMap[a.id]?.cost ?? a.investedAmount;
                    const bCost = realizedPlMap[b.id]?.cost ?? b.investedAmount;
                    const aProfit = realizedPlMap[a.id]?.pl ?? 0;
                    const bProfit = realizedPlMap[b.id]?.pl ?? 0;
                    aValue = aCost + aProfit;
                    bValue = bCost + bProfit;
                }
                // Special handling for Invested (Cost Basis)
                else if (sortConfig.key === 'investedAmount') {
                    aValue = realizedPlMap[a.id]?.cost ?? a.investedAmount;
                    bValue = realizedPlMap[b.id]?.cost ?? b.investedAmount;
                }

                // Handle strings (case-insensitive)
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'asc'
                        ? aValue.localeCompare(bValue)
                        : bValue.localeCompare(aValue);
                }

                // Handle numbers
                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [archivedInvestments, sortConfig, realizedPlMap]);

    const groupedInvestments = useMemo(() => {
        if (groupBy === 'NONE') return null;
        const groups: Record<string, GroupedData> = {};
        sortedInvestments.forEach(inv => {
            const key = groupBy === 'TYPE' ? inv.type : inv.platform;
            if (!groups[key]) groups[key] = { totalInv: 0, totalCurr: 0, items: [] };
            groups[key].items.push(inv);
            groups[key].totalInv += inv.investedAmount;
            groups[key].totalCurr += inv.currentValue;
        });
        return groups;
    }, [sortedInvestments, groupBy]);

    // Keyboard Nav
    useEffect(() => {
        if (effectiveViewMode !== 'TERMINAL' || editingCell) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).tagName === 'INPUT') return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedRowIndex(prev => Math.min(prev + 1, sortedInvestments.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedRowIndex(prev => Math.max(prev - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedRowIndex >= 0 && sortedInvestments[selectedRowIndex]) {
                    setSimulatorAsset(sortedInvestments[selectedRowIndex]);
                }
            } else if (e.key === '2') {
                e.preventDefault();
                if (selectedRowIndex >= 0 && sortedInvestments[selectedRowIndex]) {
                    const inv = sortedInvestments[selectedRowIndex];
                    startEditing(inv.id, 'currentValue', inv.currentValue);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [effectiveViewMode, sortedInvestments, selectedRowIndex, editingCell]);

    const startEditing = (id: string, field: 'investedAmount' | 'currentValue', currentValue: number) => {
        if (isPrivacyMode) return;
        setEditingCell({ id, field });
        setEditValue(currentValue.toString());
    };

    const saveInlineEdit = () => {
        if (editingCell && onQuickUpdate) {
            const numVal = parseFloat(editValue);
            if (!isNaN(numVal)) {
                onQuickUpdate(editingCell.id, { [editingCell.field]: numVal });
            }
        }
        setEditingCell(null);
    };

    const renderTerminalRow = (inv: Investment, index: number, isArchived = false) => {
        let profit = 0;
        let profitPercent = "0.00";
        let investedAmount = inv.investedAmount;
        let currentValue = inv.currentValue;

        if (isArchived) {
            profit = realizedPlMap[inv.id]?.pl ?? 0;
            const costBasis = realizedPlMap[inv.id]?.cost ?? inv.investedAmount;
            investedAmount = costBasis;
            profitPercent = (costBasis > 0)
                ? ((profit / costBasis) * 100).toFixed(2)
                : "∞";
            currentValue = costBasis + profit;
        } else {
            profit = inv.currentValue - inv.investedAmount;
            profitPercent = calculatePercentage(profit, inv.investedAmount);
        }

        const isProfit = profit >= 0;
        const portfolioShare = calculatePercentage(inv.currentValue, totalAssets);
        const isSelected = index === selectedRowIndex;
        const isEditingInvested = editingCell?.id === inv.id && editingCell?.field === 'investedAmount';
        const isEditingCurrent = editingCell?.id === inv.id && editingCell?.field === 'currentValue';

        const fundamentals = fundamentalsMap[inv.id];

        return (
            <motion.tr
                key={inv.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className={`group border-b border-slate-200 dark:border-slate-800/50 transition-colors ${isSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'} ${isArchived ? 'opacity-60 grayscale' : ''}`}
                onClick={() => !isArchived && setSelectedRowIndex(index)}
            >
                <td className="py-3 px-4 relative cursor-pointer" onClick={() => !isArchived && setSimulatorAsset(inv)}>
                    {isSelected && <motion.div layoutId="activeRow" className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />}
                    <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded-lg ${isProfit ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                            {inv.type === InvestmentType.STOCKS ? <TrendingUp size={14} /> : inv.type === InvestmentType.CRYPTO ? <Zap size={14} /> : <Wallet size={14} />}
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                                {inv.name}
                                {discrepanciesMap[(inv.ticker || inv.name).toUpperCase()] && (
                                    <span title={`Price divergence flagged: ${(discrepanciesMap[(inv.ticker || inv.name).toUpperCase()].delta * 100).toFixed(2)}% between Upstox & Dhan`}>
                                        <AlertTriangle 
                                            size={12} 
                                            className="text-amber-500 animate-pulse shrink-0 cursor-help" 
                                        />
                                    </span>
                                )}
                            </p>
                            <p className="text-[10px] text-slate-500 uppercase">{inv.type}</p>
                        </div>
                    </div>
                </td>
                {visibleColumns.includes('platform') && <td className="py-3 px-4 text-sm text-slate-500 dark:text-slate-400">{inv.platform}</td>}
                {visibleColumns.includes('invested') && (
                    <td className="py-3 px-4 text-right font-mono text-sm text-slate-600 dark:text-slate-400 cursor-cell hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-white transition-colors" onClick={() => !isArchived && startEditing(inv.id, 'investedAmount', inv.investedAmount)}>
                        {isEditingInvested ? (
                            <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={saveInlineEdit} autoFocus className="w-24 bg-white dark:bg-slate-900 border border-indigo-500 rounded px-1 py-0.5 text-right outline-none text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500" />
                        ) : (
                            <div className="flex items-center justify-end gap-1.5 group/edit">
                                <span className="border-b border-dashed border-slate-300 dark:border-slate-700 group-hover/edit:border-indigo-500 transition-colors">
                                    <PrivacyValue value={investedAmount} isPrivacyMode={isPrivacyMode} />
                                </span>
                                {!isArchived && <Edit2 size={10} className="text-slate-400 opacity-0 group-hover/edit:opacity-100 transition-opacity" />}
                            </div>
                        )}
                    </td>
                )}
                {visibleColumns.includes('current') && (
                    <td className="py-3 px-4 text-right font-mono text-sm font-bold text-slate-900 dark:text-white cursor-cell hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors" onClick={() => !isArchived && startEditing(inv.id, 'currentValue', inv.currentValue)}>
                        {isEditingCurrent ? (
                            <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={saveInlineEdit} autoFocus className="w-24 bg-white dark:bg-slate-900 border border-indigo-500 rounded px-1 py-0.5 text-right outline-none text-slate-900 dark:text-white focus:ring-1 focus:ring-indigo-500" />
                        ) : (
                            <div className="flex flex-col items-end gap-0.5 group/edit">
                                <div className="flex items-center gap-1.5">
                                    <span className="border-b border-dashed border-slate-300 dark:border-slate-700 group-hover/edit:border-indigo-500 transition-colors">
                                        <PrivacyValue value={currentValue} isPrivacyMode={isPrivacyMode} />
                                    </span>
                                    {!isArchived && <Edit2 size={10} className="text-slate-400 opacity-0 group-hover/edit:opacity-100 transition-opacity" />}
                                </div>
                                {/* CC53: eCAS drift badge — fully gated on the MF kill switch */}
                                {enableMutualFunds && inv.ecasImportMeta && inv.amfiCode && latestNavs[inv.amfiCode] != null && inv.quantity && inv.quantity > 0 && (() => {
                                    const ecasNav = inv.currentValue / inv.quantity;
                                    const currentNav = latestNavs[inv.amfiCode!];
                                    if (!isFinite(ecasNav) || ecasNav <= 0) return null;
                                    const driftPct = ((currentNav - ecasNav) / ecasNav) * 100;
                                    return (
                                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-normal">
                                            eCAS {inv.ecasImportMeta.statementDate} · {driftPct >= 0 ? '+' : ''}{driftPct.toFixed(1)}%
                                        </span>
                                    );
                                })()}
                            </div>
                        )}
                    </td>
                )}
                
                {/* Fair Value column */}
                {visibleColumns.includes('fairValue') && (
                    <td className="py-3 px-4 text-right">
                        {fundamentals ? (
                            <div className="font-mono text-sm">
                                <span className="text-slate-900 dark:text-white font-bold block">
                                    {isPrivacyMode ? '••••' : formatCurrency(fundamentals.fairValue)}
                                </span>
                                <Badge
                                    variant={fundamentals.marginOfSafety >= 0 ? 'gain' : 'loss'}
                                    size="sm"
                                    className="text-[9px] font-bold"
                                >
                                    {fundamentals.marginOfSafety >= 0 ? '+' : ''}{(fundamentals.marginOfSafety * 100).toFixed(0)}% MoS
                                </Badge>
                            </div>
                        ) : (
                            <span className="text-slate-400 dark:text-slate-600 text-xs">—</span>
                        )}
                    </td>
                )}

                {visibleColumns.includes('pl') && (
                    <td className="py-3 px-4 text-right">
                        <div className={`font-mono text-sm font-bold ${isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{isProfit ? '+' : ''}{profitPercent}%</div>
                        <div className={`text-[10px] font-medium ${isProfit ? 'text-emerald-500/80 dark:text-emerald-500/60' : 'text-rose-500/80 dark:text-rose-500/60'}`}>{isProfit ? '+' : ''}{formatCurrency(profit)}</div>
                    </td>
                )}
                {visibleColumns.includes('trend') && (
                    <td className="py-3 px-4 text-center">
                        <div className="flex justify-center opacity-60 group-hover:opacity-100 transition-opacity">
                            <Sparkline trend={isProfit ? 'UP' : 'DOWN'} width={60} height={20} />
                        </div>
                    </td>
                )}
                {visibleColumns.includes('alloc') && (
                    <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                            <span className="text-xs font-bold text-slate-900 dark:text-slate-500 font-mono">{portfolioShare}%</span>
                            <div className="w-12 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-transparent shadow-inner">
                                <div className="h-full bg-indigo-500" style={{ width: `${Math.max(0, Number(portfolioShare))}%` }}></div>
                            </div>
                        </div>
                    </td>
                )}
                {visibleColumns.includes('actions') && (
                    <td className="py-3 px-4 text-right">
                        {!isArchived && (
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {inv.type === InvestmentType.STOCKS && (
                                    <Tooltip content="Analyze in Alpha Terminal">
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                useNavigationIntentStore.getState().setIntent({
                                                    target: 'alpha',
                                                    action: 'search_stock',
                                                    payload: { symbol: inv.ticker || inv.name },
                                                    createdAt: Date.now()
                                                });
                                            }}
                                            aria-label="Analyze in Alpha Terminal"
                                        >
                                            <Activity size={14} />
                                        </Button>
                                    </Tooltip>
                                )}
                                {isIpoAsset(inv) && onSyncToJournal && (
                                    <Tooltip content="Sync this IPO to Trade Journal Calendar">
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            onClick={(e) => { e.stopPropagation(); onSyncToJournal(inv); }}
                                            aria-label="Sync this IPO to Trade Journal Calendar"
                                        >
                                            <BookOpen size={14} />
                                        </Button>
                                    </Tooltip>
                                )}
                                <Tooltip content="Record Exit">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={(e) => { e.stopPropagation(); onBookProfit?.(inv); }}
                                        aria-label={`Record exit for ${inv.ticker || 'investment'}`}
                                    >
                                        <ArrowUpRight size={14} className="text-emerald-500" />
                                    </Button>
                                </Tooltip>
                                <Tooltip content="Edit Asset">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={(e) => { e.stopPropagation(); onEditAsset(inv, e); }}
                                        aria-label="Edit asset"
                                    >
                                        <Edit2 size={14} />
                                    </Button>
                                </Tooltip>
                                <Tooltip content="Delete Asset">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={(e) => { e.stopPropagation(); onDeleteAsset(inv, e); }}
                                        aria-label="Delete asset"
                                    >
                                        <Trash2 size={14} className="text-rose-400" />
                                    </Button>
                                </Tooltip>
                            </div>
                        )}
                        {isArchived && (
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20 shadow-sm">Archived</span>
                        )}
                    </td>
                )}
            </motion.tr>
        );
    };

    const renderCardItem = (inv: Investment, isArchived = false) => {
        let profit = 0;
        let profitPercent = "0.00";
        let currentValue = inv.currentValue;

        if (isArchived) {
            profit = realizedPlMap[inv.id]?.pl ?? 0;
            const costBasis = realizedPlMap[inv.id]?.cost ?? inv.investedAmount;
            profitPercent = (costBasis > 0)
                ? ((profit / costBasis) * 100).toFixed(2)
                : "∞";
            currentValue = costBasis + profit;
        } else {
            profit = inv.currentValue - inv.investedAmount;
            profitPercent = calculatePercentage(profit, inv.investedAmount);
        }

        const isProfit = profit >= 0;
        const { shouldBookProfit, isBubbleRisk } = riskEngine.analyzeAsset(inv);

        let Icon = Wallet;
        if (inv.type === InvestmentType.STOCKS) Icon = TrendingUp;
        else if (inv.type === InvestmentType.CRYPTO) Icon = Zap;
        else if (inv.type === InvestmentType.DIGITAL_GOLD || inv.type === InvestmentType.DIGITAL_SILVER) Icon = Sparkles;
        else if (inv.type === InvestmentType.REAL_ESTATE) Icon = LayoutDashboard;

        const fundamentals = fundamentalsMap[inv.id];

        const iconContainerRadius = isAstryx ? 'rounded-[8px]' : 'rounded-lg';

        const fundamentalsClass = isAstryx
            ? 'mb-3 p-2 bg-[#1e1e1e] rounded-[8px] border border-white/[0.06] grid grid-cols-2 gap-1.5 text-[9px] text-zinc-400 relative z-10 leading-normal'
            : isReui
            ? 'mb-3 p-2 bg-muted/50 rounded-lg border border-border/60 grid grid-cols-2 gap-1.5 text-[9px] text-muted-foreground relative z-10 leading-normal'
            : 'mb-3 p-2 bg-slate-50/80 dark:bg-white/[0.04] rounded-xl border border-slate-200/80 dark:border-white/[0.06] grid grid-cols-2 gap-1.5 text-[9px] text-slate-500 dark:text-slate-400 relative z-10 leading-normal';

        const exitBtnClass = isAstryx
            ? 'w-full flex items-center justify-center gap-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 py-1.5 rounded-full hover:bg-emerald-500/20 transition-colors'
            : isReui
            ? 'w-full flex items-center justify-center gap-1 text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 py-1.5 rounded-md hover:bg-emerald-500/20 transition-colors'
            : 'w-full flex items-center justify-center gap-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 py-1.5 rounded-lg hover:bg-emerald-500/20 transition-colors';

        const actionBtnClass = isAstryx
            ? 'w-7 h-7 p-0 inline-flex items-center justify-center hover:bg-white/10 rounded-[6px] text-zinc-400 hover:text-white transition-colors shrink-0'
            : isReui
            ? 'w-7 h-7 p-0 inline-flex items-center justify-center hover:bg-accent rounded-md text-muted-foreground hover:text-foreground transition-colors shrink-0'
            : 'w-7 h-7 p-0 inline-flex items-center justify-center hover:bg-indigo-500/10 rounded text-slate-400 dark:text-slate-450 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors shrink-0';

        const footerBorderClass = isAstryx ? 'border-white/10' : isReui ? 'border-border' : 'border-slate-200 dark:border-white/5';

        // 100% UNTOUCHED ORIGINAL CLASSIC WEALTHOS CARD (DESKTOP MUSCLE MEMORY)
        if (!isReui && !isAstryx) {
            return (
                <motion.div
                    key={inv.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12, ease: 'easeInOut' }}
                    onClick={() => !isArchived && setSimulatorAsset(inv)}
                    className={`luxury-card bg-white/80 dark:bg-slate-900/50 backdrop-blur-xl p-4 rounded-2xl border border-slate-200/80 dark:border-white/[0.08] hover:border-indigo-500/40 dark:hover:border-white/[0.14] shadow-sm hover:shadow-md transition-all duration-200 group relative overflow-hidden cursor-pointer hover:-translate-y-0.5 ${isArchived ? 'opacity-60 grayscale' : ''}`}
                >
                    <div className="flex justify-between items-start mb-3 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className={`p-2.5 rounded-xl ${isProfit ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}><Icon size={20} /></div>
                            <div>
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm truncate max-w-[140px] flex items-center gap-1">
                                    {inv.name}
                                    {isBubbleRisk && !isArchived && <AlertTriangle size={12} className="text-fuchsia-500 animate-pulse" />}
                                    {discrepanciesMap[(inv.ticker || inv.name).toUpperCase()] && (
                                        <span title={`Price divergence flagged: ${(discrepanciesMap[(inv.ticker || inv.name).toUpperCase()].delta * 100).toFixed(2)}% between Upstox & Dhan`}>
                                            <AlertTriangle 
                                                size={12} 
                                                className="text-amber-500 animate-pulse shrink-0 cursor-help" 
                                            />
                                        </span>
                                    )}
                                </h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{inv.platform}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="font-bold text-slate-900 dark:text-white text-base"><PrivacyValue value={currentValue} isPrivacyMode={isPrivacyMode} /></p>
                            <p className={`text-xs font-bold ${isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{isProfit ? '+' : ''}{profitPercent}%</p>
                        </div>
                    </div>

                    {/* mini holding fundamentals card (G.2.2 & G.3.2) */}
                    {fundamentals && !isArchived && (
                        <div className="mb-3 p-2 bg-slate-50/80 dark:bg-white/[0.04] rounded-xl border border-slate-200/80 dark:border-white/[0.06] grid grid-cols-2 gap-1.5 text-[9px] text-slate-500 dark:text-slate-400 relative z-10 leading-normal">
                            <div>
                                <span className="text-slate-400 dark:text-slate-500">P/E:</span> <span className="font-bold text-slate-700 dark:text-slate-200">{fundamentals.pe.toFixed(1)}</span>
                            </div>
                            <div>
                                <span className="text-slate-400 dark:text-slate-500">ROE:</span> <span className="font-bold text-slate-700 dark:text-slate-200">{fundamentals.roe.toFixed(1)}%</span>
                            </div>
                            <div>
                                <span className="text-slate-400 dark:text-slate-500">Promoter:</span> <span className="font-bold text-slate-700 dark:text-slate-200">{fundamentals.promoter.toFixed(0)}%</span>
                            </div>
                            <div>
                                <span className="text-slate-400 dark:text-slate-500">FII Flow:</span> <span className={`font-bold ${fundamentals.fiiTrend === 'UP' ? 'text-emerald-600 dark:text-emerald-400' : fundamentals.fiiTrend === 'DOWN' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>{fundamentals.fiiTrend}</span>
                            </div>
                            <div className="col-span-2 pt-1 border-t flex justify-between border-slate-200 dark:border-slate-800/40">
                                <span className="text-slate-400 dark:text-slate-500">Fair Value (MoS):</span>
                                <span className={`font-bold ${fundamentals.marginOfSafety >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {isPrivacyMode ? '••••' : formatCurrency(fundamentals.fairValue)} ({(fundamentals.marginOfSafety * 100).toFixed(0)}%)
                                </span>
                            </div>
                        </div>
                    )}

                    {isSpotlightEnabled && !isArchived && !fundamentals && (
                        <div className="absolute bottom-12 left-0 right-0 h-8 opacity-10 pointer-events-none group-hover:opacity-20 transition-opacity">
                            <Sparkline trend={isProfit ? 'UP' : 'DOWN'} width={300} height={32} />
                        </div>
                    )}

                    {!isArchived && shouldBookProfit && (<div className="mb-3"><button onClick={(e) => { e.stopPropagation(); onBookProfit?.(inv); }} className="w-full flex items-center justify-center gap-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 py-1.5 rounded-lg hover:bg-emerald-500/20 transition-colors"><ArrowUpRight size={12} /> SUGGESTED EXIT</button></div>)}

                    <div className="flex items-center justify-between pt-3 border-t relative z-10 border-slate-200 dark:border-white/5">
                        <div className="flex items-center gap-2">{inv.recurring?.isEnabled && <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded flex items-center gap-1"><RefreshCw size={10} /> SIP</span>}<span className="text-[10px] text-slate-500 font-mono">{calculatePercentage(inv.currentValue, totalAssets)}%</span></div>
                        {!isArchived && (
                            <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                {inv.type === InvestmentType.STOCKS && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            useNavigationIntentStore.getState().setIntent({
                                                target: 'alpha',
                                                action: 'search_stock',
                                                payload: { symbol: inv.ticker || inv.name },
                                                createdAt: Date.now()
                                            });
                                        }}
                                        className={actionBtnClass}
                                        title="Analyze in Alpha Terminal"
                                    >
                                        <Activity size={14} />
                                    </button>
                                )}
                                {isIpoAsset(inv) && onSyncToJournal && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onSyncToJournal(inv); }}
                                        className={actionBtnClass}
                                        title="Sync this IPO to Trade Journal Calendar"
                                    >
                                        <BookOpen size={14} />
                                    </button>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); onBookProfit?.(inv); }} className={actionBtnClass} title="Record Exit"><ArrowUpRight size={14} /></button>
                                <button onClick={(e) => { e.stopPropagation(); onEditAsset(inv, e); }} className={actionBtnClass} title="Edit Holding"><Edit2 size={14} /></button>
                                <button onClick={(e) => { e.stopPropagation(); onDeleteAsset(inv, e); }} className={actionBtnClass} title="Delete Holding"><Trash2 size={14} /></button>
                            </div>
                        )}
                        {isArchived && (
                            <span className="text-xs font-bold text-amber-500">Archived</span>
                        )}
                    </div>
                </motion.div>
            );
        }

        // PRESET MODE (ReUI / Astryx)
        return (
            <Card
                key={inv.id}
                onClick={() => !isArchived && setSimulatorAsset(inv)}
                className={`transition-all duration-200 group relative overflow-hidden cursor-pointer hover:-translate-y-0.5 hover:border-zinc-700 ${isArchived ? 'opacity-60 grayscale' : ''}`}
            >
                <CardContent className="p-4">

                <div className="flex justify-between items-start mb-3 relative z-10">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 ${iconContainerRadius} ${isProfit ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}><Icon size={20} /></div>
                        <div>
                            <h4 className="font-bold text-slate-900 dark:text-white text-sm truncate max-w-[140px] flex items-center gap-1">
                                {inv.name}
                                {isBubbleRisk && !isArchived && <AlertTriangle size={12} className="text-fuchsia-500 animate-pulse" />}
                                {discrepanciesMap[(inv.ticker || inv.name).toUpperCase()] && (
                                    <span title={`Price divergence flagged: ${(discrepanciesMap[(inv.ticker || inv.name).toUpperCase()].delta * 100).toFixed(2)}% between Upstox & Dhan`}>
                                        <AlertTriangle 
                                            size={12} 
                                            className="text-amber-500 animate-pulse shrink-0 cursor-help" 
                                        />
                                    </span>
                                )}
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{inv.platform}</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="font-bold text-slate-900 dark:text-white text-base"><PrivacyValue value={currentValue} isPrivacyMode={isPrivacyMode} /></p>
                        <p className={`text-xs font-bold ${isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{isProfit ? '+' : ''}{profitPercent}%</p>
                    </div>
                </div>

                {/* mini holding fundamentals card (G.2.2 & G.3.2) */}
                {fundamentals && !isArchived && (
                    <div className={fundamentalsClass}>
                        <div>
                            <span className={isAstryx ? "text-zinc-500" : "text-slate-400 dark:text-slate-500"}>P/E:</span> <span className={isAstryx ? "font-bold text-zinc-200" : "font-bold text-slate-700 dark:text-slate-200"}>{fundamentals.pe.toFixed(1)}</span>
                        </div>
                        <div>
                            <span className={isAstryx ? "text-zinc-500" : "text-slate-400 dark:text-slate-500"}>ROE:</span> <span className={isAstryx ? "font-bold text-zinc-200" : "font-bold text-slate-700 dark:text-slate-200"}>{fundamentals.roe.toFixed(1)}%</span>
                        </div>
                        <div>
                            <span className={isAstryx ? "text-zinc-500" : "text-slate-400 dark:text-slate-500"}>Promoter:</span> <span className={isAstryx ? "font-bold text-zinc-200" : "font-bold text-slate-700 dark:text-slate-200"}>{fundamentals.promoter.toFixed(0)}%</span>
                        </div>
                        <div>
                            <span className={isAstryx ? "text-zinc-500" : "text-slate-400 dark:text-slate-500"}>FII Flow:</span> <span className={`font-bold ${fundamentals.fiiTrend === 'UP' ? 'text-emerald-600 dark:text-emerald-400' : fundamentals.fiiTrend === 'DOWN' ? 'text-rose-600 dark:text-rose-400' : (isAstryx ? 'text-zinc-400' : 'text-slate-500 dark:text-slate-400')}`}>{fundamentals.fiiTrend}</span>
                        </div>
                        <div className={`col-span-2 pt-1 border-t flex justify-between ${isAstryx ? 'border-white/10' : 'border-slate-200 dark:border-slate-800/40'}`}>
                            <span className={isAstryx ? "text-zinc-500" : "text-slate-400 dark:text-slate-500"}>Fair Value (MoS):</span>
                            <span className={`font-bold ${fundamentals.marginOfSafety >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {isPrivacyMode ? '••••' : formatCurrency(fundamentals.fairValue)} ({(fundamentals.marginOfSafety * 100).toFixed(0)}%)
                            </span>
                        </div>
                    </div>
                )}

                {isSpotlightEnabled && !isArchived && !fundamentals && (
                    <div className="absolute bottom-12 left-0 right-0 h-8 opacity-10 pointer-events-none group-hover:opacity-20 transition-opacity">
                        <Sparkline trend={isProfit ? 'UP' : 'DOWN'} width={300} height={32} />
                    </div>
                )}

                {!isArchived && shouldBookProfit && (<div className="mb-3"><button onClick={(e) => { e.stopPropagation(); onBookProfit?.(inv); }} className={exitBtnClass}><ArrowUpRight size={12} /> SUGGESTED EXIT</button></div>)}

                <div className={`flex items-center justify-between pt-3 border-t relative z-10 ${footerBorderClass}`}>
                    <div className="flex items-center gap-2">{inv.recurring?.isEnabled && <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded flex items-center gap-1"><RefreshCw size={10} /> SIP</span>}<span className="text-[10px] text-slate-500 font-mono">{calculatePercentage(inv.currentValue, totalAssets)}%</span></div>
                    {!isArchived && (
                        <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            {inv.type === InvestmentType.STOCKS && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        useNavigationIntentStore.getState().setIntent({
                                            target: 'alpha',
                                            action: 'search_stock',
                                            payload: { symbol: inv.ticker || inv.name },
                                            createdAt: Date.now()
                                        });
                                    }}
                                    className={actionBtnClass}
                                    title="Analyze in Alpha Terminal"
                                >
                                    <Activity size={14} />
                                </button>
                            )}
                            {isIpoAsset(inv) && onSyncToJournal && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onSyncToJournal(inv); }}
                                    className={actionBtnClass}
                                    title="Sync this IPO to Trade Journal Calendar"
                                >
                                    <BookOpen size={14} />
                                </button>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); onBookProfit?.(inv); }} className={actionBtnClass} title="Record Exit"><ArrowUpRight size={14} /></button>
                            <button onClick={(e) => { e.stopPropagation(); onEditAsset(inv, e); }} className={actionBtnClass}><Edit2 size={14} /></button>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteAsset(inv, e); }} className={actionBtnClass}><Trash2 size={14} /></button>
                        </div>
                    )}
                    {isArchived && (
                        <span className="text-xs font-bold text-amber-500">Archived</span>
                    )}
                </div>
                </CardContent>
            </Card>
        );
    };

    const SortIcon = ({ columnKey }: { columnKey: keyof Investment | 'profit' }) => {
        if (sortConfig?.key !== columnKey) return <span className="ml-1 text-slate-600 select-none opacity-0 group-hover:opacity-100 transition-opacity">⇅</span>;
        return <span className="ml-1 text-indigo-400">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
    };

    const SortableHeader = ({ label, columnKey, align = 'left', className = '' }: { label: string, columnKey: keyof Investment | 'profit', align?: 'left' | 'right' | 'center', className?: string }) => {
        const headerThClass = isAstryx
            ? 'py-2.5 px-3.5 text-[11px] font-semibold uppercase text-[#9e9e9e] hover:text-white cursor-pointer select-none group transition-colors'
            : isReui
            ? 'py-3 px-4 text-xs font-medium uppercase text-muted-foreground hover:text-foreground cursor-pointer select-none group transition-colors'
            : 'py-3 px-4 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300 transition-colors select-none group';

        return (
            <th
                className={`${headerThClass} ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}
                onClick={() => handleSort(columnKey)}
                style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}
            >
                {label} <SortIcon columnKey={columnKey} />
            </th>
        );
    };

    const TableHeader = () => {
        const theadClass = isAstryx
            ? 'bg-[#262626] border-b border-[rgba(255,255,255,0.102)] relative'
            : isReui
            ? 'bg-muted/60 border-b border-border relative'
            : 'bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-white/5 relative';

        const trendThClass = isAstryx
            ? 'py-2.5 px-3.5 text-[11px] font-semibold uppercase text-[#9e9e9e] text-center'
            : isReui
            ? 'py-3 px-4 text-xs font-medium uppercase text-muted-foreground text-center'
            : 'py-3 px-4 text-xs font-bold text-slate-500 uppercase text-center';

        return (
            <thead className={theadClass}>
                <tr>
                    <SortableHeader label="Asset" columnKey="name" />
                    {visibleColumns.includes('platform') && <SortableHeader label="Platform" columnKey="platform" />}
                    {visibleColumns.includes('invested') && <SortableHeader label="Invested" columnKey="investedAmount" align="right" />}
                    {visibleColumns.includes('current') && <SortableHeader label="Current" columnKey="currentValue" align="right" />}
                    {visibleColumns.includes('fairValue') && <SortableHeader label="Fair Value" columnKey="currentValue" align="right" />}
                    {visibleColumns.includes('pl') && <SortableHeader label="P&L" columnKey="profit" align="right" />}
                    {visibleColumns.includes('trend') && <th className={trendThClass}>Trend</th>}
                    {visibleColumns.includes('alloc') && <SortableHeader label="Alloc." columnKey="currentValue" align="right" />}
                    {visibleColumns.includes('actions') && <th className="py-3 px-4"></th>}
                </tr>
            </thead>
        );
    };

    return (
        <div className="space-y-4">
            {/* Progressive Disclosure: Live Execution & Diagnostics Hub */}
            <div className={`overflow-hidden transition-all ${
                isAstryx 
                    ? 'rounded-[12px] bg-[#262626] border border-[rgba(255,255,255,0.102)] shadow-none' 
                    : isReui 
                    ? 'rounded-xl bg-card border border-border shadow-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' 
                    : 'luxury-card rounded-2xl border border-slate-200/80 dark:border-white/[0.08] bg-white/70 dark:bg-slate-900/40 backdrop-blur-xl shadow-sm'
            }`} style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}>
                <button
                    type="button"
                    onClick={() => setShowDiagnostics(prev => !prev)}
                    className={`w-full flex items-center justify-between ${isMobileViewport ? 'px-3 py-1.5' : 'px-4 py-3'} hover:bg-slate-50/60 dark:hover:bg-white/[0.03] transition-colors text-left`}
                >
                    <div className="flex items-center gap-2">
                        <div className={`p-1 ${isAstryx ? 'rounded-[6px]' : isReui ? 'rounded-md' : 'rounded-lg'} bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0`}>
                            <Activity size={isMobileViewport ? 13 : 15} />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`${isMobileViewport ? 'text-[11px]' : 'text-xs'} font-bold text-slate-800 dark:text-slate-200`}>
                                Live Execution & Diagnostics
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">
                                (Dhan HQ, Trade Journal, MCS Monitor, Alloc Optimizer)
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[9px] md:text-[10px] font-bold uppercase tracking-wider px-2 md:px-2.5 py-0.5 rounded-full ${
                            isAstryx ? 'bg-white/10 text-zinc-300' : isReui ? 'bg-secondary text-secondary-foreground' : 'bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300'
                        }`}>
                            {showDiagnostics ? 'Hide' : (isMobileViewport ? 'Telemetry' : 'Show Telemetry (5 Tools)')}
                        </span>
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${showDiagnostics ? 'rotate-180' : ''}`} />
                    </div>
                </button>

                <AnimatePresence>
                    {showDiagnostics && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: 'easeInOut' }}
                            className={`overflow-hidden p-4 space-y-4 border-t ${isAstryx ? 'border-white/10' : isReui ? 'border-border' : 'border-slate-200/80 dark:border-white/[0.06]'}`}
                        >
                            <DhanDiagnosticsPanel
                                investments={investments}
                                formatCurrency={formatCurrency}
                                isPrivacyMode={isPrivacyMode}
                                isFocused={highlightDiagnostics}
                                onNavigate={onNavigate}
                            />
                            <TradingJournalPnLCard
                                onNavigate={onNavigate}
                                formatCurrency={formatCurrency}
                                isPrivacyMode={isPrivacyMode}
                            />
                            <LivePositionsPanel formatCurrency={formatCurrency} isPrivacyMode={isPrivacyMode} />
                            <LiveMcsMonitor />
                            <PortfolioAllocOptWidget />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {isLoading ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                    <div className="bg-slate-50/50 dark:bg-slate-900/40 rounded-2xl border border-slate-200 dark:border-white/5 p-8">
                        <SkeletonTable rows={5} cols={6} />
                    </div>
                </div>
            ) : (
                <>
                    {/* Portfolio Quality Score summary card (G.2.3) */}
                    <div className={`relative overflow-hidden flex flex-col justify-between ${
                        isAstryx 
                            ? 'rounded-[12px] bg-[#262626] border border-[rgba(255,255,255,0.102)] p-5 text-white shadow-none' 
                            : isReui 
                            ? 'rounded-xl bg-card border border-border p-5 text-card-foreground shadow-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' 
                            : 'luxury-card bg-white/80 dark:bg-slate-900/50 backdrop-blur-xl border border-slate-200/80 dark:border-white/[0.08] rounded-2xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.06)]'
                    }`} style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}>
                        <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                            <Box size={80} className="text-emerald-500" />
                        </div>
                        <div className="flex items-center gap-3 mb-3">
                            <div className={`p-2 ${isAstryx ? 'rounded-[8px]' : isReui ? 'rounded-lg' : 'rounded-xl'} bg-emerald-500/10`}>
                                <Box className="text-emerald-600 dark:text-emerald-400" size={18} />
                            </div>
                            <div>
                                <h4 className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">Portfolio Quality Score</h4>
                                <p className="text-[9px] text-slate-500 uppercase">Weighted Asset Fundamentals</p>
                            </div>
                        </div>

                        {loadingFundamentals ? (
                            <div className="h-10 flex items-center gap-2">
                                <RefreshCw className="animate-spin text-emerald-600 dark:text-emerald-400" size={14} />
                                <span className="text-[10px] text-slate-500 uppercase">Analyzing Holdings...</span>
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className={`text-3xl font-black ${portfolioQualityScore >= 70 ? 'text-emerald-600 dark:text-emerald-400' : portfolioQualityScore >= 45 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {portfolioQualityScore}
                                    </span>
                                    <span className="text-xs text-slate-400 dark:text-slate-600 font-medium">/100</span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-500 ${portfolioQualityScore >= 70 ? 'bg-emerald-500' : portfolioQualityScore >= 45 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                        style={{ width: `${portfolioQualityScore}%` }}
                                    />
                                </div>
                                <p className="text-[9px] text-slate-600 dark:text-slate-400 leading-normal mt-2">
                                    {portfolioQualityScore >= 70 
                                        ? "Your stock holdings exhibit strong returns on equity, low leverage, and institutional interest." 
                                        : portfolioQualityScore >= 45 
                                        ? "Moderate overall quality. Consider rebalancing stock allocations with weak fundamentals."
                                        : "Speculative quality score. Higher concentration in low-return or highly leveraged assets."}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
                        <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                            <Info size={80} className="text-sky-500" />
                        </div>
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-sky-500/10 rounded-xl">
                                <Info className="text-sky-600 dark:text-sky-400" size={18} />
                            </div>
                            <div>
                                <h4 className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">Intrinsic Valuation</h4>
                                <p className="text-[9px] text-slate-500 uppercase">Margin of Safety Gap</p>
                            </div>
                        </div>

                        {loadingFundamentals ? (
                            <div className="h-10 flex items-center gap-2">
                                <RefreshCw className="animate-spin text-sky-600 dark:text-sky-400" size={14} />
                                <span className="text-[10px] text-slate-500 uppercase">Calculating intrinsic value...</span>
                            </div>
                        ) : (
                            <div>
                                <div className="flex items-baseline gap-1.5 mb-2">
                                    <span className={`text-3xl font-black ${averageMarginOfSafety >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {averageMarginOfSafety >= 0 ? '+' : ''}{(averageMarginOfSafety * 100).toFixed(1)}%
                                    </span>
                                    <span className="text-xs text-slate-500 font-bold uppercase">Average MoS</span>
                                </div>
                                <p className="text-[9px] text-slate-600 dark:text-slate-400 leading-normal">
                                    {averageMarginOfSafety >= 0.15 ? (
                                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">🟢 Undervalued. Good margin of safety relative to competitor PE values.</span>
                                    ) : averageMarginOfSafety >= 0 ? (
                                        <span className="text-slate-700 dark:text-slate-300">🟡 Neutral valuation. Average holdings are trading near their fair estimate values.</span>
                                    ) : (
                                        <span className="text-rose-600 dark:text-rose-400 font-bold">🔴 Overvalued. Portfolio stocks are trading at a premium compared to peer companies.</span>
                                    )}
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}

            {effectiveViewMode === 'TERMINAL' && (
                <div className="flex items-center justify-between px-2 mb-2 animate-in fade-in">
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                        <div className="flex items-center gap-1"><span className="p-1 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700"><Keyboard size={10} /></span> <span>Nav</span></div>
                        <div className="flex items-center gap-1"><span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono">Enter</span> <span>Simulate</span></div>
                        <div className="flex items-center gap-1"><span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 font-mono">2</span> <span>Edit</span></div>
                        {ipoHoldingsCount > 0 && onSyncAllIposToJournal && (
                            <button
                                onClick={onSyncAllIposToJournal}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 border border-indigo-500/30 rounded-lg text-[11px] font-bold transition-all shadow-sm active:scale-95"
                                title="Directly parse and log all active IPO gains into Trade Journal Calendar"
                            >
                                <BookOpen size={12} />
                                <span>Sync {ipoHoldingsCount} IPO{ipoHoldingsCount > 1 ? 's' : ''} to Journal</span>
                            </button>
                        )}
                    </div>

                    <div className="relative">
                        <button
                            onClick={() => setShowColumnToggle(!showColumnToggle)}
                            className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-[10px] font-bold text-slate-500 hover:text-indigo-500 transition-colors shadow-sm"
                        >
                            <Columns size={12} />
                            Columns
                        </button>

                        <AnimatePresence>
                            {showColumnToggle && (
                                <motion.div
                                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                                    className="absolute top-full right-0 mt-2 z-[110] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-4 min-w-[180px] space-y-3 backdrop-blur-xl"
                                >
                                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Visible Columns</span>
                                        <button
                                            onClick={() => setVisibleColumns(['platform', 'invested', 'current', 'fairValue', 'pl', 'trend', 'alloc', 'actions'])}
                                            className="text-[9px] font-bold text-indigo-500 hover:text-indigo-400"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {[
                                            { id: 'platform', label: 'Platform' },
                                            { id: 'invested', label: 'Invested' },
                                            { id: 'current', label: 'Current' },
                                            { id: 'fairValue', label: 'Fair Value' },
                                            { id: 'pl', label: 'P&L' },
                                            { id: 'trend', label: 'Trend' },
                                            { id: 'alloc', label: 'Allocation' },
                                            { id: 'actions', label: 'Actions' }
                                        ].map(col => (
                                            <label key={col.id} className="flex items-center gap-2 cursor-pointer group">
                                                <input
                                                    type="checkbox"
                                                    checked={visibleColumns.includes(col.id)}
                                                    onChange={() => toggleColumn(col.id)}
                                                    className="w-3 h-3 rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0"
                                                />
                                                <span className={`text-xs font-bold transition-colors ${visibleColumns.includes(col.id) ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 group-hover:text-slate-500'}`}>
                                                    {col.label}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            )}

            {investments.length === 0 && !showArchived ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-900/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 mb-4"><Box size={32} /></div>
                    <p className="text-slate-600 dark:text-slate-400 font-medium">Your portfolio is empty.</p>
                </div>
            ) : filteredInvestments.length === 0 && !showArchived ? (
                <div className="text-center py-20"><p className="text-slate-500">No assets match your search.</p></div>
            ) : groupBy === 'NONE' ? (
                effectiveViewMode === 'TERMINAL' ? (
                    <div className={
                        isAstryx 
                            ? "rounded-[12px] bg-[#1b1b1b] border border-[rgba(255,255,255,0.102)] overflow-hidden relative shadow-none"
                            : isReui
                            ? "rounded-xl bg-card border border-border overflow-hidden shadow-sm relative"
                            : "luxury-card bg-white/80 dark:bg-slate-900/50 backdrop-blur-xl rounded-2xl border border-slate-200/80 dark:border-white/[0.08] overflow-hidden shadow-[0_16px_40px_-10px_rgba(0,0,0,0.4)] relative"
                    }>
                        {!isAstryx && !isReui && <NoiseTexture opacity={0.02} />}
                        <div className="table-scroll overflow-x-auto w-full">
                            <table className="w-full text-left border-collapse relative z-10 min-w-[850px]" style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}>
                                <TableHeader />
                                <tbody>{sortedInvestments.map((inv, index) => renderTerminalRow(inv, index))}</tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <AnimatePresence mode="popLayout">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                            {sortedInvestments.map(inv => renderCardItem(inv))}
                        </div>
                    </AnimatePresence>
                )
            ) : (
                groupedInvestments && Object.entries(groupedInvestments).map(([groupKey, groupData]: [string, GroupedData]) => (
                    <div key={groupKey} className={`mb-4 overflow-hidden transition-all ${
                        isAstryx 
                            ? "rounded-[12px] border border-white/[0.102] bg-[#1b1b1b] hover:border-white/20 shadow-none" 
                            : isReui 
                            ? "rounded-xl border border-border bg-card shadow-sm hover:border-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" 
                            : "rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/30 shadow-lg hover:border-indigo-500/30 dark:hover:border-slate-700"
                    }`} style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}>
                        <div
                            className={`p-4 flex items-center justify-between cursor-pointer transition-colors select-none ${
                                isAstryx ? 'bg-[#212121] hover:bg-[#282828]' : isReui ? 'bg-muted/40 hover:bg-muted/70' : 'bg-slate-50 dark:bg-slate-900/50 backdrop-blur-md hover:bg-slate-100 dark:hover:bg-slate-800/50'
                            }`}
                            onClick={() => toggleGroup(groupKey)}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 ${isAstryx ? 'rounded-[8px]' : isReui ? 'rounded-lg' : 'rounded-xl'} transition-transform duration-200 ${expandedGroups[groupKey] ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rotate-90' : (isAstryx ? 'bg-white/5 text-zinc-400' : isReui ? 'bg-secondary text-muted-foreground' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400')}`}>
                                    <ChevronRight size={16} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-900 dark:text-white text-base leading-tight">{groupKey}</h3>
                                    <p className="text-xs text-slate-500 font-medium">{groupData.items.length} assets • {formatCurrency(groupData.totalCurr)}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className={`text-sm font-mono font-bold ${(groupData.totalCurr - groupData.totalInv) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {(groupData.totalCurr - groupData.totalInv) >= 0 ? '+' : ''}{calculatePercentage(groupData.totalCurr - groupData.totalInv, groupData.totalInv)}%
                                </div>
                            </div>
                        </div>

                        {expandedGroups[groupKey] && (
                            <div className="p-4 bg-slate-50/30 dark:bg-black/20 border-t border-slate-200 dark:border-white/5 animate-in slide-in-from-top-1 duration-200">
                                {effectiveViewMode === 'TERMINAL' ? (
                                    <div className={
                                        isAstryx 
                                            ? "rounded-[10px] bg-[#1b1b1b] border border-[rgba(255,255,255,0.102)] overflow-hidden" 
                                            : isReui 
                                            ? "rounded-lg bg-card border border-border overflow-hidden shadow-sm" 
                                            : "bg-white dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-white/5 overflow-hidden"
                                    }>
                                        <div className="table-scroll overflow-x-auto w-full">
                                            <table className="w-full text-left border-collapse min-w-[850px]" style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}>
                                                <TableHeader />
                                                <tbody>{groupData.items.map((inv, idx) => renderTerminalRow(inv, idx))}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
                                        {groupData.items.map(inv => renderCardItem(inv))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))
            )}

            {/* Archived Section Toggle */}
            {archivedInvestments.length > 0 && (
                <div className="mt-8 border-t border-slate-200 dark:border-slate-800 pt-6">
                    <button
                        onClick={() => setShowArchived(!showArchived)}
                        className="flex items-center gap-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors mb-4 text-sm font-semibold"
                    >
                        <ChevronDown size={16} className={`transition-transform ${showArchived ? 'rotate-180' : ''}`} />
                        Show Archived Holdings ({archivedInvestments.length})
                    </button>

                    {showArchived && (
                        <div className="animate-in fade-in slide-in-from-top-2">
                            {effectiveViewMode === 'TERMINAL' ? (
                                <div>
                                    <div className="bg-white dark:bg-slate-900/20 rounded-2xl border border-slate-200 dark:border-white/5 overflow-hidden shadow-sm opacity-60 hover:opacity-100 transition-opacity">
                                        <div className="overflow-x-auto w-full">
                                            <table className="w-full text-left border-collapse min-w-[850px]">
                                                <TableHeader />
                                                <tbody>{sortedArchivedInvestments.map((inv, index) => renderTerminalRow(inv, index, true))}</tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 opacity-60 hover:opacity-100 transition-opacity">
                                    {sortedArchivedInvestments.map(inv => renderCardItem(inv, true))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
