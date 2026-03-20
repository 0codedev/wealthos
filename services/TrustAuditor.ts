import { logger } from './Logger';
import { db } from '../database';

interface ChannelPerformance {
    channelId: string;
    calls: number;
    successes: number;
    failures: number;
    totalROI: number;
    lastCallAt: number;
}

export class TrustAuditor {
    private static STORAGE_KEY = 'telegram_trust_audit';
    private static performanceData: Record<string, ChannelPerformance> = {};

    static initialize() {
        const saved = typeof window !== 'undefined' ? localStorage.getItem(this.STORAGE_KEY) : null;
        if (saved) {
            this.performanceData = JSON.parse(saved);
        }
    }

    /**
     * Records a new call from a channel.
     */
    static recordCall(channelId: string) {
        if (!this.performanceData[channelId]) {
            this.performanceData[channelId] = {
                channelId,
                calls: 0,
                successes: 0,
                failures: 0,
                totalROI: 0,
                lastCallAt: 0
            };
        }
        this.performanceData[channelId].calls++;
        this.performanceData[channelId].lastCallAt = Date.now();
        this.save();

        // Sync call record and trust score to IndexedDB
        db.pool_sources.where('handle').equals(channelId).first()
            .then(src => {
                if (src && src.id) {
                    const nextScore = this.getTrustScore(channelId);
                    db.pool_sources.update(src.id, {
                        trustScore: nextScore,
                        lastSeenAt: Date.now()
                    }).catch(err => logger.warn(`TrustAuditor: Failed to update pool_sources: ${err}`));
                }
            })
            .catch(err => logger.warn(`TrustAuditor: Failed to find pool_source: ${err}`));
    }

    /**
     * Updates the outcome of a trade.
     */
    static recordOutcome(channelId: string, success: boolean, roi: number = 0) {
        const perf = this.performanceData[channelId];
        if (!perf) return;

        if (success) perf.successes++;
        else perf.failures++;

        perf.totalROI += roi;
        this.save();
        
        const nextScore = this.getTrustScore(channelId);
        logger.info(`TrustAuditor: Updated ${channelId}. Success Rate: ${nextScore}%`);

        // Sync outcome and trust score to IndexedDB
        db.pool_sources.where('handle').equals(channelId).first()
            .then(src => {
                if (src && src.id) {
                    db.pool_sources.update(src.id, {
                        trustScore: nextScore,
                        lastSeenAt: Date.now()
                    }).catch(err => logger.warn(`TrustAuditor: Failed to update pool_sources: ${err}`));
                }
            })
            .catch(err => logger.warn(`TrustAuditor: Failed to find pool_source: ${err}`));
    }

    /**
     * Calculates the trust score (0-100).
     */
    static getTrustScore(channelId: string): number {
        const perf = this.performanceData[channelId];
        if (!perf || perf.calls === 0) return 70; // Baseline for new channels

        const rate = (perf.successes / (perf.successes + perf.failures || 1)) * 100;
        // Weight by sample size
        const confidence = Math.min(perf.calls / 10, 1);
        return Math.round(rate * confidence + 70 * (1 - confidence));
    }

    private static save() {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.performanceData));
    }
}
