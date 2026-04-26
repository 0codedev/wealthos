import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { pageVariants } from '../ui/animations';
import {
    Target, Activity, History, Clock,
    Plus, LayoutList, Table as TableIcon,
    RefreshCw, ArrowUpRight, PieChart, Circle, FileText
} from 'lucide-react';
import { Investment, AggregatedData, PortfolioStats } from '../../types';
import { MarketStatus } from '../../hooks/useMarketSentiment';
import { useSettingsStore } from '../../store/settingsStore';
import { LifeEvent } from '../../database';
import { logger } from '../../services/Logger';
import { useFamily } from '../../contexts/FamilyContext';
import { SkeletonCard, SkeletonTable, SkeletonLine, SkeletonNumber } from '../ui/Skeleton';

// New Components
const CommandCenter = lazy(() => import('../dashboard/CommandCenter'));
import HeroSection from '../dashboard/HeroSection';
import WidgetSkeleton from '../shared/WidgetSkeleton';
import { WidgetRegistry, WidgetRegistryProps } from '../dashboard/WidgetRegistry';
import { DashboardGrid } from '../dashboard/DashboardGrid';
import { MacroRegimeBanner } from '../dashboard/MacroRegimeBanner';
import DataHealthHub from '../data/DataHealthHub';
import { Button } from '../ui/button';
import { Chip } from '../ui/chip';
import { Slider } from '../ui/slider';
import { TabHeader } from '../ui/TabHeader';



const SpendingAnalyticsHub = lazy(() => import('../dashboard/hubs/SpendingAnalyticsHub').then(m => ({ default: m.SpendingAnalyticsHub })));
const MarketInsightsHub = lazy(() => import('../dashboard/hubs/MarketInsightsHub').then(m => ({ default: m.MarketInsightsHub })));
const CommunityHub = lazy(() => import('../dashboard/hubs/CommunityHub').then(m => ({ default: m.CommunityHub })));
const ReportGenerationModal = lazy(() => import('../reports/ReportGenerationModal'));


// Store
import { usePortfolioStore } from '../../store/portfolioStore';
import { useDerivedStats } from '../../hooks/useDerivedStats';
import { runMonteCarlo } from '../../utils/MonteCarlo';
import { migrateStorageKey, cleanLegacyVersionedKeys } from '../../utils/storageVersion';
import { selectInvestmentsForEntity } from '../../lib/domain/portfolio';
import { DEFAULT_WIDGETS } from '../dashboard/widgetOrderDefaults';

// FIX #5: Moved interface to module scope (was inside component body)
interface ProjectionPoint {
    year: number;
    amount: number;
    date?: string;
    base?: number;
    bull?: number;
    bear?: number;
    eventMarker?: boolean;
}

interface DashboardTabProps {
    // UI/Callback props KEPT
    isPrivacyMode: boolean;
    isDarkMode: boolean;
    onAddFirstAsset: () => void;
    formatCurrency: (val: number) => string;
    formatCurrencyPrecise: (val: number) => string;
    calculatePercentage: (part: number, total: number) => string;
    ASSET_CLASS_COLORS: Record<string, string>;
    CustomTooltip: React.ComponentType<any>;
    marketVix: number;
    marketStatus: MarketStatus;
    // Controlled View State
    view: 'MAIN' | 'SPENDING' | 'MARKETS' | 'COMMUNITY';
    onViewChange: (view: 'MAIN' | 'SPENDING' | 'MARKETS' | 'COMMUNITY') => void;
    onQuickAction: (action: string) => void;
}

const generateMonthlyReportOnDemand = async (payload: {
    investments: Investment[];
    stats: PortfolioStats;
    allocationData: AggregatedData[];
}) => {
    const reportService = await import('../../services/ReportService');
    return reportService.generateMonthlyReport(payload);
};

const DashboardTab: React.FC<DashboardTabProps> = ({
    isPrivacyMode, isDarkMode, onAddFirstAsset,
    formatCurrency, formatCurrencyPrecise, calculatePercentage,
    ASSET_CLASS_COLORS, CustomTooltip, marketVix, marketStatus,
    view, onViewChange, onQuickAction
}) => {

    // Consume Store Directly (No Prop Drilling) - Atomic Selectors used to prevent Re-render Storm
    const allInvestments = usePortfolioStore(s => s.investments);
    const globalStats = usePortfolioStore(s => s.stats);
    const isStoreLoading = usePortfolioStore(s => s.isLoading);
    const history = usePortfolioStore(s => s.history);
    const lifeEvents = usePortfolioStore(s => s.lifeEvents);
    const addLifeEvent = usePortfolioStore(s => s.addLifeEvent);
    const deleteLifeEvent = usePortfolioStore(s => s.deleteLifeEvent);

    // Context for Filtering
    const { activeEntity, setActiveEntity, getEntityName } = useFamily();

    // Filter Investments based on Active Entity
    const investments = useMemo(() => {
        return selectInvestmentsForEntity(allInvestments, activeEntity);
    }, [allInvestments, activeEntity]);

    // Compute Derived Stats (The Fix for Profile Filtering)
    const { stats, allocationData, assetClassData, platformData } = useDerivedStats(investments, globalStats);

    // FIX #8: Replaced console.log with dev-only logger
    useEffect(() => {
        if (import.meta.env.DEV) {
            logger.debug('[DashboardTab] Debug', {
                storeInvestments: allInvestments?.length,
                filteredInvestments: investments?.length,
                activeEntity,
            }, 'DashboardTab');
        }
    }, [allInvestments, investments, activeEntity]);

    // Global Toggle State: false = Gross, true = Net
    const [showNetWorth, setShowNetWorth] = useState(false);
    const [isBeginnerMode, setIsBeginnerMode] = useState(false);
    const targetNetWorth = useSettingsStore(state => state.targetNetWorth);
    const targetDate = useSettingsStore(state => state.targetDate);
    const isEditMode = useSettingsStore(state => state.isEditMode);



    // Dynamic Projection based on Toggle
    const dynamicProjectionData = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const startValue = showNetWorth ? (stats?.totalValue || 0) : (stats?.totalAssets || 0);
        const targetYear = targetDate ? new Date(targetDate).getFullYear() : currentYear + 10;
        const years = Math.max(5, Math.min(20, targetYear - currentYear));
        const monthlyContribution = investments.reduce((sum, investment) => {
            if (investment.recurring?.isEnabled) {
                return sum + (investment.recurring.amount || 0);
            }
            return sum;
        }, 0);

        const result = runMonteCarlo(
            Math.max(startValue, 0),
            monthlyContribution,
            years,
            Math.max(targetNetWorth || startValue, startValue),
            0.12,
            0.15,
            true
        );

        return result.yearlyPaths.map((path) => {
            const year = currentYear + path.year;
            return {
                date: year.toString(),
                year,
                amount: Math.round(path.p50),
                base: Math.round(path.p50),
                bull: Math.round(path.p90),
                bear: Math.round(path.p10),
                eventMarker: false
            };
        });
    }, [stats, showNetWorth, targetDate, targetNetWorth, investments]);

    // FIX #9: Wire projectionData to dynamicProjectionData (was always empty [])
    const projectionData: ProjectionPoint[] = dynamicProjectionData;

    // --- TIME TRAVELER STATE ---
    const [timeTravelIndex, setTimeTravelIndex] = useState<number>(0);

    // Initialize Time Traveler to Present
    useEffect(() => {
        if (history && history.length > 0) {
            setTimeTravelIndex(history.length);
        }
    }, [history?.length]);

    const dynamicHealthScore = useMemo(() => {
        const dScore = (stats?.diversityScore || 0) * 0.5;
        const pScore = (stats?.totalPLPercent ? Math.min(100, 50 + parseFloat(String(stats.totalPLPercent))) : 50) * 0.5;
        return Math.min(100, Math.round(dScore + pScore));
    }, [stats]);

    const [showReportModal, setShowReportModal] = useState(false);
    const [showHealthHub, setShowHealthHub] = useState(false);

    // --- TIME TRAVELER LOGIC ---
    const timeTravelData = useMemo(() => {
        const totalPoints = (history?.length || 0) + 1 + (projectionData?.length || 0); // Past + Present + Future
        const currentIndex = history?.length || 0;

        // Detailed State Logic
        let type = 'PRESENT';
        let value = stats?.totalCurrent || 0;
        let date = 'Today';

        if (timeTravelIndex < currentIndex) {
            const h = history[timeTravelIndex];
            type = 'PAST';
            value = h?.value || 0;
            date = h?.date || 'Past';
        } else if (timeTravelIndex > currentIndex) {
            const pIndex = timeTravelIndex - currentIndex - 1;
            const p = projectionData[pIndex];
            type = 'FUTURE';
            value = p?.amount || 0;
            date = p?.year ? `Year ${p.year}` : 'Future';
        }

        return { totalPoints, currentIndex, type, value, date };
    }, [history, projectionData, timeTravelIndex, stats.totalCurrent]);

    const isPresent = timeTravelIndex === (history?.length || 0);

    // --- DRAGGABLE GRID STATE ---
    const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
        // Agent I: use the versioned-migration helper so that any
        // *future* renumbering (`-v10`, `-v11`, …) only requires
        // appending the new key to the `legacyKeys` array. Legacy
        // `-v9` and `-v8` keys are still read for backward compat.
        const order = migrateStorageKey<string[]>({
            currentKey: 'dashboard-widget-order',
            legacyKeys: ['dashboard-widget-order-v9', 'dashboard-widget-order-v8'],
            defaultValue: DEFAULT_WIDGETS,
            validate: (raw) => Array.isArray(raw) && raw.every((x: unknown) => typeof x === 'string')
                ? raw as string[]
                : null,
        });
        return order;
    });

    // One-time cleanup of stale `dashboard-widget-order-v8` keys.
    useEffect(() => {
        cleanLegacyVersionedKeys('dashboard-widget-order', 9);
    }, []);

    // FIX #4: Removed duplicate useEffect (was identical block declared twice)
    useEffect(() => {
        if (widgetOrder.length < DEFAULT_WIDGETS.length) {
            setWidgetOrder(DEFAULT_WIDGETS);
        }
    }, []);

    // Registry for Widgets
    const renderWidget = (id: string) => {
        const widgetProps: WidgetRegistryProps = {
            id,
            isEditMode,
            formatCurrency,
            isPrivacyMode,
            stats,
            formatCurrencyPrecise,
            investments,
            calculatePercentage,
            showNetWorth,
            targetNetWorth,
            assetClassData,
            CustomTooltip,
            platformData,
            isDarkMode,
            onViewChange,
            dynamicProjectionData,
            onQuickAction,
            history,
            lifeEvents,
            addLifeEvent,
            deleteLifeEvent,
        };
        return <WidgetRegistry {...widgetProps} />;
    };
    const renderDashboardView = () => {
        if (view === 'SPENDING') {
            return (
                <Suspense fallback={<WidgetSkeleton title="Spending Hub" />}>
                    <SpendingAnalyticsHub
                        onBack={() => onViewChange('MAIN')}
                        formatCurrency={formatCurrency}
                    />
                </Suspense>
            );
        }

        if (view === 'MARKETS') {
            return (
                <Suspense fallback={<WidgetSkeleton title="Market Hub" />}>
                    <MarketInsightsHub
                        onBack={() => onViewChange('MAIN')}
                        stats={stats}
                        investments={investments}
                    />
                </Suspense>
            );
        }

        if (view === 'COMMUNITY') {
            return (
                <Suspense fallback={<WidgetSkeleton title="Community Hub" />}>
                    <CommunityHub
                        onBack={() => onViewChange('MAIN')}
                        investments={investments}
                        stats={stats}
                        assetClassData={assetClassData}
                    />
                </Suspense>
            );
        }

        return (
            <div className="page-shell space-y-4 sm:space-y-6 pt-1 sm:pt-4 pb-24 md:pb-0">
                {/* 1. CANONICAL TAB HEADER & ACTIONS */}
                <TabHeader
                    title="Wealth Dashboard"
                    subtitle="Live operating surface for portfolio state, broker priorities, and execution."
                    hideTitleOnMobile={true}
                    badge={
                        <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">
                            {showNetWorth ? 'Net Mode' : 'Gross Mode'}
                        </span>
                    }
                    actions={
                        <>
                            {/* Desktop Actions (Text Buttons) */}
                            <div className="hidden sm:flex items-center justify-end gap-2 w-auto">
                                <Button
                                    variant={isBeginnerMode ? "outline" : "secondary"}
                                    size="sm"
                                    onClick={() => setIsBeginnerMode((prev) => !prev)}
                                    className={`inline-flex items-center gap-1.5 whitespace-nowrap ${
                                        isBeginnerMode
                                            ? "border-amber-500/50 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                            : "text-slate-300 hover:text-white"
                                    }`}
                                    title={isBeginnerMode ? 'Switch to Standard View' : 'Switch to Beginner Mode'}
                                >
                                    <Circle size={10} className={`shrink-0 ${isBeginnerMode ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
                                    <span>{isBeginnerMode ? 'Beginner Mode On' : 'Standard View'}</span>
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setShowHealthHub((prev) => !prev)}
                                >
                                    {showHealthHub ? 'Hide Health Hub' : 'Open Health Hub'}
                                </Button>
                                <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => onQuickAction('add')}
                                >
                                    Add Asset
                                </Button>
                            </div>

                            {/* Mobile Actions (Authentic 1:1 Square Icon Boxes) */}
                            <div className="flex sm:hidden items-center justify-end gap-2 w-full">
                                <button
                                    type="button"
                                    onClick={() => setIsBeginnerMode((prev) => !prev)}
                                    title={isBeginnerMode ? 'Beginner Mode On' : 'Standard View'}
                                    aria-label={isBeginnerMode ? 'Beginner Mode On' : 'Standard View'}
                                    className={`aspect-square w-8 h-8 rounded-lg border flex items-center justify-center transition-all active:scale-95 ${
                                        isBeginnerMode
                                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                                            : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-white'
                                    }`}
                                >
                                    <Circle size={12} className={`shrink-0 ${isBeginnerMode ? 'fill-amber-400' : ''}`} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowHealthHub((prev) => !prev)}
                                    title={showHealthHub ? 'Hide Health Hub' : 'Open Health Hub'}
                                    aria-label={showHealthHub ? 'Hide Health Hub' : 'Open Health Hub'}
                                    className={`aspect-square w-8 h-8 rounded-lg border flex items-center justify-center transition-all active:scale-95 ${
                                        showHealthHub
                                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                                            : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:text-white'
                                    }`}
                                >
                                    <Activity size={14} className="shrink-0" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onQuickAction('add')}
                                    title="Add Asset"
                                    aria-label="Add Asset"
                                    className="aspect-square w-8 h-8 rounded-lg border border-indigo-500/30 bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all active:scale-95 shadow-sm shadow-indigo-600/30"
                                >
                                    <Plus size={15} className="shrink-0" />
                                </button>
                            </div>
                        </>
                    }
                />

                {/* 2. MACRO REGIME DETECTOR */}
                <MacroRegimeBanner />

                {/* 3. PRIMARY HERO SECTION (Net Worth / Wealth Health) */}
                {!isPresent ? (
                    <div className={`rounded-wa-lg p-4 sm:p-5 md:p-6 shadow-lg border transition-all duration-500 relative overflow-hidden ${timeTravelData.type === 'PAST' ? 'bg-slate-100 dark:bg-wa-card border-slate-200 dark:border-wa-border' : 'bg-indigo-50 dark:bg-wa-card border-indigo-200 dark:border-wa-border'}`}>
                        <div className="absolute top-0 right-0 p-8 opacity-10">
                            {timeTravelData.type === 'PAST' ? <History size={120} className="text-slate-900 dark:text-white" /> : <Target size={120} className="text-indigo-600 dark:text-indigo-400" />}
                        </div>
                        <div className="relative z-10 text-center">
                            <p className={`text-sm font-bold uppercase tracking-widest mb-2 ${timeTravelData.type === 'PAST' ? 'text-slate-500 dark:text-slate-400' : 'text-indigo-600 dark:text-indigo-300'}`}>
                                {timeTravelData.type === 'PAST' ? 'Historical Snapshot' : 'Future Projection'}
                            </p>
                            <h2 className="text-5xl font-black text-slate-900 dark:text-white mb-2">
                                {isPrivacyMode ? '••••••' : formatCurrency(timeTravelData.value)}
                            </h2>
                            <p className="text-lg font-medium text-slate-600 dark:text-white/70">
                                {timeTravelData.date}
                            </p>
                            <Button
                                onClick={() => setTimeTravelIndex(history?.length || 0)}
                                variant="outline"
                                size="default"
                                className="mt-6"
                            >
                                Return to Present
                            </Button>
                        </div>
                    </div>
                ) : (
                    <HeroSection
                        stats={stats}
                        isPrivacyMode={isPrivacyMode}
                        dynamicHealthScore={dynamicHealthScore}
                        formatCurrency={formatCurrency}
                        lifeEvents={lifeEvents}
                        addLifeEvent={addLifeEvent}
                        deleteLifeEvent={deleteLifeEvent}
                        showLiability={showNetWorth}
                        setShowLiability={setShowNetWorth}
                    />
                )}

                {showHealthHub && (
                    <div className="mb-6 animate-in slide-in-from-top-4 duration-300">
                        <DataHealthHub onClose={() => setShowHealthHub(false)} />
                    </div>
                )}

                {/* 4. COMMAND CENTER (MARKET PULSE + MISSION QUEUE) */}
                <Suspense fallback={null}>
                    <CommandCenter marketStatus={marketStatus} marketVix={marketVix} onQuickAction={onQuickAction} />
                </Suspense>

                {/* 5. TIME TRAVELER SLIDER */}
                {investments.length > 0 && (
                    <>
                        <div className="luxury-card bg-white/80 dark:bg-wa-card backdrop-blur-xl p-4 rounded-wa-lg border border-slate-200/80 dark:border-wa-border shadow-sm">
                            <div className="toolbar-wrap justify-between mb-2 flex items-center">
                                <div className="flex items-center gap-4 min-w-0">
                                    <span className="hidden sm:inline-flex text-xs font-bold text-slate-400 uppercase items-center gap-1"><History size={12} /> Past</span>
                                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-1">Time Traveler <Clock size={12} /></span>
                                    <span className="hidden sm:inline-flex text-xs font-bold text-slate-400 uppercase items-center gap-1">Future <Target size={12} /></span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setShowReportModal(true)}
                                        className="gap-1.5"
                                    >
                                        <FileText size={12} /> Generate Report
                                    </Button>
                                </div>
                            </div>
                            <Slider
                                min={0}
                                max={(history?.length || 0) + (projectionData?.length || 0)}
                                value={timeTravelIndex}
                                onChange={(val) => setTimeTravelIndex(val)}
                                formatValue={() => timeTravelData.date || 'Present'}
                            />
                        </div>

                        {/* Only show widgets if in Present Mode */}
                        {isPresent && (
                            <>
                                {/* EDIT MODE BANNER */}
                                {isEditMode && (
                                    <div className="bg-indigo-600 text-white p-2 rounded-lg text-center text-sm font-bold mb-4 animate-in fade-in slide-in-from-top-2">
                                        Edit Mode Active - Drag widgets to reorder
                                    </div>
                                )}

                                <DashboardGrid 
                                    renderWidget={renderWidget} 
                                    isBeginnerMode={isBeginnerMode}
                                />
                            </>
                        )}
                    </>
                )
                }

                {
                    investments.length === 0 && !isStoreLoading && (
                        <div className="bg-white dark:bg-wa-card rounded-wa-lg p-12 text-center border border-slate-200 dark:border-wa-border shadow-sm animate-in fade-in zoom-in duration-500">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-wa-card-elevated text-slate-400 mb-4">
                                <PieChart size={32} />
                            </div>
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                                {activeEntity === 'ALL' ? 'No investment data found' : `No assets found for ${getEntityName(activeEntity)}`}
                            </h3>
                            <p className="text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto text-sm">
                                {activeEntity !== 'ALL' && allInvestments.length > 0 
                                    ? `You have ${allInvestments.length} total assets, but none are tagged to this profile.`
                                    : 'Start by adding your first investment to unlock AI-powered insights and tracking.'
                                }
                            </p>
                            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                                <Button 
                                    onClick={onAddFirstAsset} 
                                    variant="default"
                                    size="lg"
                                    className="gap-2"
                                >
                                    <Plus size={18} /> Add First Asset
                                </Button>
                                {activeEntity !== 'ALL' && allInvestments.length > 0 && (
                                    <Button 
                                        onClick={() => setActiveEntity('ALL')}
                                        variant="secondary"
                                        size="lg"
                                    >
                                        View All Assets
                                    </Button>
                                )}
                            </div>
                        </div>
                    )
                }


                {isStoreLoading && (
                    <div className="space-y-8">
                        <div className="bg-wa-card/50 rounded-wa-lg p-8 border border-wa-border animate-pulse">
                            <div className="flex justify-between items-start mb-12">
                                <div className="space-y-3">
                                    <SkeletonLine width="120px" height={12} rounded />
                                    <SkeletonNumber size="xl" />
                                </div>
                                <div className="flex gap-2">
                                    <div className="w-20 h-10 bg-slate-800 rounded-xl" />
                                    <div className="w-20 h-10 bg-slate-800 rounded-xl" />
                                </div>
                            </div>
                            <div className="grid grid-cols-4 gap-6">
                                <div className="h-24 bg-slate-800/50 rounded-2xl" />
                                <div className="h-24 bg-slate-800/50 rounded-2xl" />
                                <div className="h-24 bg-slate-800/50 rounded-2xl" />
                                <div className="h-24 bg-slate-800/50 rounded-2xl" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-8">
                            <SkeletonCard />
                            <SkeletonCard />
                        </div>
                    </div>
                )}

                {/* Report Modal */}
                <Suspense fallback={null}>
                    <ReportGenerationModal
                        isOpen={showReportModal}
                        onClose={() => setShowReportModal(false)}
                        currentStats={stats}
                        investments={investments}
                        allocationData={allocationData}
                    />
                </Suspense>
            </div>
        );
    }; // Close renderDashboardView

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={view}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="h-full"
            >
                {renderDashboardView()}
            </motion.div>
        </AnimatePresence>
    );
}; // Close DashboardTab component

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(DashboardTab);
