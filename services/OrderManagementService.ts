import { LifecycleAction } from './TelegramSignalParser';
import { dhanOrderService } from './DhanOrderService';
import { logger } from './Logger';
import { TrustAuditor } from './TrustAuditor';

interface ManagedOrder {
    symbol: string;
    orderId: string;
    securityId: string;
    channelId?: string;
    initialPrice?: number;
}

export class OrderManagementService {
    private static managedOrders: Map<string, ManagedOrder> = new Map();
    private static activityLogs: { id: string, text: string, time: string, type: 'INFO' | 'SUCCESS' | 'WARN' }[] = [];

    static getLogs() {
        return this.activityLogs;
    }

    static getManagedCount() {
        return this.managedOrders.size;
    }

    private static addLog(text: string, type: 'INFO' | 'SUCCESS' | 'WARN' = 'INFO') {
        const id = Math.random().toString(36).substring(7);
        const time = new Date().toLocaleTimeString();
        this.activityLogs = [{ id, text, time, type }, ...this.activityLogs].slice(0, 10);
    }

    /**
     * Registers an executed order for Shadow Management.
     */
    static registerManagedOrder(symbol: string, orderId: string, securityId: string, channelId?: string) {
        this.managedOrders.set(symbol, { symbol, orderId, securityId, channelId });
        logger.info(`ShadowManager: Now tracking ${symbol} (Order: ${orderId}) from channel ${channelId}`);
        this.addLog(`Now tracking ${symbol} (SL Governor Active)`, 'SUCCESS');
    }

    /**
     * Processes a lifecycle action and applies it to the linked Dhan order.
     */
    static async applyLifecycleAction(action: LifecycleAction) {
        try {
            // 1. Find the managed order
            // We search for a symbol match. Since Telegram symbols are messy, we do a fuzzy check.
            let linkedOrderKey = Array.from(this.managedOrders.keys()).find(k => 
                action.tradingSymbol ? action.tradingSymbol.includes(k) || k.includes(action.tradingSymbol) : false
            );

            // If no explicit symbol in action, try to find any active managed order (for single trade setups)
            if (!linkedOrderKey && this.managedOrders.size === 1) {
                linkedOrderKey = this.managedOrders.keys().next().value;
            }

            if (!linkedOrderKey) {
                logger.warn('ShadowManager: Could not find a managed order for this lifecycle update', action.rawText);
                return;
            }

            const managed = this.managedOrders.get(linkedOrderKey)!;

            // 2. Execute Action
            switch (action.action) {
                case 'MODIFY_SL':
                case 'MOVE_SL':
                    if (action.newValue) {
                        await this.modifyStopLoss(managed.orderId, action.newValue);
                    }
                    break;
                
                case 'BOOK_PROFIT':
                    await this.modifyStopLoss(managed.orderId, action.newValue || 0);
                    if (managed.channelId) {
                        TrustAuditor.recordOutcome(managed.channelId, true, 1); // ROI 1 as proxy for success
                    }
                    break;

                case 'FULL_EXIT':
                    await this.squareOffPosition(managed.orderId);
                    break;

                case 'PARTIAL_EXIT':
                    logger.info('ShadowManager: Partial exit requested, but not yet implemented for automated flow.');
                    break;

                default:
                    logger.info('ShadowManager: No automated action for this update type.');
            }
            
            this.addLog(`${action.action} applied to ${linkedOrderKey}`, 'INFO');
        } catch (error) {
            logger.error('ShadowManager: Action application failed', error);
            this.addLog(`Failed to apply ${action.action}`, 'WARN');
        }
    }

    /**
     * Modifies the Stop Loss of an existing Dhan order.
     */
    private static async modifyStopLoss(orderId: string, newPrice: number) {
        logger.info(`ShadowManager: Modifying SL for order ${orderId} to ${newPrice}`);
        
        try {
            const orders = await dhanOrderService.getOrders();
            const order = orders.find((o: any) => o.orderId === orderId);

            if (!order) {
                logger.error(`ShadowManager: Order ${orderId} not found in Dhan active orders.`);
                return;
            }

            // In Dhan, to modify a Stop Loss order, we update the price and triggerPrice
            await dhanOrderService.modifyOrder(orderId, {
                price: newPrice,
                triggerPrice: newPrice,
                quantity: order.quantity,
                orderType: order.orderType,
                validity: order.validity as any
            });
            
            this.addLog(`SL Modified: ${order.tradingSymbol} → ${newPrice}`, 'SUCCESS');
            logger.info(`ShadowManager: Successfully modified SL for ${order.tradingSymbol} to ${newPrice}`);
        } catch (error) {
            logger.error('ShadowManager: SL Modification failed', error);
        }
    }

    /**
     * Sells/Closes the position completely.
     */
    private static async squareOffPosition(orderId: string) {
        logger.info(`ShadowManager: Squaring off position for order ${orderId}`);
        try {
            const orders = await dhanOrderService.getOrders();
            const order = orders.find((o: any) => o.orderId === orderId);

            if (!order) {
                logger.error(`ShadowManager: Order ${orderId} not found for square off.`);
                return;
            }

            // Place an opposite market order to close
            await dhanOrderService.placeOrder({
                transactionType: order.transactionType === 'BUY' ? 'SELL' : 'BUY',
                exchangeSegment: order.exchangeSegment as any,
                productType: order.productType as any,
                orderType: 'MARKET',
                validity: 'DAY',
                tradingSymbol: order.tradingSymbol,
                securityId: order.securityId,
                quantity: order.quantity,
                price: 0,
                triggerPrice: 0
            });

            this.addLog(`SQUARED OFF: ${order.tradingSymbol}`, 'SUCCESS');
            logger.info(`ShadowManager: Successfully squared off ${order.tradingSymbol}`);

            // Update Trust Auditor & Cleanup
            const managed = this.managedOrders.get(order.tradingSymbol);
            if (managed?.channelId) {
                TrustAuditor.recordOutcome(managed.channelId, true, 0.5); 
            }
            this.managedOrders.delete(order.tradingSymbol);

        } catch (error) {
            logger.error('ShadowManager: Square off failed', error);
            this.addLog('Failed to square off position', 'WARN');
        }
    }
}
