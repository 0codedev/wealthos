import React, { useEffect, useState, useMemo } from 'react';
import { liveQuery } from 'dexie';
import { db, Trade, calculatePnL } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import TradeHistoryTable from '../../journal/TradeHistoryTable';
import { deleteWithUndo } from '../../../lib/deleteWithUndo';
import { consumeUndo } from '../../../lib/undoStack';
import { COPY } from '../../../utils/appCopy';
import { useToast } from '../../shared/ToastProvider';
import ExecutionDesk from '../../journal/ExecutionDesk';
import BrokerCSVImport, { ParsedTrade } from '../../journal/BrokerCSVImport';
import { SyncTradesButton } from '../../journal/SyncTradesButton';
import { SyncSandboxTradesButton, syncSandboxTradesFromApi } from '../../journal/SyncSandboxTradesButton';
import { usePausedInterval } from '../../../hooks/usePausedInterval';
import { useSandboxStore } from '../../../store/sandboxStore';
import { Plus, Download, RefreshCw, Calendar, Target, HelpCircle, CheckSquare, Search, Filter } from 'lucide-react';

interface TradesTabProps {
    onEditTrade: (trade: Trade) => void;
    onNewTrade: () => void;
    selectedTradeToEdit: Trade | null;
    isAddingNewTrade: boolean;
    onCloseExecutionDesk: () => void;
}

export const TradesTab: React.FC<TradesTabProps> = ({
    onEditTrade,
    onNewTrade,
    selectedTradeToEdit,
    isAddingNewTrade,
    onCloseExecutionDesk,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...rest
}: TradesTabProps) => {
    void rest;
    const isSandboxMode = useSandboxStore(state => state.isSandboxMode);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [selectedTradeIds, setSelectedTradeIds] = useState<number[]>([]);
    const { toast } = useToast();
    
    // Modals
    const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);

    // Filters
    const [searchQuery, setSearchQuery] = useState('');
    const [directionFilter, setDirectionFilter] = useState<'ALL' | 'Long' | 'Short'>('ALL');
    const [assetFilter, setAssetFilter] = useState<string>('ALL');
    const [setupFilter, setSetupFilter] = useState<string>('ALL');

    const handleImportTrades = async (parsed: ParsedTrade[]) => {
        try {
            const newTrades: Trade[] = parsed.map(pt => ({
                ticker: pt.symbol,
                direction: pt.type === 'BUY' ? 'Long' : 'Short',
                quantity: pt.quantity,
                entryPrice: pt.price,
                exitPrice: pt.price,
                date: pt.date,
                entryTime: '09:15',
                moodEntry: 'Focused',
                moodExit: 'Satisfied',
                mistakes: [],
                setup: 'Manual CSV',
                pnl: 0,
                notes: `Imported from ${pt.broker} CSV. OrderNo: ${pt.orderNo || 'N/A'}`
            }));

            for (const t of newTrades) {
                await db.trades.add(t);
            }
        } catch (e) {
            console.error('Failed to save imported trades:', e);
            alert('Failed to import trades. Please check the console for logs.');
        }
    };

    useEffect(() => {
        const subscription = liveQuery(() => (db.trades as any).active().toArray()).subscribe((data: Trade[]) => {
            const sorted = [...data].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const enriched = sorted.map(t => ({
                ...t,
                pnl: calculatePnL(t)
            }));
            setTrades(enriched);
        });
        return () => subscription.unsubscribe();
    }, []);

    // Autonomous Sandbox Sync: Auto-hydrate silently upon mounting in Sandbox Mode
    useEffect(() => {
        if (!isSandboxMode) return;
        let active = true;
        void (async () => {
            try {
                await syncSandboxTradesFromApi(false);
            } catch (err) {
                console.warn('Autonomous sandbox sync error:', err);
            }
        })();
        return () => { active = false; };
    }, [isSandboxMode]);

    // Autonomous Background Poller: every 30s while active in sandbox mode
    usePausedInterval(() => {
        if (isSandboxMode) {
            void syncSandboxTradesFromApi();
        }
    }, isSandboxMode ? 30000 : null, { runImmediately: false });

    // Reactive filter based on Sandbox Mode toggle
    const modeTrades = useMemo(() => {
        return trades.filter(t => isSandboxMode ? t.source === 'SANDBOX' : t.source !== 'SANDBOX');
    }, [trades, isSandboxMode]);

    // Unique assets and setups for filters
    const assetClasses = useMemo(() => {
        const set = new Set<string>();
        modeTrades.forEach(t => {
            if (t.assetClass) set.add(t.assetClass);
        });
        return Array.from(set);
    }, [modeTrades]);

    const setups = useMemo(() => {
        const set = new Set<string>();
        modeTrades.forEach(t => {
            if (t.setup) set.add(t.setup);
        });
        return Array.from(set);
    }, [modeTrades]);

    const filteredTrades = useMemo(() => {
        return modeTrades.filter(t => {
            const matchesSearch = searchQuery ? (
                t.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (t.notes && t.notes.toLowerCase().includes(searchQuery.toLowerCase()))
            ) : true;
            
            const matchesDirection = directionFilter === 'ALL' ? true : t.direction === directionFilter;
            const matchesAsset = assetFilter === 'ALL' ? true : t.assetClass === assetFilter;
            const matchesSetup = setupFilter === 'ALL' ? true : t.setup === setupFilter;

            return matchesSearch && matchesDirection && matchesAsset && matchesSetup;
        });
    }, [modeTrades, searchQuery, directionFilter, assetFilter, setupFilter]);

    if (selectedTradeToEdit || isAddingNewTrade) {
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 md:p-6 shadow-2xl">
                <ExecutionDesk 
                    onClose={onCloseExecutionDesk} 
                    tradeToEdit={selectedTradeToEdit} 
                />
            </div>
        );
    }

    return (
        <div className="space-y-6 pb-20">
            {/* Toolbar Header */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
                        <CheckSquare size={20} />
                    </div>
                    <div>
                        <h2 className="text-md font-bold text-slate-800 dark:text-white">Trades Ledger</h2>
                        <p className="text-[10px] text-slate-400 mt-0.5">Manage, filter, and audit your execution records</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        onClick={() => setIsCsvModalOpen(true)}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold border border-slate-200 dark:border-slate-700 rounded-xl text-xs flex items-center gap-2 transition-all"
                    >
                        <Download size={14} /> Import CSV
                    </button>
                    
                    <SyncTradesButton />
                    <SyncSandboxTradesButton />

                    <button
                        onClick={onNewTrade}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
                    >
                        <Plus size={14} /> Record Trade
                    </button>
                </div>
            </div>

            {/* Filters Ledger */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row flex-wrap items-center gap-4">
                {/* Search */}
                <div className="relative w-full md:w-64">
                    <input
                        type="text"
                        placeholder="Search Symbol or Notes..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 pl-9 pr-4 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 transition-colors"
                    />
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>

                {/* Direction Filter */}
                <div className="flex items-center gap-1.5 w-full md:w-auto">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider hidden md:inline">Type:</span>
                    <select
                        value={directionFilter}
                        onChange={e => setDirectionFilter(e.target.value as any)}
                        className="w-full md:w-32 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                    >
                        <option value="ALL">All Actions</option>
                        <option value="Long">Long / Buy</option>
                        <option value="Short">Short / Sell</option>
                    </select>
                </div>

                {/* Asset Class Filter */}
                <div className="flex items-center gap-1.5 w-full md:w-auto">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider hidden md:inline">Asset:</span>
                    <select
                        value={assetFilter}
                        onChange={e => setAssetFilter(e.target.value)}
                        className="w-full md:w-36 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                    >
                        <option value="ALL">All Asset Classes</option>
                        {assetClasses.map(a => (
                            <option key={a} value={a}>{a}</option>
                        ))}
                    </select>
                </div>

                {/* Setup Filter */}
                <div className="flex items-center gap-1.5 w-full md:w-auto">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider hidden md:inline">Setup:</span>
                    <select
                        value={setupFilter}
                        onChange={e => setSetupFilter(e.target.value)}
                        className="w-full md:w-40 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                    >
                        <option value="ALL">All Setups</option>
                        {setups.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Ledgers Table */}
            <TradeHistoryTable
                trades={filteredTrades}
                onTradeClick={onEditTrade}
                onDeleteTrade={async (id) => {
                    const t = trades.find(x => x.id === id);
                    const label = t?.ticker ?? 'Trade';
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
                    toast.success(COPY.undo.tradeDeleted(label), {
                        duration: 30000,
                        action: { label: 'Undo', onClick: () => { void consumeUndo(entryId)?.undo(); } },
                    });
                }}
                selectedTradeIds={selectedTradeIds}
                setSelectedTradeIds={setSelectedTradeIds}
            />

            {/* CSV Import Modal */}
            <BrokerCSVImport
                isOpen={isCsvModalOpen}
                onClose={() => setIsCsvModalOpen(false)}
                onImport={handleImportTrades}
            />
        </div>
    );
};

export default TradesTab;
