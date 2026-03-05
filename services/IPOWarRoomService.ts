import { IPOApplication } from '../database';
import type { IPOListing } from './IPOCalendarService';

export interface IPOScoreFactor {
    label: string;
    impact: 'positive' | 'neutral' | 'negative';
    points: number;
    rationale: string;
}

export interface IPOTimelineMilestone {
    label: string;
    date?: string;
    status: 'done' | 'active' | 'upcoming' | 'missing';
}

export interface IPOApplicationSummary {
    blockedCapital: number;
    refundedCapital: number;
    listedPnL: number;
    activeApplications: number;
    allottedApplications: number;
}

export const scoreIPOBreakdown = (ipo: IPOListing): { score: number; factors: IPOScoreFactor[] } => {
    const factors: IPOScoreFactor[] = [];
    let score = 50;

    if ((ipo.gmp || 0) >= 40) {
        score += 15;
        factors.push({ label: 'GMP momentum', impact: 'positive', points: 15, rationale: 'Grey market premium is strong.' });
    } else if ((ipo.gmp || 0) > 0) {
        score += 6;
        factors.push({ label: 'GMP support', impact: 'positive', points: 6, rationale: 'Grey market premium is positive but not explosive.' });
    } else if ((ipo.gmp || 0) < 0) {
        score -= 12;
        factors.push({ label: 'Negative GMP', impact: 'negative', points: -12, rationale: 'Grey market demand is weak.' });
    }

    if ((ipo.subscriptionData?.qib || 0) >= 8) {
        score += 10;
        factors.push({ label: 'QIB demand', impact: 'positive', points: 10, rationale: 'Institutional demand is strong.' });
    }
    if ((ipo.subscriptionData?.retail || 0) >= 2) {
        score += 8;
        factors.push({ label: 'Retail demand', impact: 'positive', points: 8, rationale: 'Retail book is showing healthy participation.' });
    } else if (ipo.subscriptionData?.retail !== undefined && ipo.subscriptionData.retail < 1) {
        score -= 8;
        factors.push({ label: 'Retail demand', impact: 'negative', points: -8, rationale: 'Retail participation is weak.' });
    }

    if (ipo.issueSize >= 1500) {
        score += 5;
        factors.push({ label: 'Issue size', impact: 'positive', points: 5, rationale: 'Larger issue may provide stronger liquidity and discovery.' });
    }

    if (ipo.category === 'SME') {
        score -= 6;
        factors.push({ label: 'SME risk', impact: 'negative', points: -6, rationale: 'SME issues tend to carry more liquidity and execution risk.' });
    }

    if (ipo.rating === 'SUBSCRIBE') {
        score += 8;
        factors.push({ label: 'Street rating', impact: 'positive', points: 8, rationale: 'Street consensus leans favorable.' });
    } else if (ipo.rating === 'AVOID') {
        score -= 12;
        factors.push({ label: 'Street rating', impact: 'negative', points: -12, rationale: 'Street consensus leans cautious.' });
    }

    return {
        score: Math.max(0, Math.min(100, score)),
        factors,
    };
};

export const buildIPOTimeline = (ipo: IPOListing, today: Date = new Date()): IPOTimelineMilestone[] => {
    const now = today.getTime();
    const getStatus = (date?: string): IPOTimelineMilestone['status'] => {
        if (!date) return 'missing';
        const target = new Date(date).getTime();
        if (Number.isNaN(target)) return 'missing';
        if (Math.abs(target - now) < 1000 * 60 * 60 * 24) return 'active';
        return target < now ? 'done' : 'upcoming';
    };

    const openDate = ipo.issueOpenDate || ipo.timeline?.application_start_date;
    const closeDate = ipo.issueCloseDate || ipo.timeline?.application_end_date;
    const allotment = ipo.allotmentDate || ipo.timeline?.allotment_date || ipo.timeline?.allotment_start_date;
    const refund = ipo.refundDate || ipo.timeline?.refund_initiation_date;
    const listing = ipo.listingDate || ipo.timeline?.listing_date;

    return [
        { label: 'Open', date: openDate, status: getStatus(openDate) },
        { label: 'Close', date: closeDate, status: getStatus(closeDate) },
        { label: 'Allotment', date: allotment, status: getStatus(allotment) },
        { label: 'Refund', date: refund, status: getStatus(refund) },
        { label: 'Listing', date: listing, status: getStatus(listing) },
    ];
};

const cleanIpoTicker = (name: string): string => {
    return (name || '')
        .replace(/^IPO Gain:\s*/i, '')
        .replace(/\s*IPO$/i, '')
        .replace(/\s*Limited$/i, '')
        .replace(/\s*Ltd\.?$/i, '')
        .replace(/\s*India$/i, '')
        .replace(/\s*Asset Management$/i, '')
        .replace(/\s*AMC$/i, '')
        .trim()
        .toUpperCase();
};

export const summarizeIPOApplications = (
    applications: IPOApplication[],
    investments: any[] = [],
    trades: any[] = []
): IPOApplicationSummary => {
    // 1. Build map of clean ticker -> trade PnL
    const ipoTradeProfitMap: Record<string, number> = {};
    trades.forEach(t => {
        if (t.isDeleted) return;
        const cleanTicker = cleanIpoTicker(t.ticker || '');
        if (cleanTicker) {
            ipoTradeProfitMap[cleanTicker] = (ipoTradeProfitMap[cleanTicker] || 0) + (t.pnl || 0);
        }
    });

    // 2. Identify all distinct listed IPO names from applications
    const listedIpoNames = Array.from(new Set(
        applications.filter(a => a.status === 'LISTED').map(a => cleanIpoTicker(a.ipoName))
    )).filter(Boolean);

    let totalRealizedIpoPnL = 0;
    const accountedIpos = new Set<string>();

    listedIpoNames.forEach(name => {
        let profit = ipoTradeProfitMap[name] || 0;
        if (!profit) {
            for (const [k, v] of Object.entries(ipoTradeProfitMap)) {
                if (k.includes(name) || name.includes(k)) {
                    profit = v;
                    accountedIpos.add(k);
                    break;
                }
            }
        } else {
            accountedIpos.add(name);
        }
        totalRealizedIpoPnL += profit;
    });

    // Fallback to investments if trades didn't yield
    if (totalRealizedIpoPnL === 0) {
        investments.forEach(inv => {
            if (inv.platform === 'Syndicate' || inv.type === 'IPO' || (inv.name && inv.name.startsWith('IPO Gain:'))) {
                totalRealizedIpoPnL += ((inv.currentValue || 0) - (inv.investedAmount || 0));
            }
        });
    }

    const summary = applications.reduce<IPOApplicationSummary>((acc, app) => {
        const blockedAmount = app.blockedAmount ?? app.amount;
        if (app.status === 'BLOCKED') {
            acc.blockedCapital += blockedAmount;
            acc.activeApplications += 1;
        }
        if (app.status === 'REFUNDED') {
            acc.refundedCapital += app.refundAmount ?? blockedAmount;
        }
        if (app.status === 'ALLOTTED' || app.status === 'LISTED') {
            acc.allottedApplications += 1;
        }
        if (app.status === 'LISTED' && typeof app.realizedPnL === 'number' && app.realizedPnL !== 0) {
            acc.listedPnL += app.realizedPnL;
        }
        return acc;
    }, {
        blockedCapital: 0,
        refundedCapital: 0,
        listedPnL: 0,
        activeApplications: 0,
        allottedApplications: 0,
    });

    if (summary.listedPnL === 0 && totalRealizedIpoPnL > 0) {
        summary.listedPnL = totalRealizedIpoPnL;
    }

    return summary;
};
