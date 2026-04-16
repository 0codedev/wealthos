import React, { useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { db, Trade } from '../../database';
import { useToast } from '../shared/ToastProvider';
import { useSandboxStore } from '../../store/sandboxStore';

let inFlightSync: Promise<{ success: boolean; count: number; error?: string }> | null = null;
let lastSyncTimestamp = 0;
let lastSyncResult: { success: boolean; count: number; error?: string } = { success: true, count: 0 };
const SYNC_COOLDOWN_MS = 60_000;

export async function syncSandboxTradesFromApi(force = false): Promise<{ success: boolean; count: number; error?: string }> {
    const now = Date.now();
    if (!force && inFlightSync) {
        return inFlightSync;
    }
    if (!force && now - lastSyncTimestamp < SYNC_COOLDOWN_MS && lastSyncResult.success) {
        return lastSyncResult;
    }

    inFlightSync = (async () => {
        try {
            const response = await fetch('/api/python-nse/api/openalgo/sync-sandbox-trades');
            if (!response.ok) {
                throw new Error(`Server returned status: ${response.status}`);
            }

            const result = await response.json();
            if (result.status !== 'success' || !Array.isArray(result.trades)) {
                throw new Error(result.message || 'Invalid sandbox response format');
            }

            const incomingTrades: Trade[] = result.trades;
            if (incomingTrades.length === 0) {
                lastSyncTimestamp = Date.now();
                lastSyncResult = { success: true, count: 0 };
                return lastSyncResult;
            }

            // Remove existing SANDBOX trades and insert new ones atomically in a single Dexie transaction,
            // while preserving user soft-deletions and manual journal annotations (mistakes, custom notes)
            await db.transaction('rw', db.trades, async () => {
                const allTrades = await db.trades.toArray();
                const existingSandboxTrades = allTrades.filter(
                    t => t.source === 'SANDBOX' || (t.broker as string) === 'openalgo_sandbox'
                );

                // Remember user-deleted trades so auto-sync never resurrects them
                const deletedTradeKeys = new Set(
                    existingSandboxTrades
                        .filter(t => t.isDeleted)
                        .map(t => `${t.ticker}_${t.date}_${t.entryTime || ''}`)
                );

                // Preserve user-edited journal notes and mistakes
                const userEditsMap = new Map<string, Partial<Trade>>();
                for (const t of existingSandboxTrades) {
                    if (!t.isDeleted && (t.mistakes?.length || t.notes || (t.moodExit && t.moodExit !== 'Satisfied'))) {
                        userEditsMap.set(`${t.ticker}_${t.date}_${t.entryTime || ''}`, {
                            mistakes: t.mistakes,
                            notes: t.notes,
                            moodEntry: t.moodEntry,
                            moodExit: t.moodExit
                        });
                    }
                }

                const sandboxTradeIds = existingSandboxTrades
                    .map(t => t.id)
                    .filter((id): id is number => id !== undefined);

                if (sandboxTradeIds.length > 0) {
                    await db.trades.bulkDelete(sandboxTradeIds);
                }

                // Filter out trades the user explicitly deleted, and merge user edits
                const tradesToInsert = incomingTrades
                    .filter(t => !deletedTradeKeys.has(`${t.ticker}_${t.date}_${t.entryTime || ''}`))
                    .map(t => {
                        const key = `${t.ticker}_${t.date}_${t.entryTime || ''}`;
                        const edits = userEditsMap.get(key);
                        return edits ? { ...t, ...edits } : t;
                    });

                if (tradesToInsert.length > 0) {
                    await db.trades.bulkAdd(tradesToInsert);
                }
            });

            lastSyncTimestamp = Date.now();
            lastSyncResult = { success: true, count: incomingTrades.length };
            return lastSyncResult;
        } catch (error: any) {
            return { success: false, count: 0, error: error.message || String(error) };
        } finally {
            inFlightSync = null;
        }
    })();

    return inFlightSync;
}

export const SyncSandboxTradesButton: React.FC = () => {
    const isSandbox = useSandboxStore(state => state.isSandboxMode);
    const [isSyncing, setIsSyncing] = useState(false);
    const { toast } = useToast();

    // Hook rules: Early return must occur AFTER all hooks have been declared unconditionally
    if (!isSandbox) return null;

    const handleSync = async () => {
        setIsSyncing(true);
        try {
            const res = await syncSandboxTradesFromApi(true);
            if (res.success) {
                if (res.count === 0) {
                    toast.info('No sandbox trades found in OpenAlgo ledger.');
                } else {
                    toast.success(`Loaded ${res.count} sandbox trade(s) from OpenAlgo ledger!`);
                }
            } else {
                console.error('Failed to sync sandbox trades:', res.error);
                toast.error(`Failed to load sandbox trades: ${res.error}`);
            }
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-bold rounded-lg border border-amber-500/30 transition-all disabled:opacity-50 shadow-sm"
            title="Pull latest executed sandbox trades from OpenAlgo"
        >
            <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
            <span>{isSyncing ? 'Loading Sandbox...' : 'Sync Sandbox Trades'}</span>
            <Sparkles size={12} className="text-amber-400 opacity-80" />
        </button>
    );
};

