import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AlertType = 'PRICE' | 'PL_TARGET' | 'SIP_REMINDER' | 'IPO' | 'CUSTOM';
export type AlertCondition = 'ABOVE' | 'BELOW' | 'EQUALS';

export interface Alert {
    id: string;
    type: AlertType;
    name: string;
    description?: string;

    // For PRICE alerts
    assetName?: string;
    targetPrice?: number;
    condition?: AlertCondition;

    // For PL_TARGET alerts
    targetPLPercent?: number;

    // For SIP_REMINDER
    sipDay?: number; // Day of month (1-31)
    sipAmount?: number;

    // For IPO alerts
    ipoName?: string;

    // Common
    isActive: boolean;
    isTriggered: boolean;
    createdAt: string;
    triggeredAt?: string;
    notifyVia: ('BROWSER' | 'TELEGRAM')[];
}

interface AlertsState {
    alerts: Alert[];
    addAlert: (alert: Omit<Alert, 'id' | 'createdAt' | 'isTriggered'>) => void;
    removeAlert: (id: string) => void;
    toggleAlert: (id: string) => void;
    triggerAlert: (id: string) => void;
    resetAlert: (id: string) => void;
    clearTriggered: () => void;
}

export const useAlertsStore = create<AlertsState>()(
    persist(
        (set) => ({
            alerts: [],

            addAlert: (alertData) => set((state) => {
                const newAlerts = [
                    ...state.alerts,
                    {
                        ...alertData,
                        id: crypto.randomUUID ? crypto.randomUUID() : `alert_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        createdAt: new Date().toISOString(),
                        isTriggered: false,
                    }
                ];

                // Keep only the most recent 200 alerts to prevent unbounded growth
                if (newAlerts.length > 200) {
                    return { alerts: newAlerts.slice(newAlerts.length - 200) };
                }
                return { alerts: newAlerts };
            }),

            removeAlert: (id) => set((state) => ({
                alerts: state.alerts.filter(a => a.id !== id)
            })),

            toggleAlert: (id) => set((state) => ({
                alerts: state.alerts.map(a =>
                    a.id === id ? { ...a, isActive: !a.isActive } : a
                )
            })),

            triggerAlert: (id) => set((state) => ({
                alerts: state.alerts.map(a =>
                    a.id === id ? { ...a, isTriggered: true, triggeredAt: new Date().toISOString() } : a
                )
            })),

            resetAlert: (id) => set((state) => ({
                alerts: state.alerts.map(a =>
                    a.id === id ? { ...a, isTriggered: false, triggeredAt: undefined } : a
                )
            })),

            clearTriggered: () => set((state) => ({
                alerts: state.alerts.map(a => ({ ...a, isTriggered: false, triggeredAt: undefined }))
            })),
        }),
        {
            name: 'wealth-aggregator-alerts',
        }
    )
);

// Helper to check if browser notifications are supported
export const requestNotificationPermission = async (): Promise<boolean> => {
    if (!('Notification' in window)) {
        console.warn('Browser does not support notifications');
        return false;
    }

    if (Notification.permission === 'granted') {
        return true;
    }

    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }

    return false;
};

export const sendBrowserNotification = (title: string, body: string, icon?: string) => {
    if (Notification.permission === 'granted') {
        new Notification(title, {
            body,
            icon: icon || '/favicon.ico',
            badge: '/favicon.ico',
        });
    }
};
