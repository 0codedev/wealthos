import { dhanBrokerService } from './DhanBrokerService';
import { db, Trade } from '../database';
import { logger } from './Logger';
import { refreshImportedTradeReviewQueue, resolveTradeReviewStatus } from './BrokerReviewWorkflowService';
import { clearMatchedBrokerExecutionHandoffs } from './BrokerExecutionHandoffService';
import { registerJournalReviewHandoff } from './JournalReviewHandoffService';

// A key to track the last sync timestamp in localStorage to avoid spamming the API
const LAST_SYNC_KEY = 'dhan_last_trade_sync';
const SYNC_INTERVAL_MS = 1000 * 60 * 60 * 2; // 2 hours

export interface TradeSyncGate {
    shouldSync: boolean;
    reason: 'force' | 'due' | 'recent-skip';
    lastSyncAt: number | null;
    nextEligibleAt: number | null;
}

export const getTradeSyncGate = (lastSyncRaw: string | null, now: number, force: boolean): TradeSyncGate => {
    if (force) {
        return {
            shouldSync: true,
            reason: 'force',
            lastSyncAt: lastSyncRaw ? parseInt(lastSyncRaw, 10) : null,
            nextEligibleAt: null,
        };
    }

    const lastSyncAt = lastSyncRaw ? parseInt(lastSyncRaw, 10) : null;
    if (lastSyncAt && (now - lastSyncAt) < SYNC_INTERVAL_MS) {
        return {
            shouldSync: false,
            reason: 'recent-skip',
            lastSyncAt,
            nextEligibleAt: lastSyncAt + SYNC_INTERVAL_MS,
        };
    }

    return {
        shouldSync: true,
        reason: 'due',
        lastSyncAt,
        nextEligibleAt: null,
    };
};

export class DhanBackgroundSyncService {
    private isSyncing = false;

    /**
     * Automatic background sync is disabled per user preference.
     * Manual sync via the Sync Trades button remains available.
     */
    public async autoSyncTrades(force: boolean = false): Promise<number> {
        // Disabled automatic background sync
        return 0;

        const now = Date.now();
        const syncGate = getTradeSyncGate(localStorage.getItem(LAST_SYNC_KEY), now, force);

        if (!syncGate.shouldSync) {
            try {
                await db.sync_records.put({
                    id: 'dhan:trade-sync',
                    scope: 'broker',
                    entityType: 'trade-sync',
                    entityId: 'primary',
                    source: 'dhan',
                    syncVersion: 1,
                    syncStatus: 'SYNCED',
                    lastSyncedAt: new Date(syncGate.lastSyncAt ?? now).toISOString(),
                    diagnostic: syncGate.nextEligibleAt
                        ? `Skipped auto-sync because trade sync is still fresh until ${new Date(Number(syncGate.nextEligibleAt)).toISOString()}`
                        : 'Skipped auto-sync because trade sync is still fresh',
                });
            } catch (e) {
                logger.warn('Failed to update skip sync record', e);
            }
            return 0;
        }

        this.isSyncing = true;
        let addedCount = 0;
        const matchedExecutionHandoffs: Array<{ ticker: string; action: 'BUY' | 'SELL' }> = [];

        try {
            const dhanTrades = await dhanBrokerService.fetchTrades();
            if (!dhanTrades || dhanTrades.length === 0) {
                // No trades, just update the timestamp
                localStorage.setItem(LAST_SYNC_KEY, now.toString());
                try {
                    await db.sync_records.put({
                        id: 'dhan:trade-sync',
                        scope: 'broker',
                        entityType: 'trade-sync',
                        entityId: 'primary',
                        source: 'dhan',
                        syncVersion: 1,
                        syncStatus: 'SYNCED',
                        lastSyncedAt: new Date(now).toISOString(),
                        diagnostic: 'No new trades returned by broker',
                    });
                } catch (e) {
                    logger.warn('Failed to update empty sync record', e);
                }
                return 0;
            }

            const existingImportedTrades = await db.trades.toArray();

            for (const dt of dhanTrades) {
                const brokerTradeId = dt.exchangeTradeId || dt.orderId || `${dt.exchangeOrderId}_${dt.tradingSymbol}_${dt.tradedQuantity}_${dt.tradedPrice}_${dt.exchangeTime}`;
                const tradeDate = (dt.exchangeTime || dt.createTime || new Date().toISOString()).split(' ')[0];
                const sourceChecksum = `${dt.tradingSymbol}|${dt.transactionType}|${dt.tradedQuantity}|${dt.tradedPrice}|${dt.exchangeTime}`;
                const isDup = existingImportedTrades.some(t =>
                    t.brokerTradeId === brokerTradeId ||
                    t.sourceChecksum === sourceChecksum
                );

                if (!isDup) {
                    const resolvedReviewStatus = resolveTradeReviewStatus({
                        ticker: dt.tradingSymbol || 'Unknown',
                        direction: dt.transactionType === 'BUY' ? 'Long' : 'Short',
                        quantity: dt.tradedQuantity,
                        entryPrice: dt.tradedPrice,
                        exitPrice: dt.tradedPrice,
                        date: tradeDate,
                        entryTime: dt.createTime?.split(' ')[1] || new Date().toISOString().split('T')[1].substring(0, 5),
                        moodEntry: 'Focused',
                        moodExit: 'Satisfied',
                        mistakes: [],
                        setup: 'DAS',
                        pnl: 0,
                        isImported: true,
                        broker: 'dhan',
                        brokerOrderId: dt.orderId || dt.exchangeOrderId,
                        brokerTradeId,
                        brokerSecurityId: dt.securityId,
                        source: 'dhan',
                        sourceId: brokerTradeId,
                        sourceChecksum,
                        syncStatus: 'SYNCED',
                        importConfidence: 0.92,
                        orderType: dt.orderType,
                        productType: dt.productType,
                        isin: dt.isin,
                        brokerAccountId: dt.dhanClientId,
                    } as Trade);
                    const newTrade: Trade = {
                        ticker: dt.tradingSymbol || 'Unknown',
                        direction: dt.transactionType === 'BUY' ? 'Long' : 'Short',
                        quantity: dt.tradedQuantity,
                        entryPrice: dt.tradedPrice,
                        exitPrice: dt.tradedPrice, // Default for single-leg syncs
                        date: tradeDate,
                        entryTime: dt.createTime?.split(' ')[1] || new Date().toISOString().split('T')[1].substring(0, 5),
                        moodEntry: 'Focused',
                        moodExit: 'Satisfied',
                        mistakes: [],
                        setup: 'DAS', // Custom setup tag
                        pnl: 0,
                        isImported: true,
                        broker: 'dhan',
                        brokerOrderId: dt.orderId || dt.exchangeOrderId,
                        brokerTradeId,
                        brokerSecurityId: dt.securityId,
                        source: 'dhan',
                        sourceId: brokerTradeId,
                        sourceChecksum,
                        syncStatus: 'SYNCED',
                        importConfidence: 0.92,
                        reviewStatus: resolvedReviewStatus,
                        orderType: dt.orderType,
                        productType: dt.productType,
                        isin: dt.isin,
                        brokerAccountId: dt.dhanClientId,
                    };
                    await db.trades.add(newTrade);
                    addedCount++;
                    matchedExecutionHandoffs.push({
                        ticker: (dt.tradingSymbol || 'Unknown').toUpperCase(),
                        action: dt.transactionType,
                    });
                    registerJournalReviewHandoff(
                        dt.tradingSymbol || 'Unknown',
                        resolvedReviewStatus,
                        now,
                    );

                    existingImportedTrades.push(newTrade);
                }
            }

            // Update timestamp after successful sync
            localStorage.setItem(LAST_SYNC_KEY, now.toString());
            const clearedExecutionHandoffs = clearMatchedBrokerExecutionHandoffs(matchedExecutionHandoffs, now);
            const reviewQueueUpdates = await refreshImportedTradeReviewQueue();
            await db.sync_records.put({
                id: 'dhan:trade-sync',
                scope: 'broker',
                entityType: 'trade-sync',
                entityId: 'primary',
                source: 'dhan',
                syncVersion: 1,
                syncStatus: 'SYNCED',
                lastSyncedAt: new Date(now).toISOString(),
                diagnostic: `Imported ${addedCount} trade(s); refreshed ${reviewQueueUpdates} review state(s); converted ${clearedExecutionHandoffs} execution follow-up(s)`,
            });
            logger.info(`[DhanBackgroundSync] Synced ${addedCount} new trades.`, undefined, 'DhanBackgroundSync');

        } catch (error: any) {
            const errMsg = error instanceof Error ? error.message : String(error);
            try {
                await db.sync_records.put({
                    id: 'dhan:trade-sync',
                    scope: 'broker',
                    entityType: 'trade-sync',
                    entityId: 'primary',
                    source: 'dhan',
                    syncVersion: 1,
                    syncStatus: 'ERROR',
                    lastSyncedAt: new Date(now).toISOString(),
                    diagnostic: errMsg,
                });
            } catch (innerErr) {
                logger.error('[DhanBackgroundSync] Failed to update error sync record:', innerErr);
            }
            logger.error('[DhanBackgroundSync] Failed to sync trades:', errMsg);
        } finally {
            this.isSyncing = false;
        }

        return addedCount;
    }
}

export const dhanBackgroundSync = new DhanBackgroundSyncService();
