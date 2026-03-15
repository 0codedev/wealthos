import { PoolItem } from '../database';
import { logger } from './Logger';

export class PoolLevelAlertMonitor {
    private static instance: PoolLevelAlertMonitor;

    // Track the fired state per item ID.
    // Maps item.id -> { targetSellFired: boolean; targetBuyFired: boolean; stopLossFired: boolean }
    private firedStates: Map<number, { targetSellFired: boolean; targetBuyFired: boolean; stopLossFired: boolean }> = new Map();

    private readonly HYSTERESIS = 0.005; // 0.5% hysteresis

    private constructor() {}

    public static getInstance(): PoolLevelAlertMonitor {
        if (!PoolLevelAlertMonitor.instance) {
            PoolLevelAlertMonitor.instance = new PoolLevelAlertMonitor();
        }
        return PoolLevelAlertMonitor.instance;
    }

    /**
     * Checks if the live price crosses any defined levels and handles hysteresis.
     * Returns the type of alert if triggered, or null.
     */
    public check(item: PoolItem, livePrice: number): 'TARGET_HIT' | 'STOP_HIT' | null {
        if (!item.id || item.alertEnabled !== 1 || !item.alertOn || livePrice <= 0 || !Number.isFinite(livePrice)) {
            return null;
        }

        // Initialize state for this item if not exists
        if (!this.firedStates.has(item.id)) {
            this.firedStates.set(item.id, {
                targetSellFired: false,
                targetBuyFired: false,
                stopLossFired: false
            });
        }

        const state = this.firedStates.get(item.id)!;
        let triggeredAlert: 'TARGET_HIT' | 'STOP_HIT' | null = null;

        // 1. Check Target Sell (Resistance / Profit target)
        if (item.targetSellPrice && item.targetSellPrice > 0 && item.alertOn.includes('PRICE_TARGET_HIT')) {
            if (livePrice >= item.targetSellPrice) {
                if (!state.targetSellFired) {
                    state.targetSellFired = true;
                    triggeredAlert = 'TARGET_HIT';
                    logger.info(`PoolLevelAlertMonitor: Target Sell Hit for ${item.ticker} at ${livePrice} (Level: ${item.targetSellPrice})`);
                }
            } else if (livePrice < item.targetSellPrice * (1 - this.HYSTERESIS)) {
                // Reset fired flag only if price falls below the hysteresis threshold
                if (state.targetSellFired) {
                    state.targetSellFired = false;
                    logger.debug(`PoolLevelAlertMonitor: Reset Target Sell Alert state for ${item.ticker} (price fell to ${livePrice})`);
                }
            }
        }

        // 2. Check Target Buy (Support / Breakout buy target)
        if (item.targetBuyPrice && item.targetBuyPrice > 0 && item.alertOn.includes('PRICE_TARGET_HIT')) {
            if (livePrice <= item.targetBuyPrice) {
                if (!state.targetBuyFired) {
                    state.targetBuyFired = true;
                    triggeredAlert = 'TARGET_HIT'; // Re-use TARGET_HIT for consistency
                    logger.info(`PoolLevelAlertMonitor: Target Buy Hit for ${item.ticker} at ${livePrice} (Level: ${item.targetBuyPrice})`);
                }
            } else if (livePrice > item.targetBuyPrice * (1 + this.HYSTERESIS)) {
                // Reset fired flag only if price goes above hysteresis threshold
                if (state.targetBuyFired) {
                    state.targetBuyFired = false;
                    logger.debug(`PoolLevelAlertMonitor: Reset Target Buy Alert state for ${item.ticker} (price rose to ${livePrice})`);
                }
            }
        }

        // 3. Check Stop Loss
        if (item.stopLoss && item.stopLoss > 0 && item.alertOn.includes('STOP_HIT')) {
            if (livePrice <= item.stopLoss) {
                if (!state.stopLossFired) {
                    state.stopLossFired = true;
                    triggeredAlert = 'STOP_HIT';
                    logger.info(`PoolLevelAlertMonitor: Stop Loss Hit for ${item.ticker} at ${livePrice} (Level: ${item.stopLoss})`);
                }
            } else if (livePrice > item.stopLoss * (1 + this.HYSTERESIS)) {
                // Reset fired flag only if price recovers above hysteresis threshold
                if (state.stopLossFired) {
                    state.stopLossFired = false;
                    logger.debug(`PoolLevelAlertMonitor: Reset Stop Loss Alert state for ${item.ticker} (price recovered to ${livePrice})`);
                }
            }
        }

        return triggeredAlert;
    }
}

export const poolLevelAlertMonitor = PoolLevelAlertMonitor.getInstance();
