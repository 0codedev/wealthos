/**
 * IPOAnalyticsService - Historical IPO data, refund tracking, mandate expiry
 * TaxComputationService - Capital gains, ITR statements, Form 26AS
 */

// ==================== IPO HISTORICAL DATABASE ====================

export interface HistoricalIPO {
    name: string;
    listingDate: string;
    issuePrice: number;
    listingPrice: number;
    listingGain: number;
    currentPrice: number;
    currentGain: number;
    category: 'Mainboard' | 'SME';
    subscriptionRetail: number;
    subscriptionHNI: number;
    subscriptionQIB: number;
    gmpAtListing: number;
}

export const HISTORICAL_IPOS: HistoricalIPO[] = [
    { name: 'Zomato', listingDate: '2021-07-23', issuePrice: 76, listingPrice: 116, listingGain: 52.6, currentPrice: 185, currentGain: 143.4, category: 'Mainboard', subscriptionRetail: 7.5, subscriptionHNI: 12.5, subscriptionQIB: 51.8, gmpAtListing: 25 },
    { name: 'Nykaa', listingDate: '2021-11-10', issuePrice: 1125, listingPrice: 2001, listingGain: 77.9, currentPrice: 185, currentGain: -83.6, category: 'Mainboard', subscriptionRetail: 12.2, subscriptionHNI: 112.0, subscriptionQIB: 91.2, gmpAtListing: 700 },
    { name: 'Paytm', listingDate: '2021-11-18', issuePrice: 2150, listingPrice: 1950, listingGain: -9.3, currentPrice: 850, currentGain: -60.5, category: 'Mainboard', subscriptionRetail: 1.7, subscriptionHNI: 2.8, subscriptionQIB: 2.8, gmpAtListing: -20 },
    { name: 'LIC', listingDate: '2022-05-17', issuePrice: 949, listingPrice: 872, listingGain: -8.1, currentPrice: 920, currentGain: -3.1, category: 'Mainboard', subscriptionRetail: 1.99, subscriptionHNI: 2.91, subscriptionQIB: 2.83, gmpAtListing: -25 },
    { name: 'Adani Wilmar', listingDate: '2022-02-08', issuePrice: 230, listingPrice: 221, listingGain: -3.9, currentPrice: 350, currentGain: 52.2, category: 'Mainboard', subscriptionRetail: 3.92, subscriptionHNI: 5.34, subscriptionQIB: 6.64, gmpAtListing: -10 },
    { name: 'Delhivery', listingDate: '2022-05-24', issuePrice: 487, listingPrice: 493, listingGain: 1.2, currentPrice: 420, currentGain: -13.8, category: 'Mainboard', subscriptionRetail: 1.06, subscriptionHNI: 1.26, subscriptionQIB: 3.29, gmpAtListing: 5 },
    { name: 'Tata Technologies', listingDate: '2023-11-30', issuePrice: 500, listingPrice: 1200, listingGain: 140.0, currentPrice: 1050, currentGain: 110.0, category: 'Mainboard', subscriptionRetail: 62.5, subscriptionHNI: 206.5, subscriptionQIB: 75.8, gmpAtListing: 550 },
    { name: 'IREDA', listingDate: '2023-11-29', issuePrice: 32, listingPrice: 50, listingGain: 56.3, currentPrice: 185, currentGain: 478.1, category: 'Mainboard', subscriptionRetail: 7.97, subscriptionHNI: 10.23, subscriptionQIB: 57.39, gmpAtListing: 15 },
];

export function getIPOPerformanceStats(): {
    averageListingGain: number;
    positiveListings: number;
    negativeListings: number;
    bestIPO: HistoricalIPO;
    worstIPO: HistoricalIPO;
    averageRetailSubscription: number;
} {
    const positive = HISTORICAL_IPOS.filter(i => i.listingGain > 0).length;
    const sorted = [...HISTORICAL_IPOS].sort((a, b) => b.listingGain - a.listingGain);

    return {
        averageListingGain: HISTORICAL_IPOS.reduce((sum, i) => sum + i.listingGain, 0) / HISTORICAL_IPOS.length,
        positiveListings: positive,
        negativeListings: HISTORICAL_IPOS.length - positive,
        bestIPO: sorted[0],
        worstIPO: sorted[sorted.length - 1],
        averageRetailSubscription: HISTORICAL_IPOS.reduce((sum, i) => sum + i.subscriptionRetail, 0) / HISTORICAL_IPOS.length
    };
}

// ==================== MANDATE EXPIRY TRACKING ====================

export interface IPOMandate {
    bankName: string;
    upiId: string;
    ipoName: string;
    amount: number;
    mandateDate: string;
    expiryDate: string;
    status: 'Active' | 'Expired' | 'Executed' | 'Cancelled';
    daysToExpiry: number;
}

export function checkMandateExpiry(mandates: Omit<IPOMandate, 'daysToExpiry' | 'status'>[]): IPOMandate[] {
    const now = new Date();

    return mandates.map(m => {
        const expiry = new Date(m.expiryDate);
        const daysToExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        let status: IPOMandate['status'] = 'Active';
        if (daysToExpiry < 0) status = 'Expired';
        else if (daysToExpiry === 0) status = 'Active'; // Last day

        return { ...m, daysToExpiry, status };
    });
}

// ==================== REFUND TRACKING ====================

export interface RefundTracker {
    ipoName: string;
    appliedAmount: number;
    allottedShares: number;
    allottedAmount: number;
    refundAmount: number;
    refundStatus: 'Pending' | 'Initiated' | 'Credited';
    refundDate?: string;
    upiHandle: string;
    expectedCreditDate: string;
}

export function calculateExpectedRefund(
    appliedAmount: number,
    lotSize: number,
    issuePrice: number,
    allottedLots: number
): { refundAmount: number; allottedAmount: number } {
    const allottedAmount = allottedLots * lotSize * issuePrice;
    const refundAmount = appliedAmount - allottedAmount;
    return { refundAmount, allottedAmount };
}

// ==================== CAPITAL GAINS COMPUTATION ====================

export interface CapitalGainEntry {
    asset: string;
    assetType: 'Equity' | 'MutualFund' | 'Debt' | 'Gold' | 'RealEstate';
    buyDate: string;
    sellDate: string;
    buyPrice: number;
    sellPrice: number;
    quantity: number;
    holdingPeriod: number;
    gainType: 'STCG' | 'LTCG';
    grossGain: number;
    indexedCost?: number;
    taxableGain: number;
    taxRate: number;
    taxAmount: number;
}

// Cost Inflation Index (CII)
const CII: Record<string, number> = {
    '2001-02': 100, '2002-03': 105, '2003-04': 109, '2004-05': 113,
    '2005-06': 117, '2006-07': 122, '2007-08': 129, '2008-09': 137,
    '2009-10': 148, '2010-11': 167, '2011-12': 184, '2012-13': 200,
    '2013-14': 220, '2014-15': 240, '2015-16': 254, '2016-17': 264,
    '2017-18': 272, '2018-19': 280, '2019-20': 289, '2020-21': 301,
    '2021-22': 317, '2022-23': 331, '2023-24': 348, '2024-25': 363,
};

function getFY(date: Date): string {
    const month = date.getMonth();
    const year = date.getFullYear();
    if (month < 3) { // Jan-Mar
        return `${year - 1}-${String(year).slice(2)}`;
    }
    return `${year}-${String(year + 1).slice(2)}`;
}

export function calculateCapitalGains(
    asset: string,
    assetType: CapitalGainEntry['assetType'],
    buyDate: string,
    sellDate: string,
    buyPrice: number,
    sellPrice: number,
    quantity: number = 1
): CapitalGainEntry {
    const buy = new Date(buyDate);
    const sell = new Date(sellDate);
    const holdingDays = Math.ceil((sell.getTime() - buy.getTime()) / (1000 * 60 * 60 * 24));

    // Determine LTCG threshold based on asset type
    const ltcgThreshold: Record<string, number> = {
        'Equity': 365,
        'MutualFund': 365, // Equity MF
        'Debt': 1095, // 3 years
        'Gold': 1095,
        'RealEstate': 730, // 2 years
    };

    const isLTCG = holdingDays >= ltcgThreshold[assetType];
    const grossGain = (sellPrice - buyPrice) * quantity;

    // Indexation for debt, gold, real estate
    let indexedCost: number | undefined;
    let taxableGain = grossGain;

    if (isLTCG && ['Debt', 'Gold', 'RealEstate'].includes(assetType)) {
        const buyFY = getFY(buy);
        const sellFY = getFY(sell);
        if (CII[buyFY] && CII[sellFY]) {
            indexedCost = (buyPrice * quantity * CII[sellFY]) / CII[buyFY];
            taxableGain = (sellPrice * quantity) - indexedCost;
        }
    }

    // LTCG exemption for equity (₹1L per year)
    if (isLTCG && assetType === 'Equity') {
        taxableGain = Math.max(0, grossGain - 100000);
    }

    // Tax rates
    const taxRates: Record<string, { stcg: number; ltcg: number }> = {
        'Equity': { stcg: 15, ltcg: 10 },
        'MutualFund': { stcg: 15, ltcg: 10 },
        'Debt': { stcg: 30, ltcg: 20 }, // As per slab for new rules
        'Gold': { stcg: 30, ltcg: 20 },
        'RealEstate': { stcg: 30, ltcg: 20 },
    };

    const taxRate = isLTCG ? taxRates[assetType].ltcg : taxRates[assetType].stcg;
    const taxAmount = Math.max(0, taxableGain * taxRate / 100);

    return {
        asset,
        assetType,
        buyDate,
        sellDate,
        buyPrice,
        sellPrice,
        quantity,
        holdingPeriod: holdingDays,
        gainType: isLTCG ? 'LTCG' : 'STCG',
        grossGain,
        indexedCost,
        taxableGain,
        taxRate,
        taxAmount
    };
}

// ==================== ITR STATEMENT GENERATOR ====================

export interface ITRScheduleCG {
    fy: string;
    stcgEntries: CapitalGainEntry[];
    ltcgEntries: CapitalGainEntry[];
    totalSTCG: number;
    totalLTCG: number;
    stcgTax: number;
    ltcgTax: number;
    totalTax: number;
}

export function generateScheduleCG(
    entries: CapitalGainEntry[],
    fy: string
): ITRScheduleCG {
    const stcgEntries = entries.filter(e => e.gainType === 'STCG');
    const ltcgEntries = entries.filter(e => e.gainType === 'LTCG');

    const totalSTCG = stcgEntries.reduce((sum, e) => sum + e.taxableGain, 0);
    const totalLTCG = ltcgEntries.reduce((sum, e) => sum + e.taxableGain, 0);
    const stcgTax = stcgEntries.reduce((sum, e) => sum + e.taxAmount, 0);
    const ltcgTax = ltcgEntries.reduce((sum, e) => sum + e.taxAmount, 0);

    return {
        fy,
        stcgEntries,
        ltcgEntries,
        totalSTCG,
        totalLTCG,
        stcgTax,
        ltcgTax,
        totalTax: stcgTax + ltcgTax
    };
}

export function generateITRHTML(schedule: ITRScheduleCG): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Schedule CG - Capital Gains Statement FY ${schedule.fy}</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 40px; max-width: 900px; margin: 0 auto; }
        h1 { color: #1e40af; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; }
        th { background: #f3f4f6; }
        .section { margin: 30px 0; }
        .summary { background: #f0fdf4; padding: 20px; border-radius: 8px; }
        .total { font-weight: bold; background: #dbeafe; }
    </style>
</head>
<body>
    <h1>Schedule CG - Capital Gains Statement</h1>
    <p>Financial Year: ${schedule.fy}</p>
    
    <div class="section">
        <h2>Short-Term Capital Gains (STCG)</h2>
        <table>
            <thead>
                <tr>
                    <th>Asset</th>
                    <th>Buy Date</th>
                    <th>Sell Date</th>
                    <th>Gain</th>
                    <th>Tax @${schedule.stcgEntries[0]?.taxRate || 15}%</th>
                </tr>
            </thead>
            <tbody>
                ${schedule.stcgEntries.map(e => `
                    <tr>
                        <td>${e.asset}</td>
                        <td>${e.buyDate}</td>
                        <td>${e.sellDate}</td>
                        <td>₹${e.taxableGain.toLocaleString()}</td>
                        <td>₹${e.taxAmount.toLocaleString()}</td>
                    </tr>
                `).join('')}
                <tr class="total">
                    <td colspan="3">Total STCG</td>
                    <td>₹${schedule.totalSTCG.toLocaleString()}</td>
                    <td>₹${schedule.stcgTax.toLocaleString()}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="section">
        <h2>Long-Term Capital Gains (LTCG)</h2>
        <table>
            <thead>
                <tr>
                    <th>Asset</th>
                    <th>Buy Date</th>
                    <th>Sell Date</th>
                    <th>Indexed Cost</th>
                    <th>Gain</th>
                    <th>Tax</th>
                </tr>
            </thead>
            <tbody>
                ${schedule.ltcgEntries.map(e => `
                    <tr>
                        <td>${e.asset}</td>
                        <td>${e.buyDate}</td>
                        <td>${e.sellDate}</td>
                        <td>₹${(e.indexedCost || e.buyPrice * e.quantity).toLocaleString()}</td>
                        <td>₹${e.taxableGain.toLocaleString()}</td>
                        <td>₹${e.taxAmount.toLocaleString()}</td>
                    </tr>
                `).join('')}
                <tr class="total">
                    <td colspan="4">Total LTCG</td>
                    <td>₹${schedule.totalLTCG.toLocaleString()}</td>
                    <td>₹${schedule.ltcgTax.toLocaleString()}</td>
                </tr>
            </tbody>
        </table>
    </div>

    <div class="summary">
        <h2>Tax Summary</h2>
        <p><strong>Total Capital Gains Tax Payable:</strong> ₹${schedule.totalTax.toLocaleString()}</p>
    </div>
    
    <p style="color: #6b7280; font-size: 12px; margin-top: 40px;">
        Generated by Wealth Aggregator • This is a helper document, verify with your CA before filing.
    </p>
</body>
</html>
    `;
}

// ==================== TDS CREDIT TRACKER ====================

export interface TDSCredit {
    deductor: string;
    tan: string;
    section: string;
    transactionDate: string;
    amount: number;
    tdsDeducted: number;
    status: 'Claimed' | 'Pending' | 'Matched';
}

export function getTDSCredits(): TDSCredit[] {
    // Mock data - in production, fetch from Form 26AS
    return [
        { deductor: 'HDFC Bank Ltd', tan: 'MUMH12345A', section: '194A', transactionDate: '2024-06-15', amount: 50000, tdsDeducted: 5000, status: 'Matched' },
        { deductor: 'Zerodha Broking', tan: 'BLRZ67890B', section: '194H', transactionDate: '2024-09-20', amount: 15000, tdsDeducted: 750, status: 'Matched' },
        { deductor: 'Employer Co', tan: 'DELC11111C', section: '192', transactionDate: '2024-03-31', amount: 800000, tdsDeducted: 45000, status: 'Pending' },
    ];
}

export default {
    HISTORICAL_IPOS,
    getIPOPerformanceStats,
    checkMandateExpiry,
    calculateExpectedRefund,
    calculateCapitalGains,
    generateScheduleCG,
    generateITRHTML,
    getTDSCredits,
    CII
};
