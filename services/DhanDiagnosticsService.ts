import { DhanFundLimitResponse, DhanPositionResponse } from './DhanBrokerService';
import { SyncRecordRow, Trade } from '../database';
import { Investment } from '../types';
import { getBrokerReviewQueue } from './BrokerReviewWorkflowService';
import { BrokerExecutionHandoff } from './BrokerExecutionHandoffService';

export interface DhanDiagnosticsSummary {
    syncHealth: 'healthy' | 'warning' | 'critical';
    configured: boolean;
    stalePipelines: number;
    conflictedPipelines: number;
    erroredPipelines: number;
    reconciliationConflicts: number;
    orphanedHoldings: number;
    pendingReviewTrades: number;
    needsScreenshots: number;
    readyForLesson: number;
    recentExecutions: number;
    openPositions: number;
    totalOpenExposure: number;
    availableBalance: number | null;
    lastTradeSyncAt?: string;
    lastPortfolioSyncAt?: string;
    diagnostics: string[];
}

export const summarizeDhanDiagnostics = ({
    configured,
    syncRecords,
    trades,
    investments,
    positions,
    fundLimit,
    executionHandoffs = [],
}: {
    configured: boolean;
    syncRecords: SyncRecordRow[];
    trades: Trade[];
    investments: Investment[];
    positions: DhanPositionResponse[];
    fundLimit: DhanFundLimitResponse | null;
    executionHandoffs?: BrokerExecutionHandoff[];
}): DhanDiagnosticsSummary => {
    const stalePipelines = syncRecords.filter((record) => record.source === 'dhan' && record.syncStatus === 'STALE').length;
    const conflictedPipelines = syncRecords.filter((record) => record.source === 'dhan' && record.syncStatus === 'CONFLICT').length;
    const erroredPipelines = syncRecords.filter((record) => record.source === 'dhan' && record.syncStatus === 'ERROR').length;

    const brokerHoldings = investments.filter((investment) =>
        investment.broker === 'dhan' || investment.platform === 'DhanHQ' || investment.source === 'dhan'
    );
    const reconciliationConflicts = brokerHoldings.filter((investment) => investment.reconciliationStatus === 'PARTIAL').length;
    const orphanedHoldings = brokerHoldings.filter((investment) => investment.reconciliationStatus === 'ORPHANED').length;

    const pendingReviewTrades = getBrokerReviewQueue(trades).length;
    const needsScreenshots = trades.filter((trade) => trade.reviewStatus === 'NEEDS_SCREENSHOTS').length;
    const readyForLesson = trades.filter((trade) => trade.reviewStatus === 'READY_FOR_LESSON').length;
    const recentExecutions = executionHandoffs.length;
    const totalOpenExposure = positions.reduce((sum, position) => sum + Math.abs((position.netQty || 0) * (position.costPrice || position.buyAvg || position.sellAvg || 0)), 0);

    const diagnostics: string[] = [];
    if (!configured) diagnostics.push('DhanHQ is not configured.');
    if (erroredPipelines > 0) diagnostics.push(`${erroredPipelines} Dhan pipeline${erroredPipelines > 1 ? 's are' : ' is'} errored.`);
    if (conflictedPipelines > 0 || reconciliationConflicts > 0) diagnostics.push('Broker reconciliation needs attention.');
    if (pendingReviewTrades > 0) diagnostics.push(`${pendingReviewTrades} imported trade${pendingReviewTrades > 1 ? 's are' : ' is'} waiting in the review loop.`);
    if (recentExecutions > 0) diagnostics.push(`${recentExecutions} fresh broker execution${recentExecutions > 1 ? 's are' : ' is'} waiting for sync confirmation.`);
    if (fundLimit && fundLimit.availabelBalance < 25000) diagnostics.push('Available Dhan runway is getting tight.');

    const syncHealth: DhanDiagnosticsSummary['syncHealth'] =
        !configured || erroredPipelines > 0 || orphanedHoldings > 0
            ? 'critical'
            : conflictedPipelines > 0 || stalePipelines > 0 || pendingReviewTrades > 0 || reconciliationConflicts > 0
                ? 'warning'
                : 'healthy';

    const lastTradeSyncAt = syncRecords.find((record) => record.id === 'dhan:trade-sync')?.lastSyncedAt;
    const lastPortfolioSyncAt =
        syncRecords.find((record) => record.id === 'dhan:portfolio-reconciliation')?.lastSyncedAt ||
        syncRecords.find((record) => record.id === 'dhan:portfolio-cache')?.lastSyncedAt;

    return {
        syncHealth,
        configured,
        stalePipelines,
        conflictedPipelines,
        erroredPipelines,
        reconciliationConflicts,
        orphanedHoldings,
        pendingReviewTrades,
        needsScreenshots,
        readyForLesson,
        recentExecutions,
        openPositions: positions.length,
        totalOpenExposure,
        availableBalance: fundLimit?.availabelBalance ?? null,
        lastTradeSyncAt,
        lastPortfolioSyncAt,
        diagnostics,
    };
};
