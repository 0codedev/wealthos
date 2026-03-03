import { BrokerHoldingCache, SyncRecordRow } from '../database';
import { Investment } from '../types';

export interface BrokerReconciliationIssue {
    id: string;
    brokerSecurityId?: string;
    localInvestmentId?: string;
    tradingSymbol: string;
    reconciliationStatus: NonNullable<Investment['reconciliationStatus']>;
    syncStatus: NonNullable<Investment['syncStatus']>;
    matchType: 'broker-id' | 'ticker-fallback' | 'imported-new' | 'orphaned-local';
    severity: 'high' | 'medium' | 'low';
    description: string;
}

export interface BrokerReconciliationSummary {
    matched: number;
    partial: number;
    unmatchedBroker: number;
    orphanedLocal: number;
    issues: BrokerReconciliationIssue[];
}

const getBrokerKey = (brokerSecurityId?: string, ticker?: string) =>
    `${brokerSecurityId || 'unknown'}:${(ticker || '').toUpperCase()}`;

const isBrokerLinkedInvestment = (investment: Investment) =>
    investment.broker === 'dhan' || investment.platform === 'DhanHQ' || investment.source === 'dhan';

const normalizeTicker = (value?: string | null) => (value || '').trim().toUpperCase();

const getInvestedAmountFromHolding = (holding: Pick<BrokerHoldingCache, 'quantity' | 'avgCostPrice'>) =>
    (holding.quantity || 0) * (holding.avgCostPrice || 0);

const isCloseEnough = (left: number, right: number, tolerance: number) =>
    Math.abs(left - right) <= tolerance;

export interface HoldingMatchResult {
    existing?: Investment;
    reconciliationStatus: NonNullable<Investment['reconciliationStatus']>;
    syncStatus: NonNullable<Investment['syncStatus']>;
    matchType: BrokerReconciliationIssue['matchType'];
    description?: string;
}

export const findBrokerHoldingMatch = (
    holding: Pick<BrokerHoldingCache, 'brokerSecurityId' | 'tradingSymbol' | 'quantity' | 'avgCostPrice'>,
    investments: Investment[]
): HoldingMatchResult => {
    const activeBrokerInvestments = investments.filter(
        (investment) => isBrokerLinkedInvestment(investment) && investment.status !== 'ARCHIVED'
    );

    const exact = activeBrokerInvestments.find((investment) =>
        investment.brokerSecurityId === holding.brokerSecurityId ||
        investment.dhanSecurityId === holding.brokerSecurityId
    );

    if (exact) {
        const quantityMatches = isCloseEnough(exact.quantity || 0, holding.quantity || 0, 0.0001);
        const investedMatches = isCloseEnough(
            exact.investedAmount || 0,
            getInvestedAmountFromHolding(holding),
            Math.max(5, getInvestedAmountFromHolding(holding) * 0.02)
        );

        if (quantityMatches && investedMatches) {
            return {
                existing: exact,
                reconciliationStatus: 'MATCHED',
                syncStatus: 'SYNCED',
                matchType: 'broker-id',
            };
        }

        return {
            existing: exact,
            reconciliationStatus: 'PARTIAL',
            syncStatus: 'CONFLICT',
            matchType: 'broker-id',
            description: 'Broker identity matched, but quantity or cost basis differs from the local record.',
        };
    }

    const fallback = activeBrokerInvestments.find((investment) =>
        !investment.brokerSecurityId &&
        normalizeTicker(investment.ticker || investment.name) === normalizeTicker(holding.tradingSymbol)
    );

    if (fallback) {
        return {
            existing: fallback,
            reconciliationStatus: 'PARTIAL',
            syncStatus: 'CONFLICT',
            matchType: 'ticker-fallback',
            description: 'Matched via ticker fallback. Confirm broker identity mapping for this holding.',
        };
    }

    return {
        reconciliationStatus: 'MATCHED',
        syncStatus: 'SYNCED',
        matchType: 'imported-new',
        description: 'Broker holding imported as a new local record.',
    };
};

export const reconcileBrokerPortfolio = (
    investments: Investment[],
    holdings: Pick<BrokerHoldingCache, 'brokerSecurityId' | 'tradingSymbol' | 'quantity' | 'avgCostPrice'>[]
): BrokerReconciliationSummary => {
    const issues: BrokerReconciliationIssue[] = [];
    const matchedLocalIds = new Set<string>();
    const activeHoldings = holdings.filter((item) => (item.quantity || 0) > 0);

    for (const holding of activeHoldings) {
        const result = findBrokerHoldingMatch(holding, investments);
        const id = `recon:${getBrokerKey(holding.brokerSecurityId, holding.tradingSymbol)}`;

        if (result.existing?.id) {
            matchedLocalIds.add(result.existing.id);
        }

        if (result.reconciliationStatus !== 'MATCHED' || result.matchType !== 'broker-id') {
            issues.push({
                id,
                brokerSecurityId: holding.brokerSecurityId,
                localInvestmentId: result.existing?.id,
                tradingSymbol: holding.tradingSymbol,
                reconciliationStatus: result.reconciliationStatus,
                syncStatus: result.syncStatus,
                matchType: result.matchType,
                severity: result.reconciliationStatus === 'PARTIAL' ? 'medium' : 'low',
                description: result.description || 'Broker holding requires review.',
            });
        }
    }

    const orphanedLocals = investments.filter((investment) =>
        isBrokerLinkedInvestment(investment) &&
        investment.status !== 'ARCHIVED' &&
        !matchedLocalIds.has(investment.id) &&
        !!(investment.brokerSecurityId || investment.dhanSecurityId)
    );

    for (const investment of orphanedLocals) {
        issues.push({
            id: `recon:local:${investment.id}`,
            brokerSecurityId: investment.brokerSecurityId || investment.dhanSecurityId,
            localInvestmentId: investment.id,
            tradingSymbol: investment.ticker || investment.name,
            reconciliationStatus: 'ORPHANED',
            syncStatus: 'STALE',
            matchType: 'orphaned-local',
            severity: 'high',
            description: 'Local broker holding is no longer present in the latest Dhan snapshot.',
        });
    }

    const partialCount = issues.filter((issue) => issue.reconciliationStatus === 'PARTIAL').length;
    const unmatchedBrokerCount = issues.filter((issue) => issue.matchType === 'imported-new').length;

    return {
        matched: Math.max(0, activeHoldings.length - partialCount - unmatchedBrokerCount),
        partial: partialCount,
        unmatchedBroker: unmatchedBrokerCount,
        orphanedLocal: orphanedLocals.length,
        issues,
    };
};

export const buildReconciliationSyncRecord = (
    summary: BrokerReconciliationSummary,
    fetchedAt: string
): SyncRecordRow => ({
    id: 'dhan:portfolio-reconciliation',
    scope: 'broker',
    entityType: 'reconciliation',
    entityId: 'primary',
    source: 'dhan',
    syncVersion: 1,
    syncStatus: summary.partial > 0 || summary.orphanedLocal > 0 ? 'CONFLICT' : 'SYNCED',
    lastSyncedAt: fetchedAt,
    diagnostic: `Matched ${summary.matched}, partial ${summary.partial}, imported ${summary.unmatchedBroker}, orphaned ${summary.orphanedLocal}`,
});
