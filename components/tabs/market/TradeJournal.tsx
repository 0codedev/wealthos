
import React, { useState, useMemo } from 'react';
import { liveQuery } from 'dexie';
import { db, PaperTrade } from '../../../database';
import {
    ClipboardList, Plus, TrendingUp, TrendingDown,
    XCircle, CheckCircle2, History, PlayCircle,
    Trash2, AlertCircle
} from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';

export const TradeJournal: React.FC = () => {
    // State
    const [activeTab, setActiveTab] = useState<'OPEN' | 'HISTORY'>('OPEN');
    const [isOrderFormOpen, setIsOrderFormOpen] = useState(false);

    // Order Form State
    const [ticker, setTicker] = useState('');
    const [type, setType] = useState<'BUY' | 'SELL'>('BUY');
    const [price, setPrice] = useState<number | ''>('');
    const [qty, setQty] = useState<number | ''>('');
    const [notes, setNotes] = useState('');

    // Fetch Data (Manual Subscription to fix crash)
    const [openPositions, setOpenPositions] = useState<PaperTrade[]>([]);
    const [closedPositions, setClosedPositions] = useState<PaperTrade[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    React.useEffect(() => {
        const subOpen = liveQuery(() => db.paper_trades.where('status').equals('OPEN').toArray())
            .subscribe({
                next: (data) => { setOpenPositions(data); setIsLoading(false); },
                error: (err) => { console.error('Open positions query error:', err); setIsLoading(false); }
            });

        const subClosed = liveQuery(() => db.paper_trades.where('status').equals('CLOSED').reverse().toArray())
            .subscribe({
                next: (data) => { setClosedPositions(data); },
                error: (err) => { console.error('Closed positions query error:', err); }
            });

        return () => {
            subOpen.unsubscribe();
            subClosed.unsubscribe();
        };
    }, []);

    // Stats
    const stats = useMemo(() => {
        const realizedPnL = closedPositions.reduce((sum, t) => sum + (t.pnl || 0), 0);
        const winRate = closedPositions.length > 0
            ? (closedPositions.filter(t => (t.pnl || 0) > 0).length / closedPositions.length) * 100
            : 0;
        return { realizedPnL, winRate, totalTrades: closedPositions.length };
    }, [closedPositions]);

    // Handlers
    const handlePlaceOrder = async () => {
        if (!ticker || !price || !qty) return;

        try {
            await db.paper_trades.add({
                ticker: ticker.toUpperCase(),
                type,
                entryPrice: Number(price),
                quantity: Number(qty),
                openDate: new Date().toISOString(),
                status: 'OPEN',
                notes
            });
            setIsOrderFormOpen(false);
            resetForm();
        } catch (error) {
            console.error("Failed to place paper trade", error);
        }
    };

    const handleClosePosition = async (trade: PaperTrade) => {
        const exitPrice = prompt(`Enter exit price for ${trade.ticker} (${trade.type}):`);
        if (!exitPrice) return;

        const exit = Number(exitPrice);
        if (isNaN(exit)) return;

        const pnl = trade.type === 'BUY'
            ? (exit - trade.entryPrice) * trade.quantity
            : (trade.entryPrice - exit) * trade.quantity;

        try {
            await db.paper_trades.update(trade.id!, {
                status: 'CLOSED',
                closePrice: exit,
                closeDate: new Date().toISOString(),
                pnl
            });
        } catch (error) {
            console.error("Failed to close position", error);
        }
    };

    const handleDeleteLog = async (id: number) => {
        if (confirm('Delete this trade record?')) {
            await db.paper_trades.delete(id);
        }
    };

    const resetForm = () => {
        setTicker('');
        setPrice('');
        setQty('');
        setNotes('');
        setType('BUY');
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header Plate */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                            <ClipboardList className="text-indigo-400" size={28} />
                            Trade Journal
                        </h2>
                        <p className="text-slate-400 mt-1">
                            Manually log your trades to track performance stats.
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="bg-slate-800/50 px-4 py-2 rounded-xl border border-slate-700">
                            <p className="text-xs text-slate-400 font-bold uppercase">Realized P&L</p>
                            <p className={`text-xl font-bold ${stats.realizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatCurrency(stats.realizedPnL)}
                            </p>
                        </div>
                        <button
                            onClick={() => setIsOrderFormOpen(true)}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-all active:scale-95"
                        >
                            <Plus size={18} /> Log Trade
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left: Trade List */}
                <div className="lg:col-span-2 space-y-4">

                    {/* Tabs */}
                    <div className="flex gap-2 bg-white dark:bg-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 w-fit">
                        <button
                            onClick={() => setActiveTab('OPEN')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'OPEN' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <PlayCircle size={14} className={activeTab === 'OPEN' ? 'text-blue-500' : ''} /> Open Positions
                            <span className="bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-md text-[10px]">{openPositions.length}</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('HISTORY')}
                            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'HISTORY' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <History size={14} className={activeTab === 'HISTORY' ? 'text-purple-500' : ''} /> Trade History
                        </button>
                    </div>

                    {/* Table Area */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm min-h-[320px] md:min-h-[400px]">
                        {activeTab === 'OPEN' && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 uppercase">
                                            <th className="p-4 font-bold">Ticker</th>
                                            <th className="p-4 font-bold">Side</th>
                                            <th className="p-4 font-bold">Entry</th>
                                            <th className="p-4 font-bold">Qty</th>
                                            <th className="p-4 font-bold">Value</th>
                                            <th className="p-4 font-bold text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {isLoading ? (
                                            [0, 1, 2].map((i) => (
                                                <tr key={`open-skel-${i}`}>
                                                    <td colSpan={6} className="p-4">
                                                        <div className="skeleton h-5 w-full" />
                                                    </td>
                                                </tr>
                                            ))
                                        ) : openPositions.length === 0 ? (
                                            <tr>
                                                <td colSpan={6}>
                                                    <div className="p-10 text-center">
                                                        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto mb-3 flex items-center justify-center">
                                                            <PlayCircle size={22} />
                                                        </div>
                                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No open positions</p>
                                                        <p className="text-xs text-slate-400 mt-1">Use the manual entry on the right to start a simulated trade.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            openPositions.map(trade => (
                                                <tr key={trade.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                    <td className="p-4 font-bold text-slate-900 dark:text-white">{trade.ticker}</td>
                                                    <td className="p-4">
                                                        <span className={`text-[10px] font-bold px-2 py-1 rounded ${trade.type === 'BUY' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'}`}>
                                                            {trade.type}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-sm font-mono text-slate-600 dark:text-slate-400">{formatCurrency(trade.entryPrice)}</td>
                                                    <td className="p-4 text-sm text-slate-600 dark:text-slate-400">{trade.quantity}</td>
                                                    <td className="p-4 text-sm font-mono font-bold text-slate-900 dark:text-white">{formatCurrency(trade.entryPrice * trade.quantity)}</td>
                                                    <td className="p-4 text-right">
                                                        <button
                                                            onClick={() => handleClosePosition(trade)}
                                                            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-800 transition-colors"
                                                        >
                                                            Close
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === 'HISTORY' && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 uppercase">
                                            <th className="p-4 font-bold">Ticker</th>
                                            <th className="p-4 font-bold text-center">Type</th>
                                            <th className="p-4 font-bold">P&L</th>
                                            <th className="p-4 font-bold">ROI</th>
                                            <th className="p-4 font-bold">Date</th>
                                            <th className="p-4 font-bold text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {isLoading ? (
                                            [0, 1, 2].map((i) => (
                                                <tr key={`closed-skel-${i}`}>
                                                    <td colSpan={6} className="p-4">
                                                        <div className="skeleton h-5 w-full" />
                                                    </td>
                                                </tr>
                                            ))
                                        ) : closedPositions.length === 0 ? (
                                            <tr>
                                                <td colSpan={6}>
                                                    <div className="p-10 text-center">
                                                        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto mb-3 flex items-center justify-center">
                                                            <History size={22} />
                                                        </div>
                                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No history yet</p>
                                                        <p className="text-xs text-slate-400 mt-1">Closed positions will appear here with their P&L.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            closedPositions.map(trade => {
                                                const invested = trade.entryPrice * trade.quantity;
                                                const pnl = trade.pnl || 0;
                                                const roi = invested ? ((pnl / invested) * 100).toFixed(2) : '0';

                                                return (
                                                    <tr key={trade.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                                        <td className="p-4 font-bold text-slate-900 dark:text-white">{trade.ticker}</td>
                                                        <td className="p-4 text-center">
                                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${trade.type === 'BUY' ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'text-rose-500 bg-rose-50 dark:bg-rose-900/20'}`}>
                                                                {trade.type}
                                                            </span>
                                                        </td>
                                                        <td className={`p-4 font-mono font-bold ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                            {pnl >= 0 ? '+' : ''}{formatCurrency(pnl)}
                                                        </td>
                                                        <td className={`p-4 text-xs font-bold ${Number(roi) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                            {roi}%
                                                        </td>
                                                        <td className="p-4 text-xs text-slate-500">
                                                            {trade.closeDate ? new Date(trade.closeDate).toLocaleDateString() : '-'}
                                                        </td>
                                                        <td className="p-4 text-right">
                                                            <button
                                                                onClick={() => handleDeleteLog(trade.id!)}
                                                                className="text-slate-400 hover:text-rose-500 transition-colors p-1"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Order Form & Insights */}
                <div className="space-y-6">
                    {/* Order Form */}
                    <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm ${isOrderFormOpen ? 'ring-2 ring-indigo-500' : ''}`}>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Manual Entry</h3>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ticker</label>
                                <input
                                    type="text"
                                    value={ticker}
                                    onChange={(e) => setTicker(e.target.value)}
                                    placeholder="e.g. RELIANCE"
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-bold uppercase outline-none focus:border-indigo-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setType('BUY')}
                                    className={`p-2 rounded-lg text-sm font-bold border ${type === 'BUY' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 border-emerald-500' : 'border-slate-200 dark:border-slate-800 text-slate-500'}`}
                                >
                                    BUY
                                </button>
                                <button
                                    onClick={() => setType('SELL')}
                                    className={`p-2 rounded-lg text-sm font-bold border ${type === 'SELL' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 border-rose-500' : 'border-slate-200 dark:border-slate-800 text-slate-500'}`}
                                >
                                    SELL
                                </button>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Price</label>
                                    <input
                                        type="number"
                                        value={price}
                                        onChange={(e) => setPrice(parseFloat(e.target.value) || '')}
                                        className="w-full p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Quantity</label>
                                    <input
                                        type="number"
                                        value={qty}
                                        onChange={(e) => setQty(parseFloat(e.target.value) || '')}
                                        className="w-full p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:border-indigo-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Analysis / Notes</label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Why this trade? Setup? Stop loss?"
                                    className="w-full p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl outline-none focus:border-indigo-500 text-sm h-20 resize-none"
                                />
                            </div>

                            <button
                                onClick={handlePlaceOrder}
                                className="w-full py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold hover:opacity-90 transition-opacity"
                            >
                                Log Trade
                            </button>
                        </div>
                    </div>

                    {/* Quick Stats */}
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-800">
                        <h4 className="font-bold text-slate-700 dark:text-slate-300 mb-4 flex items-center gap-2">
                            <AlertCircle size={16} /> Performance
                        </h4>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-slate-500">Win Rate</span>
                                <span className="font-bold text-slate-900 dark:text-white">{stats.winRate.toFixed(1)}%</span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                                <div className="bg-emerald-500 h-full" style={{ width: `${stats.winRate}%` }}></div>
                            </div>
                            <div className="flex justify-between items-center pt-2">
                                <span className="text-sm text-slate-500">Total Trades</span>
                                <span className="font-bold text-slate-900 dark:text-white">{stats.totalTrades}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
