import React, { useEffect, useMemo, useState, useRef, useCallback, Profiler } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import BulkActionTray from './BulkActionTray';
import { Trade, QuickLog, db, Strategy } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { TrendingUp, TrendingDown, Calendar, Target, Brain, MessageSquare, Trash2, Info, Layers, Zap, Clock, BookOpenCheck, Edit2, X, AlertOctagon, ChevronLeft, ChevronRight, StickyNote } from 'lucide-react';
import { getActiveJournalReviewHandoffs, JOURNAL_REVIEW_HANDOFF_EVENT } from '../../services/JournalReviewHandoffService';
import { StateSurface } from '../shared/SurfacePrimitives';
import { useToast } from '../shared/ToastProvider';
import { COPY } from '../../utils/appCopy';
import { SkeletonCard } from '../ui/Skeleton';

const onRenderCallback = (
    id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
) => {
    if (actualDuration > 10) {
        console.log(`[Profiler] ${id} (${phase}) took ${actualDuration.toFixed(2)}ms`);
    }
};

// Helper to determine if a trade was taken in a high-risk / DO NOT TRADE zone
const getZoneWarning = (timeStr?: string) => {
    if (!timeStr) return null;
    try {
        const [h, m] = timeStr.split(':').map(Number);
        const totalMins = h * 60 + m;
        if (totalMins >= 555 && totalMins < 570) return 'Opening Chaos (Do Not Trade)';
        if (totalMins >= 660 && totalMins < 720) return 'Dead Zone (Do Not Trade)';
        if (totalMins >= 900 && totalMins < 930) return 'Closing Casino (Flat)';
    } catch(e) {}
    return null;
};

// Formats Dhan tickers: "SENSEX-240423-80000-CE" → "SENSEX 23 APR 80000 CALL"
const formatTicker = (ticker: string): string => {
    if (!ticker) return '';
    const parts = ticker.split('-');
    
    // Process the type (CE -> CALL, PE -> PUT)
    let type = parts[parts.length - 1] || '';
    if (type === 'CE') type = 'CALL';
    else if (type === 'PE') type = 'PUT';

    if (parts.length >= 4) {
        const expiry = parts[1];
        // Handle YYMMDD format
        if (expiry.length === 6 && !isNaN(Number(expiry))) {
            const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
            const monthIdx = parseInt(expiry.substring(2, 4)) - 1;
            const monthName = months[monthIdx] || expiry.substring(2, 4);
            const day = expiry.substring(4, 6);
            return `${parts[0]} ${day} ${monthName} ${parts[2]} ${type}`;
        }
        // Handle MMMYYYY format (e.g., APR2026) -> "APR"
        if (expiry.length >= 7 && isNaN(Number(expiry.substring(0, 1)))) {
            const monthPart = expiry.substring(0, 3).toUpperCase();
            return `${parts[0]} ${monthPart} ${parts[2]} ${type}`;
        }
    }
    
    // Fallback: replace dashes and clean up CE/PE
    return ticker.split('-').map(p => {
        if (p === 'CE') return 'CALL';
        if (p === 'PE') return 'PUT';
        return p;
    }).join(' ');
};

const calculateDuration = (entry?: string, exit?: string): string | null => {
    if (!entry || !exit || entry === exit) return null;
    const [eH, eM] = entry.split(':').map(Number);
    const [xH, xM] = exit.split(':').map(Number);
    if (isNaN(eH) || isNaN(eM) || isNaN(xH) || isNaN(xM)) return null;
    let diffMinutes = (xH * 60 + xM) - (eH * 60 + eM);
    if (diffMinutes < 0) diffMinutes += 24 * 60;
    if (diffMinutes <= 0) return null;
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h`;
    return `${mins}m`;
};

interface TradeHistoryTableProps {
    trades: Trade[];
    quickLogs?: QuickLog[];
    onTradeClick?: (trade: Trade) => void;
    onDeleteTrade?: (tradeId: number) => void;
    onRefresh?: () => void;
    selectedTradeIds: number[];
    setSelectedTradeIds: React.Dispatch<React.SetStateAction<number[]>>;
}

const TradeRow = React.memo(({ 
    trade, 
    index, 
    isWin, 
    matchingReviewHandoff, 
    onTradeClick, 
    onDeleteTrade, 
    isBulkEditMode, 
    isSelected, 
    toggleSelectTrade 
}: { 
    trade: Trade; 
    index: number; 
    isWin: boolean; 
    matchingReviewHandoff: any; 
    onTradeClick?: (t: Trade) => void; 
    onDeleteTrade?: (id: number) => void;
    isBulkEditMode: boolean;
    isSelected: boolean;
    toggleSelectTrade: (id: number, e: React.MouseEvent) => void;
}) => {
    const [feeTooltipVisible, setFeeTooltipVisible] = useState(false);
    const [feeTooltipPos, setFeeTooltipPos] = useState({ top: 0, left: 0 });
    const feeRef = useRef<HTMLSpanElement>(null);

    const handleFeeMouseEnter = useCallback(() => {
        if (feeRef.current) {
            const rect = feeRef.current.getBoundingClientRect();
            setFeeTooltipPos({ top: rect.bottom + 8, left: rect.left });
            setFeeTooltipVisible(true);
        }
    }, []);

    const handleFeeMouseLeave = useCallback(() => setFeeTooltipVisible(false), []);
    const zoneWarning = getZoneWarning(trade.entryTime);

    return (
        <>
            <tr
                key={`trade-${trade.id}`}
                onClick={(e) => isBulkEditMode ? toggleSelectTrade(trade.id!, e) : onTradeClick?.(trade)}
                className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${isSelected ? 'bg-indigo-50/30 dark:bg-indigo-500/5' : ''}`}
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 60px' } as any}
            >
            {isBulkEditMode && (
                <td className="py-4 px-6" onClick={e => toggleSelectTrade(trade.id!, e)}>
                    <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={() => {}} 
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                </td>
            )}
            <td className="py-4 px-6 whitespace-nowrap">
                <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                        <Calendar size={14} className="text-indigo-500" />
                        {new Date(trade.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </div>
                    {trade.entryTime && (() => {
                        const matchLegs = trade.notes?.match(/Legs:\s*(\d+)/i);
                        const legsCount = trade.legsCount || (matchLegs ? parseInt(matchLegs[1], 10) : undefined);
                        const duration = calculateDuration(trade.entryTime, trade.exitTime);

                        return (
                            <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400 pl-5 flex-wrap">
                                <Clock size={10} className="shrink-0 text-slate-500" />
                                <span className="font-mono text-slate-700 dark:text-slate-300 font-semibold">
                                    {trade.entryTime}
                                    {trade.exitTime && trade.exitTime !== trade.entryTime ? ` → ${trade.exitTime}` : ''}
                                </span>
                                {duration && (
                                    <span className="px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 font-bold text-[9px] border border-indigo-500/20">
                                        {duration}
                                    </span>
                                )}
                                {legsCount && legsCount > 1 && (
                                    <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold text-[9px] border border-slate-200 dark:border-slate-700">
                                        {legsCount} LEGS
                                    </span>
                                )}
                                {zoneWarning && (
                                    <span className="flex items-center gap-1 text-rose-500 font-bold bg-rose-50 dark:bg-rose-500/10 px-1.5 py-0.5 rounded-full" title={zoneWarning}>
                                        <AlertOctagon size={10} /> Zone
                                    </span>
                                )}
                            </div>
                        );
                    })()}
                </div>
            </td>
            <td className="py-4 px-6">
                <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center font-bold text-sm border cursor-default
                        ${trade.isStitchedEntry
                            ? 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
                            : isWin
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                                : 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
                        }`} title={trade.ticker}>
                        {(trade.ticker || 'U').substring(0, 1).toUpperCase()}
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900 dark:text-white uppercase">{formatTicker(trade.ticker)}</span>
                            {((Array.isArray(trade.tags) && (trade.tags.includes('IPO') || trade.tags.includes('ListingGain'))) || (typeof trade.notes === 'string' && trade.notes.includes('IPO'))) && (
                                <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-extrabold rounded bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30">
                                    🚀 IPO
                                </span>
                            )}
                            {(trade.productType === 'CNC' || !trade.productType) && (
                                <span className="flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400">
                                    <Layers size={8} /> CNC
                                </span>
                            )}
                            {(trade.productType === 'MTF') && (
                                <span className="flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400">
                                    <Zap size={8} /> MTF
                                </span>
                            )}
                            {(trade.productType === 'MARGIN') && (
                                <span className="flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400">
                                    <Layers size={8} /> MARGIN
                                </span>
                            )}
                            {(trade.productType === 'INTRADAY' || trade.productType === 'MIS') && (
                                <span className="flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                                    <Zap size={8} /> MIS
                                </span>
                            )}
                            {trade.reviewStatus && trade.reviewStatus !== 'ANNOTATED' && (
                                <span className="flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                                    <BookOpenCheck size={8} />
                                    {trade.reviewStatus === 'NEEDS_ANNOTATION' ? 'Screens' : 'Lesson'}
                                </span>
                            )}
                            {trade.optionsData?.daysToExpiry !== undefined && (
                                <span className="px-1.5 py-0.5 text-[9px] font-black rounded-md bg-violet-500/10 text-violet-400 border border-violet-500/20" title="Days to Expiry">
                                    {trade.optionsData.daysToExpiry}d
                                </span>
                            )}
                        </div>
                        {trade.notes && (
                            <div className="mt-1 flex items-start gap-1 text-[10px] text-slate-500 dark:text-slate-400 italic max-w-[200px] truncate" title={trade.notes}>
                                <StickyNote size={10} className="text-indigo-400 shrink-0 mt-0.5" />
                                <span>{trade.notes}</span>
                            </div>
                        )}
                    </div>
                </div>
            </td>
            <td className="py-4 px-6">
                <div className="flex flex-col gap-1.5">
                    <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-[10px] font-black text-slate-600 dark:text-slate-400 shadow-sm">
                        <Target size={10} className="text-indigo-500" />
                        {trade.setup === 'Dhan Auto-Sync' ? 'DAS' : (trade.setup || 'Discretionary')}
                    </div>
                    {trade.legsCount && trade.legsCount > 0 && (
                        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[8px] font-black text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 w-fit">
                            <span className="opacity-60">{trade.legsCount}</span> LEGS
                        </div>
                    )}
                </div>
            </td>
            <td className="py-4 px-6 text-right font-mono text-sm font-bold text-slate-700 dark:text-slate-300">{trade.quantity}</td>
            <td className="py-4 px-6 text-right font-mono text-[11px]">
                <div className="flex flex-col gap-0.5 items-end">
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <span className="opacity-60 text-[9px]">En:</span>
                        <span className="font-bold">₹{trade.entryPrice}</span>
                        {trade.orderType === 'MARKET' && (
                            <span className="w-3.5 h-3.5 rounded-sm bg-rose-500 flex items-center justify-center text-[8px] font-black text-white shadow-sm" title="Market Order Execution">M</span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <span className="opacity-60 text-[9px]">Ex:</span>
                        <span className="font-bold">₹{trade.exitPrice}</span>
                    </div>
                </div>
            </td>
            <td className="py-4 px-6 text-right font-mono">
                <div className="flex flex-col items-end gap-0.5">
                    <span className={`text-sm font-black font-tabular financial-value ${trade.isStitchedEntry ? 'text-amber-500' : isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {trade.isStitchedEntry ? 'SOLD' : (isWin ? '+' : '') + formatCurrency(trade.pnl || 0)}
                    </span>
                    {(trade.feeBreakdown || trade.fees) && (
                        <>
                            <span
                                ref={feeRef}
                                onMouseEnter={handleFeeMouseEnter}
                                onMouseLeave={handleFeeMouseLeave}
                                className="text-[9px] font-bold text-slate-400 cursor-help flex items-center gap-0.5 select-none"
                            >
                                <Info size={9} className="text-slate-500" />
                                {trade.fees ? `-₹${trade.fees.toFixed(1)}` : ''}
                            </span>

                            {/* Fee Breakdown Tooltip - Dynamic positioning based on row index */}
                            {feeTooltipVisible && (
                                <div
                                    style={{
                                        position: 'fixed',
                                        top: index < 3 ? feeTooltipPos.top : feeRef.current?.getBoundingClientRect().top! - 8,
                                        left: feeTooltipPos.left,
                                        zIndex: 99999,
                                        transform: index < 3 ? 'translateX(-85%)' : 'translateX(-85%) translateY(-100%)'
                                    }}
                                    className="w-52 bg-slate-900/98 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 text-left"
                                >
                                    <div className="flex justify-between items-center mb-3 pb-2 border-b border-white/10">
                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gross P&L</span>
                                        <span className={`text-[11px] font-black font-mono ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {isWin ? '+' : ''}{formatCurrency((trade.pnl || 0) + (trade.fees || 0))}
                                        </span>
                                    </div>
                                    {trade.feeBreakdown ? (
                                        <div className="space-y-1.5">
                                            <div className="flex justify-between text-[10px]"><span className="text-slate-500">Brokerage</span><span className="font-mono text-slate-300 font-bold">₹{trade.feeBreakdown.brokerage?.toFixed(2) ?? '0.00'}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="text-slate-500">STT</span><span className="font-mono text-slate-300 font-bold">₹{trade.feeBreakdown.stt?.toFixed(2) ?? '0.00'}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="text-slate-500">Exch. Charges</span><span className="font-mono text-slate-300 font-bold">₹{trade.feeBreakdown.exchangeTransactionCharges?.toFixed(2) ?? '0.00'}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="text-slate-500">SEBI + Stamp</span><span className="font-mono text-slate-300 font-bold">₹{((trade.feeBreakdown.sebiTax || 0) + (trade.feeBreakdown.stampDuty || 0)).toFixed(2)}</span></div>
                                            <div className="flex justify-between text-[10px]"><span className="text-slate-500">GST</span><span className="font-mono text-slate-300 font-bold">₹{trade.feeBreakdown.serviceTax?.toFixed(2) ?? '0.00'}</span></div>
                                        </div>
                                    ) : (
                                        <p className="text-[10px] text-slate-500 italic">Synced fees — no breakdown</p>
                                    )}
                                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-white/10">
                                        <span className="text-[10px] font-black text-slate-400 uppercase">Total Fees</span>
                                        <span className="text-[11px] font-black font-mono text-rose-400">-₹{(trade.fees || 0).toFixed(2)}</span>
                                    </div>
                                    
                                    {/* Arrow pointing up (for top rows) or down (for bottom rows) */}
                                    {index < 3 ? (
                                        <div className="absolute -top-1.5 right-6 w-3 h-3 bg-slate-900 border-l border-t border-white/10 rotate-45" />
                                    ) : (
                                        <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-slate-900 border-r border-b border-white/10 rotate-45" />
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </td>
            <td className="py-4 px-6 text-center">
                <div className="flex flex-col items-center gap-1">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] uppercase font-black text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 flex items-center gap-1">
                        <Brain size={10} className="text-indigo-400" /> {trade.moodEntry}
                    </span>
                </div>
            </td>

            {onDeleteTrade && (
                <td className="py-4 px-3 text-center" onClick={e => e.stopPropagation()}>
                    <button
                        onClick={() => onDeleteTrade(trade.id!)}
                        aria-label={`Delete trade ${trade.ticker || 'unknown'}`}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
                    >
                        <Trash2 size={14} aria-hidden="true" />
                    </button>
                </td>
            )}
        </tr>
    </>
    );
});

const TradeHistoryTable: React.FC<TradeHistoryTableProps> = ({ 
    trades, 
    quickLogs = [], 
    onTradeClick, 
    onDeleteTrade, 
    onRefresh,
    selectedTradeIds,
    setSelectedTradeIds
}) => {
    const { toast } = useToast();
    const [reviewHandoffs, setReviewHandoffs] = useState(() => getActiveJournalReviewHandoffs());
    const [strategies, setStrategies] = useState<Strategy[]>([]);
    const [isUpdating, setIsUpdating] = useState(false);
    const [isBulkEditMode, setIsBulkEditMode] = useState(false);
    const [lastSelectedId, setLastSelectedId] = useState<number | null>(null);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(50);

    // Reset pagination when data changes
    useEffect(() => {
        setCurrentPage(1);
    }, [trades.length, quickLogs.length]);

    useEffect(() => {
        const refreshReviewHandoffs = () => setReviewHandoffs(getActiveJournalReviewHandoffs());
        window.addEventListener(JOURNAL_REVIEW_HANDOFF_EVENT, refreshReviewHandoffs);
        window.addEventListener('storage', refreshReviewHandoffs);
        db.strategies.toArray().then(setStrategies);
        return () => {
            window.removeEventListener(JOURNAL_REVIEW_HANDOFF_EVENT, refreshReviewHandoffs);
            window.removeEventListener('storage', refreshReviewHandoffs);
        };
    }, []);

    const toggleSelectAll = () => {
        if (selectedTradeIds.length === trades.length) {
            setSelectedTradeIds([]);
        } else {
            setSelectedTradeIds(trades.map(t => t.id!).filter(id => id !== undefined));
        }
    };

    const toggleSelectTrade = (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        
        const currentIds = trades.map(t => t.id!).filter(id => id !== undefined) as number[];
        
        if (e.shiftKey && lastSelectedId !== null && isBulkEditMode) {
            const startIdx = currentIds.indexOf(lastSelectedId);
            const endIdx = currentIds.indexOf(id);
            
            if (startIdx !== -1 && endIdx !== -1) {
                const start = Math.min(startIdx, endIdx);
                const end = Math.max(startIdx, endIdx);
                const rangeIds = currentIds.slice(start, end + 1);
                
                setSelectedTradeIds(prev => {
                    // Standard robust behavior:
                    // 1. Keep IDs that are NOT in the current visible list (they might be from other dates/filters)
                    const others = prev.filter(pid => !currentIds.includes(pid));
                    const newSet = new Set(others);
                    // 2. Add the entire range from anchor to current
                    rangeIds.forEach(rid => newSet.add(rid));
                    return Array.from(newSet);
                });
                // We DON'T update lastSelectedId here. The anchor stays fixed.
                return;
            }
        }

        setSelectedTradeIds(prev => {
            const isSelected = prev.includes(id);
            // On a normal click, this item becomes the new anchor
            setLastSelectedId(id);
            if (isSelected) {
                return prev.filter(i => i !== id);
            } else {
                return [...prev, id];
            }
        });
    };

    const handleBulkUpdate = async (updates: Partial<Trade>) => {
        if (selectedTradeIds.length === 0) return;
        setIsUpdating(true);
        try {
            await db.transaction('rw', db.trades, async () => {
                for (const id of selectedTradeIds) {
                    await db.trades.update(id, updates);
                }
            });
            toast.success(`Updated ${selectedTradeIds.length} trades successfully`);
            setSelectedTradeIds([]);
            onRefresh?.();
        } catch (error) {
            console.error('Bulk update failed', error);
            toast.error('Failed to update trades');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleStitchDelivery = async () => {
        if (selectedTradeIds.length !== 2) return;
        setIsUpdating(true);
        try {
            const selectedTrades = await db.trades.where('id').anyOf(selectedTradeIds).toArray();
            if (selectedTrades.length !== 2) return;

            // Sort by date/time to find Entry and Exit
            const sorted = [...selectedTrades].sort((a, b) => {
                const dateA = new Date(`${a.date}T${a.entryTime || '00:00'}`).getTime();
                const dateB = new Date(`${b.date}T${b.entryTime || '00:00'}`).getTime();
                return dateA - dateB;
            });

            const entryTrade = sorted[0];
            const exitTrade = sorted[1];

            // 1. Update Entry Trade: Neutralize it but keep as record
            await db.trades.update(entryTrade.id!, {
                pnl: 0,
                exitPrice: entryTrade.entryPrice,
                isStitchedEntry: true,
                isStitchedExit: false,
                productType: entryTrade.productType || 'CNC',
                notes: (entryTrade.notes || '') + '\n[Stitched: Entry Leg of Delivery Trade]'
            });

            // 2. Update Exit Trade: Pull Entry Price and Flip Direction
            const finalEntryPrice = entryTrade.entryPrice;
            const finalExitPrice = exitTrade.exitPrice || exitTrade.entryPrice;
            const qty = exitTrade.quantity;
            const fees = (entryTrade.fees || 0) + (exitTrade.fees || 0);
            
            // Realized P&L Math
            const grossPnl = (finalExitPrice - finalEntryPrice) * qty;
            const netPnl = grossPnl - fees;

            await db.trades.update(exitTrade.id!, {
                entryPrice: finalEntryPrice,
                exitPrice: finalExitPrice,
                direction: 'Long',
                pnl: Number(netPnl.toFixed(2)),
                fees: Number(fees.toFixed(2)),
                productType: exitTrade.productType || 'CNC',
                isStitchedExit: true,
                isStitchedEntry: false,
                notes: (exitTrade.notes || '') + '\n[Stitched: Realized P&L from Delivery Exit]'
            });

            toast.success('Trades stitched successfully!');
            setSelectedTradeIds([]);
            onRefresh?.();
        } catch (error) {
            console.error('Stitching failed', error);
            toast.error('Failed to stitch trades');
        } finally {
            setIsUpdating(false);
        }
    };

    const combinedTimeline = useMemo(() => {
        const tMap = trades.map(tr => ({ type: 'TRADE' as const, date: tr.date, data: tr }));
        const lMap = quickLogs.map(ql => ({ type: 'LOG' as const, date: ql.timestamp, data: ql }));
        return [...tMap, ...lMap].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [trades, quickLogs]);

    const totalItems = combinedTimeline.length;
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const paginatedTimeline = useMemo(() => {
        const start = (currentPage - 1) * rowsPerPage;
        return combinedTimeline.slice(start, start + rowsPerPage);
    }, [combinedTimeline, currentPage, rowsPerPage]);

    const containerRef = useRef<HTMLDivElement>(null);

    // Reset scroll of the container when page changes
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
        }
    }, [currentPage]);

    const TableHeader = useMemo(() => (
        <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-20">
            <tr>
                {isBulkEditMode && (
                    <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider w-8">
                        <input 
                            type="checkbox" 
                            checked={trades.length > 0 && selectedTradeIds.length === trades.length}
                            onChange={toggleSelectAll}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                    </th>
                )}
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">Date &amp; Time</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">Symbol</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider">Setup</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Qty</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Price</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">P&amp;L</th>
                <th className="py-4 px-6 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Psych</th>
                {onDeleteTrade && <th className="py-4 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center w-12"></th>}
            </tr>
        </thead>
    ), [isBulkEditMode, trades.length, selectedTradeIds.length, toggleSelectAll, onDeleteTrade]);

    if (trades.length === 0 && quickLogs.length === 0) {
        return (
            <StateSurface
                tone="neutral"
                icon={BookOpenCheck as any}
                title="Blank Journal"
                description={COPY.empty.noTrades}
                className="border-dashed bg-white py-10 dark:bg-slate-900"
            />
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm relative z-0">
            {/* Header with Toggle */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Layers size={16} className="text-indigo-500" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">Timeline</h3>
                </div>
                <button 
                    onClick={() => {
                        setIsBulkEditMode(!isBulkEditMode);
                        if (isBulkEditMode) setSelectedTradeIds([]);
                    }}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        isBulkEditMode 
                        ? 'bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
                        : 'bg-indigo-50 text-indigo-600 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20'
                    }`}
                >
                    {isBulkEditMode ? <X size={14} /> : <Edit2 size={14} />}
                    {isBulkEditMode ? 'Cancel Bulk' : 'Bulk Edit'}
                </button>
            </div>


            {/* Bulk Action Tray Integration */}
            <AnimatePresence>
                {isBulkEditMode && selectedTradeIds.length > 0 && (
                    <BulkActionTray
                        selectedCount={selectedTradeIds.length}
                        isUpdating={isUpdating}
                        strategies={strategies}
                        onBulkUpdate={handleBulkUpdate}
                        onStitchDelivery={handleStitchDelivery}
                        onCancel={() => {
                            setIsBulkEditMode(false);
                            setSelectedTradeIds([]);
                            setLastSelectedId(null);
                        }}
                    />
                )}
            </AnimatePresence>


            <Profiler id="TradeHistoryTable" onRender={onRenderCallback}>
                <div ref={containerRef} className="table-scroll rounded-2xl">
                    <table className="w-full text-left border-separate border-spacing-0">
                        {TableHeader}
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {paginatedTimeline.map((item, index) => {
                                if (item.type === 'LOG') {
                                    const log = item.data as QuickLog;
                                    return (
                                        <tr key={`log-${log.id || index}`} className="bg-indigo-50/50 dark:bg-indigo-900/10 border-l-2 border-l-indigo-500">
                                            {isBulkEditMode && <td className="py-3 px-6"></td>}
                                            <td colSpan={onDeleteTrade ? 8 : 7} className="py-3 px-6">
                                                <div className="flex items-center gap-3">
                                                    <MessageSquare size={14} className="text-indigo-500" />
                                                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    <p className="text-sm text-slate-800 dark:text-slate-200 font-medium">{log.note}</p>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }

                                const trade = item.data as Trade;
                                const isWin = (trade.pnl || 0) >= 0;
                                const matchingReviewHandoff = reviewHandoffs.find((handoff) =>
                                    handoff.ticker === trade.ticker?.toUpperCase() &&
                                    (!handoff.reviewStatus || handoff.reviewStatus === trade.reviewStatus)
                                );
                                
                                return (
                                    <TradeRow 
                                        key={`trade-${trade.id}`}
                                        trade={trade}
                                        index={index}
                                        isWin={isWin}
                                        matchingReviewHandoff={matchingReviewHandoff}
                                        onTradeClick={onTradeClick}
                                        onDeleteTrade={onDeleteTrade}
                                        isBulkEditMode={isBulkEditMode}
                                        isSelected={selectedTradeIds.includes(trade.id!)}
                                        toggleSelectTrade={toggleSelectTrade}
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Profiler>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/50 rounded-b-2xl">
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-slate-500 font-medium">
                            Showing <span className="text-slate-900 dark:text-white font-bold">{(currentPage - 1) * rowsPerPage + 1}</span> to <span className="text-slate-900 dark:text-white font-bold">{Math.min(currentPage * rowsPerPage, totalItems)}</span> of <span className="text-slate-900 dark:text-white font-bold">{totalItems}</span>
                        </span>
                        <select 
                            value={rowsPerPage}
                            onChange={(e) => setRowsPerPage(Number(e.target.value))}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-600 outline-none focus:border-indigo-500"
                        >
                            <option value={25}>25 per page</option>
                            <option value={50}>50 per page</option>
                            <option value={100}>100 per page</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(prev => prev - 1)}
                            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-30 hover:border-indigo-500 transition-all"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <div className="flex gap-1">
                            {/* Simple page numbers */}
                            {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                                let pageNum = i + 1;
                                // Sliding window logic for page numbers
                                if (totalPages > 5 && currentPage > 3) {
                                    pageNum = currentPage - 3 + i + 1;
                                    if (pageNum > totalPages) pageNum = totalPages - (4 - i);
                                }
                                
                                return (
                                    <button
                                        key={pageNum}
                                        onClick={() => setCurrentPage(pageNum)}
                                        className={`w-8 h-8 rounded-xl text-xs font-black transition-all ${
                                            currentPage === pageNum
                                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20'
                                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-500'
                                        }`}
                                    >
                                        {pageNum}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(prev => prev + 1)}
                            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 disabled:opacity-30 hover:border-indigo-500 transition-all"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TradeHistoryTable;
