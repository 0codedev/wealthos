import { Investment, InvestmentType } from '../types';

export interface PortfolioActionProposal {
    id: string;
    category: 'rebalance' | 'deploy-cash' | 'trim' | 'tax-harvest';
    title: string;
    summary: string;
    priority: 'high' | 'medium' | 'low';
    amount?: number;
    target?: string;
    metadata?: Record<string, string | number>;
}

export interface PortfolioActionSummary {
    total: number;
    rebalance: number;
    deployCash: number;
    trim: number;
    taxHarvest: number;
    topProposal: PortfolioActionProposal | null;
}

export const getPortfolioAssetBucket = (investment: Investment): string => {
    switch (investment.type) {
        case InvestmentType.STOCKS:
        case InvestmentType.MUTUAL_FUND:
        case InvestmentType.SMALLCASE:
        case InvestmentType.ETF:
        case InvestmentType.TRADING:
            return 'Equity & Related';
        case InvestmentType.DIGITAL_GOLD:
        case InvestmentType.DIGITAL_SILVER:
            return 'Commodities';
        case InvestmentType.CRYPTO:
            return 'Crypto';
        case InvestmentType.FD:
        case InvestmentType.CASH:
            return 'Fixed Income';
        case InvestmentType.REAL_ESTATE:
            return 'Real Estate';
        default:
            return 'Other';
    }
};

export const generatePortfolioActionProposals = (
    investments: Investment[],
    allocationTargets: Record<string, number>
): PortfolioActionProposal[] => {
    const activeInvestments = investments.filter((investment) => investment.status !== 'ARCHIVED');
    const totalAssets = activeInvestments.reduce((sum, investment) => sum + (investment.currentValue || 0), 0);
    if (totalAssets <= 0) return [];

    const actions: PortfolioActionProposal[] = [];

    const bucketTotals = activeInvestments.reduce<Record<string, number>>((acc, investment) => {
        const bucket = getPortfolioAssetBucket(investment);
        acc[bucket] = (acc[bucket] || 0) + (investment.currentValue || 0);
        return acc;
    }, {});

    for (const [bucket, targetPercent] of Object.entries(allocationTargets)) {
        const currentValue = bucketTotals[bucket] || 0;
        const currentPercent = (currentValue / totalAssets) * 100;
        const deviation = currentPercent - targetPercent;

        if (deviation >= 4) {
            const trimAmount = totalAssets * (deviation / 100);
            actions.push({
                id: `rebalance-sell-${bucket}`,
                category: 'rebalance',
                title: `Trim ${bucket}`,
                summary: `${bucket} is ${deviation.toFixed(1)}% above target allocation.`,
                priority: deviation >= 8 ? 'high' : 'medium',
                amount: trimAmount,
                target: bucket,
                metadata: {
                    currentPercent: Number(currentPercent.toFixed(1)),
                    targetPercent,
                },
            });
        } else if (deviation <= -4) {
            const addAmount = totalAssets * (Math.abs(deviation) / 100);
            actions.push({
                id: `rebalance-buy-${bucket}`,
                category: 'rebalance',
                title: `Build ${bucket}`,
                summary: `${bucket} is ${Math.abs(deviation).toFixed(1)}% below target allocation.`,
                priority: Math.abs(deviation) >= 8 ? 'high' : 'medium',
                amount: addAmount,
                target: bucket,
                metadata: {
                    currentPercent: Number(currentPercent.toFixed(1)),
                    targetPercent,
                },
            });
        }
    }

    const cashHoldings = activeInvestments.filter((investment) => investment.type === InvestmentType.CASH);
    const cashValue = cashHoldings.reduce((sum, investment) => sum + (investment.currentValue || 0), 0);
    const cashPercent = (cashValue / totalAssets) * 100;
    const underweightBuckets = actions.filter((action) => action.category === 'rebalance' && action.id.startsWith('rebalance-buy'));
    if (cashPercent >= 15 && underweightBuckets.length > 0) {
        const topUnderweight = underweightBuckets.sort((left, right) => (right.amount || 0) - (left.amount || 0))[0];
        actions.push({
            id: 'deploy-idle-cash',
            category: 'deploy-cash',
            title: 'Deploy idle cash',
            summary: `${cashPercent.toFixed(1)}% of the portfolio is in cash while ${topUnderweight.target} is underweight.`,
            priority: cashPercent >= 25 ? 'high' : 'medium',
            amount: Math.min(cashValue * 0.5, topUnderweight.amount || 0),
            target: topUnderweight.target,
            metadata: {
                cashPercent: Number(cashPercent.toFixed(1)),
            },
        });
    }

    const largestHolding = [...activeInvestments]
        .sort((left, right) => (right.currentValue || 0) - (left.currentValue || 0))[0];
    if (largestHolding) {
        const largestShare = ((largestHolding.currentValue || 0) / totalAssets) * 100;
        if (largestShare >= 18) {
            const targetShare = 15;
            actions.push({
                id: `trim-${largestHolding.id}`,
                category: 'trim',
                title: `Trim ${largestHolding.name}`,
                summary: `${largestHolding.name} alone is ${largestShare.toFixed(1)}% of the portfolio.`,
                priority: largestShare >= 25 ? 'high' : 'medium',
                amount: totalAssets * Math.max(0, (largestShare - targetShare) / 100),
                target: largestHolding.name,
                metadata: {
                    largestShare: Number(largestShare.toFixed(1)),
                },
            });
        }
    }

    const harvestCandidates = activeInvestments
        .filter((investment) =>
            investment.type !== InvestmentType.CASH &&
            (investment.currentValue || 0) < (investment.investedAmount || 0) &&
            (investment.investedAmount || 0) > 0
        )
        .map((investment) => {
            const loss = (investment.currentValue || 0) - (investment.investedAmount || 0);
            const lossPercent = (loss / (investment.investedAmount || 1)) * 100;
            return { investment, loss, lossPercent };
        })
        .filter((candidate) => candidate.loss <= -2500 || candidate.lossPercent <= -8)
        .sort((left, right) => left.loss - right.loss);

    for (const candidate of harvestCandidates.slice(0, 2)) {
        actions.push({
            id: `tax-harvest-${candidate.investment.id}`,
            category: 'tax-harvest',
            title: `Harvest loss in ${candidate.investment.name}`,
            summary: `${candidate.investment.name} is down ${Math.abs(candidate.lossPercent).toFixed(1)}% below cost basis.`,
            priority: candidate.lossPercent <= -15 ? 'high' : 'low',
            amount: Math.abs(candidate.loss),
            target: candidate.investment.name,
            metadata: {
                lossPercent: Number(candidate.lossPercent.toFixed(1)),
            },
        });
    }

    const categoryPriority = { high: 0, medium: 1, low: 2 };
    return actions
        .sort((left, right) => categoryPriority[left.priority] - categoryPriority[right.priority])
        .slice(0, 6);
};

export const summarizePortfolioActionProposals = (
    proposals: PortfolioActionProposal[],
): PortfolioActionSummary => ({
    total: proposals.length,
    rebalance: proposals.filter((proposal) => proposal.category === 'rebalance').length,
    deployCash: proposals.filter((proposal) => proposal.category === 'deploy-cash').length,
    trim: proposals.filter((proposal) => proposal.category === 'trim').length,
    taxHarvest: proposals.filter((proposal) => proposal.category === 'tax-harvest').length,
    topProposal: proposals[0] || null,
});
