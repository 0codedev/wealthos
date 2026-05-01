import React, { useState, useEffect, useMemo } from 'react';
import { db, Trade, calculatePnL } from '../../database';
import {
    ClipboardList, Plus, Filter, Search, TrendingUp, TrendingDown,
    Calendar, Clock, Tag, MoreVertical, Eye, Trash2, Edit2,
    Info, Layers, Zap, StickyNote
} from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';

import { useTradingJournalStore } from '../../store/tradingJournalStore';
import { EmptyState } from '../shared/EmptyState';
import { deleteWithUndo } from '../../lib/deleteWithUndo';
import { COPY } from '../../utils/appCopy';
import { useToast } from '../shared/ToastProvider';

interface TradeJournalProps {
    onAddTrade?: () => void;
    onEditTrade?: (trade: Trade) => void;
}

export const TradeJournal: React.FC<TradeJournalProps> = ({ onAddTrade, onEditTrade }) => {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const { toast } = useToast();

    // Use Store for persisted preferences
    const {
        filterType, setFilterType,
        sortBy, setSortBy
    } = useTradingJournalStore();

    useEffect(() => {
        const loadTrades = async () => {
            const allTrades: Trade[] = await (db.trades as any).active().toArray();
            const sorted = allTrades.sort((a: Trade, b: Trade) => (b.date || '').localeCompare(a.date || ''));
            setTrades(sorted);
        };
        loadTrades();
    }, []);
    const stats = useMemo(() => {
        const wins = trades.filter(t => calculatePnL(t) > 0);
        const losses = trades.filter(t => calculatePnL(t) < 0);
        const totalPnL = trades.reduce((acc, t) => acc + calculatePnL(t), 0);
        const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

        // Profitable Days logic
        const dailyPnL: Record<string, number> = {};
        trades.forEach(t => {
            const pnl = calculatePnL(t);
            dailyPnL[t.date] = (dailyPnL[t.date] || 0) + pnl;
        });
        const dayEntries = Object.entries(dailyPnL);
        const profitableDays = dayEntries.filter(([_, pnl]) => pnl > 0).length;
        const totalDays = dayEntries.length;

        return {
            total: trades.length,
            wins: wins.length,
            losses: losses.length,
            totalPnL,
            winRate,
            profitableDays,
            totalDays
        };
    }, [trades]);

    const killZones = useMemo(() => {
        const zones = {
            'Morning': { pnL: 0, wins: 0, total: 0 },
            'Mid-Day': { pnL: 0, wins: 0, total: 0 },
            'Afternoon': { pnL: 0, wins: 0, total: 0 },
        };

        trades.forEach(t => {
            if (!t.entryTime) return;
            // Parse HH:mm
            const parts = t.entryTime.split(':');
            if (parts.length < 2) return;
            const hours = parseInt(parts[0], 10);
            const mins = parseInt(parts[1], 10);
            const timeVal = hours + mins / 60;

            let zone: keyof typeof zones = 'Afternoon';
            if (timeVal >= 9 && timeVal < 11.5) zone = 'Morning'; // 9:00 AM - 11:30 AM
            else if (timeVal >= 11.5 && timeVal < 14) zone = 'Mid-Day'; // 11:30 AM - 2:00 PM

            const currentPnl = calculatePnL(t);
            zones[zone].pnL += currentPnl;
            zones[zone].total += 1;
            if (currentPnl > 0) zones[zone].wins += 1;
        });

        return [
            { label: '🌅 Morning Kill Zone (9:00 - 11:30)', ...zones['Morning'] },
            { label: '☀️ Mid-Day Chop (11:30 - 14:00)', ...zones['Mid-Day'] },
            { label: '🌇 Afternoon Push (14:00 - 15:30)', ...zones['Afternoon'] },
        ];
    }, [trades]);

    const filteredTrades = useMemo(() => {
        return trades
            .filter(t => {
                if (filterType === 'WIN') return calculatePnL(t) > 0;
                if (filterType === 'LOSS') return calculatePnL(t) < 0;
                return true;
            })
            .filter(t =>
                t.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.setup?.toLowerCase().includes(searchTerm.toLowerCase())
            )
            .sort((a, b) => {
                if (sortBy === 'pnl') return calculatePnL(b) - calculatePnL(a);
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });
    }, [trades, filterType, searchTerm, sortBy]);

    const handleDelete = async (id: number) => {
        const trade = trades.find(t => t.id === id);
        const label = trade?.ticker ?? 'Trade';
        const entryId = await deleteWithUndo({
            table: 'trades',
            id,
            kind: 'trade',
            label,
            message: COPY.undo.tradeDeleted(label),
        });
        if (!entryId) {
            toast.error(COPY.undo.failed);
            return;
        }
        setTrades(prev => prev.filter(t => t.id !== id));
        toast.undo(COPY.undo.tradeDeleted(label), {
            duration: 30000,
            action: { label: 'Undo', onClick: () => { void import('../../lib/undoStack').then(m => m.consumeUndo(entryId)?.undo()); } }
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl">
                            <ClipboardList size={24} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Trade Journal</h2>
                            <p className="text-sm text-slate-500">Log and analyze your trades</p>
                        </div>
                    </div>
                    <button
                        onClick={onAddTrade}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium flex items-center gap-2 hover:bg-indigo-700 transition-colors"
                    >
                        <Plus size={18} /> Log Trade
                    </button>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center">
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.total || 0}</p>
                        <p className="text-xs text-slate-500">Total Trades</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center">
                        <p className={`text-2xl font-bold ${stats.totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {stats.totalPnL >= 0 ? '+' : ''}{formatCurrency(stats.totalPnL)}
                        </p>
                        <p className="text-xs text-slate-500">Total P&L</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center">
                        <p className={`text-2xl font-bold ${stats.winRate >= 50 ? 'text-emerald-500' : 'text-amber-500'}`}>
                            {stats.winRate ? stats.winRate.toFixed(0) : '0'}%
                        </p>
                        <p className="text-xs text-slate-500">Win Rate</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center border-l-2 border-indigo-500/10">
                        <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                            {stats.profitableDays}<span className="text-sm text-slate-400 font-medium">/{stats.totalDays}</span>
                        </p>
                        <p className="text-xs text-slate-500">Profitable Days</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-center">
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">{stats.wins || 0}</p>
                        <p className="text-xs text-slate-500">Winning Trades</p>
                    </div>
                </div>

                {/* Kill Zones (Time of Day Heatmap) */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                    {killZones.map(zone => (
                        <div key={zone.label} className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col items-center">
                            <p className="text-xs text-slate-500 font-medium mb-1">{zone.label}</p>
                            <p className={`text-lg font-bold ${zone.total === 0 ? 'text-slate-400' : zone.pnL > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {zone.total === 0 ? '₹0.00' : `${zone.pnL >= 0 ? '+' : ''}${formatCurrency(zone.pnL)}`}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-[10px]">
                                <span className="text-slate-400">{zone.total || 0} Trades</span>
                                <span className="text-slate-300">•</span>
                                <span className={zone.total > 0 && zone.wins / zone.total >= 0.5 ? 'text-emerald-500 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'}>
                                    {zone.total > 0 ? (Math.round((zone.wins / zone.total) * 100) || 0) : 0}% Win Rate
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by symbol or strategy..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                    />
                </div>
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                    {(['ALL', 'WIN', 'LOSS'] as const).map(type => (
                        <button
                            key={type}
                            onClick={() => setFilterType(type)}
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === type
                                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            {type}
                        </button>
                    ))}
                </div>
            </div>

            {/* Trades List */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-visible relative z-0">
                {filteredTrades.length === 0 ? (
                    <EmptyState
                        variant="default"
                        type="no-trades"
                        actionLabel={onAddTrade ? "Add Trade" : undefined}
                        onAction={onAddTrade}
                        icon={ClipboardList}
                    />
                ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredTrades.map((trade, index) => {
                            const pnl = calculatePnL(trade);
                            const isWin = pnl > 0;

                            return (
                                <div
                                    key={trade.id}
                                    className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg border cursor-default
                                                ${isWin
                                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                                                    : 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
                                                }`} title={trade.ticker}>
                                                {trade.ticker.substring(0, 1).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-bold text-slate-900 dark:text-white">
                                                        {trade.ticker}
                                                    </span>

                                                    {/* Goal 3: Options Decoder */}
                                                    {trade.optionsData && (
                                                        <>
                                                            <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${trade.optionsData.optionType === 'CE'
                                                                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30'
                                                                    : 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30'
                                                                }`}>
                                                                {trade.optionsData.optionType}
                                                            </span>
                                                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-500/10 dark:border-purple-500/30">
                                                                🎯 {trade.optionsData.strikePrice || 0}
                                                            </span>
                                                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 font-mono tracking-tight">
                                                                ⏳ {trade.optionsData.daysToExpiry || 0}DTE
                                                            </span>
                                                        </>
                                                    )}

                                                    {/* Default direction & setup tags */}
                                                    <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${trade.direction === 'Long'
                                                        ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
                                                        : 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400'
                                                        }`}>
                                                        {trade.direction}
                                                    </span>
                                                    {trade.setup && (
                                                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                                                            {trade.setup === 'Dhan Auto-Sync' ? 'DAS' : trade.setup}
                                                        </span>
                                                    )}

                                                    {/* Goal 4: Leverage/Product Tags */}
                                                    {(trade.productType === 'MARGIN' || trade.productType === 'MTF') && (
                                                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400" title="Margin Trade Funding (Leveraged Delivery)">
                                                            <Zap size={10} /> MTF
                                                        </span>
                                                    )}
                                                    {(trade.productType === 'INTRADAY' || trade.productType === 'MIS' || trade.productType === 'MARGIN' && trade.brokerProfile === 'Intraday Equity') && (
                                                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400" title="Intraday 5x Leverage">
                                                            <Zap size={10} /> MIS
                                                        </span>
                                                    )}

                                                    {/* Goal 7: Complexity Score */}
                                                    {trade.legsCount && trade.legsCount > 1 && (
                                                        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700" title={`${trade.legsCount} Orders grouped. Scaled in/out.`}>
                                                            <Layers size={10} /> {trade.legsCount || 0} Legs
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-slate-500 flex items-center gap-2 mt-1">
                                                    <Calendar size={12} /> {new Date(trade.date).toLocaleDateString()}
                                                    <Clock size={12} className="ml-2" /> {trade.quantity || 0} shares
                                                </p>
                                                {trade.notes && (
                                                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/60 max-w-2xl text-left">
                                                        <div className="flex gap-1.5 items-start">
                                                            <StickyNote size={12} className="text-indigo-400 shrink-0 mt-0.5" />
                                                            <p className="whitespace-pre-line italic leading-relaxed">{trade.notes}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right flex flex-col items-end">
                                                {/* Goal 1: Fee Breakdown Tooltip */}
                                                <div className="relative group/fees flex items-center justify-end gap-1.5">
                                                    <p className={`font-bold ${isWin ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                        {isWin ? '+' : ''}{formatCurrency(pnl)}
                                                    </p>
                                                    {trade.feeBreakdown && (
                                                        <div className="cursor-help cursor-pointer relative z-40">
                                                            <Info size={14} className="text-slate-400 hover:text-indigo-500 transition-colors" />
                                                            {/* Tooltip Content */}
                                                            <div className={`absolute right-0 ${index < 2 ? 'top-full mt-2 origin-top-right' : 'bottom-full mb-2 origin-bottom-right'} w-52 p-3 bg-slate-900 text-white text-xs rounded-xl opacity-0 scale-95 group-hover/fees:opacity-100 group-hover/fees:scale-100 pointer-events-none transition-all duration-200 shadow-2xl border border-slate-700 z-[100]`}>
                                                                <p className="font-bold text-slate-200 mb-2 border-b border-slate-700 pb-1.5 flex justify-between">
                                                                    <span>Gross P&L</span>
                                                                    <span className={pnl + (trade.fees || 0) > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                                                        {formatCurrency(pnl + (trade.fees || 0))}
                                                                    </span>
                                                                </p>
                                                                <div className="space-y-1 mt-2">
                                                                    <div className="flex justify-between"><span className="text-slate-400">Brokerage</span><span>₹{trade.feeBreakdown.brokerage.toFixed(2)}</span></div>
                                                                    <div className="flex justify-between"><span className="text-slate-400">STT</span><span>₹{trade.feeBreakdown.stt.toFixed(2)}</span></div>
                                                                    <div className="flex justify-between"><span className="text-slate-400">Exch. Charges</span><span>₹{trade.feeBreakdown.exchangeTransactionCharges.toFixed(2)}</span></div>
                                                                    <div className="flex justify-between"><span className="text-slate-400">SEBI + Stamp</span><span>₹{(trade.feeBreakdown.sebiTax + trade.feeBreakdown.stampDuty).toFixed(2)}</span></div>
                                                                    <div className="flex justify-between"><span className="text-slate-400">GST</span><span>₹{trade.feeBreakdown.serviceTax.toFixed(2)}</span></div>
                                                                </div>
                                                                <div className="flex justify-between mt-2 pt-1.5 border-t border-slate-700 font-bold items-center">
                                                                    <span className="text-slate-300">Total Charges</span>
                                                                    <span className="text-amber-400">-₹{(trade.fees || 0).toFixed(2)}</span>
                                                                </div>
                                                                {/* Arrow */}
                                                                <div className={`absolute ${index < 2 ? '-top-1.5 border-l border-t' : '-bottom-1.5 border-r border-b'} right-1 w-3 h-3 bg-slate-900 border-slate-700 rotate-45`}></div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Goal 2: Execution Tags */}
                                                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 justify-end">
                                                    Entry: {formatCurrency(trade.entryPrice)}
                                                    {trade.orderType === 'MARKET' ? (
                                                        <span className="px-1 py-[1px] rounded text-[9px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400 border border-rose-200 dark:border-rose-500/30" title="Market Order (Urgency/Slippage)">M</span>
                                                    ) : trade.orderType === 'LIMIT' ? (
                                                        <span className="px-1 py-[1px] rounded text-[9px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30" title="Limit Order (Precision)">L</span>
                                                    ) : null}
                                                </p>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => onEditTrade?.(trade)}
                                                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                                                >
                                                    <Edit2 size={14} className="text-slate-400" />
                                                </button>
                                                <button
                                                    onClick={() => trade.id && handleDelete(trade.id)}
                                                    className="p-2 hover:bg-rose-100 dark:hover:bg-rose-500/20 rounded-lg"
                                                >
                                                    <Trash2 size={14} className="text-rose-500" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TradeJournal;
