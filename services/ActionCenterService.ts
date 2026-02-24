import { Trade, SyncRecordRow } from '../database';
import { Investment } from '../types';
import { computePortfolioView } from '../lib/domain/portfolio';
import { getBrokerReviewQueue } from './BrokerReviewWorkflowService';

export interface SmartActionItem {
    id: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    action: string;
}

export const generateSmartActions = (
    investments: Investment[],
    trades: Trade[],
    syncRecords: SyncRecordRow[]
): SmartActionItem[] => {
    const actions: SmartActionItem[] = [];
    const view = computePortfolioView(investments);
    const totalAssets = view.stats.totalAssets || 0;

    const syncIssues = syncRecords.filter((record) =>
        record.syncStatus === 'ERROR' || record.syncStatus === 'STALE' || record.syncStatus === 'CONFLICT'
    );
    if (syncIssues.length > 0) {
        actions.push({
            id: 'broker-sync',
            title: 'Review Broker Sync',
            description: `${syncIssues.length} broker pipeline${syncIssues.length > 1 ? 's are' : ' is'} stale, conflicted, or errored.`,
            priority: 'high',
            action: 'broker-sync',
        });
    }

    const pendingReviews = getBrokerReviewQueue(trades);
    if (pendingReviews.length > 0) {
        actions.push({
            id: 'trade-review',
            title: 'Annotate Imported Trades',
            description: `${pendingReviews.length} imported trade${pendingReviews.length > 1 ? 's are' : ' is'} still waiting on review steps.`,
            priority: 'high',
            action: 'trade-review',
        });
    }

    const cashValue = investments
        .filter((investment) => investment.type === 'Cash/Bank')
        .reduce((sum, investment) => sum + (investment.currentValue || 0), 0);
    if (totalAssets > 0 && (cashValue / totalAssets) > 0.2) {
        actions.push({
            id: 'idle-cash',
            title: 'Deploy Idle Cash',
            description: `${(((cashValue / totalAssets) * 100)).toFixed(1)}% of the portfolio is parked in cash.`,
            priority: 'medium',
            action: 'idle-cash',
        });
    }

    const largestHolding = [...view.normalizedInvestments]
        .filter((investment) => investment.status !== 'ARCHIVED')
        .sort((left, right) => (right.currentValue || 0) - (left.currentValue || 0))[0];
    if (largestHolding && totalAssets > 0 && ((largestHolding.currentValue || 0) / totalAssets) > 0.25) {
        actions.push({
            id: 'rebalance',
            title: 'Trim Concentration',
            description: `${largestHolding.name} is above 25% of portfolio weight.`,
            priority: 'medium',
            action: 'rebalance',
        });
    }

    const taxLossCandidates = investments.filter((investment) =>
        investment.status !== 'ARCHIVED' &&
        (investment.currentValue || 0) < (investment.investedAmount || 0) &&
        (investment.investedAmount || 0) > 0
    );
    if (taxLossCandidates.length > 0) {
        actions.push({
            id: 'tax-harvest',
            title: 'Review Tax Loss Harvest',
            description: `${taxLossCandidates.length} holding${taxLossCandidates.length > 1 ? 's are' : ' is'} below cost basis.`,
            priority: 'low',
            action: 'tax-harvest',
        });
    }

    return actions.slice(0, 5);
};
