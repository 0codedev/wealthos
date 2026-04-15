import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Upload, FileText, CheckCircle2, AlertTriangle, X, Download, Eye,
    Loader2, Building2, Filter
} from 'lucide-react';
import { useVirtualScroll } from '../../hooks/useVirtualScroll';
import { formatCurrencyPrecise as formatCurrency, getISTDateString } from '../../utils/helpers';
import { usePortfolio } from '../../hooks/usePortfolio';

// ==================== TYPES ====================
export interface ParsedTrade {
    symbol: string;
    type: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    date: string;
    orderType?: string;
    exchange?: string;
    broker: string;
    orderNo?: string;
    status?: 'parsed' | 'error' | 'duplicate';
    errorMessage?: string;
}

interface BrokerCSVImportProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (trades: ParsedTrade[]) => void;
}

// ==================== BROKER PARSERS ====================

// RFC-compliant CSV line splitter that respects quoted strings with commas
export const splitCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim().replace(/^["']|["']$/g, ''));
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim().replace(/^["']|["']$/g, ''));
    return result;
};

// Safe numerical cleaner: strips currency symbols, commas, and guarantees finite non-negative numbers
export const cleanNumber = (val: string | number | undefined | null): number => {
    if (val === undefined || val === null) return 0;
    const cleaned = String(val).replace(/["',₹]/g, '').trim();
    const num = Number(cleaned);
    return Number.isFinite(num) && num > 0 ? num : 0;
};

// Safe quantity cleaner: ensures positive safe integer quantities without fractional roundings
export const cleanQuantity = (val: string | number | undefined | null): number => {
    const num = cleanNumber(val);
    return Number.isSafeInteger(Math.floor(num)) ? Math.floor(num) : 0;
};

// Zerodha Contract Note CSV Format
const parseZerodhaCSV = (csvContent: string): ParsedTrade[] => {
    const lines = csvContent.split('\n').filter(line => line.trim());
    const trades: ParsedTrade[] = [];

    // Skip header lines (Zerodha has multiple header rows)
    let dataStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('Trade No') || lines[i].includes('Symbol')) {
            dataStartIndex = i + 1;
            break;
        }
    }

    for (let i = dataStartIndex; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i]);

        if (cols.length < 6) continue;

        try {
            // Zerodha format: Trade No, Order No, Trade Time, Symbol, Side, Qty, Price, ...
            const symbol = cols[3] || cols[2]; // Symbol column
            const side = (cols[4] || cols[3] || '').toUpperCase();
            const qty = cleanQuantity(cols[5] || cols[4] || '0');
            const price = cleanNumber(cols[6] || cols[5] || '0');

            if (symbol && qty > 0 && price > 0) {
                trades.push({
                    symbol: symbol.replace('-EQ', '').replace('-BE', ''),
                    type: side.includes('BUY') || side === 'B' ? 'BUY' : 'SELL',
                    quantity: qty,
                    price: price,
                    date: cols[2] || getISTDateString(),
                    exchange: 'NSE',
                    broker: 'Zerodha',
                    orderNo: cols[1],
                    status: 'parsed'
                });
            }
        } catch (e) {
            console.warn('Failed to parse line:', lines[i]);
        }
    }

    return trades;
};

// Groww Trade History CSV Format
const parseGrowwCSV = (csvContent: string): ParsedTrade[] => {
    const lines = csvContent.split('\n').filter(line => line.trim());
    const trades: ParsedTrade[] = [];

    // Find header row
    let headerIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes('symbol') || lines[i].toLowerCase().includes('stock')) {
            headerIndex = i;
            break;
        }
    }

    const headers = splitCSVLine(lines[headerIndex] || '').map(h => h.trim().toLowerCase());
    const symbolIdx = headers.findIndex(h => h.includes('symbol') || h.includes('stock'));
    const typeIdx = headers.findIndex(h => h.includes('type') || h.includes('side') || h.includes('action'));
    const qtyIdx = headers.findIndex(h => h.includes('qty') || h.includes('quantity'));
    const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('rate'));
    const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('time'));

    for (let i = headerIndex + 1; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i]);

        try {
            const symbol = cols[symbolIdx] || '';
            const type = (cols[typeIdx] || '').toUpperCase();
            const qty = cleanQuantity(cols[qtyIdx] || '0');
            const price = cleanNumber(cols[priceIdx] || '0');
            const date = cols[dateIdx] || '';

            if (symbol && qty > 0 && price > 0) {
                trades.push({
                    symbol: symbol.replace(' Ltd.', '').replace(' Limited', ''),
                    type: type.includes('BUY') ? 'BUY' : 'SELL',
                    quantity: qty,
                    price: price,
                    date: date || getISTDateString(),
                    exchange: 'NSE',
                    broker: 'Groww',
                    status: 'parsed'
                });
            }
        } catch (e) {
            console.warn('Failed to parse Groww line:', lines[i]);
        }
    }

    return trades;
};

// Angel One / Angel Broking CSV
const parseAngelCSV = (csvContent: string): ParsedTrade[] => {
    const lines = csvContent.split('\n').filter(line => line.trim());
    const trades: ParsedTrade[] = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = splitCSVLine(lines[i]);

        if (cols.length < 5) continue;

        try {
            // Angel format varies, try common patterns
            let symbol = '', type = '', qty = 0, price = 0, date = '';

            for (let j = 0; j < cols.length; j++) {
                const col = cols[j];
                if (col.match(/^[A-Z]{2,}$/)) symbol = col;
                if (['BUY', 'SELL', 'B', 'S'].includes(col.toUpperCase())) type = col.toUpperCase();
                if (qty === 0 && !col.includes('.') && !col.includes('/') && !col.includes('-')) {
                    const parsedQty = cleanQuantity(col);
                    if (parsedQty > 0) qty = parsedQty;
                }
                if (col.includes('.') && price === 0) {
                    const parsedPrice = cleanNumber(col);
                    if (parsedPrice > 0) price = parsedPrice;
                }
                if (col.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/)) date = col;
            }

            if (symbol && qty > 0 && price > 0) {
                trades.push({
                    symbol: symbol,
                    type: type.includes('BUY') || type === 'B' ? 'BUY' : 'SELL',
                    quantity: qty,
                    price: price,
                    date: date || getISTDateString(),
                    exchange: 'NSE',
                    broker: 'Angel One',
                    status: 'parsed'
                });
            }
        } catch (e) {
            console.warn('Failed to parse Angel line:', lines[i]);
        }
    }

    return trades;
};

// Auto-detect broker and parse
const autoParseCSV = (content: string, filename: string): { trades: ParsedTrade[]; broker: string } => {
    const lowerContent = content.toLowerCase();
    const lowerFilename = filename.toLowerCase();

    if (lowerContent.includes('zerodha') || lowerFilename.includes('zerodha') || lowerFilename.includes('kite')) {
        return { trades: parseZerodhaCSV(content), broker: 'Zerodha' };
    }

    if (lowerContent.includes('groww') || lowerFilename.includes('groww')) {
        return { trades: parseGrowwCSV(content), broker: 'Groww' };
    }

    if (lowerContent.includes('angel') || lowerFilename.includes('angel')) {
        return { trades: parseAngelCSV(content), broker: 'Angel One' };
    }

    // Try all parsers and take the one with most results
    const zerodha = parseZerodhaCSV(content);
    const groww = parseGrowwCSV(content);
    const angel = parseAngelCSV(content);

    if (zerodha.length >= groww.length && zerodha.length >= angel.length) {
        return { trades: zerodha, broker: 'Auto-detected (Zerodha format)' };
    } else if (groww.length >= angel.length) {
        return { trades: groww, broker: 'Auto-detected (Groww format)' };
    }
    return { trades: angel, broker: 'Auto-detected (Angel format)' };
};

// ==================== COMPONENT ====================
export const BrokerCSVImport: React.FC<BrokerCSVImportProps> = ({ isOpen, onClose, onImport }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [parsedTrades, setParsedTrades] = useState<ParsedTrade[]>([]);
    const [detectedBroker, setDetectedBroker] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [selectedTrades, setSelectedTrades] = useState<Set<number>>(new Set());

    const { containerRef, onScroll, visibleItems, totalHeight, offsetY, startIndex } = useVirtualScroll({
        itemHeight: 50,
        itemsCount: parsedTrades.length,
        containerHeight: 400
    });

    const { investments } = usePortfolio();

    const checkDuplicateTrades = useCallback((trades: ParsedTrade[]): ParsedTrade[] => {
        // Create a fast lookup set of existing assignments: Symbol-Date-Qty
        // Note: Real-world duplicate checking might need more fuzziness, but this catches exact double-imports
        const existingSet = new Set(
            investments.map(inv => {
                // Approximate matching: Name should contain Symbol, and quantity should match
                // Since 'investments' aggregates current holdings, this is tricky for 'trades' history.
                // ideally we check against 'db.investments' for holdings, or 'db.trades' if we were importing into a trade log.
                // Assuming this imports into 'Investments' (Portfolio holdings), we check if we already hold this.
                // A better duplicate check for *Holdings* import is:
                // If we already have "HDFC Bank" and we import "HDFC Bank", warn the user.
                return `${inv.name.toUpperCase()}-${inv.quantity || 0}`;
            })
        );

        return trades.map(t => {
            // Check if we already hold this exact quantity of this symbol
            const key = `${t.symbol.toUpperCase()}-${t.quantity}`;
            if (existingSet.has(key)) {
                return { ...t, status: 'duplicate', errorMessage: 'Possible duplicate holding' };
            }
            return t;
        });
    }, [investments]);

    const handleFile = useCallback(async (file: File) => {
        setIsProcessing(true);
        setError('');

        try {
            const content = await file.text();
            let { trades, broker } = autoParseCSV(content, file.name);

            if (trades.length === 0) {
                setError('No valid trades found in the CSV. Please check the file format.');
            } else {
                // Run Duplicate Check
                trades = checkDuplicateTrades(trades);

                setParsedTrades(trades);
                setDetectedBroker(broker);
                // Select only non-duplicates by default
                setSelectedTrades(new Set(trades.map((t, i) => t.status !== 'duplicate' ? i : -1).filter(i => i !== -1)));
            }
        } catch (e) {
            setError('Failed to parse CSV file. Please ensure it\'s a valid trade history file.');
        } finally {
            setIsProcessing(false);
        }
    }, [checkDuplicateTrades]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
            handleFile(file);
        } else {
            setError('Please upload a CSV file');
        }
    }, [handleFile]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    const toggleTradeSelection = (index: number) => {
        const newSelected = new Set(selectedTrades);
        if (newSelected.has(index)) {
            newSelected.delete(index);
        } else {
            newSelected.add(index);
        }
        setSelectedTrades(newSelected);
    };

    const handleImport = () => {
        const tradesToImport = parsedTrades.filter((_, i) => selectedTrades.has(i));
        onImport(tradesToImport);
        onClose();
    };



    if (!isOpen) return null;
    if (typeof window === 'undefined') return null;

    return createPortal(
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-slate-800">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                                <Upload size={20} className="text-white" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Import Trades from Broker</h3>
                                <p className="text-xs text-slate-500">Supports Zerodha, Groww, Angel One CSV exports</p>
                            </div>
                        </div>
                        <button onClick={onClose} aria-label="Close CSV import" className="text-slate-400 hover:text-white p-2">
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
                        {/* Drop Zone */}
                        {parsedTrades.length === 0 && (
                            <div
                                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all ${isDragging
                                    ? 'border-emerald-500 bg-emerald-500/10'
                                    : 'border-slate-700 hover:border-slate-600'
                                    }`}
                            >
                                {isProcessing ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <Loader2 size={48} className="animate-spin text-emerald-500" />
                                        <p className="text-slate-400">Processing CSV file...</p>
                                    </div>
                                ) : (
                                    <>
                                        <FileText size={48} className="mx-auto text-slate-600 mb-4" />
                                        <p className="text-slate-400 mb-2">Drag and drop your broker CSV file here</p>
                                        <p className="text-slate-500 text-sm mb-4">or</p>
                                        <label className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500/20 text-emerald-400 rounded-xl cursor-pointer hover:bg-emerald-500/30 transition-colors font-semibold">
                                            <Upload size={18} />
                                            Browse Files
                                            <input
                                                type="file"
                                                accept=".csv"
                                                onChange={handleFileInput}
                                                className="hidden"
                                            />
                                        </label>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div className="mt-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-3">
                                <AlertTriangle className="text-rose-500" size={20} />
                                <p className="text-rose-400 text-sm">{error}</p>
                            </div>
                        )}

                        {/* Parsed Results */}
                        {parsedTrades.length > 0 && (
                            <div className="space-y-4">
                                {/* Summary */}
                                <div className="flex items-center justify-between p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                                    <div className="flex items-center gap-3">
                                        <CheckCircle2 className="text-emerald-500" size={24} />
                                        <div>
                                            <p className="text-emerald-400 font-bold">{parsedTrades.length} trades found</p>
                                            <p className="text-slate-400 text-sm">Broker: {detectedBroker}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs text-slate-500 uppercase">Selected</p>
                                        <p className="text-lg font-bold text-white">{selectedTrades.size} / {parsedTrades.length}</p>
                                    </div>
                                </div>

                                {/* Trades Table */}
                                <div
                                    className="bg-slate-800/50 rounded-xl border border-slate-700 h-[400px] overflow-y-auto overflow-x-auto table-scroll relative"
                                    ref={containerRef}
                                    onScroll={onScroll}
                                >
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-800/80 sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="p-3 text-left text-slate-500 font-bold uppercase text-xs">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedTrades.size === parsedTrades.length}
                                                        onChange={() => {
                                                            if (selectedTrades.size === parsedTrades.length) {
                                                                setSelectedTrades(new Set());
                                                            } else {
                                                                setSelectedTrades(new Set(parsedTrades.map((_, i) => i)));
                                                            }
                                                        }}
                                                        className="accent-emerald-500"
                                                    />
                                                </th>
                                                <th className="p-3 text-left text-slate-500 font-bold uppercase text-xs">Symbol</th>
                                                <th className="p-3 text-left text-slate-500 font-bold uppercase text-xs">Type</th>
                                                <th className="p-3 text-right text-slate-500 font-bold uppercase text-xs">Qty</th>
                                                <th className="p-3 text-right text-slate-500 font-bold uppercase text-xs">Price</th>
                                                <th className="p-3 text-right text-slate-500 font-bold uppercase text-xs">Value</th>
                                                <th className="p-3 text-left text-slate-500 font-bold uppercase text-xs">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {offsetY > 0 && <tr style={{ height: offsetY }}></tr>}
                                            {visibleItems.map((index) => {
                                                const trade = parsedTrades[index];
                                                if (!trade) return null;
                                                return (
                                                    <tr
                                                        key={index}
                                                        className={`border-t border-slate-700/50 hover:bg-slate-800/50 cursor-pointer ${selectedTrades.has(index) ? '' : 'opacity-50'
                                                            }`}
                                                        onClick={() => toggleTradeSelection(index)}
                                                    >
                                                        <td className="p-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedTrades.has(index)}
                                                                onChange={() => toggleTradeSelection(index)}
                                                                className="accent-emerald-500"
                                                            />
                                                        </td>
                                                        <td className="p-3 font-mono font-bold text-white">{trade.symbol}</td>
                                                        <td className="p-3">
                                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${trade.type === 'BUY'
                                                                ? 'bg-emerald-500/20 text-emerald-400'
                                                                : 'bg-rose-500/20 text-rose-400'
                                                                }`}>
                                                                {trade.type}
                                                            </span>
                                                        </td>
                                                        <td className="p-3 text-right font-mono text-slate-300">{trade.quantity}</td>
                                                        <td className="p-3 text-right font-mono text-slate-300">{formatCurrency(trade.price)}</td>
                                                        <td className="p-3 text-right font-mono font-bold text-white">{formatCurrency(trade.quantity * trade.price)}</td>
                                                        <td className="p-3 text-slate-400">{trade.date}</td>
                                                    </tr>
                                                );
                                            })}
                                            {totalHeight - offsetY - (visibleItems.length * 50) > 0 && (
                                                <tr style={{ height: totalHeight - offsetY - (visibleItems.length * 50) }}></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {parsedTrades.length > 0 && (
                        <div className="flex items-center justify-between p-6 border-t border-slate-800 bg-slate-900/50">
                            <button
                                onClick={() => { setParsedTrades([]); setError(''); }}
                                className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                            >
                                Upload Different File
                            </button>
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={handleImport}
                                disabled={selectedTrades.size === 0}
                                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                            >
                                <CheckCircle2 size={18} />
                                Import {selectedTrades.size} Trades
                            </motion.button>
                        </div>
                    )}
                </motion.div>
            </motion.div>
        </AnimatePresence>,
        document.body
    );
};

export default BrokerCSVImport;
