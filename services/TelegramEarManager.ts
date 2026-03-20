/**
 * TelegramEarManager ΓÇö robust, HMR-proof, single WebSocket connection to
 * the Multi-Ear Telegram bridge (scripts/telegram-ear-server.js) on
 * ws://127.0.0.1:8081 + http://127.0.0.1:3001.
 *
 * Why this rewrite:
 *  - The previous version had no guard against the React useEffect cleanup
 *    calling `disconnect()` on every StrictMode double-mount, causing the
 *    WS to flap (open ΓåÆ close ΓåÆ open ΓåÆ close...) and the bridge to spam
 *    `[WebSocket] UI Connected` on every cycle.
 *  - Vite HMR reloaded the module on every save, creating a NEW
 *    `TelegramEarManager` instance each time and leaking the old WS.
 *
 * The fix has 4 parts:
 *  1. **State machine** (IDLE ΓåÆ CONNECTING ΓåÆ OPEN ΓåÆ CLOSING ΓåÆ CLOSED)
 *     Every transition is guarded. Invalid transitions are no-ops.
 *  2. **globalThis singleton** ΓÇö exactly ONE instance per page load,
 *     regardless of how many times the module is reloaded.
 *  3. **Intentional-disconnect flag** ΓÇö when the caller asks to
 *     disconnect, the manager suppresses the auto-reconnect so we don't
 *     fight with the next mount cycle.
 *  4. **Exponential backoff + ping/pong** ΓÇö survives transient network
 *     drops and detects dead sockets.
 */
import { db, TelegramMessage, ParsedSignal, ParsedSignalRecord, SignalProvider } from '../database';
import { chatWithGroq } from './groqService';
import { useSystemHealthStore } from '../store/systemHealthStore';
import { logger } from './Logger';
import { showToast } from '../components/shared/ToastProvider';
import { useSettingsStore } from '../store/settingsStore';

export interface EarStats {
    earId: string;
    name: string;
    type: 'SIGNALS' | 'NEWS' | 'ARCHIVE';
    color: string;
    messageCount: number;
    signalCount: number;
    lastActive: number | null;
    isConnected: boolean;
    enabled?: boolean;
    channelIds?: string[] | 'ALL';
    keywords?: string[];
}

export interface EarSummary {
    earId: string;
    generatedAt: string;
    brief: string;
    keySignals: string[];
    newsHeadlines: string[];
    sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

const SIGNAL_SUMMARY_PROMPT = `You are a professional trading analyst.
You are given a list of trade signals and updates.
Synthesize these into a structured signal summary report.
Provide a general brief of active themes, highlight key active signals, list recent targets or SL hit, and estimate overall sentiment.

OUTPUT FORMAT (strict JSON):
{
  "brief": "Summary of active trade themes and signals",
  "keySignals": ["BANKNIFTY 47500 CE - Buy active near 225", "CRUDEOIL 8700 CE - Target 1 hit"],
  "newsHeadlines": [],
  "sentiment": "BULLISH" // BULLISH, BEARISH, or NEUTRAL
}

Return ONLY valid JSON.`;

const NEWS_SUMMARY_PROMPT = `You are a professional Indian market macro analyst.
You are given news headlines and market updates from Telegram.
Synthesize these into a news brief. Group by macro updates, earnings, and policy events.

OUTPUT FORMAT (strict JSON):
{
  "brief": "Comprehensive summary of news and market sentiment impact",
  "keySignals": [],
  "newsHeadlines": ["RBI policy remains unchanged", "FII flow positive"],
  "sentiment": "NEUTRAL" // BULLISH, BEARISH, or NEUTRAL

Return ONLY valid JSON.`;

const ARCHIVE_SUMMARY_PROMPT = `You are a market researcher.
Summarize the general market conversations, sentiment, and themes discussed in these messages.

OUTPUT FORMAT (strict JSON):
{
  "brief": "General market talk summary",
  "keySignals": [],
  "newsHeadlines": [],
  "sentiment": "NEUTRAL"
}

Return ONLY valid JSON.`;

export function mapDbMessageToModel(dbMsg: any): TelegramMessage {
    return {
        id: dbMsg.id,
        earId: dbMsg.earId || dbMsg.ear_id || '',
        threadId: dbMsg.threadId !== undefined ? dbMsg.threadId : (dbMsg.thread_id || undefined),
        channelName: dbMsg.channelName || dbMsg.channel_name || undefined,
        text: dbMsg.text || dbMsg.message_text || '',
        messageType: dbMsg.messageType || dbMsg.message_type || 'RAW',
        parsedJson: dbMsg.parsedJson || dbMsg.parsed_json || undefined,
        confidence: typeof dbMsg.confidence === 'number' ? dbMsg.confidence : 0,
        receivedAt: dbMsg.receivedAt || dbMsg.received_at || Date.now(),
        isStarred: dbMsg.isStarred !== undefined ? dbMsg.isStarred : (dbMsg.is_starred ? 1 : 0),
        isLifecycle: dbMsg.isLifecycle !== undefined ? dbMsg.isLifecycle : (dbMsg.is_lifecycle ? 1 : 0)
    };
}

type ConnState = 'IDLE' | 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';
type StatusEvent =
    | { type: 'connecting' }
    | { type: 'open' }
    | { type: 'closed'; reason: string }
    | { type: 'reconnect_scheduled'; delayMs: number }
    | { type: 'error'; message: string };

class TelegramEarManager {
    private ws: WebSocket | null = null;
    private state: ConnState = 'IDLE';
    private intentionalDisconnect = false;
    private reconnectTimeout: number | null = null;
    private pingInterval: number | null = null;
    private pingTimeout: number | null = null;
    private reconnectAttempts = 0;
    private lastMessageReceivedAt = Date.now();
    private listeners: Set<(event: any) => void> = new Set();
    private statusListeners: Set<(e: StatusEvent) => void> = new Set();

    // Read endpoints from .env (allow override) but keep the safe defaults
    // that match scripts/telegram-ear-server.js
    private readonly wsUrl: string =
        (typeof window !== 'undefined' && (window as any).__TELEGRAM_EAR_WS_URL__) ||
        (typeof window !== 'undefined'
            ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                ? 'ws://localhost:8081'
                : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/telegram-ear/`)
            : 'ws://localhost:8081');
    private readonly httpUrl: string =
        (typeof window !== 'undefined' && (window as any).__TELEGRAM_EAR_HTTP_URL__) ||
        (typeof window !== 'undefined'
            ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                ? 'http://localhost:3001'
                : `${window.location.protocol}//${window.location.host}/api/telegram-ear`)
            : 'http://localhost:3001');
    private readonly token: string =
        (typeof window !== 'undefined' && (window as any).__TELEGRAM_EAR_TOKEN__) ||
        (typeof window !== 'undefined' && localStorage.getItem('wealth_telegram_ear_token')) ||
        'local-dev-token-v1';

    // Tunables
    private readonly PING_INTERVAL_MS = 25_000;
    private readonly PONG_TIMEOUT_MS = 10_000;
    private readonly RECONNECT_BASE_MS = 2_000;
    private readonly RECONNECT_MAX_MS = 30_000;

    constructor() {
    }

    // ----------------------------------------------------------------
    // Connection lifecycle
    // ----------------------------------------------------------------

    /**
     * Idempotent: safe to call from every React mount, every HMR reload,
     * every navigation. The state machine guarantees a single open socket.
     */
    connect(): void {
        // Already open or in flight ΓÇö nothing to do.
        if (this.state === 'OPEN' || this.state === 'CONNECTING') {
            return;
        }
        // Caller cleared the intentional flag, so future disconnects
        // should re-arm the auto-reconnect loop.
        this.intentionalDisconnect = false;
        this.openSocket();
    }

    /**
     * Disconnect and **suppress auto-reconnect**. Use this only when the
     * caller is sure the connection should stay closed (e.g. user clicked
     * "Disconnect" or the app is shutting down).
     *
     * Do NOT call this from a React useEffect cleanup ΓÇö the WS is a
     * singleton that lives for the app lifetime.
     */
    disconnect(): void {
        this.intentionalDisconnect = true;
        this.clearTimers();
        if (this.ws) {
            // Move to CLOSING so any racing onclose handlers skip the
            // auto-reconnect branch.
            this.state = 'CLOSING';
            // Pre-empt the auto-reconnect by nullifying handlers BEFORE close.
            const ws = this.ws;
            ws.onopen = null;
            ws.onerror = null;
            ws.onmessage = null;
            ws.onclose = null;
            try { ws.close(1000, 'intentional-disconnect'); } catch { /* ignore */ }
            this.ws = null;
        }
        this.state = 'CLOSED';
        useSystemHealthStore.getState().setTelegramStatus(false);
    }

    /**
     * Force a reconnect: disconnect + immediate connect. Used by the
     * "Reconnect" button.
     */
    reconnect(): void {
        this.disconnect();
        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;
        // Defer one tick so React can finish its paint before we open.
        setTimeout(() => this.openSocket(), 0);
    }

    // ----------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------

    private openSocket(): void {
        if (this.state === 'OPEN' || this.state === 'CONNECTING') return;
        if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

        this.state = 'CONNECTING';
        const separator = this.wsUrl.includes('?') ? '&' : '?';
        const authenticatedUrl = `${this.wsUrl}${separator}token=${encodeURIComponent(this.token)}`;
        logger.info(`[TelegramEarManager] Connecting to ${this.wsUrl} (token protected)`);

        let ws: WebSocket;
        try {
            ws = new WebSocket(authenticatedUrl);
        } catch (err: any) {
            logger.error('[TelegramEarManager] WebSocket constructor threw:', err);
            this.scheduleReconnect(`ctor-throw:${err?.message ?? 'unknown'}`);
            return;
        }
        this.ws = ws;

        ws.onopen = () => {
            if (this.intentionalDisconnect) {
                // The caller asked us to disconnect, but the open raced
                // in. Close it immediately without triggering reconnect.
                try { ws.close(1000, 'post-intentional-open'); } catch { /* ignore */ }
                return;
            }
            this.state = 'OPEN';
            this.reconnectAttempts = 0;
            logger.info('[TelegramEarManager] WS OPEN');
            useSystemHealthStore.getState().setTelegramStatus(true);
            this.emitStatus({ type: 'open' });
            this.startPingLoop();
            this.syncMissedMessages().catch((err) => {
                logger.warn('[TelegramEarManager] Catch-up sync failed on open:', err);
            });
        };

        ws.onmessage = (event) => {
            this.handleIncomingMessage(event).catch((err) => {
                logger.error('[TelegramEarManager] message handler threw:', err);
            });
        };

        ws.onerror = (err) => {
            // The browser doesn't give us useful detail here. The
            // onclose that follows is what carries the actual reason.
            logger.warn('[TelegramEarManager] WS error event');
            this.emitStatus({ type: 'error', message: 'socket error' });
        };

        ws.onclose = (event) => {
            const wasOpen = this.state === 'OPEN';
            this.state = 'CLOSED';
            this.clearPingLoop();
            this.ws = null;
            useSystemHealthStore.getState().setTelegramStatus(false);
            const reason = event?.reason || `code-${event?.code ?? 'unknown'}`;
            this.emitStatus({ type: 'closed', reason });

            if (this.intentionalDisconnect) {
                logger.info(`[TelegramEarManager] WS closed (intentional): ${reason}`);
                return;
            }
            // An unexpected close ΓåÆ schedule a reconnect with backoff.
            logger.warn(`[TelegramEarManager] WS closed unexpectedly (${reason}) ΓÇö scheduling reconnect`);
            this.scheduleReconnect(reason);
        };
    }

    private scheduleReconnect(reason: string): void {
        if (this.intentionalDisconnect) return;
        if (this.reconnectTimeout) return; // already scheduled

        this.reconnectAttempts += 1;
        const delay = Math.min(
            this.RECONNECT_MAX_MS,
            this.RECONNECT_BASE_MS * Math.pow(2, Math.min(5, this.reconnectAttempts - 1))
        );
        logger.info(`[TelegramEarManager] Reconnect #${this.reconnectAttempts} in ${delay}ms (reason: ${reason})`);
        this.emitStatus({ type: 'reconnect_scheduled', delayMs: delay });

        this.reconnectTimeout = window.setTimeout(() => {
            this.reconnectTimeout = null;
            this.openSocket();
        }, delay);
    }

    // Ping/pong ΓÇö sends a small JSON ping every PING_INTERVAL_MS and
    // expects any message back within PONG_TIMEOUT_MS. The server
    // echoes any text message it receives, so this is a reliable liveness
    // check without requiring a custom ping/pong server frame.
    private startPingLoop(): void {
        this.clearPingLoop();
        this.lastMessageReceivedAt = Date.now();
        this.pingInterval = window.setInterval(() => {
            if (this.state !== 'OPEN' || !this.ws) return;
            const elapsed = Date.now() - this.lastMessageReceivedAt;
            if (elapsed > this.PING_INTERVAL_MS + this.PONG_TIMEOUT_MS) {
                logger.warn(`[TelegramEarManager] no messages for ${elapsed}ms — forcing reconnect`);
                if (this.ws) {
                    try { this.ws.close(4000, 'ping-timeout'); } catch { /* ignore */ }
                }
                return;
            }
            try {
                this.ws.send(JSON.stringify({ type: 'PING', at: Date.now() }));
            } catch (err) {
                logger.warn('[TelegramEarManager] ping send failed:', err);
            }
        }, this.PING_INTERVAL_MS);
    }

    private clearPingLoop(): void {
        if (this.pingInterval) { window.clearInterval(this.pingInterval); this.pingInterval = null; }
        if (this.pingTimeout) { window.clearTimeout(this.pingTimeout); this.pingTimeout = null; }
    }

    private clearTimers(): void {
        this.clearPingLoop();
        if (this.reconnectTimeout) {
            window.clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    private async handleIncomingMessage(event: MessageEvent): Promise<void> {
        this.lastMessageReceivedAt = Date.now();
        // Anything we receive counts as a liveness check tick — clear pingTimeout if active.
        if (this.pingTimeout) { window.clearTimeout(this.pingTimeout); this.pingTimeout = null; }

        let data: any;
        try { data = JSON.parse(event.data); } catch { return; }

        if (data?.type === 'PONG') return; // server ack
        if (data?.type === 'STATUS') {
            // Server-initiated health snapshot ΓÇö ignored at the message
            // level (it doesn't carry a parsed signal) but the manager
            // surface `clientCount` and `uptime` for future diagnostics.
            return;
        }
        if (!['NEW_SIGNAL', 'NEW_NEWS', 'NEW_ARCHIVE', 'LIFECYCLE_UPDATE'].includes(data?.type)) return;

        const msgRow: TelegramMessage = {
            id: data.id,
            earId: data.earId,
            threadId: data.threadId,
            channelName: data.channelName,
            text: data.text,
            messageType: data.parsed ? 'PARSED_SIGNAL' : (data.earId === 'news_data' ? 'NEWS' : 'RAW'),
            parsedJson: data.parsed ? JSON.stringify(data.parsed) : undefined,
            confidence: data.parsed ? 0.9 : 0.0,
            receivedAt: data.timestamp || Date.now(),
            isStarred: 0,
            isLifecycle: data.type === 'LIFECYCLE_UPDATE' ? 1 : 0
        };

        await db.telegram_messages.put(msgRow);

        if (data.parsed) {
            const parsed = data.parsed;
            const parsedSignalRow: ParsedSignal = {
                instrument: parsed.tradingSymbol || '',
                action: parsed.action || 'BUY',
                entryPrice: Number(parsed.suggestedEntryPrice) || 0,
                stopLoss: Number(parsed.stopLoss) || undefined,
                target1: parsed.targets?.[0],
                target2: parsed.targets?.[1],
                target3: parsed.targets?.[2],
                provider: data.channelName || 'Telegram',
                timestamp: new Date(data.timestamp || Date.now()).toISOString(),
                status: 'NEEDS_REVIEW',
                expiryDate: parsed.expiryDate || undefined,
                threadId: data.threadId ? String(data.threadId) : undefined
            };

            const existing = await db.parsed_signals
                .where('instrument')
                .equals(parsedSignalRow.instrument)
                .and((s) => s.provider === parsedSignalRow.provider &&
                    Math.abs(new Date(s.timestamp).getTime() - new Date(parsedSignalRow.timestamp).getTime()) < 10_000)
                .first();

            if (!existing) {
                await db.parsed_signals.put(parsedSignalRow);
            }

            // Sync to db.parsed_signal_records so it reflects in the Signal Ledger
            const parsedRecord: ParsedSignalRecord = {
                rawText: data.text,
                parsed: {
                    action: parsed.action === 'SELL' ? 'SELL' : 'BUY',
                    tradingSymbol: parsed.tradingSymbol || '',
                    strike: parsed.strike || null,
                    type: parsed.type || null,
                    entry: Number(parsed.suggestedEntryPrice) || 0,
                    sl: Number(parsed.stopLoss) || 0,
                    targets: Array.isArray(parsed.targets) ? parsed.targets : [],
                    expiry: parsed.expiryDate || null,
                    productType: parsed.productType || 'MARGIN',
                    exchangeSegment: parsed.exchangeSegment || 'NSE_FNO'
                },
                confidence: typeof data.confidence === 'number' ? data.confidence : 0.9,
                source: 'TEXT',
                status: 'PARSED',
                timestamp: data.timestamp || Date.now(),
                ticker: parsed.tradingSymbol || ''
            };

            const existingRecord = await db.parsed_signal_records
                .where('timestamp')
                .between(parsedRecord.timestamp - 5000, parsedRecord.timestamp + 5000)
                .and((r) => r.rawText === parsedRecord.rawText)
                .first();

            if (!existingRecord) {
                await db.parsed_signal_records.add(parsedRecord);
            }

            // Register/Upsert provider with REAL channel name in db.signal_providers
            const providerName = data.channelName || 'Telegram Channel';
            let providerRecord = await db.signal_providers.where('name').equals(providerName).first();
            if (!providerRecord) {
                const newProvider: SignalProvider = {
                    name: providerName,
                    totalSignals: 1,
                    wins: 0,
                    losses: 0,
                    winRate: 0.65, // default baseline for newly discovered channel
                    avgRR: 1.8,
                    lastActive: new Date().toISOString()
                };
                const newId = await db.signal_providers.add(newProvider);
                providerRecord = { ...newProvider, id: newId as number };
            } else if (providerRecord.id) {
                await db.signal_providers.update(providerRecord.id, {
                    totalSignals: (providerRecord.totalSignals || 0) + 1,
                    lastActive: new Date().toISOString()
                });
            }

            const winRate = providerRecord ? providerRecord.winRate : 0.65;

            const { autoPoolEnabled, autoPoolTrustThreshold } = useSettingsStore.getState();
            if (autoPoolEnabled && winRate >= (autoPoolTrustThreshold / 100) && parsed.tradingSymbol) {
                try {
                    const { poolStoreApi } = await import('../store/poolStore');
                    await poolStoreApi.add({
                        ticker: parsed.tradingSymbol,
                        exchange: parsed.exchangeSegment || 'NSE_EQ',
                        targetBuyPrice: parsed.suggestedEntryPrice ? Number(parsed.suggestedEntryPrice) : undefined,
                        targetSellPrice: parsed.targets?.[0] ? Number(parsed.targets[0]) : undefined,
                        stopLoss: parsed.stopLoss ? Number(parsed.stopLoss) : undefined,
                        alertEnabled: 1,
                        alertOn: ['VERDICT_FIRE', 'PRICE_TARGET_HIT', 'STOP_HIT'],
                        source: 'TELEGRAM',
                        sourceMeta: { channelId: providerName, messageId: data.id },
                        notes: `Auto-watched from high-trust channel ${providerName} (WinRate: ${Math.round(winRate * 100)}%)`
                    });
                    logger.info(`[TelegramEarManager] Auto-added ${parsed.tradingSymbol} to Momentum Pool from ${providerName}`);
                } catch (err) {
                    logger.error(`[TelegramEarManager] Failed to auto-add ${parsed.tradingSymbol} to pool:`, err);
                }
            }

            // CC39 — Semi-Auto alert setter toast
            showToast(
                `${parsed.action} ${parsed.tradingSymbol} entry near ₹${parsed.suggestedEntryPrice}. SL: ₹${parsed.stopLoss || 'N/A'}. Targets: ${parsed.targets?.join(', ') || 'N/A'}`,
                'info',
                {
                    title: `📡 Signal Call: ${parsed.tradingSymbol}`,
                    duration: 12000,
                    action: {
                        label: 'Set Alert',
                        onClick: async () => {
                            try {
                                const { usePoolStore } = await import('../store/poolStore');
                                const poolStore = usePoolStore.getState();
                                await poolStore.addItem({
                                    ticker: parsed.tradingSymbol || '',
                                    notes: `Auto-alert added from Telegram channel: ${data.channelName || 'unknown'}`,
                                    source: 'TELEGRAM',
                                    targetBuyPrice: parsed.suggestedEntryPrice ? Number(parsed.suggestedEntryPrice) : undefined,
                                    targetSellPrice: parsed.targets?.[0] ? Number(parsed.targets[0]) : undefined,
                                    stopLoss: parsed.stopLoss ? Number(parsed.stopLoss) : undefined,
                                    alertOn: ['VERDICT_FIRE', 'PRICE_TARGET_HIT', 'STOP_HIT']
                                });
                                showToast(`Watchlist alert set for ${parsed.tradingSymbol}!`, 'success');
                            } catch (err) {
                                logger.error('Failed to auto-set alert from telegram toast:', err);
                            }
                        }
                    }
                }
            );
        }

        // ------------------------------------------------------------
        // 🧵 LIFECYCLE THREAD STITCHING & PROVIDER STATS UPDATE
        // ------------------------------------------------------------
        const textUpper = (data.text || '').toUpperCase();
        const isTargetHit = /TARGET\s*HIT|1ST\s*TGT|2ND\s*TGT|3RD\s*TGT|ALL\s*TGT|BOOK\s*PROFIT|PROFIT\s*BOOKED|ACHIEVED/i.test(textUpper);
        const isSlHit = /SL\s*HIT|STOPLOSS\s*HIT|EXIT\s*NOW|LOSS\s*BOOKED/i.test(textUpper);

        if (data.type === 'LIFECYCLE_UPDATE' || isTargetHit || isSlHit) {
            try {
                const channelName = data.channelName || 'Telegram';
                const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
                
                // Find recent open signal for this provider
                const recentSignal = await db.parsed_signals
                    .where('provider')
                    .equals(channelName)
                    .and(s => s.timestamp >= sixHoursAgo && (s.status === 'NEEDS_REVIEW' || s.status === 'ACTIVE'))
                    .reverse()
                    .first();

                if (recentSignal && recentSignal.id) {
                    const newStatus = isTargetHit ? 'TARGET_HIT' : (isSlHit ? 'SL_HIT' : 'CLOSED');
                    await db.parsed_signals.update(recentSignal.id, { status: newStatus });
                    logger.info(`[ThreadStitcher] Updated signal ${recentSignal.instrument} from ${channelName} -> ${newStatus}`);

                    // Dynamically recalculate & update provider win rate stats!
                    const { signalIntelligenceService } = await import('./SignalIntelligenceService');
                    await signalIntelligenceService.updateProviderStats(channelName);
                }
            } catch (err) {
                logger.warn('[ThreadStitcher] Error stitching thread lifecycle:', err);
            }
        }

        // Fan out to all React subscribers.
        this.listeners.forEach((listener) => listener(data));
    }

    // ----------------------------------------------------------------
    // Subscriptions
    // ----------------------------------------------------------------

    /** Subscribe to realtime message events. */
    subscribe(callback: (event: any) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    /** Subscribe to connection status events (for UI / debugging). */
    onStatus(callback: (e: StatusEvent) => void): () => void {
        this.statusListeners.add(callback);
        return () => { this.statusListeners.delete(callback); };
    }

    private emitStatus(e: StatusEvent): void {
        this.statusListeners.forEach((cb) => {
            try { cb(e); } catch (err) { /* swallow */ }
        });
    }

    // ----------------------------------------------------------------
    // REST helpers (unchanged behavior)
    // ----------------------------------------------------------------

    /** Execute an order to Dhan through the REST proxy. */
    async executeOrder(orderRequest: any): Promise<{ success: boolean; result: any }> {
        const settings = (await import('../store/settingsStore')).useSettingsStore.getState();
        const payload = {
            clientId: settings.dhanClientId,
            accessToken: settings.dhanAccessToken,
            order: orderRequest
        };
        const res = await fetch(`${this.httpUrl}/api/execute-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `HTTP ${res.status} executing order`);
        }
        return await res.json();
    }

    async getMessages(earId: string, options?: { limit?: number; since?: number; search?: string }): Promise<TelegramMessage[]> {
        const limit = options?.limit || 50;
        const since = options?.since || '';
        const search = options?.search || '';
        try {
            const res = await fetch(`${this.httpUrl}/api/messages?ear=${earId}&limit=${limit}&since=${since}&search=${encodeURIComponent(search)}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('API request failed');
            const rawMessages = await res.json();
            const messages: TelegramMessage[] = Array.isArray(rawMessages) ? rawMessages.map(mapDbMessageToModel) : [];

            if (!search && !since) {
                const dexieMessages = messages.map((m) => ({
                    ...m,
                    parsedJson: m.parsedJson && typeof m.parsedJson === 'object' ? JSON.stringify(m.parsedJson) : m.parsedJson
                }));
                await db.telegram_messages.where('earId').equals(earId).delete();
                await db.telegram_messages.bulkPut(dexieMessages);
            }
            return messages;
        } catch (err) {
            logger.warn(`ΓÜá∩╕Å Telegram REST offline for ear "${earId}". Falling back to Dexie cache.`, err);
            let collection = db.telegram_messages.where('earId').equals(earId);
            if (since) collection = collection.and((m) => m.receivedAt > since);
            let results = await collection.toArray();
            let mapped = results.map(mapDbMessageToModel);
            if (search) {
                const sl = search.toLowerCase();
                mapped = mapped.filter((m) => m.text.toLowerCase().includes(sl));
            }
            mapped.sort((a, b) => b.receivedAt - a.receivedAt);
            return mapped.slice(0, limit);
        }
    }

    /**
     * Backup support: raw ear configuration (incl. channelIds) for snapshotting
     * into WealthOS save files. Returns null when the ear server is unreachable.
     */
    async exportEarConfig(timeoutMs: number = 2500): Promise<any[] | null> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(`${this.httpUrl}/api/ears`, {
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok) return null;
            const data = await res.json();
            return Array.isArray(data) ? data : null;
        } catch {
            return null;
        }
    }

    /**
     * Backup support: best-effort push of a previously snapshotted ear config
     * back onto the ear server (POST /api/ear-config).
     */
    async importEarConfig(ears: any[], timeoutMs: number = 4000): Promise<boolean> {
        if (!Array.isArray(ears) || ears.length === 0) return false;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const res = await fetch(`${this.httpUrl}/api/ear-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                body: JSON.stringify({ ears }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    async getEarStats(): Promise<EarStats[]> {
        try {
            const res = await fetch(`${this.httpUrl}/api/ears`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('REST API failed');
            const data = await res.json();
            return data.map((ear: any) => ({
                ...ear,
                earId: ear.id || ear.earId,
                name: ear.name,
                type: ear.type,
                color: ear.color,
                messageCount: ear.messageCount ?? 0,
                signalCount: ear.signalCount ?? 0,
                lastActive: ear.lastActive ?? null,
                isConnected: ear.isConnected ?? true
            }));
        } catch (err) {
            logger.warn('ΓÜá∩╕Å Telegram REST offline. Returning offline mock stats based on Dexie cache.', err);
            const defaultEars = [
                { id: 'premium_signals', name: 'Premium Signal Channels', type: 'SIGNALS' as const, color: '#a855f7' },
                { id: 'news_data', name: 'News & Data Channels', type: 'NEWS' as const, color: '#06b6d4' },
                { id: 'general_archive', name: 'General Market Channels', type: 'ARCHIVE' as const, color: '#64748b' }
            ];
            const statsList: EarStats[] = [];
            for (const ear of defaultEars) {
                const count = await db.telegram_messages.where('earId').equals(ear.id).count();
                const signalsCount = await db.telegram_messages.where('earId').equals(ear.id).and((m) => m.messageType === 'PARSED_SIGNAL').count();
                const lastMsg = await db.telegram_messages.where('earId').equals(ear.id).reverse().sortBy('receivedAt');
                statsList.push({
                    earId: ear.id,
                    name: ear.name,
                    type: ear.type,
                    color: ear.color,
                    messageCount: count,
                    signalCount: signalsCount,
                    lastActive: lastMsg.length > 0 ? lastMsg[0].receivedAt : null,
                    isConnected: false
                });
            }
            return statsList;
        }
    }

    async summarize(earId: string, customPrompt?: string): Promise<EarSummary> {
        const messages = await this.getMessages(earId, { limit: 50 });
        if (messages.length === 0) {
            return {
                earId,
                generatedAt: new Date().toISOString(),
                brief: 'No messages received recently to summarize.',
                keySignals: [],
                newsHeadlines: [],
                sentiment: 'NEUTRAL'
            };
        }
        const combinedText = messages.map((m) => `[${m.channelName || 'Unknown'}]: ${m.text}`).join('\n---\n');
        let systemPrompt = ARCHIVE_SUMMARY_PROMPT;
        if (earId === 'premium_signals') systemPrompt = SIGNAL_SUMMARY_PROMPT;
        else if (earId === 'news_data') systemPrompt = NEWS_SUMMARY_PROMPT;
        const userMessage = customPrompt
            ? `${customPrompt}\n\nAnalyze these messages:\n\n${combinedText}`
            : `Synthesize a brief from these messages:\n\n${combinedText}`;
        const settings = useSettingsStore.getState();
        const earModel = settings.modelTelegramEarId || 'llama-3.1-8b-instant';
        try {
            const responseText = await chatWithGroq(earModel, [], userMessage, systemPrompt);
            const cleanJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const data = JSON.parse(cleanJsonString);
            return {
                earId,
                generatedAt: new Date().toISOString(),
                brief: data.brief || 'Brief generation succeeded.',
                keySignals: Array.isArray(data.keySignals) ? data.keySignals : [],
                newsHeadlines: Array.isArray(data.newsHeadlines) ? data.newsHeadlines : [],
                sentiment: data.sentiment || 'NEUTRAL'
            };
        } catch (err) {
            logger.error('Γ¥î Groq Ear summary generation failed:', err);
            throw err;
        }
    }

    async searchAll(query: string): Promise<TelegramMessage[]> {
        try {
            const res = await fetch(`${this.httpUrl}/api/messages?search=${encodeURIComponent(query)}&limit=50`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('API search failed');
            return await res.json();
        } catch (err) {
            logger.warn('ΓÜá∩╕Å Search falling back to Dexie cache.', err);
            const sl = query.toLowerCase();
            const results = await db.telegram_messages.filter((m) => m.text.toLowerCase().includes(sl)).toArray();
            results.sort((a, b) => b.receivedAt - a.receivedAt);
            return results.slice(0, 50);
        }
    }

    async starMessage(id: number, starred: boolean): Promise<boolean> {
        try {
            const localMsg = await db.telegram_messages.get(id);
            if (localMsg) {
                localMsg.isStarred = starred ? 1 : 0;
                await db.telegram_messages.put(localMsg);
            }
            const res = await fetch(`${this.httpUrl}/api/star`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                body: JSON.stringify({ id, starred })
            });
            if (!res.ok) throw new Error('REST API failed');
            const data = await res.json();
            return data.success;
        } catch (err) {
            logger.warn('ΓÜá∩╕Å Star toggle updated locally in Dexie. REST sync pending offline.', err);
            return true;
        }
    }

    async getThread(threadId: number): Promise<TelegramMessage[]> {
        try {
            const res = await fetch(`${this.httpUrl}/api/threads?threadId=${threadId}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('REST API failed');
            const data = await res.json();
            return Array.isArray(data) ? data.map(mapDbMessageToModel) : [];
        } catch (err) {
            logger.warn('ΓÜá∩╕Å Thread fetching falling back to Dexie cache.', err);
            const results = await db.telegram_messages.where('threadId').equals(threadId).toArray();
            const mapped = results.map(mapDbMessageToModel);
            mapped.sort((a, b) => a.receivedAt - b.receivedAt);
            return mapped;
        }
    }

    async getEarConfigs(): Promise<EarStats[]> {
        try {
            const res = await fetch(`${this.httpUrl}/api/ears`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('API failed');
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        } catch (err) {
            logger.warn('Failed to fetch ear configs from server:', err);
            return [];
        }
    }

    async getEars(): Promise<EarStats[]> {
        return this.getEarConfigs();
    }

    /**
     * Missed-messages catch-up sync on WebSocket reconnect / tab reload.
     * Fetches messages received since last known timestamp and ingests them into Dexie.
     */
    async syncMissedMessages(): Promise<number> {
        const cacheKey = 'ear_last_sync_ts';
        try {
            const cached = await db.cache.where('key').equals(cacheKey).first();
            const lastTs = cached && typeof cached.data === 'number' ? cached.data : (Date.now() - 24 * 3600 * 1000);
            
            const res = await fetch(`${this.httpUrl}/api/messages?since=${lastTs}&limit=200`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) return 0;
            const messages = await res.json();
            if (!Array.isArray(messages) || messages.length === 0) return 0;

            let ingested = 0;
            for (const msg of messages) {
                const wsData = {
                    type: msg.message_type === 'PARSED_SIGNAL' ? 'NEW_SIGNAL' : 'NEW_ARCHIVE',
                    id: msg.id,
                    earId: msg.ear_id,
                    threadId: msg.thread_id,
                    channelName: msg.channel_name,
                    text: msg.message_text,
                    parsed: msg.parsed_json ? (typeof msg.parsed_json === 'string' ? JSON.parse(msg.parsed_json) : msg.parsed_json) : null,
                    timestamp: msg.received_at
                };
                await this.handleIncomingMessage({ data: JSON.stringify(wsData) } as MessageEvent);
                ingested++;
            }

            const now = Date.now();
            if (cached && cached.id) {
                await db.cache.update(cached.id, { data: now, timestamp: now });
            } else {
                await db.cache.add({ key: cacheKey, data: now, timestamp: now });
            }

            logger.info(`[TelegramEarManager] Catch-up sync completed: ${ingested} missed messages ingested.`);
            return ingested;
        } catch (err) {
            logger.warn('[TelegramEarManager] Missed messages catch-up failed:', err);
            return 0;
        }
    }

    /**
     * Pull startup history (e.g. 200 messages) on dashboard load to populate Dexie telegram_messages without duplicates.
     */
    async pullStartupHistory(limit = 200): Promise<number> {
        try {
            const res = await fetch(`${this.httpUrl}/api/messages?limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) return 0;
            const messages = await res.json();
            if (!Array.isArray(messages) || messages.length === 0) return 0;

            let ingested = 0;
            for (const msg of messages) {
                const wsData = {
                    type: msg.message_type === 'PARSED_SIGNAL' ? 'NEW_SIGNAL' : 'NEW_ARCHIVE',
                    id: msg.id,
                    earId: msg.ear_id,
                    threadId: msg.thread_id,
                    channelName: msg.channel_name,
                    text: msg.message_text,
                    parsed: msg.parsed_json ? (typeof msg.parsed_json === 'string' ? JSON.parse(msg.parsed_json) : msg.parsed_json) : null,
                    timestamp: msg.received_at
                };
                await this.handleIncomingMessage({ data: JSON.stringify(wsData) } as MessageEvent);
                ingested++;
            }
            logger.info(`[TelegramEarManager] Startup history pull complete: ${ingested} messages ingested.`);
            return ingested;
        } catch (err) {
            logger.warn('[TelegramEarManager] Startup history pull failed:', err);
            return 0;
        }
    }

    async saveConfig(ears: any[]): Promise<boolean> {
        try {
            const res = await fetch(`${this.httpUrl}/api/ear-config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                body: JSON.stringify({ ears })
            });
            return res.ok;
        } catch (err) {
            console.error('Γ¥î Failed to save ear configurations:', err);
            return false;
        }
    }

    async getDiscoveredChannels(): Promise<any[]> {
        try {
            const res = await fetch(`${this.httpUrl}/api/discovered`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('API failed');
            const data = await res.json();
            return data.discovered || [];
        } catch (err) {
            console.error('Γ¥î Failed to fetch discovered channels:', err);
            return [];
        }
    }

    async getJoinedChannels(): Promise<any[]> {
        const cacheKey = 'telegram_joined_channels';
        try {
            const res = await fetch(`${this.httpUrl}/api/joined-channels`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('REST API failed');
            const data = await res.json();
            const channels = data.channels || [];
            if (channels.length > 0) {
                const existing = await db.cache.where('key').equals(cacheKey).first();
                if (existing && existing.id) {
                    await db.cache.update(existing.id, { data: channels, timestamp: Date.now() });
                } else {
                    await db.cache.add({ key: cacheKey, data: channels, timestamp: Date.now() });
                }
            }
            return channels;
        } catch (err) {
            console.error('Γ¥î Failed to fetch joined channels. Reading from Dexie:', err);
            try {
                const cached = await db.cache.where('key').equals(cacheKey).first();
                if (cached && Array.isArray(cached.data)) return cached.data;
            } catch { /* ignore */ }
            return [];
        }
    }

    async refreshJoinedChannels(): Promise<any[]> {
        const cacheKey = 'telegram_joined_channels';
        try {
            const res = await fetch(`${this.httpUrl}/api/joined-channels/refresh`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            if (!res.ok) throw new Error('REST API failed');
            const data = await res.json();
            const channels = data.channels || [];
            if (channels.length > 0) {
                const existing = await db.cache.where('key').equals(cacheKey).first();
                if (existing && existing.id) {
                    await db.cache.update(existing.id, { data: channels, timestamp: Date.now() });
                } else {
                    await db.cache.add({ key: cacheKey, data: channels, timestamp: Date.now() });
                }
            }
            return channels;
        } catch (err) {
            console.error('Γ¥î Failed to refresh joined channels. Reading from Dexie:', err);
            try {
                const cached = await db.cache.where('key').equals(cacheKey).first();
                if (cached && Array.isArray(cached.data)) return cached.data;
            } catch { /* ignore */ }
            return [];
        }
    }

    /**
     * A4 — Best-effort push of the daily digest to the user's "me"
     * (Telegram Saved Messages) via the ear server. Returns
     * {pushed: true} on 2xx, {pushed: false, reason} on offline or 5xx.
     * Never throws — caller's responsibility to log if they care.
     */
    async pushDailyDigestToMe(payload: {
        date: string;
        combinedBrief: string;
        sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
        keySignals: string[];
        newsHeadlines: string[];
    }): Promise<{ pushed: boolean; reason?: 'server-offline' | 'server-error' }> {
        try {
            const res = await fetch(`${this.httpUrl}/api/daily-digest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                logger.warn('TelegramEarManager', `daily-digest push returned HTTP ${res.status}`);
                return { pushed: false, reason: 'server-error' };
            }
            return { pushed: true };
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn('TelegramEarManager', `daily-digest push failed (server likely offline): ${errMsg}`);
            return { pushed: false, reason: 'server-offline' };
        }
    }

    /** Returns live status snapshot for UI indicators */
    getEarStatus(): { connected: boolean; state: ConnState; lastMessageReceivedAt: number } {
        return {
            connected: this.state === 'OPEN',
            state: this.state,
            lastMessageReceivedAt: this.lastMessageReceivedAt
        };
    }
}

// ---------------------------------------------------------------
// HMR-proof singleton ΓÇö exactly ONE instance per page load.
//
// Without this, Vite's Hot Module Replacement creates a new
// `TelegramEarManager` every time the module reloads, leaks the
// old WebSocket reference, and produces a flood of connect/disconnect
// cycles. By stashing the instance on `globalThis` we guarantee that
// every `import` of this file returns the same object.
// ---------------------------------------------------------------

declare global {
    // eslint-disable-next-line no-var
    var __telegramEarManager__: TelegramEarManager | undefined;
}

function createManager(): TelegramEarManager {
    const m = new TelegramEarManager();
    return m;
}

export const telegramEarManager: TelegramEarManager = (() => {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__telegramEarManager__) {
        return (globalThis as any).__telegramEarManager__;
    }
    const m = createManager();
    if (typeof globalThis !== 'undefined') {
        (globalThis as any).__telegramEarManager__ = m;
    }
    return m;
})();
