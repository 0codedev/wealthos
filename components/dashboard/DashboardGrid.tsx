import React, { useState, useEffect, useRef } from 'react';
import { LayoutGrid, Eye, EyeOff, Check, RotateCcw, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { motion } from 'framer-motion';
import { staggerContainer, staggerItem, layoutTactileHover, springTransition } from '../ui/animations';
import { LazyWidgetWrapper } from './LazyWidgetWrapper';
import WidgetSkeleton from '../shared/WidgetSkeleton';

interface DashboardGridProps {
    renderWidget: (id: string) => React.ReactNode;
    isBeginnerMode?: boolean;
}

const COMPLEX_WIDGET_IDS = [
    'heatmap', 'runway-gauge', 'liability-watchdog', 'cashflow-ledger',
    'xirr-time-machine', 'smart-watchlist', 'dividend-calendar',
    'portfolio-constellation', 'black-swan-war-room', 'wealth-time-capsule',
    'correlation-matrix', 'rebalancing-wizard', 'wealth-simulator'
];

// Default layout spans (1 = 1/3 width, 2 = 2/3 width, 3 = Full width)
const DEFAULT_SPANS: Record<string, number> = {
    'project-5l': 3,
    'fortress-hub': 3,
    'calendar': 3,
    'wealth-simulator': 3,
    'milestone-timeline': 3,
    'runway-gauge': 3,
    'liability-watchdog': 3,
    'heatmap': 3,
    'alerts-widget': 3,
    // Hubs generally full width
    'smart-actions-widget': 3,
    // Mid-size
    'tax-harvesting': 2,
    'ai-copilot': 2,
    'fire-dashboard': 2,
    'correlation-matrix': 2,
    'rebalancing-wizard': 2,
    'goal-thermometer': 2,
    // Power User Widgets
    'xirr-time-machine': 2,
    'smart-watchlist': 2,
    'dividend-calendar': 2,
    // Moonshot Widgets
    'portfolio-constellation': 2,
    'black-swan-war-room': 2,
    'wealth-time-capsule': 2,
    'alpha-engine-hub': 3,
    // Defaults to 1 (Standard Widgets)
};

const AVAILABLE_WIDGETS = [
    // DhanHQ Live Integration
    { id: 'live-trading-vault', label: 'Live Trading Vault', default: true },
    // Row 1: Top KPIs
    { id: 'total-pl', label: 'Portfolio Summary', default: true },
    { id: 'top-performer', label: 'Top Performer', default: true },
    { id: 'total-holdings', label: 'Total Holdings', default: true },
    // Row 2: Tax & Liabilities
    { id: 'tax-harvesting', label: 'Tax Alpha', default: true },
    { id: 'loan-widget', label: 'Liabilities', default: true },
    // Row 3: Quick Actions
    { id: 'spending-widget', label: 'Spending Trend', default: true },
    { id: 'market-widget', label: 'Market Insights', default: true },
    { id: 'community-widget', label: 'Community', default: true },
    // Row 4: Growth & AI
    { id: 'fire-dashboard', label: 'FIRE Progress', default: true },
    { id: 'ai-copilot', label: 'AI Copilot', default: true },
    // Row 5: Planning
    { id: 'project-5l', label: 'Project 5L', default: true },
    { id: 'alerts-widget', label: 'Smart Alerts', default: true },
    { id: 'telegram-quick-send', label: 'Telegram Quick Send', default: true },
    // Row 6: Charts
    { id: 'exposure-chart', label: 'Asset Exposure', default: true },
    { id: 'platform-chart', label: 'Platform Split', default: true },
    { id: 'rebalancing-wizard', label: 'Rebalancing', default: true },
    // Row 7: Calendar
    { id: 'calendar', label: 'Financial Calendar', default: true },
    // Row 8: Analysis
    { id: 'heatmap', label: 'Market Heatmap', default: true },
    { id: 'runway-gauge', label: 'Runway Gauge', default: true },
    { id: 'liability-watchdog', label: 'Liability Watchdog', default: true },
    { id: 'cashflow-ledger', label: 'Cashflow Ledger', default: true },
    // Row 9: Goals
    { id: 'goal-thermometer', label: 'Goal Thermometer', default: true },
    { id: 'milestone-timeline', label: 'Milestone Timeline', default: true },
    { id: 'ghost-portfolio', label: 'Ghost Portfolio', default: true },
    // Row 10: Advanced
    { id: 'fortress-hub', label: 'Fortress Hub', default: true },
    { id: 'wealth-simulator', label: 'Wealth Simulator', default: true },
    // Power User Widgets
    { id: 'xirr-time-machine', label: 'XIRR Time-Machine', default: true },
    { id: 'smart-watchlist', label: 'Smart Watchlist', default: true },
    { id: 'dividend-calendar', label: 'Dividend Hub', default: true },
    // Moonshot Widgets
    { id: 'portfolio-constellation', label: 'Portfolio Constellation', default: true },
    { id: 'black-swan-war-room', label: 'Black Swan War Room', default: true },
    { id: 'wealth-time-capsule', label: 'Time Capsule', default: true },
    { id: 'alpha-engine-hub', label: 'Alpha Engine Hub', default: true },
];

export const DashboardGrid: React.FC<DashboardGridProps> = ({ renderWidget, isBeginnerMode }) => {
    const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
        const savedOrder = localStorage.getItem('dash_widget_order_v5');
        return savedOrder ? JSON.parse(savedOrder) : AVAILABLE_WIDGETS.map(w => w.id);
    });
    const [hiddenWidgets, setHiddenWidgets] = useState<string[]>(() => {
        const savedHidden = localStorage.getItem('dash_hidden_widgets_v5');
        return savedHidden ? JSON.parse(savedHidden) : [];
    });
    const [widgetSpans, setWidgetSpans] = useState<Record<string, number>>(() => {
        const savedSpans = localStorage.getItem('dash_widget_spans_v2');
        return savedSpans ? JSON.parse(savedSpans) : DEFAULT_SPANS;
    });
    const [isCustomizing, setIsCustomizing] = useState(false);
    // Native drag-and-drop reorder state (Sprint 1.1 production relocate)
    const dragIdRef = useRef<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    useEffect(() => {
        setWidgetOrder(prev => {
            if (prev.length === 0) return prev;
            // Ensure ghost-portfolio and tax-harvesting are in the order if missing from saved state
            let newOrder = [...prev];
            let changed = false;
            
            if (!newOrder.includes('tax-harvesting')) {
                const spendIndex = newOrder.indexOf('spending-widget');
                if (spendIndex !== -1) newOrder.splice(spendIndex + 1, 0, 'tax-harvesting');
                else newOrder.push('tax-harvesting');
                changed = true;
            }

            if (!newOrder.includes('ghost-portfolio')) {
                const milestoneIndex = newOrder.indexOf('milestone-timeline');
                if (milestoneIndex !== -1) newOrder.splice(milestoneIndex + 1, 0, 'ghost-portfolio');
                else newOrder.push('ghost-portfolio');
                changed = true;
            }

            if (!newOrder.includes('alpha-engine-hub')) {
                const aiIndex = newOrder.indexOf('ai-copilot');
                if (aiIndex !== -1) newOrder.splice(aiIndex + 1, 0, 'alpha-engine-hub');
                else newOrder.push('alpha-engine-hub');
                changed = true;
            }

            // Sprint 3.7: migrate existing layouts to include the rebuilt
            // Telegram quick-send widget right after Smart Alerts.
            if (!newOrder.includes('telegram-quick-send')) {
                const alertsIndex = newOrder.indexOf('alerts-widget');
                if (alertsIndex !== -1) newOrder.splice(alertsIndex + 1, 0, 'telegram-quick-send');
                else newOrder.push('telegram-quick-send');
                changed = true;
            }

            return changed ? newOrder : prev;
        })
    }, []);

    // Save
    useEffect(() => {
        if (widgetOrder.length > 0) localStorage.setItem('dash_widget_order_v5', JSON.stringify(widgetOrder));
        if (hiddenWidgets) localStorage.setItem('dash_hidden_widgets_v5', JSON.stringify(hiddenWidgets));
        if (Object.keys(widgetSpans).length > 0) localStorage.setItem('dash_widget_spans_v2', JSON.stringify(widgetSpans));
    }, [widgetOrder, hiddenWidgets, widgetSpans]);

    const moveWidget = (index: number, direction: 'UP' | 'DOWN') => {
        const newOrder = [...widgetOrder];
        if (direction === 'UP' && index > 0) {
            [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
        } else if (direction === 'DOWN' && index < newOrder.length - 1) {
            [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
        }
        setWidgetOrder(newOrder);
    };

    const toggleVisibility = (id: string) => {
        if (hiddenWidgets.includes(id)) {
            setHiddenWidgets(hiddenWidgets.filter(w => w !== id));
        } else {
            setHiddenWidgets([...hiddenWidgets, id]);
        }
    };

    const updateSpan = (id: string, span: number) => {
        setWidgetSpans(prev => ({ ...prev, [id]: span }));
    };

    const getSpanClass = (id: string) => {
        const span = widgetSpans[id] || DEFAULT_SPANS[id] || 1;
        if (span === 3) return 'col-span-1 md:col-span-2 lg:col-span-3'; // Full width
        if (span === 2) return 'col-span-1 md:col-span-2 lg:col-span-2'; // 2/3 width
        return 'col-span-1'; // 1/3 width
    };

    const restoreDefaults = () => {
        // Clear persisted data
        localStorage.removeItem('dash_widget_order_v5');
        localStorage.removeItem('dash_hidden_widgets_v5');
        localStorage.removeItem('dash_widget_spans_v2');

        // Reset to defaults
        setWidgetOrder(AVAILABLE_WIDGETS.map(w => w.id));
        setHiddenWidgets(AVAILABLE_WIDGETS.filter(w => !w.default).map(w => w.id));
        setWidgetSpans(DEFAULT_SPANS);
    };

    const handleDrop = (targetId: string) => {
        const sourceId = dragIdRef.current;
        dragIdRef.current = null;
        setDragOverId(null);
        if (!sourceId || sourceId === targetId) return;
        setWidgetOrder(prev => {
            const next = [...prev];
            const from = next.indexOf(sourceId);
            const to = next.indexOf(targetId);
            if (from === -1 || to === -1) return prev;
            next.splice(from, 1);
            next.splice(to, 0, sourceId);
            return next;
        });
    };

    return (
        <div className="space-y-6">
            {/* Customization Toggle */}
            <div className="flex justify-end gap-2">
                {isCustomizing && (
                    <button
                        onClick={restoreDefaults}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm bg-white dark:bg-[#0D0E14] text-slate-500 hover:text-amber-500 border border-slate-200 dark:border-white/[0.08]"
                    >
                        <RotateCcw size={15} className="shrink-0" />
                        <span>Restore Default</span>
                    </button>
                )}
                <button
                    onClick={() => setIsCustomizing(!isCustomizing)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm ${isCustomizing
                        ? 'bg-indigo-600 text-white ring-2 ring-indigo-500/20 shadow-lg shadow-indigo-500/20'
                        : 'bg-white dark:bg-[#0D0E14] text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-white/[0.08]'
                        }`}
                >
                    {isCustomizing ? <Check size={15} className="shrink-0" /> : <LayoutGrid size={15} className="shrink-0" />}
                    <span>{isCustomizing ? 'Done Editing' : 'Customize Layout'}</span>
                </button>
            </div>

            {/* Grid Area */}
            <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="show"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-6 pb-16 sm:pb-20 min-w-0 max-w-full"
            >
                {widgetOrder.map((id, index) => {
                    const widgetDef = AVAILABLE_WIDGETS.find(w => w.id === id);
                    if (!widgetDef) return null;

                    // Skip complex widgets in Beginner Mode
                    if (isBeginnerMode && COMPLEX_WIDGET_IDS.includes(id)) return null;

                    const isHidden = hiddenWidgets.includes(id);

                    if (!isCustomizing && isHidden) return null;

                    const currentSpan = widgetSpans[id] || DEFAULT_SPANS[id] || 1;
                    const spanClass = getSpanClass(id);
                    const lazyMinHeight = currentSpan === 3 ? '360px' : currentSpan === 2 ? '320px' : '260px';
                    const skeletonHeight = currentSpan === 3 ? 'h-[320px]' : currentSpan === 2 ? 'h-[280px]' : 'h-[220px]';

                    return (
                        <motion.div
                            key={id}
                            layout
                            variants={staggerItem}
                            transition={springTransition}
                            whileHover={!isCustomizing ? layoutTactileHover.whileHover : undefined}
                            whileTap={layoutTactileHover.whileTap}
                            draggable={isCustomizing && !isHidden}
                            onDragStart={() => { dragIdRef.current = id; }}
                            onDragEnd={() => { dragIdRef.current = null; setDragOverId(null); }}
                            onDragOver={(e: React.DragEvent) => {
                                if (!isCustomizing || !dragIdRef.current || dragIdRef.current === id) return;
                                e.preventDefault();
                                setDragOverId(id);
                            }}
                            onDrop={(e: React.DragEvent) => {
                                if (!isCustomizing) return;
                                e.preventDefault();
                                handleDrop(id);
                            }}
                            className={`relative min-w-0 max-w-full overflow-hidden transition-colors duration-300 ${spanClass} ${isCustomizing
                                ? 'rounded-3xl border-2 bg-slate-50/80 dark:bg-slate-900/40 p-4 min-h-[160px] cursor-grab active:cursor-grabbing'
                                : ''
                                } ${isCustomizing && !isHidden ? 'border-dashed border-indigo-300 dark:border-indigo-700/60' : ''} ${isCustomizing && isHidden ? 'border-dashed border-slate-300 dark:border-slate-700 opacity-50 grayscale' : ''} ${dragOverId === id && isCustomizing ? '!border-solid !border-indigo-500 ring-2 ring-indigo-400/40 scale-[1.01]' : ''}`}
                        >
                            {isCustomizing ? (
                                <div className="flex flex-col h-full gap-3">
                                    {/* Header: grip + label + move/hide controls */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <GripVertical size={14} className="text-slate-400 shrink-0" aria-hidden="true" />
                                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm truncate">
                                                {widgetDef.label}
                                            </span>
                                            <span className={`hidden lg:inline-flex text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${isHidden ? 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'}`}>
                                                {isHidden ? 'Hidden' : 'Live'}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-1 shadow-sm shrink-0">
                                            <button
                                                onClick={() => moveWidget(index, 'UP')}
                                                disabled={index === 0}
                                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md disabled:opacity-30 text-slate-600 dark:text-slate-400"
                                                title="Move Up"
                                            >
                                                <ArrowUp size={14} />
                                            </button>
                                            <button
                                                onClick={() => moveWidget(index, 'DOWN')}
                                                disabled={index === widgetOrder.length - 1}
                                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md disabled:opacity-30 text-slate-600 dark:text-slate-400"
                                                title="Move Down"
                                            >
                                                <ArrowDown size={14} />
                                            </button>
                                            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
                                            <button
                                                onClick={() => toggleVisibility(id)}
                                                className={`p-1.5 rounded-md transition-colors ${isHidden ? 'text-rose-500 bg-rose-50 dark:bg-rose-900/20' : 'text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                                                title={isHidden ? "Show Widget" : "Hide Widget"}
                                            >
                                                {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* LIVE THEMED PREVIEW (Sprint 1.1): renders the real widget,
                                        scaled into a fixed-height viewport with interactions disabled.
                                        This replaces the old title-only placeholder. */}
                                    <div className="relative flex-1 min-h-[150px] max-h-[190px] overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-inner">
                                        {!isHidden && (
                                            <>
                                                <div
                                                    aria-hidden="true"
                                                    className="absolute top-0 left-0 origin-top-left pointer-events-none select-none"
                                                    style={{ width: '238%', transform: 'scale(0.42)' }}
                                                >
                                                    {renderWidget(id)}
                                                </div>
                                                {/* Fade-out mask suggesting continuation */}
                                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white dark:from-slate-900 to-transparent" />
                                                <div className="pointer-events-none absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-indigo-600/90 text-white text-[8px] font-black uppercase tracking-wider">
                                                    Live Preview
                                                </div>
                                            </>
                                        )}
                                        {isHidden && (
                                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                <EyeOff className="w-6 h-6 text-slate-400 mb-1.5" />
                                                <span className="text-xs font-medium text-slate-400">Hidden from Dashboard</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Footer: Resize Controls */}
                                    <div className="flex justify-center">
                                        <div className="flex items-center gap-1 bg-white dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 p-1 shadow-sm">
                                            {[1, 2, 3].map((size) => (
                                                <button
                                                    key={size}
                                                    onClick={() => updateSpan(id, size)}
                                                    className={`px-4 py-1.5 text-[11px] font-bold rounded-lg transition-all ${currentSpan === size
                                                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20'
                                                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                        }`}
                                                >
                                                    {size === 1 ? 'Small' : size === 2 ? 'Medium' : 'Full'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full">
                                    <LazyWidgetWrapper
                                        minHeight={lazyMinHeight}
                                        placeholder={<WidgetSkeleton title={widgetDef.label} height={skeletonHeight} />}
                                    >
                                        {renderWidget(id)}
                                    </LazyWidgetWrapper>
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </motion.div>
        </div>
    );
};
