/**
 * AnomalyDetectionService - AI-powered detection of unusual portfolio changes
 * Covers: Fraud detection, unusual transactions, portfolio risk alerts
 */

import { Investment } from '../types';

// ==================== ANOMALY TYPES ====================

export type AnomalyType =
    | 'sudden_drop'           // Single asset dropped significantly
    | 'portfolio_crash'       // Overall portfolio down significantly
    | 'unusual_transaction'   // Transaction outside normal pattern
    | 'concentration_risk'    // Single asset > 25% of portfolio
    | 'correlation_break'     // Asset moving opposite to expected
    | 'volatility_spike'      // Unusual price swings
    | 'fraud_suspected'       // Potential unauthorized activity
    | 'dividend_missing'      // Expected dividend not received
    | 'sip_failure';          // SIP execution failed

export interface Anomaly {
    id: string;
    type: AnomalyType;
    severity: 'Low' | 'Medium' | 'High' | 'Critical';
    title: string;
    description: string;
    affectedAsset?: string;
    detectedAt: string;
    value?: number;
    expectedValue?: number;
    recommendation: string;
    dismissed: boolean;
}

// ==================== DETECTION THRESHOLDS ====================

const THRESHOLDS = {
    SINGLE_ASSET_DROP: 10,        // % drop to trigger alert
    PORTFOLIO_CRASH: 8,           // % portfolio drop
    CONCENTRATION_LIMIT: 25,      // Max % in single asset
    VOLATILITY_MULTIPLIER: 2.5,   // Times normal volatility
    UNUSUAL_TRANSACTION_MULTIPLIER: 3, // Times average transaction
};

// ==================== ANOMALY DETECTION FUNCTIONS ====================

/**
 * Detect sudden drops in individual assets
 */
export function detectSuddenDrops(
    investments: Investment[],
    previousValues: Record<string, number>
): Anomaly[] {
    const anomalies: Anomaly[] = [];

    investments.forEach(inv => {
        const prevValue = previousValues[inv.id!];
        if (!prevValue) return;

        const dropPercent = ((prevValue - inv.currentValue) / prevValue) * 100;

        if (dropPercent >= THRESHOLDS.SINGLE_ASSET_DROP) {
            anomalies.push({
                id: `drop-${inv.id}-${Date.now()}`,
                type: 'sudden_drop',
                severity: dropPercent >= 20 ? 'Critical' : dropPercent >= 15 ? 'High' : 'Medium',
                title: `${inv.name} dropped ${dropPercent.toFixed(1)}%`,
                description: `${inv.name} has fallen from ₹${prevValue.toLocaleString()} to ₹${inv.currentValue.toLocaleString()}`,
                affectedAsset: inv.name,
                detectedAt: new Date().toISOString(),
                value: inv.currentValue,
                expectedValue: prevValue,
                recommendation: dropPercent >= 20
                    ? 'Review your position and consider stop-loss if not already set'
                    : 'Monitor closely for further drops',
                dismissed: false
            });
        }
    });

    return anomalies;
}

/**
 * Detect concentration risk (too much in single asset)
 */
export function detectConcentrationRisk(investments: Investment[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const totalValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);

    if (totalValue === 0) return anomalies;

    investments.forEach(inv => {
        const percentage = (inv.currentValue / totalValue) * 100;

        if (percentage >= THRESHOLDS.CONCENTRATION_LIMIT) {
            anomalies.push({
                id: `concentration-${inv.id}-${Date.now()}`,
                type: 'concentration_risk',
                severity: percentage >= 50 ? 'Critical' : percentage >= 35 ? 'High' : 'Medium',
                title: `High concentration in ${inv.name}`,
                description: `${inv.name} represents ${percentage.toFixed(1)}% of your portfolio`,
                affectedAsset: inv.name,
                detectedAt: new Date().toISOString(),
                value: percentage,
                expectedValue: THRESHOLDS.CONCENTRATION_LIMIT,
                recommendation: 'Consider diversifying to reduce single-asset risk',
                dismissed: false
            });
        }
    });

    return anomalies;
}

/**
 * Detect portfolio crash (overall significant decline)
 */
export function detectPortfolioCrash(
    currentTotal: number,
    previousTotal: number
): Anomaly | null {
    if (previousTotal === 0) return null;

    const dropPercent = ((previousTotal - currentTotal) / previousTotal) * 100;

    if (dropPercent >= THRESHOLDS.PORTFOLIO_CRASH) {
        return {
            id: `crash-${Date.now()}`,
            type: 'portfolio_crash',
            severity: dropPercent >= 15 ? 'Critical' : dropPercent >= 10 ? 'High' : 'Medium',
            title: `Portfolio down ${dropPercent.toFixed(1)}%`,
            description: `Your portfolio has dropped from ₹${previousTotal.toLocaleString()} to ₹${currentTotal.toLocaleString()}`,
            detectedAt: new Date().toISOString(),
            value: currentTotal,
            expectedValue: previousTotal,
            recommendation: 'Market-wide decline detected. Stay calm and avoid panic selling.',
            dismissed: false
        };
    }

    return null;
}

/**
 * Detect unusual transaction patterns
 */
export function detectUnusualTransaction(
    amount: number,
    averageTransaction: number,
    type: 'BUY' | 'SELL'
): Anomaly | null {
    if (averageTransaction === 0) return null;

    const multiplier = amount / averageTransaction;

    if (multiplier >= THRESHOLDS.UNUSUAL_TRANSACTION_MULTIPLIER) {
        return {
            id: `unusual-${Date.now()}`,
            type: 'unusual_transaction',
            severity: multiplier >= 5 ? 'High' : 'Medium',
            title: `Unusually large ${type} transaction`,
            description: `Transaction of ₹${amount.toLocaleString()} is ${multiplier.toFixed(1)}x your average`,
            detectedAt: new Date().toISOString(),
            value: amount,
            expectedValue: averageTransaction,
            recommendation: 'Verify this transaction was authorized by you',
            dismissed: false
        };
    }

    return null;
}

/**
 * Run all anomaly detections
 */
export function runAnomalyDetection(
    investments: Investment[],
    previousValues: Record<string, number>,
    previousTotal: number
): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Check sudden drops
    anomalies.push(...detectSuddenDrops(investments, previousValues));

    // Check concentration risk
    anomalies.push(...detectConcentrationRisk(investments));

    // Check portfolio crash
    const currentTotal = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
    const crash = detectPortfolioCrash(currentTotal, previousTotal);
    if (crash) anomalies.push(crash);

    // Sort by severity
    const severityOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
    anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return anomalies;
}

// ==================== NEWS SENTIMENT ANALYSIS ====================

export interface NewsSentiment {
    headline: string;
    source: string;
    publishedAt: string;
    sentiment: 'Positive' | 'Negative' | 'Neutral';
    score: number; // -1 to 1
    affectedStocks: string[];
    summary: string;
    url?: string;
}

// Keywords for sentiment analysis
const POSITIVE_KEYWORDS = [
    'surge', 'rally', 'gain', 'profit', 'growth', 'upgrade', 'beat', 'record',
    'acquisition', 'expansion', 'dividend', 'buyback', 'bullish', 'outperform'
];

const NEGATIVE_KEYWORDS = [
    'fall', 'crash', 'loss', 'decline', 'downgrade', 'miss', 'fraud', 'scam',
    'investigation', 'lawsuit', 'default', 'bankruptcy', 'bearish', 'underperform'
];

/**
 * Analyze sentiment of news headline
 */
export function analyzeSentiment(headline: string): { sentiment: NewsSentiment['sentiment']; score: number } {
    const lower = headline.toLowerCase();

    let positiveCount = 0;
    let negativeCount = 0;

    POSITIVE_KEYWORDS.forEach(kw => {
        if (lower.includes(kw)) positiveCount++;
    });

    NEGATIVE_KEYWORDS.forEach(kw => {
        if (lower.includes(kw)) negativeCount++;
    });

    const total = positiveCount + negativeCount;
    if (total === 0) {
        return { sentiment: 'Neutral', score: 0 };
    }

    const score = (positiveCount - negativeCount) / total;

    if (score > 0.2) return { sentiment: 'Positive', score };
    if (score < -0.2) return { sentiment: 'Negative', score };
    return { sentiment: 'Neutral', score };
}

/**
 * Get mock news with sentiment for portfolio stocks
 */
export function getNewsSentiment(watchlist: string[]): NewsSentiment[] {
    // Mock news data - in production, fetch from news API
    const mockNews: NewsSentiment[] = [
        {
            headline: 'Reliance Industries announces major expansion in retail sector',
            source: 'Economic Times',
            publishedAt: new Date().toISOString(),
            sentiment: 'Positive',
            score: 0.7,
            affectedStocks: ['RELIANCE'],
            summary: 'RIL to invest ₹75,000 crore in new retail outlets across tier-2 cities'
        },
        {
            headline: 'TCS reports record quarterly profit, beats estimates',
            source: 'Moneycontrol',
            publishedAt: new Date().toISOString(),
            sentiment: 'Positive',
            score: 0.8,
            affectedStocks: ['TCS'],
            summary: 'Q3 profit up 12% YoY, announces ₹18 dividend per share'
        },
        {
            headline: 'Banking stocks fall as RBI maintains hawkish stance',
            source: 'LiveMint',
            publishedAt: new Date().toISOString(),
            sentiment: 'Negative',
            score: -0.5,
            affectedStocks: ['HDFCBANK', 'ICICIBANK', 'SBIN'],
            summary: 'Rate cuts unlikely in near term, NIMs may remain under pressure'
        },
        {
            headline: 'Infosys faces investigation over whistleblower complaint',
            source: 'Business Standard',
            publishedAt: new Date().toISOString(),
            sentiment: 'Negative',
            score: -0.7,
            affectedStocks: ['INFY'],
            summary: 'SEBI initiates preliminary inquiry into accounting practices'
        },
        {
            headline: 'ITC demerger plan receives board approval',
            source: 'CNBC TV18',
            publishedAt: new Date().toISOString(),
            sentiment: 'Positive',
            score: 0.6,
            affectedStocks: ['ITC'],
            summary: 'Hotels business to be listed separately, unlocking value for shareholders'
        }
    ];

    // Filter for user's watchlist
    return mockNews.filter(news =>
        news.affectedStocks.some(stock =>
            watchlist.some(w => w.toUpperCase().includes(stock))
        )
    );
}

/**
 * Get overall market sentiment
 */
export function getMarketSentiment(news: NewsSentiment[]): {
    overall: 'Bullish' | 'Bearish' | 'Neutral';
    score: number;
    positiveCount: number;
    negativeCount: number;
} {
    if (news.length === 0) {
        return { overall: 'Neutral', score: 0, positiveCount: 0, negativeCount: 0 };
    }

    const positiveCount = news.filter(n => n.sentiment === 'Positive').length;
    const negativeCount = news.filter(n => n.sentiment === 'Negative').length;
    const avgScore = news.reduce((sum, n) => sum + n.score, 0) / news.length;

    let overall: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
    if (avgScore > 0.3) overall = 'Bullish';
    else if (avgScore < -0.3) overall = 'Bearish';

    return { overall, score: avgScore, positiveCount, negativeCount };
}

export default {
    detectSuddenDrops,
    detectConcentrationRisk,
    detectPortfolioCrash,
    detectUnusualTransaction,
    runAnomalyDetection,
    analyzeSentiment,
    getNewsSentiment,
    getMarketSentiment,
    THRESHOLDS
};
