/**
 * WealthOS Offline Mutation Queue with Optimistic Auto-Replay
 * Captures user mutations made while offline (transactions, notes, journal logs),
 * persists them securely in local storage, and seamlessly replays them upon reconnection.
 */

import { showToast } from '../components/shared/ToastProvider';

export interface QueuedMutation {
    id: string;
    type: 'ADD_TRANSACTION' | 'UPDATE_TRANSACTION' | 'DELETE_TRANSACTION' | 'ADD_TRADE' | 'UPDATE_GOAL' | 'CUSTOM';
    payload: any;
    timestamp: number;
    retryCount: number;
}

const QUEUE_STORAGE_KEY = 'wealth_offline_mutation_queue_v1';

class OfflineQueueService {
    private queue: QueuedMutation[] = [];
    private listeners: Set<(queue: QueuedMutation[]) => void> = new Set();
    private isProcessing = false;

    constructor() {
        this.loadQueue();
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                this.replayQueue();
            });
        }
    }

    private loadQueue() {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
            if (raw) {
                this.queue = JSON.parse(raw);
            }
        } catch (e) {
            console.error('[OfflineQueue] Failed to load queue from storage:', e);
            this.queue = [];
        }
    }

    private saveQueue() {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
            this.notifyListeners();
        } catch (e) {
            console.error('[OfflineQueue] Failed to save queue:', e);
        }
    }

    private notifyListeners() {
        this.listeners.forEach(fn => fn([...this.queue]));
    }

    public subscribe(fn: (queue: QueuedMutation[]) => void): () => void {
        this.listeners.add(fn);
        fn([...this.queue]);
        return () => this.listeners.delete(fn);
    }

    public getPendingCount(): number {
        return this.queue.length;
    }

    public enqueue(type: QueuedMutation['type'], payload: any) {
        const item: QueuedMutation = {
            id: `mut_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            type,
            payload,
            timestamp: Date.now(),
            retryCount: 0
        };

        this.queue.push(item);
        this.saveQueue();

        if (!navigator.onLine) {
            showToast('Saved offline. Will auto-sync when connection restores.', 'info', { duration: 4000 });
        } else {
            this.replayQueue();
        }
    }

    public async replayQueue(): Promise<void> {
        if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) return;

        this.isProcessing = true;
        const total = this.queue.length;

        try {
            while (this.queue.length > 0 && navigator.onLine) {
                const item = this.queue[0];
                
                // Process the mutation
                await this.executeMutation(item);

                // Remove successfully executed mutation
                this.queue.shift();
                this.saveQueue();
            }

            if (total > 0 && this.queue.length === 0) {
                showToast(`🔄 Synced ${total} offline action${total > 1 ? 's' : ''} successfully!`, 'success', { duration: 4000 });
            }
        } catch (err) {
            console.warn('[OfflineQueue] Error replaying mutations:', err);
        } finally {
            this.isProcessing = false;
        }
    }

    private async executeMutation(item: QueuedMutation): Promise<void> {
        // Dispatch synthetic event for subscribers/stores to handle
        window.dispatchEvent(new CustomEvent('wealth_offline_mutation_replay', { detail: item }));
        // Artificial short delay to prevent thrashing
        await new Promise(r => setTimeout(r, 100));
    }
}

export const offlineQueueService = new OfflineQueueService();
