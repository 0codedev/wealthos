import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart4, Calendar, TrendingUp, Users, CheckCircle2, XCircle, Clock, Award, Shield, Sparkles, Layers } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';
import { IPOApplication } from '../../database';
import { ipoCalendarService, IPOListing } from '../../services/IPOCalendarService';

export interface CapitalStackItem {
    name: string;
    amount: number;
    count: number;
    apps?: IPOApplication[];
}

interface CapitalStackProps {
    totalCash: number;
    availableCapital: number;
    displayTotal: number;
    isCapitalDanger: boolean;
    stackData: CapitalStackItem[];
}

const STACK_COLORS = [
    'bg-emerald-500 hover:bg-emerald-400',
    'bg-blue-500 hover:bg-blue-400',
    'bg-amber-500 hover:bg-amber-400',
    'bg-rose-500 hover:bg-rose-400',
    'bg-indigo-500 hover:bg-indigo-400',
    'bg-teal-500 hover:bg-teal-400',
    'bg-purple-500 hover:bg-purple-400',
    'bg-cyan-500 hover:bg-cyan-400',
    'bg-orange-500 hover:bg-orange-400'
];

const STACK_DOT_COLORS = [
    'bg-emerald-500',
    'bg-blue-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-indigo-500',
    'bg-teal-500',
    'bg-purple-500',
    'bg-cyan-500',
    'bg-orange-500'
];

export const CapitalStack = React.memo(({ totalCash, availableCapital, displayTotal, isCapitalDanger, stackData }: CapitalStackProps) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const [calendarListings, setCalendarListings] = useState<IPOListing[]>([]);
    const [tooltipCoords, setTooltipCoords] = useState<{ x: number; y: number; placement: 'top' | 'bottom' } | null>(null);

    useEffect(() => {
        let isMounted = true;
        ipoCalendarService.getAllIPOs().then(listings => {
            if (isMounted) setCalendarListings(listings);
        }).catch(() => {});
        return () => { isMounted = false; };
    }, []);

    const activeHoverItem = hoveredIdx !== null ? stackData[hoveredIdx] : null;

    // Find matching IPO calendar metadata if available
    const matchedListing = useMemo(() => {
        if (!activeHoverItem || !calendarListings.length) return null;
        const targetClean = activeHoverItem.name.trim().toLowerCase();
        return calendarListings.find(l => {
            const nameClean = l.name.trim().toLowerCase();
            return nameClean === targetClean || nameClean.includes(targetClean) || targetClean.includes(nameClean);
        }) || null;
    }, [activeHoverItem, calendarListings]);

    // Compute stats for the hovered item
    const itemStats = useMemo(() => {
        if (!activeHoverItem) return null;
        const apps = activeHoverItem.apps || [];
        const allotted = apps.filter(a => a.status === 'ALLOTTED' || a.status === 'LISTED').length;
        const refunded = apps.filter(a => a.status === 'REFUNDED').length;
        const blocked = apps.filter(a => a.status === 'BLOCKED').length;
        const total = apps.length || activeHoverItem.count || 1;
        const allotmentRate = total > 0 ? (allotted / total) * 100 : 0;
        
        // Quotas used
        const quotas = Array.from(new Set(apps.map(a => a.quota).filter(Boolean)));
        const ipoTypes = Array.from(new Set(apps.map(a => a.ipoType).filter(Boolean)));
        const avgPerApp = total > 0 ? activeHoverItem.amount / total : 0;
        const shareOfPool = displayTotal > 0 ? (activeHoverItem.amount / displayTotal) * 100 : 0;

        return {
            allotted,
            refunded,
            blocked,
            total,
            allotmentRate,
            quotas,
            ipoTypes,
            avgPerApp,
            shareOfPool,
            apps
        };
    }, [activeHoverItem, displayTotal]);

    const updateTooltipPos = (e: React.MouseEvent<HTMLElement>) => {
        const tooltipWidth = 340;
        const tooltipHeight = 240;
        const padding = 16;
        
        const x = e.clientX;
        const minX = tooltipWidth / 2 + padding;
        const maxX = window.innerWidth - tooltipWidth / 2 - padding;
        const clampedX = Math.max(minX, Math.min(x, maxX));

        let y = e.clientY - 14;
        let placement: 'top' | 'bottom' = 'top';

        if (e.clientY - tooltipHeight - 20 < 10) {
            y = e.clientY + 24;
            placement = 'bottom';
        }

        setTooltipCoords({ x: clampedX, y, placement });
    };

    const handleMouseEnter = (idx: number, e: React.MouseEvent<HTMLElement>) => {
        setHoveredIdx(idx);
        updateTooltipPos(e);
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
        updateTooltipPos(e);
    };

    const handleMouseLeave = () => {
        setHoveredIdx(null);
        setTooltipCoords(null);
    };

    // Calculate effective liquidity metrics so it never displays ₹0 when capital is deployed
    const totalAllocatedCapital = useMemo(() => {
        return stackData.reduce((sum, item) => sum + item.amount, 0);
    }, [stackData]);

    const displayLiquidity = totalCash > 0 ? totalCash : totalAllocatedCapital;
    const displayAvailable = totalCash > 0 ? availableCapital : 0;

    return (
        <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800 relative select-none">
            {/* Header Metrics */}
            <div className="flex justify-between items-end mb-3">
                <div>
                    <p className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
                        <BarChart4 size={14} className="text-indigo-500" /> Capital Stack & Liquidity Strip
                    </p>
                    <p className="text-sm font-medium text-slate-400 mt-0.5">
                        {totalCash > 0 ? 'Total Liquidity: ' : 'Active Syndicate Capital: '}
                        <span className="text-slate-900 dark:text-white font-mono font-bold">
                            {formatCurrency(displayLiquidity)}
                        </span>
                        {totalCash === 0 && totalAllocatedCapital > 0 && (
                            <span className="text-[10px] text-indigo-400 font-normal ml-1.5">({stackData.length} IPOs active)</span>
                        )}
                    </p>
                </div>
                <div className="text-right">
                    <p className={`text-sm font-mono font-bold ${isCapitalDanger ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {formatCurrency(displayAvailable)}
                    </p>
                    <p className="text-xs uppercase font-bold text-slate-400">Available</p>
                </div>
            </div>

            {/* Interactive Color Strip Bar */}
            <div
                className="w-full h-9 bg-slate-200 dark:bg-slate-800/80 rounded-xl overflow-hidden flex shadow-inner relative cursor-pointer"
                onMouseLeave={handleMouseLeave}
            >
                {stackData.map((item, idx) => {
                    const width = displayTotal > 0 ? (item.amount / displayTotal) * 100 : 0;
                    const isHovered = hoveredIdx === idx;
                    const colorClass = STACK_COLORS[idx % STACK_COLORS.length];

                    return (
                        <div
                            key={item.name}
                            onMouseEnter={(e) => handleMouseEnter(idx, e)}
                            onMouseMove={handleMouseMove}
                            className={`h-full ${colorClass} border-r border-slate-900/20 flex items-center justify-center text-[10px] font-bold text-white whitespace-nowrap overflow-hidden transition-all duration-150 relative ${
                                isHovered ? 'brightness-110 shadow-lg scale-[1.01] z-10 ring-2 ring-white/40' : 'opacity-95'
                            }`}
                            style={{ width: `${Math.max(width, 0.5)}%` }}
                        >
                            {/* Always visible label if width allows */}
                            {width > 8 && (
                                <span className="truncate px-1.5 drop-shadow-sm font-semibold tracking-tight">
                                    {item.name} {width > 16 && `(${formatCurrency(item.amount)})`}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Legend Chips with quick tooltips */}
            {stackData.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 text-xs">
                    {stackData.map((item, idx) => {
                        const isHovered = hoveredIdx === idx;
                        const dotColor = STACK_DOT_COLORS[idx % STACK_DOT_COLORS.length];
                        const width = displayTotal > 0 ? ((item.amount / displayTotal) * 100).toFixed(1) : '0';

                        return (
                            <button
                                key={item.name}
                                onMouseEnter={(e) => handleMouseEnter(idx, e)}
                                onMouseMove={handleMouseMove}
                                onMouseLeave={handleMouseLeave}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all text-[11px] font-medium border ${
                                    isHovered
                                        ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white border-indigo-500/50 shadow-xs scale-105'
                                        : 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[150px]">{item.name}</span>
                                <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">₹{formatCurrency(item.amount)}</span>
                                <span className="text-[10px] text-slate-400 font-mono">({width}%)</span>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Floating Live-Production Tooltip Card */}
            {activeHoverItem && itemStats && tooltipCoords && (
                <div
                    className="fixed z-[9999] pointer-events-none transition-all duration-75 animate-in fade-in zoom-in-95"
                    style={{
                        left: `${tooltipCoords.x}px`,
                        top: `${tooltipCoords.y}px`,
                        transform: tooltipCoords.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
                        width: '340px'
                    }}
                >
                    <div className="bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-xl border border-indigo-500/30 rounded-2xl p-4 shadow-2xl text-white space-y-3">
                        {/* Tooltip Header */}
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800">
                            <div className="flex items-center gap-2">
                                <span className={`w-3 h-3 rounded-full ${hoveredIdx !== null ? STACK_DOT_COLORS[hoveredIdx % STACK_DOT_COLORS.length] : 'bg-indigo-500'} shadow-sm`} />
                                <div>
                                    <h4 className="font-black text-sm tracking-tight text-white leading-tight">
                                        {activeHoverItem.name}
                                    </h4>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                            {itemStats.ipoTypes[0] || matchedListing?.category || 'MAINBOARD'}
                                        </span>
                                        {itemStats.quotas.map(q => (
                                            <span key={q} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                                {q}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-xs font-mono font-black text-emerald-400">
                                    ₹{formatCurrency(activeHoverItem.amount)}
                                </div>
                                <div className="text-[10px] text-slate-400 font-medium">
                                    {itemStats.shareOfPool.toFixed(1)}% of Pool
                                </div>
                            </div>
                        </div>

                        {/* Allotment & Win Rate Visualizer */}
                        <div className="bg-slate-800/80 rounded-xl p-3 space-y-2 border border-slate-700/60 shadow-inner">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-slate-200 flex items-center gap-1.5">
                                    <Award size={14} className="text-amber-400" /> Allotment Rate
                                </span>
                                <span className="font-mono font-black text-emerald-400 text-sm">
                                    {itemStats.allotmentRate.toFixed(1)}% <span className="text-xs text-slate-400 font-normal">({itemStats.allotted}/{itemStats.total} Apps)</span>
                                </span>
                            </div>

                            {/* High-Contrast Multi-Segment Visualizer Bar */}
                            <div className="w-full h-3 bg-slate-900 rounded-lg overflow-hidden flex border border-slate-700/80 shadow-inner">
                                {itemStats.allotted > 0 && (
                                    <div
                                        className="h-full transition-all"
                                        style={{
                                            width: `${(itemStats.allotted / itemStats.total) * 100}%`,
                                            backgroundColor: '#10b981' // Vibrant Green (Allotted)
                                        }}
                                        title={`Allotted: ${itemStats.allotted} (${((itemStats.allotted / itemStats.total) * 100).toFixed(0)}%)`}
                                    />
                                )}
                                {itemStats.blocked > 0 && (
                                    <div
                                        className="h-full transition-all animate-pulse"
                                        style={{
                                            width: `${(itemStats.blocked / itemStats.total) * 100}%`,
                                            backgroundColor: '#f59e0b' // Vibrant Amber (In Review)
                                        }}
                                        title={`In Review: ${itemStats.blocked} (${((itemStats.blocked / itemStats.total) * 100).toFixed(0)}%)`}
                                    />
                                )}
                                {itemStats.refunded > 0 && (
                                    <div
                                        className="h-full transition-all"
                                        style={{
                                            width: `${(itemStats.refunded / itemStats.total) * 100}%`,
                                            backgroundColor: '#ef4444' // Vibrant Coral/Red (Refunded)
                                        }}
                                        title={`Refunded: ${itemStats.refunded} (${((itemStats.refunded / itemStats.total) * 100).toFixed(0)}%)`}
                                    />
                                )}
                            </div>

                            {/* Color-Coded Breakdown Badges with matching colored dots */}
                            <div className="flex justify-between items-center text-[10px] pt-0.5 font-bold">
                                <span className="flex items-center gap-1.5 text-emerald-400">
                                    <span className="w-2 h-2 rounded-full inline-block shrink-0 shadow-sm" style={{ backgroundColor: '#10b981' }} />
                                    {itemStats.allotted} Allotted
                                </span>
                                {itemStats.blocked > 0 && (
                                    <span className="flex items-center gap-1.5 text-amber-400">
                                        <span className="w-2 h-2 rounded-full inline-block shrink-0 shadow-sm" style={{ backgroundColor: '#f59e0b' }} />
                                        {itemStats.blocked} In Review
                                    </span>
                                )}
                                <span className="flex items-center gap-1.5 text-rose-400">
                                    <span className="w-2 h-2 rounded-full inline-block shrink-0 shadow-sm" style={{ backgroundColor: '#ef4444' }} />
                                    {itemStats.refunded} Refunded
                                </span>
                            </div>
                        </div>

                        {/* Applicants Quick Chips */}
                        {itemStats.apps.length > 0 && (
                            <div className="space-y-1">
                                <p className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1">
                                    <Users size={11} /> Applicants ({itemStats.apps.length})
                                </p>
                                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                                    {itemStats.apps.map((app, idx) => {
                                        const isWin = app.status === 'ALLOTTED' || app.status === 'LISTED';
                                        const isLoss = app.status === 'REFUNDED';
                                        return (
                                            <span
                                                key={`${app.id || app.applicantName}-${idx}`}
                                                className={`text-[10px] px-2 py-0.5 rounded-lg flex items-center gap-1 border font-medium ${
                                                    isWin
                                                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                                        : isLoss
                                                        ? 'bg-slate-800 text-slate-400 border-slate-700'
                                                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                                }`}
                                            >
                                                {app.applicantName}
                                                {app.status === 'LISTED' && <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-900/60 text-emerald-300">Listed</span>}
                                                {isWin && <CheckCircle2 size={10} className="text-emerald-400" />}
                                                {isLoss && <XCircle size={10} className="text-slate-500" />}
                                                {!isWin && !isLoss && <Clock size={10} className="text-amber-400" />}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Market Timeline & Parameters if available */}
                        {matchedListing && (
                            <div className="pt-2 border-t border-slate-800 space-y-1.5 text-xs">
                                <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-slate-400 flex items-center gap-1">
                                        <TrendingUp size={12} className="text-emerald-400" /> GMP Premium:
                                    </span>
                                    <span className="font-mono font-bold text-emerald-400">
                                        {matchedListing.gmp !== undefined ? `+₹${matchedListing.gmp}` : 'N/A'}
                                    </span>
                                </div>
                                {matchedListing.subscriptionData && (
                                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                                        <span>Sub Total: <b className="text-white font-mono">{matchedListing.subscriptionData.total}x</b></span>
                                        <span>Retail: <b className="text-white font-mono">{matchedListing.subscriptionData.retail}x</b></span>
                                        <span>QIB: <b className="text-white font-mono">{matchedListing.subscriptionData.qib}x</b></span>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-1.5 pt-1 text-[10px] text-slate-400 border-t border-slate-800/60">
                                    {matchedListing.issueOpenDate && <div>Open: <span className="text-slate-200 font-medium">{matchedListing.issueOpenDate}</span></div>}
                                    {matchedListing.allotmentDate && <div>Allotment: <span className="text-slate-200 font-medium">{matchedListing.allotmentDate}</span></div>}
                                    {matchedListing.listingDate && <div>Listing: <span className="text-emerald-300 font-semibold">{matchedListing.listingDate}</span></div>}
                                    {matchedListing.refundDate && <div>Refund: <span className="text-slate-200 font-medium">{matchedListing.refundDate}</span></div>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});
