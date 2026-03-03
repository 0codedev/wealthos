import { db } from '../database';
import { dhanBackgroundSync } from './DhanBackgroundSyncService';
import { refreshImportedTradeReviewQueue } from './BrokerReviewWorkflowService';

class DhanTradeSyncService {
    autoSyncTrades(force: boolean = false) {
        return dhanBackgroundSync.autoSyncTrades(force);
    }

    refreshReviewWorkflow() {
        return refreshImportedTradeReviewQueue();
    }

    async getLastTradeSync() {
        try {
            return await db.sync_records.get('dhan:trade-sync');
        } catch (e) {
            return null;
        }
    }
}

export const dhanTradeSyncService = new DhanTradeSyncService();
