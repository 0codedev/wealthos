import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Activity, TrendingUp, TrendingDown, Target, Wallet, ChevronRight, Search, Filter, Save, History, X, Clock, StickyNote, Trash2, List, LayoutGrid, CheckCircle, AlertTriangle, Link2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, Trade, MissedTrade, MissedReason, SetupGrade } from '../../../database';
import { formatCurrency, formatCurrencySigned } from '../../../utils/helpers';
import { deleteWithUndo } from '../../../lib/deleteWithUndo';
import { consumeUndo } from '../../../lib/undoStack';
import { COPY } from '../../../utils/appCopy';
import { useToast } from '../../shared/ToastProvider';

const INSTRUMENTS = [
    // INDICES (NSE / BSE)
    { id: 'nifty', name: 'Nifty 50', defaultLotSize: 65, color: 'emerald', category: 'Indices' },
    { id: 'banknifty', name: 'Bank Nifty', defaultLotSize: 15, color: 'blue', category: 'Indices' },
    { id: 'finNifty', name: 'Fin Nifty', defaultLotSize: 40, color: 'indigo', category: 'Indices' },
    { id: 'midcap', name: 'Midcap Nifty', defaultLotSize: 75, color: 'violet', category: 'Indices' },
    { id: 'sensex', name: 'Sensex', defaultLotSize: 20, color: 'orange', category: 'Indices' },
    { id: 'bankex', name: 'Bankex', defaultLotSize: 15, color: 'rose', category: 'Indices' },
    
    // ENERGY (MCX)
    { id: 'crudeoil', name: 'Crudeoil', defaultLotSize: 100, color: 'amber', category: 'Energy' },
    { id: 'crudemini', name: 'Crude Mini', defaultLotSize: 10, color: 'amber', category: 'Energy' },
    { id: 'naturalgas', name: 'Natural Gas', defaultLotSize: 1250, color: 'cyan', category: 'Energy' },
    { id: 'ngmini', name: 'NG Mini', defaultLotSize: 250, color: 'cyan', category: 'Energy' },
    
    // PRECIOUS METALS (MCX)
    { id: 'gold', name: 'Gold', defaultLotSize: 100, color: 'yellow', category: 'Metals' },
    { id: 'goldmini', name: 'Gold Mini', defaultLotSize: 10, color: 'yellow', category: 'Metals' },
    { id: 'goldguinea', name: 'Gold Guinea', defaultLotSize: 8, color: 'yellow', category: 'Metals' },
    { id: 'goldpetal', name: 'Gold Petal', defaultLotSize: 1, color: 'yellow', category: 'Metals' },
    { id: 'silver', name: 'Silver', defaultLotSize: 30, color: 'slate', category: 'Metals' },
    { id: 'silvermini', name: 'Silver Mini', defaultLotSize: 5, color: 'slate', category: 'Metals' },
    { id: 'silvermicro', name: 'Silver Micro', defaultLotSize: 1, color: 'slate', category: 'Metals' },
    
    // BASE METALS (MCX)
    { id: 'copper', name: 'Copper', defaultLotSize: 2500, color: 'orange', category: 'Metals' },
    { id: 'zinc', name: 'Zinc', defaultLotSize: 5000, color: 'zinc', category: 'Metals' },
    { id: 'zincmini', name: 'Zinc Mini', defaultLotSize: 1000, color: 'zinc', category: 'Metals' },
    { id: 'aluminum', name: 'Aluminum', defaultLotSize: 5000, color: 'slate', category: 'Metals' },
    { id: 'almini', name: 'Alum Mini', defaultLotSize: 1000, color: 'slate', category: 'Metals' },
    { id: 'lead', name: 'Lead', defaultLotSize: 5000, color: 'blue', category: 'Metals' },
    { id: 'leadmini', name: 'Lead Mini', defaultLotSize: 1000, color: 'blue', category: 'Metals' },
    
    // CURRENCY
    { id: 'usdinr', name: 'USDINR', defaultLotSize: 1000, color: 'emerald', category: 'Currency' },
    { id: 'eurinr', name: 'EURINR', defaultLotSize: 1000, color: 'blue', category: 'Currency' },
    { id: 'gbpinr', name: 'GBPINR', defaultLotSize: 1000, color: 'purple', category: 'Currency' },
    { id: 'jpyinr', name: 'JPYINR', defaultLotSize: 1000, color: 'slate', category: 'Currency' },
    
    // LARGE CAP EQUITIES
    { id: 'reliance', name: 'Reliance', defaultLotSize: 250, color: 'blue', category: 'Equities' },
    { id: 'tcs', name: 'TCS', defaultLotSize: 175, color: 'indigo', category: 'Equities' },
    { id: 'hdfcbank', name: 'HDFC Bank', defaultLotSize: 550, color: 'blue', category: 'Equities' },
    { id: 'icicibank', name: 'ICICI Bank', defaultLotSize: 700, color: 'orange', category: 'Equities' },
    { id: 'sbin', name: 'SBIN', defaultLotSize: 1500, color: 'blue', category: 'Equities' },
    { id: 'infy', name: 'Infosys', defaultLotSize: 400, color: 'blue', category: 'Equities' },
    { id: 'bhartiartl', name: 'Airtel', defaultLotSize: 950, color: 'rose', category: 'Equities' },
    
    { id: 'custom', name: 'Custom', defaultLotSize: 1, color: 'purple', category: 'Misc' },
];

const getColorClasses = (color: string, isActive: boolean) => {
    const base = 'px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all border flex items-center gap-2';
    
    if (isActive) {
        const activeColors: Record<string, string> = {
            emerald: 'bg-emerald-500 border-emerald-400 text-white shadow-lg shadow-emerald-500/20',
            orange: 'bg-orange-500 border-orange-400 text-white shadow-lg shadow-orange-500/20',
            blue: 'bg-blue-500 border-blue-400 text-white shadow-lg shadow-blue-500/20',
            indigo: 'bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/20',
            violet: 'bg-violet-500 border-violet-400 text-white shadow-lg shadow-violet-500/20',
            purple: 'bg-purple-500 border-purple-400 text-white shadow-lg shadow-purple-500/20',
            rose: 'bg-rose-500 border-rose-400 text-white shadow-lg shadow-rose-500/20',
            amber: 'bg-amber-500 border-amber-400 text-white shadow-lg shadow-amber-500/20',
            yellow: 'bg-yellow-500 border-yellow-400 text-white shadow-lg shadow-yellow-500/20',
            slate: 'bg-slate-500 border-slate-400 text-white shadow-lg shadow-slate-500/20',
            cyan: 'bg-cyan-500 border-cyan-400 text-white shadow-lg shadow-cyan-500/20',
            zinc: 'bg-zinc-500 border-zinc-400 text-white shadow-lg shadow-zinc-500/20',
        };
        return `${base} ${activeColors[color] || 'bg-slate-800 border-slate-700 text-white'}`;
    }

    return `${base} bg-slate-900/40 border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300`;
};

interface SavedCalculation {
    id: string;
    timestamp: number;
    instrumentId: string;
    isLong: boolean;
    entryPrice: number;
    exitPrice: number;
    lots: number;
    customLotSize: number;
    note: string;
}

export const PositionPnLCalculator: React.FC = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('Indices');
    const [selectedId, setSelectedId] = useState('nifty');
    const { toast } = useToast();
    
    // Filter logic
    const filteredInstruments = useMemo(() => {
        return INSTRUMENTS.filter(inst => {
            const matchesSearch = inst.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                 inst.id.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = activeCategory === 'All' || inst.category === activeCategory;
            return matchesSearch && matchesCategory;
        });
    }, [searchQuery, activeCategory]);

    const categories = ['All', ...Array.from(new Set(INSTRUMENTS.map(i => i.category)))];

    // Inputs
    const [entryPrice, setEntryPrice] = useState<number | ''>('');
    const [exitPrice, setExitPrice] = useState<number | ''>('');
    const [lots, setLots] = useState<number>(1);
    const [customLotSize, setCustomLotSize] = useState<number>(1);
    
    // Trade Direction
    const [isLong, setIsLong] = useState(true);

    // History & Note State
    const [history, setHistory] = useState<SavedCalculation[]>(() => {
        if (typeof window === 'undefined') return [];
        const saved = localStorage.getItem('pnl_matrix_history');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse PnL history', e);
                return [];
            }
        }
        return [];
    });
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [currentNote, setCurrentNote] = useState('');

    // Virtualization, View Mode, and Sync states
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
    const [visibleCount, setVisibleCount] = useState(12);
    const [dbTrades, setDbTrades] = useState<Trade[]>([]);
    const [dbMissedTrades, setDbMissedTrades] = useState<MissedTrade[]>([]);
    const [strategies, setStrategies] = useState<{ id?: number; name: string; description?: string }[]>([]);
    const [syncVersion, setSyncVersion] = useState(0);
    const observerRef = useRef<HTMLDivElement | null>(null);

    // Modal state for logging actual & missed trades from calculations
    const [logActualItem, setLogActualItem] = useState<SavedCalculation | null>(null);
    const [logMissedItem, setLogMissedItem] = useState<SavedCalculation | null>(null);

    // Actual Trade Log Form fields
    const [actualTicker, setActualTicker] = useState('');
    const [actualDate, setActualDate] = useState('');
    const [actualQty, setActualQty] = useState(0);
    const [actualAssetClass, setActualAssetClass] = useState<'Equity' | 'Options' | 'Crypto' | 'Forex' | 'Futures'>('Equity');
    const [actualSetup, setActualSetup] = useState('');
    const [actualGrade, setActualGrade] = useState<SetupGrade>('A');
    const [actualNotes, setActualNotes] = useState('');

    // Missed Trade Log Form fields
    const [missedTicker, setMissedTicker] = useState('');
    const [missedDate, setMissedDate] = useState('');
    const [missedReason, setMissedReason] = useState<MissedReason>('Hesitation');
    const [missedSetup, setMissedSetup] = useState('');
    const [missedNotes, setMissedNotes] = useState('');

    // Fetch database items & strategies
    useEffect(() => {
        const fetchDbData = async () => {
            try {
                const trades = await db.trades.toArray();
                const missed = await db.missed_trades.toArray();
                const strats = await db.strategies.toArray();
                setDbTrades(trades);
                setDbMissedTrades(missed);
                setStrategies(strats);
            } catch (err) {
                console.error('Failed to load database records for PnL sync:', err);
            }
        };
        fetchDbData();
    }, [syncVersion, history]);

    // IntersectionObserver for lazy loading virtualization
    useEffect(() => {
        if (!observerRef.current) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                setVisibleCount(prev => Math.min(prev + 12, history.length));
            }
        }, { threshold: 0.1 });
        observer.observe(observerRef.current);
        return () => observer.disconnect();
    }, [history.length, viewMode]);

    // Reset visible count when switching view modes
    useEffect(() => {
        setVisibleCount(12);
    }, [viewMode]);

    // Date helper for calculations matching local timezone
    const getLocalDateString = (timestamp: number) => {
        const d = new Date(timestamp);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Ticker matching helper
    const isTickerMatch = (calc: SavedCalculation, dbTicker: string) => {
        const inst = INSTRUMENTS.find(i => i.id === calc.instrumentId);
        const instName = inst ? inst.name.toLowerCase() : '';
        const instId = calc.instrumentId.toLowerCase();
        const ticker = dbTicker.toLowerCase();
        
        if (instId !== 'custom') {
            if (ticker === instId || ticker === instName) return true;
            if (ticker.includes(instId) || instId.includes(ticker)) return true;
            if (ticker.includes(instName) || instName.includes(ticker)) return true;
        }
        
        if (calc.note) {
            const noteClean = calc.note.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
            const noteWords = noteClean.split(/\s+/).filter(w => w.length > 2);
            for (const word of noteWords) {
                if (ticker.includes(word) || word.includes(ticker)) return true;
            }
        }
        return false;
    };

    // Get matched status details
    const getSyncStatus = (item: SavedCalculation) => {
        const itemDate = getLocalDateString(item.timestamp);
        
        const matchedTrade = dbTrades.find(t => {
            if (t.date !== itemDate) return false;
            const isTradeLong = t.direction.toLowerCase() === 'long';
            if (isTradeLong !== item.isLong) return false;
            return isTickerMatch(item, t.ticker);
        });

        if (matchedTrade) {
            return {
                type: 'actual' as const,
                pnl: matchedTrade.pnl,
                id: matchedTrade.id,
                ticker: matchedTrade.ticker
            };
        }

        const matchedMissed = dbMissedTrades.find(m => {
            if (m.date !== itemDate) return false;
            const isMissedLong = m.direction.toLowerCase() === 'long';
            if (isMissedLong !== item.isLong) return false;
            return isTickerMatch(item, m.ticker);
        });

        if (matchedMissed) {
            return {
                type: 'missed' as const,
                reason: matchedMissed.reason,
                id: matchedMissed.id,
                ticker: matchedMissed.ticker
            };
        }
        return null;
    };

    const openLogActualModal = (item: SavedCalculation) => {
        const inst = INSTRUMENTS.find(i => i.id === item.instrumentId);
        const ticker = item.instrumentId === 'custom' 
            ? (item.note ? item.note.split(' ')[0].toUpperCase() : 'CUSTOM')
            : (inst?.name || 'CUSTOM').toUpperCase();
        const quantity = item.lots * (item.instrumentId === 'custom' ? item.customLotSize : (inst?.defaultLotSize || 1));
        
        setLogActualItem(item);
        setActualTicker(ticker);
        setActualDate(getLocalDateString(item.timestamp));
        setActualQty(quantity);
        setActualAssetClass('Equity');
        setActualSetup(inst?.name || '');
        setActualGrade('A');
        setActualNotes(item.note || '');
        setLinkMode('new');
        setSelectedTradeId('');
    };

    const openLogMissedModal = (item: SavedCalculation) => {
        const inst = INSTRUMENTS.find(i => i.id === item.instrumentId);
        const ticker = item.instrumentId === 'custom' 
            ? (item.note ? item.note.split(' ')[0].toUpperCase() : 'CUSTOM')
            : (inst?.name || 'CUSTOM').toUpperCase();
        
        setLogMissedItem(item);
        setMissedTicker(ticker);
        setMissedDate(getLocalDateString(item.timestamp));
        setMissedReason('Hesitation');
        setMissedSetup(inst?.name || 'Custom');
        setMissedNotes(item.note || '');
    };

    const handleLogActual = async () => {
        if (!logActualItem) return;
        const pnl = logActualItem.isLong 
            ? (logActualItem.exitPrice - logActualItem.entryPrice) * actualQty
            : (logActualItem.entryPrice - logActualItem.exitPrice) * actualQty;

        const newTrade: Trade = {
            ticker: actualTicker.trim().toUpperCase(),
            entryPrice: logActualItem.entryPrice,
            exitPrice: logActualItem.exitPrice,
            quantity: actualQty,
            direction: logActualItem.isLong ? 'Long' : 'Short',
            date: actualDate,
            moodEntry: 'Focused',
            moodExit: 'Satisfied',
            mistakes: [],
            setup: actualSetup || 'Manual Calc',
            grade: actualGrade,
            notes: actualNotes ? `Logged from saved projection: ${actualNotes}` : 'Logged from saved projection',
            pnl: Number(pnl.toFixed(2)),
            assetClass: actualAssetClass,
            broker: 'manual',
            syncStatus: 'SYNCED'
        };

        try {
            await db.trades.add(newTrade);
            setSyncVersion(prev => prev + 1);
            setLogActualItem(null);
        } catch (err) {
            console.error('Failed to save actual trade from calculation:', err);
            alert('Failed to log trade to Dexie database.');
        }
    };

    const handleLogMissed = async () => {
        if (!logMissedItem) return;
        const newMissed: MissedTrade = {
            date: missedDate,
            ticker: missedTicker.trim().toUpperCase(),
            assetClass: 'Equity',
            direction: logMissedItem.isLong ? 'Long' : 'Short',
            setup: missedSetup,
            reason: missedReason,
            notes: missedNotes || 'Logged from saved projection'
        };

        try {
            await db.missed_trades.add(newMissed);
            setSyncVersion(prev => prev + 1);
            setLogMissedItem(null);
        } catch (err) {
            console.error('Failed to save missed trade from calculation:', err);
            alert('Failed to log missed trade to Dexie database.');
        }
    };

    const handleDeleteSyncedTrade = async (e: React.MouseEvent, tradeId: number) => {
        e.stopPropagation();
        const entryId = await deleteWithUndo({
            table: 'trades',
            id: tradeId,
            kind: 'trade',
            label: 'Trade',
            message: COPY.undo.tradeDeleted('Trade'),
        });
        if (!entryId) {
            toast.error(COPY.undo.failed);
            return;
        }
        setSyncVersion(prev => prev + 1);
        toast.success(COPY.undo.tradeDeleted('Trade'), {
            duration: 30000,
            action: { label: 'Undo', onClick: () => { void consumeUndo(entryId)?.undo(); } },
        });
    };

    const handleDeleteSyncedMissed = async (e: React.MouseEvent, missedId: number) => {
        e.stopPropagation();
        if (window.confirm("Are you sure you want to delete this missed trade record?")) {
            try {
                await db.missed_trades.delete(missedId);
                setSyncVersion(prev => prev + 1);
            } catch (err) {
                console.error("Failed to delete synced missed trade:", err);
            }
        }
    };

    const [linkMode, setLinkMode] = useState<'new' | 'existing'>('new');
    const [selectedTradeId, setSelectedTradeId] = useState<number | ''>('');

    const matchingTrades = useMemo(() => {
        if (!logActualItem) return [];
        const query = actualTicker.trim().toLowerCase();
        return dbTrades.filter(t => {
            if (query) {
                return t.ticker.toLowerCase().includes(query);
            }
            return isTickerMatch(logActualItem, t.ticker);
        });
    }, [logActualItem, dbTrades, actualTicker]);

    const handleLinkToTrade = async () => {
        if (!logActualItem || !selectedTradeId) return;
        
        const tradeToUpdate = dbTrades.find(t => t.id === selectedTradeId);
        if (!tradeToUpdate) return;
        
        const inst = INSTRUMENTS.find(i => i.id === logActualItem.instrumentId);
        const qty = logActualItem.lots * (logActualItem.instrumentId === 'custom' ? logActualItem.customLotSize : (inst?.defaultLotSize || 1));
        const pnl = logActualItem.isLong 
            ? (logActualItem.exitPrice - logActualItem.entryPrice) * qty
            : (logActualItem.entryPrice - logActualItem.exitPrice) * qty;

        const marker = `[ID: ${logActualItem.id}]`;
        const projectionText = `\n\n📈 [Saved Projection: ${logActualItem.isLong ? 'Long' : 'Short'} | Entry: ₹${logActualItem.entryPrice} → Exit: ₹${logActualItem.exitPrice} | PnL: ${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}]\nNotes: ${actualNotes || logActualItem.note}\n${marker}`;

        let newNotes = tradeToUpdate.notes || '';
        if (newNotes.includes(marker)) {
            const markerIndex = newNotes.indexOf(marker);
            const blockStart = newNotes.lastIndexOf('📈 [Saved Projection:', markerIndex);
            if (blockStart !== -1) {
                const oldBlock = newNotes.substring(blockStart, markerIndex + marker.length);
                newNotes = newNotes.replace(oldBlock, projectionText.trim());
            }
        } else {
            newNotes = newNotes ? `${newNotes}${projectionText}` : projectionText.trim();
        }

        const updatedTrade: Trade = {
            ...tradeToUpdate,
            notes: newNotes,
            syncStatus: 'SYNCED'
        };

        try {
            await db.trades.put(updatedTrade);
            setSyncVersion(prev => prev + 1);
            setLogActualItem(null);
            setSelectedTradeId('');
            setActualNotes('');
        } catch (err) {
            console.error('Failed to link projection to trade:', err);
            alert('Failed to link projection to the selected trade.');
        }
    };

    // Auto-sync projection notes to matched database trades (e.g. automatically logged trades)
    useEffect(() => {
        const syncNotes = async () => {
            let updated = false;
            for (const item of history) {
                if (!item.note) continue; // Only sync if there is a note in the math lab
                
                const itemDate = getLocalDateString(item.timestamp);
                const matchedTrade = dbTrades.find(t => {
                    if (t.date !== itemDate) return false;
                    const isTradeLong = t.direction.toLowerCase() === 'long';
                    if (isTradeLong !== item.isLong) return false;
                    return isTickerMatch(item, t.ticker);
                });

                if (matchedTrade && matchedTrade.id) {
                    const inst = INSTRUMENTS.find(i => i.id === item.instrumentId);
                    const qty = item.lots * (item.instrumentId === 'custom' ? item.customLotSize : (inst?.defaultLotSize || 1));
                    const pnl = item.isLong 
                        ? (item.exitPrice - item.entryPrice) * qty
                        : (item.entryPrice - item.exitPrice) * qty;

                    const marker = `[ID: ${item.id}]`;
                    const projectionText = `\n\n📈 [Saved Projection: ${item.isLong ? 'Long' : 'Short'} | Entry: ₹${item.entryPrice} → Exit: ₹${item.exitPrice} | PnL: ${pnl >= 0 ? '+' : ''}₹${pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}]\nNotes: ${item.note}\n${marker}`;

                    let newNotes = matchedTrade.notes || '';
                    let needsUpdate = false;

                    if (newNotes.includes(marker)) {
                        const markerIndex = newNotes.indexOf(marker);
                        const blockStart = newNotes.lastIndexOf('📈 [Saved Projection:', markerIndex);
                        if (blockStart !== -1) {
                            const oldBlock = newNotes.substring(blockStart, markerIndex + marker.length);
                            const cleanProjectionText = projectionText.trim();
                            const cleanOldBlock = oldBlock.trim();
                            if (cleanOldBlock !== cleanProjectionText) {
                                newNotes = newNotes.replace(oldBlock, cleanProjectionText);
                                needsUpdate = true;
                            }
                        }
                    } else {
                        newNotes = newNotes ? `${newNotes}${projectionText}` : projectionText.trim();
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        const updatedTrade: Trade = {
                            ...matchedTrade,
                            notes: newNotes,
                            syncStatus: 'SYNCED'
                        };
                        try {
                            await db.trades.put(updatedTrade);
                            updated = true;
                        } catch (err) {
                            console.error('Failed to auto-sync projection note to matched trade:', err);
                        }
                    }
                }
            }
            if (updated) {
                setSyncVersion(prev => prev + 1);
            }
        };

        if (dbTrades.length > 0 && history.length > 0) {
            syncNotes();
        }
    }, [dbTrades, history]);

    // Save history whenever it changes
    useEffect(() => {
        localStorage.setItem('pnl_matrix_history', JSON.stringify(history));
    }, [history]);

    const handleSaveNote = () => {
        if (!entryPrice || !exitPrice) return;

        const newEntry: SavedCalculation = {
            id: Math.random().toString(36).substring(7),
            timestamp: Date.now(),
            instrumentId: selectedId,
            isLong,
            entryPrice: Number(entryPrice),
            exitPrice: Number(exitPrice),
            lots,
            customLotSize,
            note: currentNote
        };

        setHistory(prev => [newEntry, ...prev].slice(0, 50)); // Keep last 50
        setIsNoteModalOpen(false);
        setCurrentNote('');
    };

    const loadCalculation = (calc: SavedCalculation) => {
        setSelectedId(calc.instrumentId);
        setIsLong(calc.isLong);
        setEntryPrice(calc.entryPrice);
        setExitPrice(calc.exitPrice);
        setLots(calc.lots);
        setCustomLotSize(calc.customLotSize);
        setCurrentNote(calc.note);
    };

    const deleteHistoryItem = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this saved calculation?')) {
            setHistory(prev => prev.filter(item => item.id !== id));
        }
    };

    const activeInstrument = INSTRUMENTS.find(i => i.id === selectedId) || INSTRUMENTS[0];
    const lotSize = selectedId === 'custom' ? customLotSize : activeInstrument.defaultLotSize;

    const results = useMemo(() => {
        const ent = Number(entryPrice);
        const ext = Number(exitPrice);
        const lts = Number(lots);
        const lsz = Number(lotSize);

        if (!ent || !ext || lts <= 0 || lsz <= 0) return null;

        const totalQuantity = lts * lsz;
        
        let profitLossPerUnit = 0;
        if (isLong) {
            profitLossPerUnit = ext - ent;
        } else {
            profitLossPerUnit = ent - ext;
        }

        const totalPnL = profitLossPerUnit * totalQuantity;
        const totalInvestment = ent * totalQuantity;
        const targetValue = ext * totalQuantity;
        const roi = (totalPnL / totalInvestment) * 100;

        return {
            totalQuantity,
            totalPnL,
            totalInvestment,
            targetValue,
            roi,
            pointsCaught: Math.abs(profitLossPerUnit) * Math.sign(totalPnL)
        };
    }, [entryPrice, exitPrice, lots, lotSize, isLong]);

    return (
        <>
            <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-3xl p-5 lg:p-6 shadow-2xl"
            >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-xl font-black text-white flex items-center gap-2">
                        <div className="p-1.5 bg-emerald-500/20 rounded-lg">
                            <Target size={20} className="text-emerald-400" />
                        </div>
                        Position P&L Matrix
                    </h2>
                    <p className="text-slate-400 text-xs mt-0.5">Institutional-grade profit forecasting engine</p>
                </div>
                
                <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800/50 shadow-inner">
                    <button 
                        onClick={() => setIsLong(true)}
                        className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${isLong ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        Long
                    </button>
                    <button 
                        onClick={() => setIsLong(false)}
                        className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${!isLong ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        Short
                    </button>
                </div>
            </div>

            {/* Market Layer Selection Engine */}
            <div className="mb-6 space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                    <label className="block text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Market Layer Selection</label>
                    
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <div className="relative flex-1 sm:w-64 group">
                            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 group-focus-within:text-emerald-500 transition-colors" />
                            <input 
                                type="text"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search contract (e.g. Nifty, Reliance)..."
                                className="w-full bg-slate-950/50 border border-slate-800 rounded-lg pl-8 pr-8 py-1.5 text-[11px] text-white placeholder:text-slate-600 focus:border-emerald-500/30 outline-none transition-all"
                            />
                            {searchQuery && (
                                <button 
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-600 hover:text-white transition-colors"
                                >
                                    <ChevronRight size={10} className="rotate-45" />
                                </button>
                            )}
                        </div>
                        <div className="flex bg-slate-950/40 p-0.5 rounded-lg border border-slate-800 items-center overflow-x-auto max-w-[200px] no-scrollbar">
                            <div className="px-1.5 text-slate-700">
                                <Filter size={10} />
                            </div>
                            {categories.map(cat => (
                                <button
                                    key={cat}
                                    onClick={() => setActiveCategory(cat)}
                                    className={`px-2 py-1 rounded-md text-[9px] font-bold whitespace-nowrap transition-all ${activeCategory === cat ? 'bg-slate-800 text-white' : 'text-slate-600 hover:text-slate-400'}`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 max-h-[140px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredInstruments.length > 0 ? (
                        filteredInstruments.map((inst) => {
                            const isActive = selectedId === inst.id;
                            return (
                                <button
                                    key={inst.id}
                                    onClick={() => setSelectedId(inst.id)}
                                    className={`${getColorClasses(inst.color, isActive)}`}
                                >
                                    <span className="tracking-tight">{inst.name}</span>
                                    <div className={`text-[8px] px-1.5 py-0.5 rounded-md font-mono font-black border ${
                                        isActive 
                                            ? 'bg-white/10 border-white/20 text-white' 
                                            : 'bg-slate-950 border-slate-800 text-slate-500'
                                    }`}>
                                        x{inst.defaultLotSize}
                                    </div>
                                </button>
                            );
                        })
                    ) : (
                        <div className="w-full py-6 text-center text-slate-600 text-[10px] uppercase font-black tracking-widest opacity-50 bg-slate-950/20 rounded-xl border border-dashed border-slate-800">
                            No matching contracts found
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Input Controls */}
                <div className="col-span-1 lg:col-span-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Entry Baseline</label>
                            <div className="relative group">
                                <input 
                                    type="number"
                                    value={entryPrice}
                                    onChange={e => setEntryPrice(parseFloat(e.target.value) || '')}
                                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-lg focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/5 outline-none transition-all group-hover:border-slate-700"
                                    placeholder="0.00"
                                />
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 font-mono text-[10px]">INR</div>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Exit Projection</label>
                            <div className="relative group">
                                <input 
                                    type="number"
                                    value={exitPrice}
                                    onChange={e => setExitPrice(parseFloat(e.target.value) || '')}
                                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-lg focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/5 outline-none transition-all group-hover:border-slate-700"
                                    placeholder="0.00"
                                />
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 font-mono text-[10px]">INR</div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Lots</label>
                            <input 
                                type="number"
                                min="1"
                                value={lots}
                                onChange={e => setLots(parseInt(e.target.value) || 1)}
                                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-lg focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/5 outline-none transition-all group-hover:border-slate-700"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Multiplier</label>
                            <input 
                                type="number"
                                disabled={selectedId !== 'custom'}
                                value={lotSize}
                                onChange={e => setCustomLotSize(parseInt(e.target.value) || 1)}
                                className={`w-full border rounded-xl px-4 py-3 font-mono text-lg focus:outline-none transition-all ${
                                    selectedId === 'custom' 
                                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' 
                                        : 'bg-slate-900 border-slate-800 text-slate-500 opacity-50 cursor-not-allowed'
                                }`}
                            />
                        </div>
                    </div>
                </div>

                {/* Dashboard Output Visuals */}
                <div className="col-span-1 lg:col-span-7">
                    <AnimatePresence mode="wait">
                        {results ? (
                            <motion.div 
                                key="results"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.98 }}
                                className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full"
                            >
                                {/* Main PnL Card */}
                                <div className={`col-span-full rounded-2xl p-6 relative overflow-hidden border shadow-xl flex flex-col justify-center min-h-[160px] ${
                                    results.totalPnL >= 0 
                                        ? 'bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20' 
                                        : 'bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border-rose-500/20'
                                }`}>
                                    <div className="absolute -right-4 -bottom-4 opacity-10">
                                        {results.totalPnL >= 0 ? <TrendingUp size={160} className="text-emerald-500" /> : <TrendingDown size={160} className="text-rose-500" />}
                                    </div>
                                    
                                    <div className="relative z-10">
                                        <div className="flex items-center gap-2 mb-1.5">
                                            <span className={`text-[9px] font-black tracking-[0.2em] uppercase px-1.5 py-0.5 rounded ${results.totalPnL >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                                {isLong ? 'Long' : 'Short'} Alpha
                                            </span>
                                        </div>
                                        <div className={`text-4xl md:text-5xl font-black font-mono tracking-tighter ${results.totalPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {formatCurrencySigned(results.totalPnL)}
                                        </div>

                                        {currentNote && (
                                            <motion.div 
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="mt-3 flex gap-2 items-start p-2 bg-white/5 rounded-lg border border-white/10 max-w-md"
                                            >
                                                <StickyNote size={12} className="text-indigo-400 shrink-0 mt-0.5" />
                                                <p className="text-[10px] text-slate-400 italic leading-relaxed">{currentNote}</p>
                                            </motion.div>
                                        )}
                                        
                                        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                                            <div className="flex flex-wrap gap-3">
                                                <div className="bg-slate-950/40 backdrop-blur-md rounded-xl px-3.5 py-2 border border-white/5">
                                                    <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-0.5">Return</div>
                                                    <div className={`text-lg font-mono font-black ${results.roi >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {results.roi >= 0 ? '+' : ''}{results.roi.toFixed(1)}%
                                                    </div>
                                                </div>
                                                <div className="bg-slate-950/40 backdrop-blur-md rounded-xl px-3.5 py-2 border border-white/5">
                                                    <div className="text-[9px] text-slate-500 uppercase font-bold tracking-widest mb-0.5">Capture</div>
                                                    <div className={`text-lg font-mono font-black ${results.pointsCaught >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                        {results.pointsCaught >= 0 ? '+' : ''}{results.pointsCaught.toFixed(1)} <span className="text-[10px] font-normal opacity-50 uppercase">pts</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => setIsNoteModalOpen(true)}
                                                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest text-white transition-all group"
                                            >
                                                <Save size={14} className="group-hover:scale-110 transition-transform" />
                                                Save to Note
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Info Cards */}
                                <motion.div 
                                    whileHover={{ y: -3 }}
                                    className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 flex flex-col justify-center"
                                >
                                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                                        <div className="p-1 bg-white/5 rounded-md"><Wallet size={10}/></div> Capital
                                    </span>
                                    <div className="text-xl font-mono text-white font-black">{formatCurrency(results.totalInvestment)}</div>
                                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                                        <span>Allocated:</span>
                                        <span className="text-slate-300 font-mono font-bold">{results.totalQuantity}</span>
                                    </div>
                                </motion.div>

                                <motion.div 
                                    whileHover={{ y: -3 }}
                                    className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 flex flex-col justify-center"
                                >
                                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                                        <div className="p-1 bg-white/5 rounded-md"><Activity size={10}/> Yield</div>
                                    </span>
                                    <div className="text-xl font-mono text-white font-black">{formatCurrency(results.targetValue)}</div>
                                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                                        <span>Status:</span>
                                        <span className={`font-bold ${results.totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                            {results.totalPnL >= 0 ? 'Optimized' : 'Drawdown'}
                                        </span>
                                    </div>
                                </motion.div>
                            </motion.div>
                        ) : (
                            <motion.div 
                                key="placeholder"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="h-full min-h-[300px] border border-dashed border-slate-800 rounded-2xl flex flex-col items-center justify-center text-slate-500 bg-slate-950/10"
                            >
                                <div className="p-4 bg-slate-900/50 rounded-full mb-4 border border-slate-800">
                                    <Target size={32} className="text-slate-700" />
                                </div>
                                <p className="font-black uppercase tracking-widest text-[10px] text-slate-500 text-center">Awaiting Market Projection</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
            
            {/* History Section */}
            {history.length > 0 && (
                <div className="mt-10 pt-10 border-t border-slate-800/50">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                                <History size={18} />
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-white uppercase tracking-wider">Saved Projections</h3>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Quick access to previous calculations & notes</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 self-end sm:self-center">
                            {/* View Mode Toggle */}
                            <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800/50 shadow-inner">
                                <button 
                                    onClick={() => setViewMode('grid')}
                                    className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                    title="Grid View"
                                >
                                    <LayoutGrid size={14} />
                                </button>
                                <button 
                                    onClick={() => setViewMode('table')}
                                    className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                    title="Tabular View"
                                >
                                    <List size={14} />
                                </button>
                            </div>

                            <button 
                                onClick={() => { if(confirm('Clear all history?')) setHistory([]); }}
                                className="text-[10px] font-black text-slate-650 hover:text-rose-500 transition-colors uppercase tracking-widest flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-rose-500/30"
                            >
                                <Trash2 size={12} /> Clear History
                            </button>
                        </div>
                    </div>

                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {history.slice(0, visibleCount).map((item) => {
                                const instrument = INSTRUMENTS.find(i => i.id === item.instrumentId);
                                const qty = item.lots * (item.instrumentId === 'custom' ? item.customLotSize : (instrument?.defaultLotSize || 1));
                                const pnl = item.isLong 
                                    ? (item.exitPrice - item.entryPrice) * qty 
                                    : (item.entryPrice - item.exitPrice) * qty;
                                const sync = getSyncStatus(item);
                                
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => loadCalculation(item)}
                                        className="bg-slate-950/40 border border-slate-800 rounded-2xl p-4 text-left hover:border-indigo-500/30 transition-all hover:-translate-y-0.5 active:scale-[0.99] duration-200 group relative overflow-hidden flex flex-col justify-between transform w-full"
                                    >
                                        <div className="w-full">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className={`w-2 h-2 rounded-full ${pnl >= 0 ? 'bg-emerald-500' : 'bg-rose-500'} shadow-[0_0_8px_rgba(16,185,129,0.3)]`} />
                                                    <span className="text-[10px] font-black text-white uppercase">{instrument?.name || 'Unknown'}</span>
                                                </div>
                                                <div className="flex items-center gap-2 onClick-propagation-guard" onClick={e => e.stopPropagation()}>
                                                    <span className="text-[8px] font-bold text-slate-650 uppercase tracking-tighter">
                                                        {new Date(item.timestamp).toLocaleDateString()}
                                                    </span>
                                                    <button 
                                                        onClick={(e) => deleteHistoryItem(e, item.id)}
                                                        className="p-1.5 text-slate-700 hover:text-rose-500 hover:bg-rose-500/10 rounded-md transition-all"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="flex items-baseline gap-2 mb-2">
                                                <span className={`text-lg font-mono font-black ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {formatCurrencySigned(pnl)}
                                                </span>
                                                <span className="text-[9px] text-slate-650 font-bold uppercase tracking-widest">{item.isLong ? 'Long' : 'Short'}</span>
                                            </div>

                                            <div className="flex items-center gap-3 text-[9px] text-slate-500 font-mono mb-3 bg-slate-900/50 rounded-lg px-2 py-1.5">
                                                <div className="flex flex-col">
                                                    <span className="text-[7px] uppercase opacity-50">Entry</span>
                                                    <span className="text-slate-300">₹{item.entryPrice}</span>
                                                </div>
                                                <ChevronRight size={10} className="text-slate-705" />
                                                <div className="flex flex-col">
                                                    <span className="text-[7px] uppercase opacity-50">Exit</span>
                                                    <span className="text-slate-300">₹{item.exitPrice}</span>
                                                </div>
                                                <div className="ml-auto flex flex-col items-end">
                                                    <span className="text-[7px] uppercase opacity-50">Lots</span>
                                                    <span className="text-slate-300">{item.lots}</span>
                                                </div>
                                            </div>

                                            {item.note && (
                                                <div className="relative group/note mb-3">
                                                    <div className="flex gap-2 p-2.5 bg-indigo-500/5 rounded-xl border border-indigo-500/10">
                                                        <StickyNote size={12} className="text-indigo-400 shrink-0 mt-0.5" />
                                                        <p className="text-[10px] text-slate-400 leading-relaxed italic line-clamp-2">{item.note}</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Grid Card Action/Sync Tray */}
                                        <div className="w-full mt-auto pt-3 border-t border-slate-800/40 flex items-center justify-between text-[10px] onClick-propagation-guard" onClick={e => e.stopPropagation()}>
                                            {sync ? (
                                                sync.type === 'actual' ? (
                                                    <div className="flex items-center justify-between w-full">
                                                        <span className="flex items-center gap-1 font-bold text-emerald-400">
                                                            <CheckCircle size={11} className="shrink-0" />
                                                            Logged ({formatCurrencySigned(sync.pnl || 0)})
                                                        </span>
                                                        <button 
                                                            onClick={(e) => handleDeleteSyncedTrade(e, sync.id!)}
                                                            className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 px-1.5 py-0.5 rounded transition-all font-bold uppercase tracking-wider text-[8px] border border-rose-500/15"
                                                            title="Delete actual trade from journal"
                                                        >
                                                            Delete Trade
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-between w-full">
                                                        <span className="flex items-center gap-1 font-bold text-amber-400">
                                                            <AlertTriangle size={11} className="shrink-0" />
                                                            Missed ({sync.reason})
                                                        </span>
                                                        <button 
                                                            onClick={(e) => handleDeleteSyncedMissed(e, sync.id!)}
                                                            className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 px-1.5 py-0.5 rounded transition-all font-bold uppercase tracking-wider text-[8px] border border-rose-500/15"
                                                            title="Delete missed trade record"
                                                        >
                                                            Delete Record
                                                        </button>
                                                    </div>
                                                )
                                            ) : (
                                                <div className="flex gap-2 w-full">
                                                    <button 
                                                        onClick={() => openLogActualModal(item)}
                                                        className="flex-1 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-350 border border-indigo-500/20 transition-all text-center font-bold uppercase tracking-wider text-[8px]"
                                                    >
                                                        Log Actual
                                                    </button>
                                                    <button 
                                                        onClick={() => openLogMissedModal(item)}
                                                        className="flex-1 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 hover:text-amber-350 border border-amber-500/20 transition-all text-center font-bold uppercase tracking-wider text-[8px]"
                                                    >
                                                        Log Missed
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/40 backdrop-blur-xl">
                            <table className="w-full text-left border-collapse min-w-[700px]">
                                <thead>
                                    <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase font-black tracking-widest bg-slate-950/50">
                                        <th className="py-4 px-5">Date</th>
                                        <th className="py-4 px-4">Instrument</th>
                                        <th className="py-4 px-4">Type</th>
                                        <th className="py-4 px-4 text-right">Entry → Exit</th>
                                        <th className="py-4 px-4 text-center">Lots</th>
                                        <th className="py-4 px-4 text-right">Proj. PnL</th>
                                        <th className="py-4 px-4">Sync Status</th>
                                        <th className="py-4 px-4">Notes</th>
                                        <th className="py-4 px-5 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/40">
                                    {history.slice(0, visibleCount).map((item) => {
                                        const instrument = INSTRUMENTS.find(i => i.id === item.instrumentId);
                                        const qty = item.lots * (item.instrumentId === 'custom' ? item.customLotSize : (instrument?.defaultLotSize || 1));
                                        const pnl = item.isLong 
                                            ? (item.exitPrice - item.entryPrice) * qty 
                                            : (item.entryPrice - item.exitPrice) * qty;
                                        const sync = getSyncStatus(item);

                                        return (
                                            <tr 
                                                key={item.id}
                                                onClick={() => loadCalculation(item)}
                                                className="hover:bg-slate-900/30 transition-colors group cursor-pointer text-xs"
                                            >
                                                <td className="py-3.5 px-5 font-mono text-slate-500 font-bold">
                                                    {new Date(item.timestamp).toLocaleDateString()}
                                                </td>
                                                <td className="py-3.5 px-4 font-black text-white">
                                                    {instrument?.name || 'Custom'}
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                                                        item.isLong 
                                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                                                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                                    }`}>
                                                        {item.isLong ? 'Long' : 'Short'}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-4 text-right font-mono text-slate-300">
                                                    ₹{item.entryPrice.toLocaleString()} → ₹{item.exitPrice.toLocaleString()}
                                                </td>
                                                <td className="py-3.5 px-4 text-center font-mono text-slate-400">
                                                    {item.lots} <span className="text-[9px] opacity-40">x{item.instrumentId === 'custom' ? item.customLotSize : (instrument?.defaultLotSize || 1)}</span>
                                                </td>
                                                <td className={`py-3.5 px-4 text-right font-mono font-black ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                    {formatCurrencySigned(pnl)}
                                                </td>
                                                <td className="py-3.5 px-4">
                                                    {sync ? (
                                                        sync.type === 'actual' ? (
                                                            <span className="flex items-center gap-1 font-bold text-emerald-400 w-full justify-between">
                                                                <span className="flex items-center gap-1">
                                                                    <CheckCircle size={11} className="shrink-0" />
                                                                    Logged ({formatCurrencySigned(sync.pnl || 0)})
                                                                </span>
                                                                <button 
                                                                    onClick={(e) => handleDeleteSyncedTrade(e, sync.id!)}
                                                                    className="text-rose-500 hover:text-rose-400 p-1 hover:bg-rose-500/10 rounded transition-all font-bold uppercase tracking-wider text-[8px]"
                                                                    title="Delete actual trade from journal"
                                                                >
                                                                    Delete Trade
                                                                </button>
                                                            </span>
                                                        ) : (
                                                            <span className="flex items-center gap-1 font-bold text-amber-400 w-full justify-between">
                                                                <span className="flex items-center gap-1">
                                                                    <AlertTriangle size={11} className="shrink-0" />
                                                                    Missed ({sync.reason})
                                                                </span>
                                                                <button 
                                                                    onClick={(e) => handleDeleteSyncedMissed(e, sync.id!)}
                                                                    className="text-rose-500 hover:text-rose-400 p-1 hover:bg-rose-500/10 rounded transition-all font-bold uppercase tracking-wider text-[8px]"
                                                                    title="Delete missed trade record"
                                                                >
                                                                    Delete Record
                                                                </button>
                                                            </span>
                                                        )
                                                    ) : (
                                                        <div className="flex items-center gap-1.5 onClick-propagation-guard" onClick={e => e.stopPropagation()}>
                                                            <button 
                                                                onClick={() => openLogActualModal(item)}
                                                                className="text-[9px] font-black uppercase tracking-wider text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20 transition-all"
                                                            >
                                                                Log Actual
                                                            </button>
                                                            <button 
                                                                onClick={() => openLogMissedModal(item)}
                                                                className="text-[9px] font-black uppercase tracking-wider text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 transition-all"
                                                            >
                                                                Log Missed
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-3.5 px-4 max-w-[120px] truncate text-slate-400 italic">
                                                    {item.note || '-'}
                                                </td>
                                                <td className="py-3.5 px-5 text-right onClick-propagation-guard" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button 
                                                            onClick={(e) => deleteHistoryItem(e, item.id)}
                                                            className="p-1.5 text-slate-700 hover:text-rose-500 hover:bg-rose-500/10 rounded-md transition-all"
                                                            title="Delete saved projection"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Observer Sentinel for Virtualization */}
                    {visibleCount < history.length && (
                        <div ref={observerRef} className="h-12 flex items-center justify-center text-xs text-slate-500 py-4 mt-4">
                            <span className="animate-pulse">Loading more projections...</span>
                        </div>
                    )}
                </div>
            )}

            </motion.div>

            {typeof window !== 'undefined' && createPortal(
                <AnimatePresence>
                    {isNoteModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsNoteModalOpen(false)}
                            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl shadow-black/50"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-emerald-500/10 rounded-xl">
                                        <StickyNote className="text-emerald-400" size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black text-white">Save Calculation Note</h3>
                                        <p className="text-xs text-slate-500">Document your market thesis or missed setup reason</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsNoteModalOpen(false)}
                                    aria-label="Close notes"
                                    className="p-2 hover:bg-slate-800 rounded-xl text-slate-500 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800">
                                    <div className="flex items-center justify-between mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                        <span>Calculation Data</span>
                                        <span className="text-indigo-400">{activeInstrument.name} • {isLong ? 'Long' : 'Short'}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs text-slate-300 font-mono">₹{entryPrice} → ₹{exitPrice}</div>
                                        <div className={`text-sm font-black font-mono ${(results?.totalPnL || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {formatCurrencySigned(results?.totalPnL || 0)}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Your Note / Reason</label>
                                    <textarea
                                        autoFocus
                                        value={currentNote}
                                        onChange={(e) => setCurrentNote(e.target.value)}
                                        placeholder="Reason for missing this, or any other notes..."
                                        className="w-full h-32 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-white text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/5 outline-none transition-all resize-none placeholder:text-slate-700"
                                    />
                                </div>

                                <button
                                    onClick={handleSaveNote}
                                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 group"
                                >
                                    <Save size={18} className="group-hover:scale-110 transition-transform" />
                                    Save to History
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}

                {logActualItem && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setLogActualItem(null)}
                            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl shadow-black/50 overflow-y-auto max-h-[90vh]"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-indigo-500/10 rounded-xl">
                                        <TrendingUp className="text-indigo-400" size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black text-white">Log Actual Trade</h3>
                                        <p className="text-xs text-slate-500 font-medium">Sync calculation to your trading journal</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setLogActualItem(null)}
                                    className="p-2 hover:bg-slate-800 rounded-xl text-slate-500 hover:text-slate-355 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Mode Toggle */}
                            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800/80 mb-4">
                                <button
                                    onClick={() => setLinkMode('new')}
                                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${linkMode === 'new' ? 'bg-indigo-500 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    Log as New Trade
                                </button>
                                <button
                                    onClick={() => setLinkMode('existing')}
                                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${linkMode === 'existing' ? 'bg-indigo-500 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                                >
                                    Link to Existing Trade
                                </button>
                            </div>

                            {linkMode === 'new' ? (
                                <div className="space-y-4">
                                    <div className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800/80">
                                        <div className="flex items-center justify-between mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                            <span>Projection Baseline</span>
                                            <span className={logActualItem.isLong ? 'text-emerald-400' : 'text-rose-400'}>
                                                {logActualItem.isLong ? 'Long' : 'Short'}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between font-mono">
                                            <div className="text-xs text-slate-300">
                                                ₹{logActualItem.entryPrice} → ₹{logActualItem.exitPrice}
                                            </div>
                                            <div className={`text-sm font-black ${
                                                ((logActualItem.isLong ? logActualItem.exitPrice - logActualItem.entryPrice : logActualItem.entryPrice - logActualItem.exitPrice) * actualQty) >= 0 
                                                    ? 'text-emerald-400' 
                                                    : 'text-rose-400'
                                            }`}>
                                                {formatCurrency(((logActualItem.isLong ? logActualItem.exitPrice - logActualItem.entryPrice : logActualItem.entryPrice - logActualItem.exitPrice) * actualQty))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Ticker / Asset</label>
                                            <input 
                                                type="text"
                                                value={actualTicker}
                                                onChange={e => setActualTicker(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-indigo-500/50 outline-none transition-all uppercase"
                                                placeholder="NIFTY"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Execution Date</label>
                                            <input 
                                                type="date"
                                                value={actualDate}
                                                onChange={e => setActualDate(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-indigo-500/50 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Total Qty</label>
                                            <input 
                                                type="number"
                                                value={actualQty}
                                                onChange={e => setActualQty(parseInt(e.target.value) || 0)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-indigo-500/50 outline-none transition-all"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Asset Class</label>
                                            <select 
                                                value={actualAssetClass}
                                                onChange={e => setActualAssetClass(e.target.value as any)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500/50 outline-none transition-all"
                                            >
                                                <option value="Equity">Equity</option>
                                                <option value="Options">Options</option>
                                                <option value="Futures">Futures</option>
                                                <option value="Crypto">Crypto</option>
                                                <option value="Forex">Forex</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Setup Configuration</label>
                                            <select 
                                                value={actualSetup}
                                                onChange={e => setActualSetup(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500/50 outline-none transition-all"
                                            >
                                                <option value="">Manual Calculation</option>
                                                {strategies.map(s => (
                                                    <option key={s.id} value={s.name}>{s.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Setup Grade</label>
                                            <select 
                                                value={actualGrade}
                                                onChange={e => setActualGrade(e.target.value as SetupGrade)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500/50 outline-none transition-all"
                                            >
                                                <option value="A+">Grade A+</option>
                                                <option value="A">Grade A</option>
                                                <option value="B">Grade B</option>
                                                <option value="C">Grade C</option>
                                                <option value="D">Grade D</option>
                                                <option value="F">Grade F</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Execution Notes</label>
                                        <textarea
                                            value={actualNotes}
                                            onChange={(e) => setActualNotes(e.target.value)}
                                            placeholder="Add execution details, mood indicators, slippages, etc."
                                            className="w-full h-24 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-white text-sm focus:border-indigo-500/50 outline-none transition-all resize-none placeholder:text-slate-700"
                                        />
                                    </div>

                                    <button
                                        onClick={handleLogActual}
                                        className="w-full py-4 bg-indigo-500 hover:bg-indigo-400 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 group text-xs"
                                    >
                                        <CheckCircle size={16} className="group-hover:scale-110 transition-transform" />
                                        Commit Trade to Journal
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 gap-3">
                                        <div className="space-y-1.5">
                                            <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Search Ticker Filter</label>
                                            <input 
                                                type="text"
                                                value={actualTicker}
                                                onChange={e => setActualTicker(e.target.value)}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-indigo-500/50 outline-none transition-all uppercase"
                                                placeholder="NIFTY"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Select Existing Trade ({matchingTrades.length} found)</label>
                                        {matchingTrades.length > 0 ? (
                                            <select
                                                value={selectedTradeId}
                                                onChange={e => setSelectedTradeId(Number(e.target.value) || '')}
                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:border-indigo-500/50 outline-none transition-all"
                                            >
                                                <option value="">-- Choose matching trade --</option>
                                                {matchingTrades.map(t => (
                                                    <option key={t.id} value={t.id}>
                                                        {t.date} • {t.direction} {t.ticker} • Entry: ₹{t.entryPrice} • Exit: ₹{t.exitPrice} (PnL: ₹{t.pnl})
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="p-4 bg-slate-950/30 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                                                No existing trades found matching ticker "{actualTicker}".
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Scenario Notes (Appended to Trade Notes)</label>
                                        <textarea
                                            value={actualNotes}
                                            onChange={(e) => setActualNotes(e.target.value)}
                                            placeholder="Describe what-if details, context, lessons, etc."
                                            className="w-full h-28 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-white text-sm focus:border-indigo-500/50 outline-none transition-all resize-none placeholder:text-slate-700"
                                        />
                                    </div>

                                    <button
                                        onClick={handleLinkToTrade}
                                        disabled={!selectedTradeId}
                                        className={`w-full py-4 font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 group text-xs ${
                                            selectedTradeId 
                                                ? 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-indigo-500/20' 
                                                : 'bg-slate-850 text-slate-500 border border-slate-800 cursor-not-allowed shadow-none'
                                        }`}
                                    >
                                        <Link2 size={16} className="group-hover:scale-110 transition-transform" />
                                        Link Scenario to Selected Trade
                                    </button>
                                </div>
                            )}
                        </motion.div>
                    </div>
                )}

                {logMissedItem && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setLogMissedItem(null)}
                            className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl shadow-black/50 overflow-y-auto max-h-[90vh]"
                        >
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-amber-500/10 rounded-xl">
                                        <AlertTriangle className="text-amber-500" size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black text-white">Log Missed Trade</h3>
                                        <p className="text-xs text-slate-500 font-medium">Record missed opportunity for psychological audit</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setLogMissedItem(null)}
                                    className="p-2 hover:bg-slate-800 rounded-xl text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Ticker / Asset</label>
                                        <input 
                                            type="text"
                                            value={missedTicker}
                                            onChange={e => setMissedTicker(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-amber-500/50 outline-none transition-all uppercase"
                                            placeholder="NIFTY"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Missed Date</label>
                                        <input 
                                            type="date"
                                            value={missedDate}
                                            onChange={e => setMissedDate(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-amber-500/50 outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                        <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Psychological Culprit</label>
                                        <select 
                                            value={missedReason}
                                            onChange={e => setMissedReason(e.target.value as MissedReason)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:border-amber-500/50 outline-none transition-all"
                                        >
                                            <option value="Hesitation">Hesitation / Analysis Paralysis</option>
                                            <option value="FOMO">FOMO / Late Entry Attempt</option>
                                            <option value="Distracted">Distracted / Away from Charts</option>
                                            <option value="Setup Invalidated Early">Setup Invalidated Early</option>
                                            <option value="Too Fast">Too Fast / Price Slipped</option>
                                            <option value="Other">Other Reason</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest">Setup Configuration</label>
                                        <input 
                                            type="text"
                                            value={missedSetup}
                                            onChange={e => setMissedSetup(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white text-sm focus:border-amber-500/50 outline-none transition-all"
                                            placeholder="e.g. Breakout, Pullback"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Post-Mortem Notes</label>
                                    <textarea
                                        value={missedNotes}
                                        onChange={(e) => setMissedNotes(e.target.value)}
                                        placeholder="Why did you miss this trade? What rule did you violate? Detail your emotions."
                                        className="w-full h-28 bg-slate-950 border border-slate-800 rounded-2xl p-4 text-white text-sm focus:border-amber-500/50 outline-none transition-all resize-none placeholder:text-slate-700"
                                    />
                                </div>

                                <button
                                    onClick={handleLogMissed}
                                    className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 group text-xs"
                                >
                                    <AlertTriangle size={16} className="group-hover:scale-110 transition-transform" />
                                    Record Missed Trade
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
};

