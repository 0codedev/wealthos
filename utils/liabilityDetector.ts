import { Transaction } from '../database';

export interface SubscriptionCandidate {
    merchant: string;
    amount: number;
    frequency: 'Monthly' | 'Yearly' | 'Weekly' | 'Irregular';
    riskLevel: 'High' | 'Medium' | 'Low';
    lastDate: string;
    nextExpectedDate: string;
    yearlyImpact: number;
}

export const findSubscriptionTraps = (transactions: Transaction[]): SubscriptionCandidate[] => {
    // 1. Filter for debits
    const debits = transactions.filter(t => t.type === 'debit' && !t.excluded);

    // 2. Group by Merchant/Description (Normalization is key)
    const groups: Record<string, Transaction[]> = {};

    debits.forEach(t => {
        // Normalize: "Netflix.com" -> "netflix"
        // "Spotify Premium" -> "spotify"
        const key = (t.merchant || t.description || 'Unknown').toLowerCase().trim();
        // Better heuristic: take first two words to avoid grouping "Amazon Prime" and "Amazon AWS"
        const cleanKey = key.split(/[\s*-]/).slice(0, 2).join('').replace(/[^a-z0-9]/g, '');

        if (!cleanKey) return;

        if (!groups[cleanKey]) groups[cleanKey] = [];
        groups[cleanKey].push(t);
    });

    const candidates: SubscriptionCandidate[] = [];

    // 3. Analyze each group
    Object.entries(groups).forEach(([_key, txns]) => {
        if (txns.length < 2) return; // Need at least 2 to form a pattern

        // Sort by date desc
        txns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const mostRecent = txns[0];
        if (!mostRecent) return;
        const amount = mostRecent.amount;

        // Check for consistent amounts (allow 5% variance for currency fluctuations)
        const isConsistentAmount = txns.every(t => Math.abs(t.amount - amount) < (amount * 0.05));

        if (!isConsistentAmount) return;

        // Check intervals
        const intervals: number[] = [];
        for (let i = 0; i < txns.length - 1; i++) {
            const tI = txns[i];
            const tNext = txns[i + 1];
            if (tI === undefined || tNext === undefined) continue;
            const d1 = new Date(tI.date).getTime();
            const d2 = new Date(tNext.date).getTime();
            const days = Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
            intervals.push(days);
        }

        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

        let frequency: 'Monthly' | 'Yearly' | 'Weekly' | 'Irregular' = 'Irregular';
        let risk: 'High' | 'Medium' | 'Low' = 'Low';

        if (Math.abs(avgInterval - 30) < 5) {
            frequency = 'Monthly';
            risk = 'High'; // Monthly recurs often unnoticed
        } else if (Math.abs(avgInterval - 365) < 10) {
            frequency = 'Yearly';
            risk = 'Medium';
        } else if (Math.abs(avgInterval - 7) < 2) {
            frequency = 'Weekly';
            risk = 'High';
        }

        if (frequency !== 'Irregular') {
            const nextDate = new Date(mostRecent.date);
            nextDate.setDate(nextDate.getDate() + avgInterval);

            candidates.push({
                merchant: mostRecent.merchant || mostRecent.description, // Use original name
                amount,
                frequency,
                riskLevel: risk,
                lastDate: mostRecent.date,
                nextExpectedDate: nextDate.toISOString(),
                yearlyImpact: frequency === 'Monthly' ? amount * 12 : frequency === 'Weekly' ? amount * 52 : amount
            });
        }
    });

    // Sort by Impact
    return candidates.sort((a, b) => b.yearlyImpact - a.yearlyImpact);
};
