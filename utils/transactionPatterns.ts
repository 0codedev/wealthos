/**
 * Transaction Pattern Detection Utilities
 */

import { Transaction } from '../contexts/TransactionContext';

export interface RecurringPattern {
    id: string; // Unique identifier
    merchant: string;
    amount: number;
    avgAmount?: number; // Average amount for display
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
    patternType?: 'SIP' | 'Subscription' | 'Bill' | 'Other'; // Type of recurring pattern
    lastDate: string;
    nextExpected: string;
    nextExpectedDate?: string; // Alias for nextExpected for widget compatibility
    count: number;
}

export interface AnomalyResult {
    transaction: Transaction;
    reason: string;
    severity: 'low' | 'medium' | 'high';
    deviation: number;
    avgAmount?: number;
}

/**
 * Helper to detect the type of recurring pattern
 */
function detectPatternType(merchant: string, _amount: number): 'SIP' | 'Subscription' | 'Bill' | 'Other' {
    const lowerMerchant = merchant.toLowerCase();

    // SIP patterns (investment-related)
    if (lowerMerchant.includes('sip') || lowerMerchant.includes('mutual') ||
        lowerMerchant.includes('zerodha') || lowerMerchant.includes('groww') ||
        lowerMerchant.includes('invest') || lowerMerchant.includes('coin')) {
        return 'SIP';
    }

    // Subscription patterns
    if (lowerMerchant.includes('netflix') || lowerMerchant.includes('spotify') ||
        lowerMerchant.includes('amazon prime') || lowerMerchant.includes('youtube') ||
        lowerMerchant.includes('hotstar') || lowerMerchant.includes('subscription')) {
        return 'Subscription';
    }

    // Bill patterns
    if (lowerMerchant.includes('electricity') || lowerMerchant.includes('water') ||
        lowerMerchant.includes('gas') || lowerMerchant.includes('internet') ||
        lowerMerchant.includes('mobile') || lowerMerchant.includes('bill')) {
        return 'Bill';
    }

    return 'Other';
}

/**
 * Detect recurring payment patterns from transactions
 */
export function detectRecurringPatterns(transactions: Transaction[]): RecurringPattern[] {
    const patterns: RecurringPattern[] = [];
    const merchantMap = new Map<string, Transaction[]>();

    // Group by merchant
    transactions.forEach(txn => {
        const key = txn.merchant || txn.description.substring(0, 20);
        if (!merchantMap.has(key)) {
            merchantMap.set(key, []);
        }
        merchantMap.get(key)!.push(txn);
    });

    // Find patterns
    merchantMap.forEach((txns, merchant) => {
        if (txns.length >= 2) {
            const amounts = txns.map(t => t.amount);
            const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
            const variance = amounts.reduce((a, b) => a + Math.pow(b - avgAmount, 2), 0) / amounts.length;

            // Low variance = likely recurring
            if (variance / avgAmount < 0.1) {
                const dates = txns.map(t => new Date(t.date).getTime()).sort();
                const intervals = [];
                for (let i = 1; i < dates.length; i++) {
                    const dI = dates[i];
                    const dPrev = dates[i - 1];
                    if (dI !== undefined && dPrev !== undefined) {
                        intervals.push((dI - dPrev) / (1000 * 60 * 60 * 24));
                    }
                }
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / (intervals.length || 1);

                let frequency: RecurringPattern['frequency'] = 'monthly';
                if (avgInterval < 2) frequency = 'daily';
                else if (avgInterval < 10) frequency = 'weekly';
                else if (avgInterval < 20) frequency = 'biweekly';
                else if (avgInterval < 45) frequency = 'monthly';
                else frequency = 'yearly';

                const lastDate = new Date(Math.max(...dates));
                const nextExpected = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);

                patterns.push({
                    id: `pattern_${merchant.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}`,
                    merchant,
                    amount: avgAmount,
                    avgAmount, // For widget display
                    frequency,
                    patternType: detectPatternType(merchant, avgAmount),
                    lastDate: lastDate.toISOString(),
                    nextExpected: nextExpected.toISOString(),
                    nextExpectedDate: nextExpected.toISOString(), // Alias for widget
                    count: txns.length
                });
            }
        }
    });

    return patterns.sort((a, b) => b.count - a.count).slice(0, 10);
}

/**
 * Detect spending anomalies
 */
export function detectAnomalies(transactions: Transaction[]): AnomalyResult[] {
    const anomalies: AnomalyResult[] = [];

    // Calculate category averages
    const categoryStats = new Map<string, { avg: number; stdDev: number }>();
    const categoryAmounts = new Map<string, number[]>();

    transactions.forEach(txn => {
        if (!categoryAmounts.has(txn.category)) {
            categoryAmounts.set(txn.category, []);
        }
        categoryAmounts.get(txn.category)!.push(txn.amount);
    });

    categoryAmounts.forEach((amounts, category) => {
        const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        const variance = amounts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / amounts.length;
        categoryStats.set(category, { avg, stdDev: Math.sqrt(variance) });
    });

    // Find anomalies (> 2 std devs from mean)
    transactions.forEach(txn => {
        const stats = categoryStats.get(txn.category);
        if (stats && stats.stdDev > 0) {
            const deviation = (txn.amount - stats.avg) / stats.stdDev;
            if (Math.abs(deviation) > 2) {
                anomalies.push({
                    transaction: txn,
                    reason: deviation > 0 ? 'Unusually high spending' : 'Unusually low spending',
                    severity: Math.abs(deviation) > 3 ? 'high' : 'medium',
                    deviation,
                    avgAmount: stats.avg
                });
            }
        }
    });

    return anomalies.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)).slice(0, 5);
}

export interface CategoryTrend {
    category: string;
    currentAmount: number;
    previousAmount: number;
    change: number;
    changePercent: number;
    trend: 'up' | 'down' | 'stable';
}

/**
 * Get spending trends by category comparing current month to previous month
 */
export function getCategoryTrends(transactions: Transaction[]): CategoryTrend[] {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const currentMonthTxns = transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'debit';
    });

    const prevMonthTxns = transactions.filter(t => {
        const d = new Date(t.date);
        return d.getMonth() === prevMonth && d.getFullYear() === prevYear && t.type === 'debit';
    });

    const currentByCategory = new Map<string, number>();
    const prevByCategory = new Map<string, number>();

    currentMonthTxns.forEach(t => {
        currentByCategory.set(t.category, (currentByCategory.get(t.category) || 0) + t.amount);
    });

    prevMonthTxns.forEach(t => {
        prevByCategory.set(t.category, (prevByCategory.get(t.category) || 0) + t.amount);
    });

    const allCategories = new Set([...currentByCategory.keys(), ...prevByCategory.keys()]);
    const trends: CategoryTrend[] = [];

    allCategories.forEach(category => {
        const current = currentByCategory.get(category) || 0;
        const previous = prevByCategory.get(category) || 0;
        const change = current - previous;
        const changePercent = previous > 0 ? (change / previous) * 100 : current > 0 ? 100 : 0;

        trends.push({
            category,
            currentAmount: current,
            previousAmount: previous,
            change,
            changePercent,
            trend: Math.abs(changePercent) < 5 ? 'stable' : change > 0 ? 'up' : 'down'
        });
    });

    return trends.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
}

export default {
    detectRecurringPatterns,
    detectAnomalies,
    getCategoryTrends
};
