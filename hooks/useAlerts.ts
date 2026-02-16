import { useCallback, useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db, Alert } from '../database';
import { Investment } from '../types';
import { notificationService } from '../services/NotificationService';

interface UseAlertsResult {
    alerts: Alert[];
    activeAlerts: Alert[];

    // Actions
    createPriceAlert: (investment: Investment, targetPrice: number, type: 'price_target' | 'stop_loss') => Promise<void>;
    createSIPReminder: (investment: Investment) => Promise<void>;
    createTaxDeadline: (title: string, description: string, deadline: Date) => Promise<void>;
    deleteAlert: (id: number) => Promise<void>;
    toggleAlert: (id: number) => Promise<void>;

    // Permission
    hasPermission: boolean;
    requestPermission: () => Promise<void>;

    // Check for triggered alerts
    checkAlerts: (investments: Investment[]) => Promise<void>;
}

/**
 * Hook for managing smart portfolio alerts with browser notifications.
 */
export function useAlerts(): UseAlertsResult {
    const [hasPermission, setHasPermission] = useState(false);
    const [alerts, setAlerts] = useState<Alert[]>([]);

    // Check permission on mount
    useEffect(() => {
        setHasPermission(notificationService.getPermission() === 'granted');
    }, []);

    // Live query for all alerts
    useEffect(() => {
        const subscription = liveQuery(() => db.alerts.orderBy('createdAt').reverse().toArray())
            .subscribe(setAlerts);
        return () => subscription.unsubscribe();
    }, []);

    // Filter active alerts
    const activeAlerts = alerts.filter(a => a.isActive);

    // Request notification permission
    const requestPermission = useCallback(async () => {
        const permission = await notificationService.requestPermission();
        setHasPermission(permission === 'granted');
    }, []);

    // Create price alert
    const createPriceAlert = useCallback(async (
        investment: Investment,
        targetPrice: number,
        type: 'price_target' | 'stop_loss'
    ) => {
        await notificationService.createPriceAlert(
            investment.id,
            investment.name,
            targetPrice,
            type
        );
    }, []);

    // Create SIP reminder
    const createSIPReminder = useCallback(async (investment: Investment) => {
        if (!investment.recurring?.isEnabled) return;

        // Default to 1st of month if no date specified
        const dayOfMonth = 1;
        await notificationService.createSIPReminder(investment.name, dayOfMonth);
    }, []);

    // Create tax deadline
    const createTaxDeadline = useCallback(async (
        title: string,
        description: string,
        deadline: Date
    ) => {
        await notificationService.createTaxDeadline(title, description, deadline);
    }, []);

    // Delete alert
    const deleteAlert = useCallback(async (id: number) => {
        await notificationService.deleteAlert(id);
    }, []);

    // Toggle alert active status
    const toggleAlert = useCallback(async (id: number) => {
        const alert = await db.alerts.get(id);
        if (alert) {
            await db.alerts.update(id, { isActive: !alert.isActive });
        }
    }, []);

    // Check if any price alerts are triggered
    const checkAlerts = useCallback(async (investments: Investment[]) => {
        const priceAlerts = await db.alerts
            .where('type')
            .anyOf(['price_target', 'stop_loss'])
            .and(a => a.isActive && !a.notified)
            .toArray();

        for (const alert of priceAlerts) {
            const investment = investments.find(i => i.id === alert.assetId);
            if (!investment) continue;

            const currentPrice = investment.currentValue / (investment.investedAmount / investment.currentValue);
            let isTriggered = false;

            if (alert.type === 'price_target' && currentPrice >= (alert.triggerValue || 0)) {
                isTriggered = true;
            } else if (alert.type === 'stop_loss' && currentPrice <= (alert.triggerValue || 0)) {
                isTriggered = true;
            }

            if (isTriggered) {
                await notificationService.send({
                    title: alert.type === 'price_target' ? '🎯 Target Hit!' : '🚨 Stop Loss Triggered!',
                    body: `${alert.title} - Current: ₹${currentPrice.toLocaleString()}`,
                    tag: `price-${alert.id}`,
                    requireInteraction: true,
                });
                await notificationService.markAsNotified(alert.id!);
            }
        }

        // Also check SIP reminders and tax deadlines
        await notificationService.checkSIPReminders();
        await notificationService.checkTaxDeadlines();
    }, []);

    return {
        alerts,
        activeAlerts,
        createPriceAlert,
        createSIPReminder,
        createTaxDeadline,
        deleteAlert,
        toggleAlert,
        hasPermission,
        requestPermission,
        checkAlerts,
    };
}

export default useAlerts;
