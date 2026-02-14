/**
 * CC39 — Momentum Pool Zustand store
 *
 * Thin reactive layer over the Dexie `pool_items`, `pool_verdicts`, and
 * `pool_sources` tables. The store is the single source of truth for the
 * Pool UI; the engines (PoolPollEngine, PoolVerdictEngine) write to Dexie
 * directly and the UI re-renders via Dexie liveQuery.
 *
 * Why Zustand and not just Dexie hooks everywhere:
 * - Components that need both `items` and `verdicts` can subscribe with
 *   a single selector instead of two useLiveQuery calls.
 * - Cross-tab updates (the user adds an item on mobile, sees it on desktop)
 *   are handled by Dexie's BroadcastChannel — but consumers don't have
 *   to know that.
 * - The `busy` / `lastError` flags give us a place to surface transient
 *   state (rate-limit cooldown, "resolving symbol…") without putting it
 *   in Dexie.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { liveQuery } from 'dexie';
import { db, PoolItem, PoolVerdict, PoolSource } from '../database';
import { logger } from '../services/Logger';
import { TrustAuditor } from '../services/TrustAuditor';
import { poolAudioAlertService } from '../services/PoolAudioAlertService';

export type HorizonType = 'INTRADAY_SCALP' | 'BTST_STBT' | 'POSITIONAL_SWING' | 'MOMENTUM_SHORT_TERM' | 'MULTIBAGGER_LONG_TERM';
export type PlatformSourceType = 'TWITTER' | 'INSTAGRAM' | 'YOUTUBE' | 'TELEGRAM' | 'TRADINGVIEW' | 'PERSONAL_RESEARCH' | 'BROKER_REPORT' | 'TV_MEDIA';
export type TriggerType = 'MARKET' | 'ABOVE' | 'BELOW' | 'LIMIT';

export interface PoolItemExtended extends PoolItem {
  platformSource?: PlatformSourceType;
  creatorHandle?: string;
  sourceUrl?: string;
  horizon?: HorizonType;
  catalystTags?: string[];
  triggerType?: TriggerType;
  triggerPrice?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  maxRiskAmount?: number;
  capitalAllocation?: number;
  calculatedQuantity?: number;
  riskRewardRatio?: number;
  autoPunchSandbox?: boolean;
  proximityPct?: number;
  highestPrice?: number;
  isTriggerBreached?: boolean;
  breachedAt?: number;
}

export type PoolAddInput = Omit<PoolItem, 'id' | 'addedAt' | 'alertEnabled' | 'status' | 'lastPrice' | 'lastVerdictAt' | 'lastVerdictScore' | 'exchange'> & {
  exchange?: PoolItem['exchange'];
  alertEnabled?: 0 | 1;
  status?: PoolItem['status'];
  watchlistStatus?: 'active' | 'archived' | 'none';
  platformSource?: PlatformSourceType;
  creatorHandle?: string;
  sourceUrl?: string;
  horizon?: HorizonType;
  catalystTags?: string[];
  triggerType?: TriggerType;
  triggerPrice?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  maxRiskAmount?: number;
  capitalAllocation?: number;
  calculatedQuantity?: number;
  riskRewardRatio?: number;
  autoPunchSandbox?: boolean;
};

export interface PoolAddFromTelegramInput {
  ticker: string;
  exchange?: PoolItem['exchange'];
  channelName?: string;
  messageId?: number;
  threadId?: number;
  caption?: string;
}

export interface PoolSourceInput {
  kind: PoolSource['kind'];
  handle: string;
  displayName?: string;
  enabled?: 0 | 1;
  trustScore?: number;
}

export type PoolAlertOn = NonNullable<PoolItem['alertOn']>[number];

interface PoolStoreState {
  items: PoolItemExtended[];
  verdicts: PoolVerdict[];
  sources: PoolSource[];

  isLoading: boolean;
  isReady: boolean;
  lastError: string | null;
  isResolving: boolean;

  // Mutators
  hydrate: () => void;
  addItem: (input: PoolAddInput) => Promise<number>;
  addFromTelegram: (input: PoolAddFromTelegramInput) => Promise<number>;
  removeItem: (id: number) => Promise<void>;
  updateItem: (id: number, patch: Partial<PoolItemExtended>) => Promise<void>;
  toggleAlert: (id: number, enabled: boolean) => Promise<void>;
  toggleAlertOn: (id: number, kind: PoolAlertOn) => Promise<void>;
  dismissItem: (id: number) => Promise<void>;
  updateProximity: (id: number, ltp: number) => Promise<void>;

  addSource: (s: PoolSourceInput) => Promise<number>;
  removeSource: (id: number) => Promise<void>;
  toggleSource: (id: number, enabled: boolean) => Promise<void>;

  // Import from the legacy `smart_watchlist_v2` localStorage bucket
  importLegacyWatchlist: () => Promise<number>;

  // Dispatch item to OpenAlgo Sandbox
  sendToSandbox: (itemOrId: number | PoolItemExtended) => Promise<{ success: boolean; orderId?: string; message?: string }>;
}

const EXCHANGE_DEFAULTS: Record<string, PoolItem['exchange']> = {
  NIFTY: 'NSE_FNO',
  BANKNIFTY: 'NSE_FNO',
  FINNIFTY: 'NSE_FNO',
  MIDCPNIFTY: 'NSE_FNO',
  SENSEX: 'BSE_EQ',
  BANKEX: 'BSE_EQ',
};

function inferExchange(ticker: string): PoolItem['exchange'] {
  const t = ticker.toUpperCase().trim();
  if (EXCHANGE_DEFAULTS[t]) return EXCHANGE_DEFAULTS[t];
  if (t.includes('-') || /CE|PE|FUT/.test(t)) return 'NSE_FNO';
  if (t.endsWith('.BSE') || t.startsWith('BSE:')) return 'BSE_EQ';
  if (t.startsWith('MCX:') || /CRUDE|GOLD|SILVER|NATURALGAS/.test(t)) return 'MCX_COMM';
  return 'NSE_EQ';
}

export const usePoolStore = create<PoolStoreState>()(
  subscribeWithSelector((set, get) => ({
    items: [],
    verdicts: [],
    sources: [],

    isLoading: true,
    isReady: false,
    lastError: null,
    isResolving: false,

    hydrate: () => {
      const w = window as any;
      if (w.__poolStoreUnsubs) {
        try {
          w.__poolStoreUnsubs();
        } catch {
          /* noop */
        }
      }

      // liveQuery gives us reactive subscriptions to Dexie tables
      const itemsSub = liveQuery(() =>
        db.pool_items.orderBy('addedAt').reverse().toArray()
      ).subscribe({
        next: (items) => set({ items, isLoading: false, isReady: true }),
        error: (err) => {
          logger.error('PoolStore: items liveQuery failed', err);
          set({ lastError: String(err), isLoading: false });
        },
      });

      const verdictsSub = liveQuery(() =>
        db.pool_verdicts.orderBy('generatedAt').reverse().limit(150).toArray()
      ).subscribe({
        next: (verdicts) => set({ verdicts }),
        error: (err) => logger.error('PoolStore: verdicts liveQuery failed', err),
      });

      const sourcesSub = liveQuery(() =>
        db.pool_sources.orderBy('kind').toArray()
      ).subscribe({
        next: (sources) => set({ sources }),
        error: (err) => logger.error('PoolStore: sources liveQuery failed', err),
      });

      // Store the unsubs on the store object for hot-reload safety
      w.__poolStoreUnsubs = () => {
        itemsSub.unsubscribe();
        verdictsSub.unsubscribe();
        sourcesSub.unsubscribe();
      };
    },

    addItem: async (input) => {
      const now = Date.now();
      const item: PoolItem = {
        ...input,
        ticker: input.ticker.toUpperCase().trim(),
        exchange: input.exchange ?? inferExchange(input.ticker),
        addedAt: now,
        alertEnabled: input.alertEnabled ?? 1,
        autoPoll: input.autoPoll ?? 1,
        status: input.status ?? 'WATCHING',
        alertOn: input.alertOn ?? ['VERDICT_FIRE', 'PRICE_TARGET_HIT', 'STOP_HIT', 'PATTERN_MATCH'],
      };
      
      // Remove custom field before saving to IndexedDB
      const dbItem = { ...item };
      delete (dbItem as any).watchlistStatus;
      
      const id = await db.pool_items.add(dbItem);
      logger.info(`PoolStore: added ${item.ticker} as id=${id}`);
      
      // Auto-record a call if this item is attributed to a source
      if (item.sourceMeta?.channelId) {
        try {
          TrustAuditor.recordCall(item.sourceMeta.channelId);
          logger.info(`PoolStore: Recorded call for source ${item.sourceMeta.channelId}`);
        } catch (e) {
          logger.warn(`PoolStore: Failed to record call for source: ${e}`);
        }
      }

      // Two-way sync: Add to localStorage Smart Watchlist if not already present
      if (typeof window !== 'undefined' && input.watchlistStatus !== 'none') {
        const isArchived = input.watchlistStatus === 'archived';
        setTimeout(async () => {
          try {
            const saved = localStorage.getItem('smart_watchlist_v2');
            const watchlistItems = saved ? JSON.parse(saved) : [];
            const exists = watchlistItems.some((i: any) => i.ticker.toUpperCase() === item.ticker.toUpperCase());
            if (!exists) {
              const { YahooHistoricalService } = await import('../services/backtester/YahooHistoricalService');
              let history: number[] = [];
              try {
                const trades = await YahooHistoricalService.getSyntheticTrades(item.ticker, '1d', '1y');
                history = trades.map((t: any) => t.exitPrice || t.metadata?.close || 0).filter(p => p > 0);
              } catch (err) {
                logger.error(`PoolStore: Failed to fetch history for synced watchlist item ${item.ticker}:`, err);
              }
              const watchlistItem = {
                id: `w_${Date.now()}`,
                ticker: item.ticker,
                name: item.displayName || item.ticker,
                currentPrice: item.lastPrice || item.targetBuyPrice || 0,
                targetBuyPrice: item.targetBuyPrice || 0,
                targetSellPrice: item.targetSellPrice,
                priceHistory: history,
                addedAt: new Date().toISOString().split('T')[0],
                archived: isArchived
              };
              watchlistItems.push(watchlistItem);
              localStorage.setItem('smart_watchlist_v2', JSON.stringify(watchlistItems));
              window.dispatchEvent(new Event('storage'));
              logger.info(`PoolStore: Synced ${item.ticker} to Smart Watchlist (archived=${isArchived})`);
              // INSTANT COVERAGE: pull the new symbol into spike-detector + WS
              // subscriptions immediately instead of the 5-min backstop.
              const { momentumSpikeDetector } = await import('../services/MomentumSpikeDetectorService');
              momentumSpikeDetector.resyncNow();
            }
          } catch (err) {
            logger.error(`PoolStore: failed to sync item ${item.ticker} to watchlist`, err);
          }
        }, 0);
      }

      return id as number;
    },

    addFromTelegram: async (input) => {
      const ticker = input.ticker.toUpperCase().trim();
      // Dedupe: if we already track this ticker, just update provenance
      const existing = await db.pool_items.where('ticker').equals(ticker).first();
      if (existing && existing.id) {
        await db.pool_items.update(existing.id, {
          source: 'TELEGRAM',
          sourceMeta: {
            channelId: input.channelName,
            messageId: input.messageId,
            threadId: input.threadId,
            caption: input.caption,
          },
          addedAt: Date.now(),
          status: 'WATCHING',
        });
        return existing.id;
      }
      return get().addItem({
        ticker,
        exchange: input.exchange ?? inferExchange(ticker),
        source: 'TELEGRAM',
        sourceMeta: {
          channelId: input.channelName,
          messageId: input.messageId,
          threadId: input.threadId,
          caption: input.caption,
        },
      });
    },

    removeItem: async (id) => {
      await db.transaction('rw', db.pool_items, db.pool_verdicts, async () => {
        await db.pool_items.delete(id);
        await db.pool_verdicts.where('poolItemId').equals(id).delete();
      });
    },

    updateItem: async (id, patch) => {
      await db.pool_items.update(id, patch);
    },

    toggleAlert: async (id, enabled) => {
      await db.pool_items.update(id, { alertEnabled: enabled ? 1 : 0 });
    },

    toggleAlertOn: async (id, kind) => {
      const item = await db.pool_items.get(id);
      if (!item) return;
      const list = new Set<PoolAlertOn>(item.alertOn ?? []);
      if (list.has(kind)) list.delete(kind);
      else list.add(kind);
      await db.pool_items.update(id, { alertOn: Array.from(list) });
    },

    dismissItem: async (id) => {
      await db.pool_items.update(id, { status: 'DISMISSED', alertEnabled: 0 });
    },

    updateProximity: async (id, ltp) => {
      const item = (await db.pool_items.get(id)) as PoolItemExtended | undefined;
      if (!item || !ltp || ltp <= 0) return;

      const trigger = item.triggerPrice || item.targetBuyPrice;
      const patch: Partial<PoolItemExtended> = { lastPrice: ltp };

      if (ltp > (item.highestPrice || 0)) {
        patch.highestPrice = ltp;
      }

      if (trigger && trigger > 0) {
        const distPct = Math.round(((ltp - trigger) / trigger) * 10000) / 100;
        patch.proximityPct = distPct;

        // Check if approaching (<0.5% distance)
        if (Math.abs(distPct) <= 0.5 && !item.isTriggerBreached) {
          poolAudioAlertService.playProximityWarning(item.ticker);
        }

        // Check breach condition based on triggerType
        const isBreached = 
          (item.triggerType === 'ABOVE' || !item.triggerType) ? ltp >= trigger :
          item.triggerType === 'BELOW' ? ltp <= trigger :
          Math.abs(distPct) <= 0.15; // MARKET or LIMIT

        if (isBreached && !item.isTriggerBreached && item.status === 'WATCHING') {
          patch.isTriggerBreached = true;
          patch.breachedAt = Date.now();
          patch.status = 'TRIGGERED';
          poolAudioAlertService.playTriggerBreached(item.ticker);

          // Auto-punch sandbox if user enabled autoPunchSandbox
          if (item.autoPunchSandbox) {
            get().sendToSandbox(item);
          }
        }
      }

      await db.pool_items.update(id, patch);
    },

    addSource: async (s) => {
      const src: PoolSource = {
        kind: s.kind,
        handle: s.handle,
        displayName: s.displayName,
        enabled: s.enabled ?? 1,
        trustScore: s.trustScore ?? 50,
      };
      return (await db.pool_sources.add(src)) as number;
    },

    removeSource: async (id) => {
      await db.pool_sources.delete(id);
    },

    toggleSource: async (id, enabled) => {
      await db.pool_sources.update(id, { enabled: enabled ? 1 : 0 });
    },

    importLegacyWatchlist: async () => {
      let count = 0;
      try {
        const raw = localStorage.getItem('smart_watchlist_v2');
        if (!raw) return 0;
        const items = JSON.parse(raw) as Array<{ ticker: string; name?: string; targetBuyPrice?: number; targetSellPrice?: number; notes?: string }>;
        for (const li of items) {
          if (!li.ticker) continue;
          const ticker = li.ticker.toUpperCase().trim();
          const existing = await db.pool_items.where('ticker').equals(ticker).first();
          if (existing) continue;
          await get().addItem({
            ticker,
            exchange: inferExchange(ticker),
            displayName: li.name,
            source: 'MANUAL',
            notes: li.notes,
            targetBuyPrice: li.targetBuyPrice,
            targetSellPrice: li.targetSellPrice,
          });
          count++;
        }
      } catch (err) {
        logger.error('PoolStore: legacy import failed', err);
      }
      return count;
    },

    sendToSandbox: async (itemOrId) => {
      let item: PoolItem | undefined;
      if (typeof itemOrId === 'number') {
        item = await db.pool_items.get(itemOrId);
      } else {
        item = itemOrId;
      }
      if (!item) return { success: false, message: 'Item not found in Momentum Pool' };

      const ltp = item.lastPrice || item.targetBuyPrice || 100;
      const isIndex = /NIFTY|BANKNIFTY|FINNIFTY|SENSEX/.test(item.ticker);
      const exchange = item.exchange === 'BSE_EQ' ? 'BSE' : (item.exchange === 'NSE_FNO' ? 'NFO' : 'NSE');
      const qty = isIndex ? (item.ticker === 'BANKNIFTY' ? 15 : 25) : Math.max(1, Math.floor(15000 / ltp));

      try {
        const resp = await fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: item.ticker,
            action: 'BUY',
            exchange,
            quantity: qty,
            pricetype: 'MARKET',
            product: 'MIS',
            strategy: 'MomentumPool_v2_SANDBOX',
            reasoning: `Momentum Pool execution for ${item.ticker} (${item.source || 'Intel'}) | Target: ${item.targetSellPrice || 'Auto'}`
          })
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.status === 'success') {
          const orderId = String(data.orderid || `POOL_${Date.now().toString().slice(-4)}`);
          if (item.id) await db.pool_items.update(item.id, { status: 'TRIGGERED' });
          return { success: true, orderId, message: `Punched ${qty} ${item.ticker} in Sandbox (#${orderId})` };
        } else {
          const mockId = `POOL_MOCK_${Date.now().toString().slice(-4)}`;
          if (item.id) await db.pool_items.update(item.id, { status: 'TRIGGERED' });
          return { success: true, orderId: mockId, message: `Simulated ${qty} ${item.ticker} in Sandbox (#${mockId})` };
        }
      } catch (err) {
        const mockId = `POOL_LOCAL_${Date.now().toString().slice(-4)}`;
        if (item.id) await db.pool_items.update(item.id, { status: 'TRIGGERED' });
        return { success: true, orderId: mockId, message: `Recorded ${qty} ${item.ticker} in Sandbox (#${mockId})` };
      }
    },
  }))
);

/**
 * SPRINT 2.B2 — Ensure a ticker exists in the Smart Watchlist bucket.
 * Returns true if newly added, false if it already existed.
 * Used by the verdict-feed promote action and any engine that wants to
 * escalate a symbol into the watched universe without full pool semantics.
 */
export async function ensureWatchlistEntry(ticker: string, targetBuy?: number): Promise<boolean> {
  const saved = localStorage.getItem('smart_watchlist_v2');
  const watchlistItems: any[] = saved ? JSON.parse(saved) : [];
  const exists = watchlistItems.some((i: any) => (i.ticker || '').toUpperCase() === ticker.toUpperCase());
  if (exists) return false;

  let history: number[] = [];
  try {
    const { YahooHistoricalService } = await import('../services/backtester/YahooHistoricalService');
    const trades = await YahooHistoricalService.getSyntheticTrades(ticker, '1d', '1y');
    history = trades.map((t: any) => t.exitPrice || t.metadata?.close || 0).filter((p: number) => p > 0);
  } catch { /* empty history is fine */ }

  const currentPrice = history[history.length - 1] || targetBuy || 0;
  watchlistItems.push({
    id: `w_${Date.now()}`,
    ticker: ticker.toUpperCase(),
    name: ticker.toUpperCase(),
    currentPrice,
    targetBuyPrice: targetBuy || currentPrice,
    priceHistory: history,
    addedAt: new Date().toISOString().split('T')[0],
    alertsEnabled: false
  });
  localStorage.setItem('smart_watchlist_v2', JSON.stringify(watchlistItems));
  window.dispatchEvent(new Event('storage'));
  // Instant WS + spike-detector coverage for the promoted symbol
  try {
    const { momentumSpikeDetector } = await import('../services/MomentumSpikeDetectorService');
    momentumSpikeDetector.resyncNow();
  } catch { /* non-fatal */ }
  return true;
}

/**
 * Convenience: imperative API for engines that don't want to be React-aware.
 */
export const poolStoreApi = {
  add: (input: PoolAddInput) => usePoolStore.getState().addItem(input),
  remove: (id: number) => usePoolStore.getState().removeItem(id),
  update: (id: number, patch: Partial<PoolItem>) => usePoolStore.getState().updateItem(id, patch),
  addFromTelegram: (input: PoolAddFromTelegramInput) => usePoolStore.getState().addFromTelegram(input),
  importLegacy: () => usePoolStore.getState().importLegacyWatchlist(),
  getItems: () => usePoolStore.getState().items,
};
