/**
 * WealthOS 7-Day Notification Persistence & Auto-Pruning Service
 * Captures all toasts, push notifications, and system alerts, saves them with a strict
 * 7-day retention limit, auto-prunes records older than 7 days, and flushes to the project repository.
 */

export interface PersistedNotification {
    id: string;
    title?: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info' | 'undo' | 'trade' | 'system' | 'market';
    timestamp: number;
    read: boolean;
    source?: string;
    actionLabel?: string;
}

const STORAGE_KEY = 'wealth_notifications_7d_v1';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const FLUSH_ENDPOINT = '/__notifications';

class NotificationPersistenceService {
    private notifications: PersistedNotification[] = [];
    private listeners: Set<(items: PersistedNotification[]) => void> = new Set();
    private pendingFlush: PersistedNotification[] = [];

    constructor() {
        if (typeof window !== 'undefined') {
            this.loadAndPrune();
            this.initListeners();

            // Run auto-pruning every 30 minutes
            setInterval(() => this.loadAndPrune(), 30 * 60 * 1000);

            // Flush new items to project repository every 10 seconds
            setInterval(() => this.flushToDisk(), 10000);
            window.addEventListener('beforeunload', () => this.flushToDisk());
        }
    }

    private loadAndPrune() {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const now = Date.now();
            const cutoff = now - RETENTION_MS;

            if (raw) {
                const parsed: PersistedNotification[] = JSON.parse(raw);
                // Strict 7-day filter
                this.notifications = parsed.filter(n => n.timestamp >= cutoff);
            } else {
                this.notifications = [];
            }
            this.saveToStorage();
        } catch (err) {
            console.error('[NotificationPersistence] Error loading notifications:', err);
            this.notifications = [];
        }
    }

    private saveToStorage() {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notifications));
            this.notifyListeners();
        } catch (err) {
            console.error('[NotificationPersistence] Error saving notifications:', err);
        }
    }

    private notifyListeners() {
        const copy = [...this.notifications];
        this.listeners.forEach(fn => fn(copy));
    }

    private initListeners() {
        // Listen to app-toast events from ToastProvider
        window.addEventListener('app-toast', (e: Event) => {
            const customEvent = e as CustomEvent<{
                message: string;
                type: 'success' | 'error' | 'warning' | 'info' | 'undo';
                options?: { title?: string; action?: { label: string } };
            }>;
            if (customEvent.detail) {
                this.addNotification({
                    message: customEvent.detail.message,
                    type: customEvent.detail.type || 'info',
                    title: customEvent.detail.options?.title,
                    actionLabel: customEvent.detail.options?.action?.label,
                    source: 'App Toast'
                });
            }
        });

        // Listen to system alert broadcasts
        window.addEventListener('wealth-system-alert', (e: Event) => {
            const customEvent = e as CustomEvent<{ title?: string; message: string; type?: any; source?: string }>;
            if (customEvent.detail) {
                this.addNotification({
                    title: customEvent.detail.title || 'System Alert',
                    message: customEvent.detail.message,
                    type: customEvent.detail.type || 'system',
                    source: customEvent.detail.source || 'System Core'
                });
            }
        });
    }

    public addNotification(item: Omit<PersistedNotification, 'id' | 'timestamp' | 'read'>) {
        const now = Date.now();
        const notification: PersistedNotification = {
            id: `notif_${now}_${Math.random().toString(36).substring(2, 6)}`,
            timestamp: now,
            read: false,
            ...item
        };

        // Deduplicate if identical message arrived within 2 seconds
        const isDuplicate = this.notifications.some(
            n => n.message === notification.message && (now - n.timestamp) < 2000
        );

        if (!isDuplicate) {
            this.notifications.unshift(notification);
            this.pendingFlush.push(notification);
            this.loadAndPrune();
        }
    }

    public getNotifications(): PersistedNotification[] {
        return [...this.notifications];
    }

    public getUnreadCount(): number {
        return this.notifications.filter(n => !n.read).length;
    }

    public markAllAsRead() {
        this.notifications = this.notifications.map(n => ({ ...n, read: true }));
        this.saveToStorage();
    }

    public markAsRead(id: string) {
        this.notifications = this.notifications.map(n => n.id === id ? ({ ...n, read: true }) : n);
        this.saveToStorage();
    }

    public clearAll() {
        this.notifications = [];
        this.saveToStorage();
    }

    public subscribe(fn: (items: PersistedNotification[]) => void): () => void {
        this.listeners.add(fn);
        fn([...this.notifications]);
        return () => this.listeners.delete(fn);
    }

    public async flushToDisk(): Promise<void> {
        if (this.pendingFlush.length === 0 || typeof window === 'undefined') return;

        const payload = [...this.pendingFlush];
        this.pendingFlush = [];

        try {
            await fetch(FLUSH_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true
            });
        } catch {
            // Restore to pending on failure
            this.pendingFlush = [...payload, ...this.pendingFlush];
        }
    }
}

export const notificationPersistenceService = new NotificationPersistenceService();
