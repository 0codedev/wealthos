/**
 * NotificationService - Browser Push Notifications for Wealth Aggregator
 * Handles permission requests, sending notifications, and scheduling alerts.
 */

import { db, Alert } from '../database';
import { useSettingsStore } from '../store/settingsStore';

export type NotificationType = 'price_target' | 'stop_loss' | 'sip_reminder' | 'tax_deadline' | 'custom';


interface NotificationOptions {
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    requireInteraction?: boolean;
    data?: any;
}

class NotificationService {
    private static instance: NotificationService;
    private permission: NotificationPermission = 'default';

    private constructor() {
        if ('Notification' in window) {
            this.permission = Notification.permission;
        }
    }

    static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    /**
     * Check if notifications are supported
     */
    isSupported(): boolean {
        return 'Notification' in window;
    }

    /**
     * Check current permission status
     */
    getPermission(): NotificationPermission {
        return this.permission;
    }

    /**
     * Request notification permission from user
     */
    async requestPermission(): Promise<NotificationPermission> {
        if (!this.isSupported()) {
            console.warn('Notifications not supported in this browser');
            return 'denied';
        }

        try {
            this.permission = await Notification.requestPermission();
            return this.permission;
        } catch (error) {
            console.error('Error requesting notification permission:', error);
            return 'denied';
        }
    }

    /**
     * Send a notification immediately
     */
    async send(options: NotificationOptions): Promise<Notification | null> {
        if (!this.isSupported()) {
            this.triggerToastFallback(options);
            return null;
        }

        if (this.permission !== 'granted') {
            const newPermission = await this.requestPermission();
            if (newPermission !== 'granted') {
                this.triggerToastFallback(options);
                return null;
            }
        }

        try {
            if ('serviceWorker' in navigator) {
                try {
                    const registration = await navigator.serviceWorker.ready;
                    if (registration && 'showNotification' in registration) {
                        const swOptions: any = {
                            body: options.body,
                            icon: options.icon || '/favicon.ico',
                            tag: options.tag,
                            requireInteraction: options.requireInteraction || false,
                            data: {
                                ...options.data,
                                url: options.data?.url || '/?tab=pool'
                            },
                            actions: [
                                { action: 'open-pool', title: '📊 Open Pool' }
                            ]
                        };
                        await registration.showNotification(options.title, swOptions);
                        return null;
                    }
                } catch (swErr) {
                    console.warn('[NotificationService] Service Worker ready check failed, using standard Notification fallback:', swErr);
                }
            }

            const notification = new Notification(options.title, {
                body: options.body,
                icon: options.icon || '/favicon.ico',
                tag: options.tag,
                requireInteraction: options.requireInteraction || false,
                data: options.data,
            });

            notification.onclick = (event) => {
                event.preventDefault();
                window.focus();
                notification.close();
            };

            // Auto-close notification after 5 seconds to prevent browser notification pile-ups
            setTimeout(() => {
                try {
                    notification.close();
                } catch (e) {
                    // Ignore if already closed or disposed
                }
            }, 5000);

            return notification;
        } catch (error) {
            console.error('Error sending notification:', error);
            this.triggerToastFallback(options);
            return null;
        }
    }

    private triggerToastFallback(options: NotificationOptions) {
        if (typeof window !== 'undefined') {
            let toastType: 'success' | 'error' | 'warning' | 'info' = 'info';
            const titleUpper = options.title.toUpperCase();
            if (
                titleUpper.includes('🚨') || 
                titleUpper.includes('STOP') || 
                titleUpper.includes('WARN') || 
                titleUpper.includes('ERROR') || 
                titleUpper.includes('SHIELD') || 
                titleUpper.includes('LEAK') ||
                titleUpper.includes('PEAK')
            ) {
                toastType = 'warning';
            } else if (
                titleUpper.includes('🎯') || 
                titleUpper.includes('SUCCESS') || 
                titleUpper.includes('ACHIEV') || 
                titleUpper.includes('BULLSEYE') ||
                titleUpper.includes('WIN')
            ) {
                toastType = 'success';
            }

            window.dispatchEvent(new CustomEvent('app-toast', {
                detail: {
                    message: `${options.title}: ${options.body}`,
                    type: toastType,
                    options: {
                        duration: 8000,
                        action: {
                            label: 'View',
                            onClick: () => {
                                window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { category: 'signals' } }));
                            }
                        }
                    }
                }
            }));
        }
    }

    /**
     * Create a price target alert
     */
    async createPriceAlert(
        assetId: string,
        assetName: string,
        targetPrice: number,
        type: 'price_target' | 'stop_loss'
    ): Promise<number> {
        const title = type === 'price_target'
            ? `Bullseye Radar: ${assetName} 🎯`
            : `Shield Alert: ${assetName} 🛡️`;

        const description = type === 'price_target'
            ? `Ready to book? ${assetName} is approaching your target of ₹${targetPrice.toLocaleString('en-IN')}.`
            : `Heads up! ${assetName} is nearing your stop loss at ₹${targetPrice.toLocaleString('en-IN')}. Check your thesis.`;

        const id = await db.alerts.add({
            type,
            title,
            description,
            triggerValue: targetPrice,
            assetId,
            isActive: true,
            createdAt: new Date().toISOString(),
            notified: false,
        });

        return id as number;
    }

    /**
     * Create a SIP reminder
     */
    async createSIPReminder(
        assetName: string,
        dayOfMonth: number
    ): Promise<number> {
        const id = await db.alerts.add({
            type: 'sip_reminder',
            title: `Compounding Fuel: ${assetName} ⏳`,
            description: `Your monthly discipline for ${assetName} is due on day ${dayOfMonth}. Ensure your bank is funded!`,
            triggerValue: dayOfMonth,
            isActive: true,
            createdAt: new Date().toISOString(),
            notified: false,
        });

        return id as number;
    }

    /**
     * Create a tax deadline alert
     */
    async createTaxDeadline(
        title: string,
        description: string,
        deadlineDate: Date
    ): Promise<number> {
        const id = await db.alerts.add({
            type: 'tax_deadline',
            title,
            description,
            triggerValue: deadlineDate.getTime(),
            isActive: true,
            createdAt: new Date().toISOString(),
            notified: false,
        });

        return id as number;
    }

    /**
     * Get all active alerts
     */
    async getActiveAlerts(): Promise<Alert[]> {
        return db.alerts.where('isActive').equals(1).toArray();
    }

    /**
     * Deactivate an alert
     */
    async deactivateAlert(id: number): Promise<void> {
        await db.alerts.update(id, { isActive: false });
    }

    /**
     * Delete an alert
     */
    async deleteAlert(id: number): Promise<void> {
        await db.alerts.delete(id);
    }

    /**
     * Mark an alert as notified
     */
    async markAsNotified(id: number): Promise<void> {
        await db.alerts.update(id, {
            notified: true,
            triggeredAt: new Date().toISOString()
        });
    }

    /**
     * Breakthrough 5: The Nervous System
     * Sends a webhook to n8n for external automation (Telegram, Notion, etc.)
     */
    async sendToNervousSystem(event: string, payload: any): Promise<boolean> {
        const { n8nWebhookUrl } = useSettingsStore.getState();
        if (!n8nWebhookUrl) {
            console.warn('n8n Nervous System: Webhook URL not configured. Skipping alert.');
            return false;
        }

        try {
            const response = await fetch(n8nWebhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event,
                    timestamp: new Date().toISOString(),
                    data: payload
                }),
            });

            if (!response.ok) {
                console.error(`n8n Nervous System: Failed to deliver event (${response.status})`);
                return false;
            }

            console.info(`n8n Nervous System: Event '${event}' delivered successfully.`);
            return true;
        } catch (error) {
            console.error('n8n Nervous System: Network error', error);
            return false;
        }
    }

    /**
     * Check if n8n webhook URL is configured
     */
    isN8NConfigured(): boolean {
        const { n8nWebhookUrl } = useSettingsStore.getState();
        return !!n8nWebhookUrl;
    }

    /**
     * Check and trigger SIP reminders for today
     */
    async checkSIPReminders(): Promise<void> {
        const today = new Date().getDate();
        const sipAlerts = await db.alerts
            .where('type')
            .equals('sip_reminder')
            .and(a => a.isActive && !a.notified && a.triggerValue === today)
            .toArray();

        for (const alert of sipAlerts) {
            await this.send({
                title: "Compounding Fuel: Ready? ⏳",
                body: alert.description,
                tag: `sip-${alert.id}`,
            });
            await this.markAsNotified(alert.id!);
        }
    }

    /**
     * Check tax deadline alerts (notify 7 days before)
     */
    async checkTaxDeadlines(): Promise<void> {
        const now = Date.now();
        const sevenDaysFromNow = now + (7 * 24 * 60 * 60 * 1000);

        const taxAlerts = await db.alerts
            .where('type')
            .equals('tax_deadline')
            .and(a =>
                a.isActive &&
                !a.notified &&
                a.triggerValue! <= sevenDaysFromNow &&
                a.triggerValue! > now
            )
            .toArray();

        for (const alert of taxAlerts) {
            const daysLeft = Math.ceil((alert.triggerValue! - now) / (24 * 60 * 60 * 1000));
            await this.send({
                title: `Tax Clock: T-${daysLeft} Days 🧾`,
                body: `${alert.description}. Loss harvesting window is closing.`,
                tag: `tax-${alert.id}`,
                requireInteraction: true,
            });
            await this.markAsNotified(alert.id!);
        }
    }

    /**
     * SMART TRIGGERS (Agent Z Enhancement)
     */
    
    // 1. Morning Market Brief
    async triggerMorningBrief(netWorth: number, niftyPoints: number) {
        await this.send({
            title: "Market Sunrise 🌅",
            body: `Good morning! Portfolio starting at ₹${netWorth.toLocaleString('en-IN')}. Nifty futures: ${niftyPoints >= 0 ? '+' : ''}${niftyPoints} pts. Ready for the bell?`,
            tag: 'morning-brief'
        });
    }

    // 2. Milestone Celebrations
    async checkMilestones(newNetWorth: number, oldNetWorth: number) {
        const milestones = [
            { val: 1000000, label: '₹10 Lakh', msg: "You've crossed ₹10 Lakh! 🎉 officially top-tier retail status." },
            { val: 2500000, label: '₹25 Lakh', msg: "₹25 Lakh milestone! 🏆 Time to re-evaluate your hedges." },
            { val: 5000000, label: 'Half a Crore', msg: "Half a Crore! 🚀 Legend status approaching. Keep the discipline." },
            { val: 10000000, label: 'Crorepati', msg: "You're a Crorepati! 🥂 ₹1 Crore achieved. Legacy mode activated." }
        ];

        for (const m of milestones) {
            if (newNetWorth >= m.val && oldNetWorth < m.val) {
                await this.send({
                    title: `Milestone: ${m.label}!`,
                    body: m.msg,
                    tag: `milestone-${m.val}`,
                    requireInteraction: true
                });
            }
        }
    }

    // 3. XIRR Drop Alert
    async triggerXIRRDrop(oldXirr: number, newXirr: number) {
        await this.send({
            title: "Performance Leak ⚠️",
            body: `Your XIRR dropped from ${oldXirr.toFixed(1)}% to ${newXirr.toFixed(1)}% this week. Audit your laggards.`,
            tag: 'xirr-drop'
        });
    }

    // 4. Inactivity Journal Reminder
    async triggerJournalReminder() {
        await this.send({
            title: "Process Decay 📝",
            body: "You haven't journaled a trade in 3 days. Reflection is where the alpha lives. Log your sessions.",
            tag: 'journal-reminder'
        });
    }

    // 6. Big Single-Day P&L
    async triggerSingleStockMove(ticker: string, move: number, pnl: number) {
        const isUp = move > 0;
        await this.send({
            title: `${isUp ? '🟢' : '🔴'} ${ticker} ${isUp ? 'Surge' : 'Dip'}`,
            body: `${ticker} is ${isUp ? 'up' : 'down'} ${Math.abs(move).toFixed(1)}% today! P&L impact: ${pnl >= 0 ? '+' : '-'}₹${Math.abs(pnl).toLocaleString('en-IN')}.`,
            tag: `move-${ticker}`
        });
    }

    // 7. FnO Expiry Reminder
    async triggerFnOExpiry() {
        await this.send({
            title: "Expiry Eve ⚡",
            body: "FnO expiry tomorrow. Remember to square off or roll over your options before 3:30 PM.",
            tag: 'fno-expiry'
        });
    }

    // 9. Goal Proximity Alert
    async triggerGoalProximity(goalName: string, percentLeft: number, remainingAmt: number) {
        await this.send({
            title: "Almost Home 🎯",
            body: `You're ${100 - percentLeft}% of the way to ${goalName}! Only ₹${remainingAmt.toLocaleString('en-IN')} more to go.`,
            tag: `goal-${goalName}`
        });
    }

    // 10. Achievement Earned
    async triggerAchievementUnlocked(title: string) {
        await this.send({
            title: "Glory Unlocked 🏅",
            body: `Achievement: "${title}" earned! Your mastery journey is ascending.`,
            tag: `achievement-${title}`
        });
    }
}

// Export singleton instance
export const notificationService = NotificationService.getInstance();

export default NotificationService;
