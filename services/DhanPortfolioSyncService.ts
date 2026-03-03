import { db, BrokerHoldingCache, BrokerPositionCache, SyncRecordRow } from '../database';
import { Investment, InvestmentType } from '../types';
import {
    dhanBrokerService,
    DhanHoldingResponse,
    DhanPositionResponse
} from './DhanBrokerService';
import { usePortfolioStore } from '../store/portfolioStore';
import { logger } from './Logger';
import {
    buildReconciliationSyncRecord,
    findBrokerHoldingMatch,
    reconcileBrokerPortfolio
} from './DhanReconciliationService';

const CACHE_TTL_MS = 1000 * 60 * 5;

const getAccountId = () => 'primary';

const checksum = (...parts: Array<string | number | undefined>) =>
    parts.map((part) => String(part || '')).join('|');

class DhanPortfolioSyncService {
    async refreshBrokerCache(): Promise<{
        holdings: DhanHoldingResponse[];
        positions: DhanPositionResponse[];
        fetchedAt: string;
    }> {
        const fetchedAt = new Date().toISOString();
        const staleAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
        const accountId = getAccountId();

        const [holdings, positions] = await Promise.all([
            dhanBrokerService.fetchHoldings(),
            dhanBrokerService.fetchPositions()
        ]);

        try {
            await db.transaction('rw', db.broker_holdings_cache, db.broker_positions_cache, async () => {
                await db.broker_holdings_cache.clear();
                await db.broker_positions_cache.clear();

                if (holdings.length > 0) {
                    await db.broker_holdings_cache.bulkPut(
                        holdings.map<BrokerHoldingCache>((holding) => ({
                            broker: 'dhan',
                            brokerAccountId: accountId,
                            brokerSecurityId: String(holding.securityId),
                            tradingSymbol: holding.tradingSymbol,
                            quantity: holding.totalQty || 0,
                            avgCostPrice: holding.avgCostPrice || 0,
                            lastPrice: 0,
                            currentValue: 0,
                            fetchedAt,
                            staleAt,
                            raw: holding,
                        }))
                    );
                }

                if (positions.length > 0) {
                    await db.broker_positions_cache.bulkPut(
                        positions.map<BrokerPositionCache>((position) => ({
                            broker: 'dhan',
                            brokerAccountId: accountId,
                            brokerSecurityId: String(position.securityId),
                            tradingSymbol: position.tradingSymbol,
                            netQty: position.netQty || 0,
                            buyAvg: position.buyAvg || 0,
                            sellAvg: position.sellAvg || 0,
                            productType: position.productType,
                            positionType: position.positionType,
                            unrealizedProfit: position.unrealizedProfit,
                            realizedProfit: position.realizedProfit,
                            fetchedAt,
                            staleAt,
                            raw: position,
                        }))
                    );
                }
            });
        } catch (e) {
            logger.warn('Failed to update broker cache tables', e);
        }

        await this.upsertSyncRecord({
            id: 'dhan:portfolio-cache',
            scope: 'broker',
            entityType: 'portfolio-cache',
            entityId: accountId,
            source: 'dhan',
            syncStatus: 'SYNCED',
            syncVersion: 1,
            lastSyncedAt: fetchedAt,
            diagnostic: `Cached ${holdings.length} holdings and ${positions.length} positions`,
        });

        return { holdings, positions, fetchedAt };
    }

    async syncPortfolioToStore(): Promise<void> {
        const { holdings, positions, fetchedAt } = await this.refreshBrokerCache();
        const ltpQuotes = await dhanBrokerService.getBatchStockLTP(holdings.map((holding) => holding.tradingSymbol));
        const ltpMap = new Map(ltpQuotes.map((quote) => [quote.symbol, quote.price]));
        const accountId = getAccountId();

        const portfolioStore = usePortfolioStore.getState();
        const existingDhanInvestments = portfolioStore.investments.filter(
            (investment) => investment.broker === 'dhan' || investment.platform === 'DhanHQ' || investment.source === 'dhan'
        );

        const activeBrokerKeys = new Set<string>();
        const processedInvestmentIds = new Set<string>();

        for (const holding of holdings) {
            const brokerSecurityId = String(holding.securityId);
            const quantity = holding.totalQty || 0;
            if (quantity <= 0) continue;

            const livePrice = ltpMap.get(holding.tradingSymbol) || holding.avgCostPrice || 0;
            const currentValue = livePrice * quantity;
            const investedAmount = (holding.avgCostPrice || 0) * quantity;
            const sourceKey = checksum('dhan', accountId, brokerSecurityId);
            activeBrokerKeys.add(sourceKey);

            const match = findBrokerHoldingMatch({
                brokerSecurityId,
                tradingSymbol: holding.tradingSymbol,
                quantity,
                avgCostPrice: holding.avgCostPrice || 0,
            }, existingDhanInvestments);
            const existing = match.existing || existingDhanInvestments.find((investment) =>
                investment.sourceId === sourceKey
            );

            const payload: Partial<Investment> = {
                name: holding.tradingSymbol,
                ticker: holding.tradingSymbol,
                type: InvestmentType.STOCKS,
                platform: 'DhanHQ',
                broker: 'dhan',
                brokerAccountId: accountId,
                brokerSecurityId,
                dhanSecurityId: brokerSecurityId,
                source: 'dhan',
                sourceId: sourceKey,
                quantity,
                investedAmount,
                currentValue,
                lastUpdated: fetchedAt,
                acquiredAt: existing?.acquiredAt || fetchedAt,
                brokerUpdatedAt: fetchedAt,
                syncStatus: match.syncStatus,
                syncVersion: 1,
                lastSyncedAt: fetchedAt,
                lastConflictAt: match.syncStatus === 'CONFLICT' ? fetchedAt : undefined,
                reconciliationStatus: match.reconciliationStatus,
                owner: existing?.owner || 'SELF',
                status: 'ACTIVE',
                unrealizedPnL: currentValue - investedAmount,
                realizedPnL: existing?.realizedPnL || 0,
                syncChecksum: checksum(sourceKey, quantity, investedAmount, currentValue),
            };

            if (existing) {
                processedInvestmentIds.add(existing.id);
                await portfolioStore.updateInvestment(existing.id, payload);
            } else {
                await portfolioStore.addInvestment({
                    id: `inv_dhan_${Date.now()}_${brokerSecurityId}`,
                    ...payload,
                } as Investment);
            }

            await this.upsertSyncRecord({
                id: `dhan:holding:${brokerSecurityId}`,
                scope: 'broker',
                entityType: 'holding',
                entityId: brokerSecurityId,
                source: 'dhan',
                sourceId: sourceKey,
                syncStatus: match.syncStatus,
                syncVersion: 1,
                checksum: payload.syncChecksum,
                lastSyncedAt: fetchedAt,
                lastConflictAt: match.syncStatus === 'CONFLICT' ? fetchedAt : undefined,
                diagnostic: match.description,
            });
        }

        for (const investment of existingDhanInvestments) {
            if (processedInvestmentIds.has(investment.id)) {
                continue;
            }
            const brokerKey = checksum('dhan', accountId, investment.brokerSecurityId || investment.dhanSecurityId);
            if (!activeBrokerKeys.has(brokerKey)) {
                await portfolioStore.updateInvestment(investment.id, {
                    status: 'ARCHIVED',
                    reconciliationStatus: 'ORPHANED',
                    syncStatus: 'STALE',
                    lastSyncedAt: fetchedAt,
                });
            }
        }

        let reconciledInvestments: Investment[] = [];
        try {
            reconciledInvestments = await db.investments.toArray();
        } catch (e) {
            logger.warn('Failed to read investments for reconciliation', e);
            const portfolioStore = usePortfolioStore.getState();
            reconciledInvestments = portfolioStore.investments; // Fallback to store
        }
        const reconciliationSummary = reconcileBrokerPortfolio(
            reconciledInvestments,
            holdings.map((holding) => ({
                brokerSecurityId: String(holding.securityId),
                tradingSymbol: holding.tradingSymbol,
                quantity: holding.totalQty || 0,
                avgCostPrice: holding.avgCostPrice || 0,
            }))
        );

        for (const issue of reconciliationSummary.issues) {
            if (issue.localInvestmentId) {
                await portfolioStore.updateInvestment(issue.localInvestmentId, {
                    reconciliationStatus: issue.reconciliationStatus,
                    syncStatus: issue.syncStatus,
                    lastConflictAt: issue.syncStatus === 'CONFLICT' ? fetchedAt : undefined,
                    status: issue.reconciliationStatus === 'ORPHANED' ? 'ARCHIVED' : 'ACTIVE',
                });
            }
        }

        await this.upsertSyncRecord(buildReconciliationSyncRecord(reconciliationSummary, fetchedAt));

        logger.info(`DhanHQ Sync Complete: ${holdings.length} holdings, ${positions.length} positions`, undefined, 'DhanPortfolioSync');
        await portfolioStore.refreshPortfolio();
    }

    private async upsertSyncRecord(record: SyncRecordRow): Promise<void> {
        try {
            await db.sync_records.put(record);
        } catch (e) {
            logger.warn('Failed to upsert sync record', e);
        }
    }
}

export const dhanPortfolioSyncService = new DhanPortfolioSyncService();
