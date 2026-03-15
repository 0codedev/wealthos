/**
 * CC39 — Momentum Pool Poll Engine
 *
 * The single producer of `pool:price-update`, `pool:verdict-ready`, and
 * `pool:alert-fired` cross-component events. Lifecycle:
 *
 *   1. start() (idempotent) — kicks off the 3s tick loop. Resolves any
 *      pooled symbol's `instrumentKey` lazily via the existing
 *      UpstoxInstrumentService.
 *   2. On every tick: pull REST quotes for the batch, write back lastPrice
 *      to Dexie, fire `pool:price-update` so the UI can flash.
 *   3. On every 5-minute candle boundary: trigger a verdict for every
 *      PoolItem (the verdicts are individually cached for 30s in the
 *      PoolVerdictEngine so this is cheap).
 *   4. On a MomentumSpikeDetectorService or TelegramEarManager signal for
 *      a pooled symbol, force a re-verdict immediately.
 *   5. If the user has `poolMarketHoursOnly` enabled (default true), the
 *      engine stops polling outside 9:15-15:30 IST. A banner can read
 *      `msUntilNextOpen()` to show a countdown.
 *
 * Singleton. Singleton. Singleton. We do not want two poll loops racing.
 */
import { db, PoolItem, PoolVerdict, ParsedSignal } from '../database';
import { logger } from './Logger';
import { isMarketHours, currentCandleBoundary } from './PoolMarketHours';
import { poolVerdictEngine } from './PoolVerdictEngine';
import { upstoxInstrumentService } from './UpstoxInstrumentService';
import { useSettingsStore } from '../store/settingsStore';
import { poolLevelAlertMonitor } from './PoolLevelAlertMonitor';

const TICK_MS = 3_000;
const BATCH_SIZE = 25; // respect Upstox quote rate limits

type Listener = (event: PoolEvent) => void;
export type PoolEvent =
  | { type: 'pool:price-update'; ticker: string; price: number; prevPrice?: number; at: number }
  | { type: 'pool:verdict-ready'; verdict: PoolVerdict; item: PoolItem; at: number }
  | { type: 'pool:alert-fired'; verdict: PoolVerdict; item: PoolItem; at: number }
  | { type: 'pool:status'; running: boolean; reason?: string; at: number }
  | { type: 'pool:signal-match'; ticker: string; signal: ParsedSignal; at: number };

class PoolPollEngine {
  private static instance: PoolPollEngine;
  private tickId: ReturnType<typeof setInterval> | null = null;
  private lastCandleBoundary = 0;
  private isRunning = false;
  private listeners = new Set<Listener>();
  private momentumUnsub: (() => void) | null = null;
  private telegramUnsub: (() => void) | null = null;
  private last429 = 0; // epoch ms; if 0 we are free, otherwise we back off
  private lastVerdictDispatch = new Map<number, number>(); // poolItemId → epoch ms

  private constructor() {}

  public static getInstance(): PoolPollEngine {
    if (!PoolPollEngine.instance) PoolPollEngine.instance = new PoolPollEngine();
    return PoolPollEngine.instance;
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('PoolPollEngine: starting');

    // Subscribe to upstream signal sources
    this.subscribeUpstream();

    // First tick immediately
    this.tick();
    this.tickId = setInterval(() => this.tick(), TICK_MS);

    // React to settings changes
    useSettingsStore.subscribe((state) => {
      if (!state.poolMarketHoursOnly && !this.isRunning) {
        this.tick();
      }
    });
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.tickId) {
      clearInterval(this.tickId);
      this.tickId = null;
    }
    if (this.momentumUnsub) { this.momentumUnsub(); this.momentumUnsub = null; }
    if (this.telegramUnsub) { this.telegramUnsub(); this.telegramUnsub = null; }
    this.emit({ type: 'pool:status', running: false, at: Date.now() });
    logger.info('PoolPollEngine: stopped');
  }

  public onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Force a re-verdict for a specific PoolItem now. Used by:
   *  - the "Run verdict now" button in the UI
   *  - the Telegram signal push handler
   *  - the momentum spike detector
   */
  public async forceVerdict(itemId: number, trigger: PoolVerdict['triggerType'] = 'MANUAL'): Promise<PoolVerdict | null> {
    const item = await db.pool_items.get(itemId);
    if (!item) return null;
    return poolVerdictEngine.analyze(item, trigger);
  }

  // -------- private --------

  private emit(event: PoolEvent) {
    this.listeners.forEach(l => {
      try { l(event); } catch (err) { /* swallow */ }
    });
  }

  private subscribeUpstream() {
    // React to momentum spikes for pooled symbols
    try {
      const { momentumSpikeDetector } = require('./MomentumSpikeDetectorService') as typeof import('./MomentumSpikeDetectorService');
      this.momentumUnsub = momentumSpikeDetector.subscribeToStateChanges(() => {
        this.handleMomentumOrTelegramTick();
      });
    } catch (err) {
      logger.warn('PoolPollEngine: momentum subscription failed', err);
    }

    // React to fresh Telegram signals
    try {
      const { telegramEarManager } = require('./TelegramEarManager') as typeof import('./TelegramEarManager');
      this.telegramUnsub = telegramEarManager.subscribe(() => {
        this.handleMomentumOrTelegramTick();
      });
    } catch (err) {
      logger.warn('PoolPollEngine: telegram subscription failed', err);
    }
  }

  private handleMomentumOrTelegramTick() {
    // Re-verdict pooled items that were mentioned in the last minute
    const oneMin = Date.now() - 60_000;
    db.pool_items.toArray().then(async (items) => {
      for (const item of items) {
        if (!item.id) continue;
        if (item.addedAt < oneMin) continue;
        if (this.lastVerdictDispatch.get(item.id)! > oneMin) continue;
        this.lastVerdictDispatch.set(item.id, Date.now());
        try {
          const v = await poolVerdictEngine.analyze(item, 'PATTERN');
          this.maybeFireAlert(v, item);
        } catch (err) {
          logger.warn(`PoolPollEngine: re-verdict failed for ${item.ticker}`, err);
        }
      }
    }).catch((err) => logger.warn('PoolPollEngine: re-verdict scan failed', err));
  }

  private async tick() {
    const settings = useSettingsStore.getState();
    if (settings.poolMarketHoursOnly && !isMarketHours()) {
      // Emit a status every 30 seconds so the UI can update the countdown
      const now = Date.now();
      if (now - (this as any)._lastStatusEmit > 30_000) {
        (this as any)._lastStatusEmit = now;
        this.emit({ type: 'pool:status', running: false, reason: 'market-closed', at: now });
      }
      return;
    }

    // Rate-limit guard: if we just got a 429, back off for 30s
    if (this.last429 && Date.now() - this.last429 < 30_000) return;

    try {
      const items = await db.pool_items
        .where('status')
        .anyOf(['WATCHING', 'VERDICT_READY', 'TRIGGERED'])
        .toArray();
      
      const pollableItems = items.filter(item => item.autoPoll !== 0);
      
      if (pollableItems.length === 0) {
        this.emit({ type: 'pool:status', running: true, at: Date.now() });
        return;
      }

      // Resolve any items missing an instrumentKey (idempotent)
      await this.resolveMissingKeys(pollableItems);

      // Batched REST quote refresh
      for (let i = 0; i < pollableItems.length; i += BATCH_SIZE) {
        const batch = pollableItems.slice(i, i + BATCH_SIZE);
        await this.refreshBatch(batch);
      }

      // 5-min candle boundary verdict pass
      const boundary = currentCandleBoundary();
      if (boundary !== this.lastCandleBoundary) {
        this.lastCandleBoundary = boundary;
        await this.runVerdictPass(pollableItems, 'SCHEDULED_OPEN');
      }

      this.emit({ type: 'pool:status', running: true, at: Date.now() });
    } catch (err) {
      logger.error('PoolPollEngine: tick failed', err);
    }
  }

  private async resolveMissingKeys(items: PoolItem[]) {
    for (const item of items) {
      if (item.instrumentKey) continue;
      try {
        const key = await upstoxInstrumentService.getInstrumentKey(item.ticker, item.exchange);
        if (key) {
          await db.pool_items.update(item.id!, { instrumentKey: key });
          item.instrumentKey = key;
        }
      } catch (err) {
        logger.warn(`PoolPollEngine: key resolve failed for ${item.ticker}`, err);
      }
    }
  }

  private async refreshBatch(batch: PoolItem[]) {
    const symbols = batch.map(i => i.ticker).join(',');
    try {
      const res = await fetch(`/api/python-nse/api/upstox/quotes?symbols=${encodeURIComponent(symbols)}`);
      if (res.status === 429) {
        this.last429 = Date.now();
        logger.warn('PoolPollEngine: 429 from /quotes, backing off');
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      const map: Record<string, number> = json?.data || {};
      for (const item of batch) {
        const price = Number(map[item.ticker] ?? map[item.ticker.toUpperCase()] ?? 0);
        if (!Number.isFinite(price) || price <= 0) continue;

        // Run level alert check with hysteresis
        const hitAlert = poolLevelAlertMonitor.check(item, price);
        if (hitAlert) {
          const verdictMock: PoolVerdict = {
            poolItemId: item.id!,
            ticker: item.ticker,
            generatedAt: Date.now(),
            verdict: hitAlert === 'TARGET_HIT' ? 'STRONG_BUY' : 'AVOID',
            score: 100,
            confidence: 1,
            summary: `${item.ticker} hit level alert: ${hitAlert} at ${price}`,
            reasoning: [`Live price ${price} crossed level target`],
            signals: {
              technical: { rsi: 50, macdHist: 0, above200sma: true, bbPos: 0.5 },
              flow: { oiChangePct: 0, volumeMultiplier: 1 }
            },
            sourceModel: 'LevelMonitor',
            triggerType: hitAlert
          };
          this.emit({
            type: 'pool:alert-fired',
            verdict: verdictMock,
            item,
            at: Date.now()
          });
        }

        const prevPrice = item.lastPrice;
        if (prevPrice !== price) {
          await db.pool_items.update(item.id!, { lastPrice: price });
          this.emit({
            type: 'pool:price-update',
            ticker: item.ticker,
            price,
            prevPrice,
            at: Date.now(),
          });

          // Check if there is an active signal on the same scrip
          const matchingSignal = await db.parsed_signals
            .where('instrument')
            .equals(item.ticker.toUpperCase())
            .and(s => s.status === 'ACTIVE')
            .first();
          if (matchingSignal) {
            this.emit({
              type: 'pool:signal-match',
              ticker: item.ticker,
              signal: matchingSignal,
              at: Date.now()
            });
          }
        }
      }
    } catch (err) {
      logger.warn(`PoolPollEngine: refreshBatch failed for ${symbols.slice(0, 30)}…`, err);
    }
  }

  private async runVerdictPass(items: PoolItem[], trigger: PoolVerdict['triggerType']) {
    for (const item of items) {
      if (!item.id) continue;
      try {
        const verdict = await poolVerdictEngine.analyze(item, trigger);
        const fresh = await db.pool_items.get(item.id);
        if (fresh) this.emit({ type: 'pool:verdict-ready', verdict, item: fresh, at: Date.now() });
        this.maybeFireAlert(verdict, fresh ?? item);
      } catch (err) {
        logger.warn(`PoolPollEngine: verdict failed for ${item.ticker}`, err);
      }
    }
  }

  private async maybeFireAlert(verdict: PoolVerdict, item: PoolItem) {
    if (!item.id) return;
    if (item.alertEnabled !== 1) return;
    if (!item.alertOn?.includes('VERDICT_FIRE')) return;

    const minScore = useSettingsStore.getState().poolAlertMinScore ?? 75;
    if (verdict.score < minScore) return;
    if (verdict.verdict === 'NEUTRAL' || verdict.verdict === 'AVOID') return;

    // Cooldown: don't re-fire for the same ticker within 5 minutes
    const lastFired = (verdict as any)._lastFiredForTicker as number | undefined;
    if (lastFired && Date.now() - lastFired < 5 * 60_000) return;

    try {
      // Lazy import to avoid a hard dependency at module load
      const { ProactiveAlertEngine } = await import('./ProactiveAlertEngine');
      await ProactiveAlertEngine.getInstance().proactivePoolVerdict(verdict, item);
      await db.pool_verdicts.update(verdict.id!, { notifiedAt: Date.now() });
      (verdict as any)._lastFiredForTicker = Date.now();
      this.emit({ type: 'pool:alert-fired', verdict, item, at: Date.now() });
      logger.info(`PoolPollEngine: alert fired for ${item.ticker} (score=${verdict.score})`);
    } catch (err) {
      logger.error('PoolPollEngine: alert fire failed', err);
    }
  }

  public async addSignalIntelItem(ticker: string, sourceChannel: string, signalData?: { entryPrice?: number; stopLoss?: number; target1?: number }): Promise<PoolItem | null> {
    try {
      const cleanTicker = ticker.toUpperCase().trim();
      const existing = await db.pool_items.where('ticker').equals(cleanTicker).first();
      if (existing) {
        logger.info(`[PoolPollEngine] ${cleanTicker} is already in Momentum Pool.`);
        return existing;
      }

      const isOption = cleanTicker.includes('CE') || cleanTicker.includes('PE') || cleanTicker.includes('FUT');
      const item: PoolItem = {
        ticker: cleanTicker,
        exchange: isOption ? 'NSE_FNO' : 'NSE_EQ',
        addedAt: Date.now(),
        source: 'TELEGRAM',
        sourceMeta: { handle: sourceChannel },
        targetBuyPrice: signalData?.entryPrice,
        stopLoss: signalData?.stopLoss,
        targetSellPrice: signalData?.target1,
        alertEnabled: 1,
        alertOn: ['VERDICT_FIRE', 'PRICE_TARGET_HIT', 'STOP_HIT'],
        status: 'WATCHING',
        autoPoll: 1,
        notes: `Auto-escalated from high-trust Telegram signal (${sourceChannel})`
      };

      const id = await db.pool_items.add(item);
      item.id = id;

      await this.forceVerdict(id, 'PATTERN');
      logger.info(`[PoolPollEngine] Auto-escalated signal ${cleanTicker} to Momentum Pool from ${sourceChannel}`);
      return item;
    } catch (err) {
      logger.error(`[PoolPollEngine] addSignalIntelItem failed for ${ticker}:`, err);
      return null;
    }
  }
}

export const poolPollEngine = PoolPollEngine.getInstance();
export default poolPollEngine;
