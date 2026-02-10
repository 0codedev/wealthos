import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { db, Transaction } from '../database';
import { logger } from '../services/Logger';
export type { Transaction };

// ============================================================================
// TYPES
// ============================================================================



interface CategorySummary {
    category: string;
    amount: number;
    count: number;
}

interface ImportResult {
    added: number;
    updated: number;
    skipped: number;
    total: number;
}

interface TransactionContextType {
    transactions: Transaction[];
    totalSpending: number;
    spendingByCategory: CategorySummary[];
    addTransaction: (txn: Transaction) => void;
    updateTransaction: (id: string, updates: Partial<Transaction>) => void;
    deleteTransaction: (id: string) => void;
    parseAndAddFromFile: (content: string, fileType: 'csv' | 'text') => number;
    smartImport: (incoming: Transaction[]) => ImportResult;
    clearTransactions: () => void;
    lastImportResult: ImportResult | null;
}

// ============================================================================
// CONTEXT
// ============================================================================

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

// ============================================================================
// CATEGORY MAPPING
// ============================================================================

const PAYTM_EMOJI_TO_CATEGORY: Record<string, string> = {
    '🥘': 'Food & Dining',
    '🛒': 'Groceries',
    '🎈': 'Entertainment',
    '🛍': 'Shopping',
    '🚕': 'Transport',
    '🚖': 'Transport',
    '🧾': 'Bills & Utilities',
    '🪙': 'Investment',
    '💵': 'Transfer',
    '🔄': 'Miscellaneous',
};

const FOLD_CATEGORY_MAP: Record<string, string> = {
    'Food & Drinks': 'Food & Dining',
    'Investment': 'Investment',
    'Bill': 'Bills & Utilities',
    'Shopping': 'Shopping',
    'Transport': 'Transport',
    'Entertainment': 'Entertainment',
    'Self Transfer': 'Transfer',
    'Hidden Charges': 'Fees',
    'Interest': 'Income',
    'Earnings': 'Income',
    'Cashback': 'Income',
    'Lent': 'Lending',
};

// ============================================================================
// PARSING UTILITIES
// ============================================================================

function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());

    return result;
}

function detectFormat(headers: string[]): 'fold' | 'paytm' | 'unknown' {
    const headerStr = headers.join(',').toLowerCase();

    if (headerStr.includes('account_number') && headerStr.includes('txn_timestamp')) {
        return 'fold';
    }
    if (headerStr.includes('upi ref no') && headerStr.includes('transaction details')) {
        return 'paytm';
    }

    return 'unknown';
}

function extractUPIRefFromNarration(narration: string): string | undefined {
    // Extract 12-digit UPI reference from narration
    // Pattern: UPI/DR/532427277052/...
    const match = narration.match(/UPI\/(?:DR|CR)\/(\d{12,18})/);
    return match ? match[1] : undefined;
}

function parseFoldCSV(content: string): Transaction[] {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const transactions: Transaction[] = [];

    const idx = {
        timestamp: headers.indexOf('txn_timestamp'),
        amount: headers.indexOf('amount'),
        type: headers.indexOf('type'),
        merchant: headers.indexOf('merchant'),
        category: headers.indexOf('category'),
        bankName: headers.indexOf('bank_name'),
        narration: headers.indexOf('narration'),
        excluded: headers.indexOf('excluded_from_cash_flow'),
    };

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < 5) continue;

        const rawType = values[idx.type]?.toUpperCase();
        const rawCategory = values[idx.category] || 'Uncategorized';
        const narration = values[idx.narration] || '';

        const txn: Transaction = {
            id: crypto.randomUUID(),
            upiRef: extractUPIRefFromNarration(narration),
            date: values[idx.timestamp] || new Date().toISOString(),
            amount: Math.abs(parseFloat(values[idx.amount]) || 0),
            type: rawType === 'CREDIT' ? 'credit' : 'debit',
            merchant: values[idx.merchant] || undefined,
            category: FOLD_CATEGORY_MAP[rawCategory] || rawCategory,
            bankName: values[idx.bankName] || undefined,
            description: narration,
            excluded: values[idx.excluded]?.toLowerCase() === 'yes',
        };

        transactions.push(txn);
    }

    return transactions;
}

function parsePaytmCSV(content: string): Transaction[] {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const transactions: Transaction[] = [];

    const idx = {
        date: headers.findIndex(h => h.toLowerCase() === 'date'),
        time: headers.findIndex(h => h.toLowerCase() === 'time'),
        details: headers.findIndex(h => h.toLowerCase().includes('transaction details')),
        upiId: headers.findIndex(h => h.toLowerCase().includes('other transaction details')),
        account: headers.findIndex(h => h.toLowerCase().includes('your account')),
        amount: headers.findIndex(h => h.toLowerCase() === 'amount'),
        upiRef: headers.findIndex(h => h.toLowerCase().includes('upi ref')),
        tags: headers.findIndex(h => h.toLowerCase() === 'tags'),
    };

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < 5) continue;

        // Parse amount (handles comma in numbers like "1,050.00")
        let amountStr = values[idx.amount]?.replace(/[",]/g, '') || '0';
        const isCredit = amountStr.startsWith('+');
        amountStr = amountStr.replace(/[+-]/g, '');
        const amount = Math.abs(parseFloat(amountStr) || 0);

        // Parse date (DD/MM/YYYY) + time
        const dateStr = values[idx.date] || '';
        const timeStr = values[idx.time] || '00:00:00';
        const [day, month, year] = dateStr.split('/');
        const isoDate = year && month && day
            ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeStr}Z`
            : new Date().toISOString();

        // Parse tags (emoji format: #🥘 Food)
        const tagStr = values[idx.tags] || '';
        let category = 'Uncategorized';
        for (const [emoji, cat] of Object.entries(PAYTM_EMOJI_TO_CATEGORY)) {
            if (tagStr.includes(emoji)) {
                category = cat;
                break;
            }
        }

        const txn: Transaction = {
            id: crypto.randomUUID(),
            upiRef: values[idx.upiRef] || undefined,
            date: isoDate,
            amount,
            type: isCredit ? 'credit' : 'debit',
            merchant: undefined, // Paytm doesn't have separate merchant field
            category,
            bankName: values[idx.account]?.split(' - ')[0] || undefined,
            description: values[idx.details] || '',
            upiId: values[idx.upiId] || undefined,
        };

        transactions.push(txn);
    }

    return transactions;
}

function parseGenericCSV(content: string): Transaction[] {
    // Fallback parser for unknown formats
    // Tries to intelligently map common column names
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const transactions: Transaction[] = [];

    // Find columns by common names
    const dateIdx = headers.findIndex(h => h.includes('date') || h.includes('time'));
    const amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('value'));
    const descIdx = headers.findIndex(h => h.includes('description') || h.includes('narration') || h.includes('details'));
    const catIdx = headers.findIndex(h => h.includes('category') || h.includes('type'));
    const refIdx = headers.findIndex(h => h.includes('ref') || h.includes('id'));

    if (dateIdx === -1 || amountIdx === -1) {
        logger.warn('Generic parser: Missing required date/amount columns', undefined, 'TransactionContext');
        return [];
    }

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < 2) continue;

        const amountStr = values[amountIdx]?.replace(/[",₹$]/g, '') || '0';
        const amount = parseFloat(amountStr.replace(/[+-]/g, '')) || 0;
        const isCredit = amountStr.startsWith('+') || amountStr.includes('CR');

        const txn: Transaction = {
            id: crypto.randomUUID(),
            upiRef: refIdx !== -1 ? values[refIdx] : undefined,
            date: values[dateIdx] || new Date().toISOString(),
            amount: Math.abs(amount),
            type: isCredit ? 'credit' : 'debit',
            category: catIdx !== -1 ? values[catIdx] : 'Uncategorized',
            description: descIdx !== -1 ? values[descIdx] : 'Imported transaction',
        };

        transactions.push(txn);
    }

    return transactions;
}

// ============================================================================
// SMART MERGE ALGORITHM
// ============================================================================

export function generateMatchKey(txn: Transaction): string {
    // Primary: UPI Ref
    if (txn.upiRef) return `upi:${txn.upiRef}`;

    // Fallback 1: Date + Amount + Type (with safe date parsing guard against RangeError)
    let dateStr = 'unknown-date';
    if (txn.date) {
        const d = new Date(txn.date);
        if (Number.isFinite(d.getTime())) {
            dateStr = d.toISOString().split('T')[0];
        }
    }
    const amt = Number.isFinite(txn.amount) ? txn.amount.toFixed(2) : '0.00';
    return `fallback:${dateStr}:${amt}:${txn.type || 'DEBIT'}`;
}

function smartMerge(existing: Transaction[], incoming: Transaction[]): { merged: Transaction[], result: ImportResult } {
    const result: ImportResult = { added: 0, updated: 0, skipped: 0, total: incoming.length };
    const merged = [...existing];

    // Build lookup map with composite keys
    const existingMap = new Map<string, Transaction>();
    existing.forEach(txn => {
        existingMap.set(generateMatchKey(txn), txn);
    });

    for (const newTxn of incoming) {
        const key = generateMatchKey(newTxn);
        const existingTxn = existingMap.get(key);

        if (existingTxn) {
            // Transaction exists - check if we can fill missing data
            let wasUpdated = false;

            if (!existingTxn.category || existingTxn.category === 'Uncategorized') {
                if (newTxn.category && newTxn.category !== 'Uncategorized') {
                    existingTxn.category = newTxn.category;
                    wasUpdated = true;
                }
            }

            if (!existingTxn.merchant && newTxn.merchant) {
                existingTxn.merchant = newTxn.merchant;
                wasUpdated = true;
            }

            if ((!existingTxn.tags || existingTxn.tags.length === 0) && newTxn.tags?.length) {
                existingTxn.tags = newTxn.tags;
                wasUpdated = true;
            }

            if (!existingTxn.upiRef && newTxn.upiRef) {
                existingTxn.upiRef = newTxn.upiRef;
                wasUpdated = true;
            }

            if (wasUpdated) {
                result.updated++;
            } else {
                result.skipped++;
            }
        } else {
            // New transaction - add it
            merged.push(newTxn);
            existingMap.set(key, newTxn);
            result.added++;
        }
    }

    return { merged, result };
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

const STORAGE_KEY = 'wealth_aggregator_transactions';

export const TransactionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);

    // Load from Dexie on mount
    useEffect(() => {
        const load = async () => {
            try {
                const txns = await db.transactions.toArray();
                setTransactions(txns);
            } catch (e) {
                logger.error('Failed to load from DB', e, 'TransactionContext');
            }
        };
        load();
    }, []);

    // No localStorage effect anymore

    // Calculate spending by category
    const spendingByCategory = React.useMemo(() => {
        const categoryMap: Record<string, { amount: number; count: number }> = {};

        transactions.forEach(txn => {
            if (txn.type === 'debit' && !txn.excluded) {
                if (!categoryMap[txn.category]) {
                    categoryMap[txn.category] = { amount: 0, count: 0 };
                }
                categoryMap[txn.category].amount += txn.amount;
                categoryMap[txn.category].count++;
            }
        });

        return Object.entries(categoryMap)
            .map(([category, data]) => ({ category, ...data }))
            .sort((a, b) => b.amount - a.amount);
    }, [transactions]);

    // Calculate total spending
    const totalSpending = React.useMemo(() => {
        return transactions
            .filter(txn => txn.type === 'debit' && !txn.excluded)
            .reduce((sum, txn) => sum + txn.amount, 0);
    }, [transactions]);

    const addTransaction = useCallback((txn: Transaction) => {
        const newTxn = { ...txn, id: txn.id || crypto.randomUUID() };
        setTransactions(prev => [...prev, newTxn]);
        // Async persist
        db.transactions.add(newTxn).catch(e => logger.error('DB Add Error', e, 'TransactionContext'));
    }, []);

    const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
        setTransactions(prev => prev.map(txn =>
            txn.id === id ? { ...txn, ...updates } : txn
        ));
        // Async persist
        db.transactions.update(id, updates).catch(e => logger.error('DB Update Error', e, 'TransactionContext'));
    }, []);

    const deleteTransaction = useCallback((id: string) => {
        setTransactions(prev => prev.filter(txn => txn.id !== id));
        // Async persist
        db.transactions.delete(id).catch(e => logger.error('DB Delete Error', e, 'TransactionContext'));
    }, []);

    const smartImport = useCallback((incoming: Transaction[]): ImportResult => {
        const { merged, result } = smartMerge(transactions, incoming);
        setTransactions(merged);
        setLastImportResult(result);
        // Async persist
        db.transactions.bulkPut(merged).catch(e => logger.error('DB BulkPut Error', e, 'TransactionContext'));
        return result;
    }, [transactions]);

    const parseAndAddFromFile = useCallback((content: string, fileType: 'csv' | 'text'): number => {
        if (fileType !== 'csv') {
            logger.warn('Only CSV format is supported', undefined, 'TransactionContext');
            return 0;
        }

        try {
            const lines = content.split('\n').filter(line => line.trim());
            if (lines.length < 2) return 0;

            const headers = parseCSVLine(lines[0]);
            const format = detectFormat(headers);

            let parsed: Transaction[] = [];

            switch (format) {
                case 'fold':
                    parsed = parseFoldCSV(content);
                    break;
                case 'paytm':
                    parsed = parsePaytmCSV(content);
                    break;
                default:
                    logger.debug('Unknown format, using generic parser', undefined, 'TransactionContext');
                    parsed = parseGenericCSV(content);
            }

            if (parsed.length === 0) return 0;

            const result = smartImport(parsed);
            logger.info('Import complete', { added: result.added, updated: result.updated, skipped: result.skipped }, 'TransactionContext');

            return result.added + result.updated;
        } catch (e) {
            logger.error('Failed to parse and import transactions from file', e, 'TransactionContext');
            return 0;
        }
    }, [smartImport]);

    const clearTransactions = useCallback(() => {
        setTransactions([]);
        db.transactions.clear().catch(e => logger.error('DB Clear Error', e, 'TransactionContext'));
    }, []);

    const value: TransactionContextType = {
        transactions,
        totalSpending,
        spendingByCategory,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        parseAndAddFromFile,
        smartImport,
        clearTransactions,
        lastImportResult,
    };

    return (
        <TransactionContext.Provider value={value}>
            {children}
        </TransactionContext.Provider>
    );
};

// ============================================================================
// HOOK
// ============================================================================

export const useTransactions = (): TransactionContextType => {
    const context = useContext(TransactionContext);
    if (!context) {
        throw new Error('useTransactions must be used within a TransactionProvider');
    }
    return context;
};
