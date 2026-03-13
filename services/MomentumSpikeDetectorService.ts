import { useSettingsStore } from '../store/settingsStore';
import { useDhanStore } from '../store/dhanStore';
import { useGlobalTickStore } from '../store/globalTickStore';
import { alphaEngineService } from './AlphaEngineService';
import { FNO_STOCKS } from '../data/fno_stocks';
import { isAlphaActiveHours } from '../types/trust';
import { upstoxWebSocketService, UpstoxTick } from './UpstoxWebSocketService';
import { upstoxInstrumentService } from './UpstoxInstrumentService';
import { omniAlertDispatcher } from './OmniAlertDispatcher';
import { newsCorrelationService } from './NewsCorrelationService';
import { logger } from './Logger';

export interface SymbolMomentumState {
  symbol: string;
  instrumentKey: string;
  priceHistory: Array<{ price: number; timestamp: number }>;
  volumeHistory: Array<{ volume: number; timestamp: number }>;
  lastAlertTimestamp: number;
  baselineVolume: number; // avg volume per minute
  observedMinutes: number[]; // track recent minute volumes for baseline
  lastMinuteBoundary: number;
  // Cumulative volume snapshot taken at the last minute-boundary crossing.
  // Enables an exact closed-bucket per-minute volume regardless of tick gaps.
  lastBoundaryCumVolume: number | null;
  fomoActiveUntil: number;
  lastPrice: number;
  peakPriceAtAlert: number;
  direction: 'UP' | 'DOWN';
}

export interface MomentumSpikeEvent {
  symbol: string;
  instrumentKey: string;
  currentPrice: number;
  movePct: number;
  windowMinutes: number;
  volumeMultiplier: number;
  direction: 'UP' | 'DOWN';
  triggerType: 'PRICE_SPIKE' | 'VOLUME_SURGE' | 'NEWS_DRIVEN' | 'VERDICT_FIRE' | 'ORB_BREAKOUT' | 'HOD_BREAKOUT' | 'LOD_BREAKOUT' | 'HOD_PROXIMITY' | 'LOD_PROXIMITY' | 'INDEX_VELOCITY_SPIKE';
  timestamp: number;
  velocity?: string;
}

class MomentumSpikeDetectorService {
  private symbolStates: Map<string, SymbolMomentumState> = new Map();
  private isRunning = false;
  private subscribedKeys: Set<string> = new Set();
  private watchlistIntervalId: any = null;
  private newsScannerIntervalId: any = null;

  // Radar-idle tracking: when subscribedKeys.size === 0 during active market
  // hours the alert radar is blind. Exposed via getRadarStatus() so the UI
  // can surface a persistent warning instead of failing silently.
  private idleSinceTimestamp: number | null = null;
  private lastIdleWarningAt = 0;

  /**
   * Live subscription health for UI surfaces.
   * `idle` true during active hours with zero subscriptions = alerts CANNOT fire.
   */
  public getRadarStatus(): { count: number; idle: boolean; idleSince: number | null; usingFallback: boolean } {
    const active = isAlphaActiveHours();
    return {
      count: this.subscribedKeys.size,
      idle: active && this.subscribedKeys.size === 0,
      idleSince: this.idleSinceTimestamp,
      usingFallback: this.usingFallbackUniverse
    };
  }
  private usingFallbackUniverse = false;

  // Track state listeners for UI updates
  private stateChangeListeners: Set<() => void> = new Set();

  public subscribeToStateChanges(listener: () => void) {
    this.stateChangeListeners.add(listener);
    return () => {
      this.stateChangeListeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.stateChangeListeners.forEach(listener => {
      try { listener(); } catch (e) { /* ignore */ }
    });
  }

  async buildWatchlist(): Promise<{ symbol: string; instrumentKey: string }[]> {
    const settings = useSettingsStore.getState();
    const watchlistSymbols: Set<string> = new Set();

    // Scope A: Manual Watchlist
    try {
      const saved = localStorage.getItem('smart_watchlist_v2');
      if (saved) {
        const watchlistItems = JSON.parse(saved);
        watchlistItems.forEach((item: any) => {
          if (item.ticker && !item.archived) watchlistSymbols.add(item.ticker.toUpperCase().trim());
        });
      }
    } catch (err) {
      logger.error('MomentumSpikeDetector: Failed to load watchlist', err);
    }

    // Scope B: Watchlist + Open Positions
    if (settings.omniAlertScope === 'B' || settings.omniAlertScope === 'C') {
      const positions = useDhanStore.getState().positions || [];
      positions.forEach(pos => {
        if (pos.tradingSymbol) {
          const cleanSymbol = pos.tradingSymbol.split('-')[0].toUpperCase().trim();
          watchlistSymbols.add(cleanSymbol);
        }
      });
    }

    // Scope C: Watchlist + Positions + Top N by R-Factor
    if (settings.omniAlertScope === 'C') {
      const topN = settings.omniAlertScopeTopNByRFactor || 10;
      const cachedStocks = alphaEngineService.getCachedStocks() || [];
      const sortedByRFactor = [...cachedStocks]
        .filter(s => s.symbol && s.rFactor !== undefined)
        .sort((a, b) => (b.rFactor || 0) - (a.rFactor || 0))
        .slice(0, topN);

      sortedByRFactor.forEach(s => {
        watchlistSymbols.add(s.symbol.toUpperCase().trim());
      });
    }

    const symbols = Array.from(watchlistSymbols);
    this.usingFallbackUniverse = false;

    // FALLBACK UNIVERSE: empty scopes used to mean zero subscriptions and a
    // totally blind alert radar with NO error surfaced anywhere. When that
    // happens during active hours, subscribe to a liquid F&O subset instead
    // so the radar is never idle, and flag it loudly.
    if (symbols.length === 0) {
      if (isAlphaActiveHours()) {
        const fallbackSymbols = FNO_STOCKS.slice(0, 25).map(s => s.symbol.toUpperCase());
        logger.warn(
          `MomentumSpikeDetectorService: Scopes A/B/C produced ZERO symbols during active hours. ` +
          `Falling back to ${fallbackSymbols.length} liquid F&O names so the alert radar stays alive. ` +
          `Add symbols to your watchlist or open positions to scope the radar down.`
        );
        this.usingFallbackUniverse = true;
        return await this.resolveSymbols(fallbackSymbols);
      }
      return [];
    }

    return await this.resolveSymbols(symbols);
  }

  private async resolveSymbols(symbols: string[]): Promise<{ symbol: string; instrumentKey: string }[]> {
    // Resolve instrument keys in bulk
    const resolvedMap = await upstoxInstrumentService.getInstrumentKeys(symbols, 'NSE_EQ');
    const result: { symbol: string; instrumentKey: string }[] = [];

    for (const [symbol, key] of Object.entries(resolvedMap)) {
      if (key) {
        result.push({ symbol, instrumentKey: key });
      }
    }

    return result;
  }

  /**
   * Live LTP for a watched symbol (from tick-driven private state).
   * Returns null when unknown/not-yet-ticked. Used by the watchlist
   * level-alert monitor.
   */
  public getLivePrice(symbol: string): number | null {
    const st = this.symbolStates.get(symbol.toUpperCase().trim());
    return st && st.lastPrice > 0 ? st.lastPrice : null;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('MomentumSpikeDetectorService: Starting...');

    await this.syncWatchlistSubscriptions();

    // Rebuild watchlist and sync subscriptions every 5 minutes
    this.watchlistIntervalId = setInterval(async () => {
      await this.syncWatchlistSubscriptions();
    }, 5 * 60 * 1000);

    // Breaking news periodic scanner (every 2 minutes)
    this.newsScannerIntervalId = setInterval(async () => {
      await this.scanForBreakingNews();
    }, 2 * 60 * 1000);
  }

  /**
   * INSTANT RESYNC: the 5-min backstop interval left a blind window when a
   * symbol was added mid-session (avg ~2.5 min with zero spike coverage).
   * Intake surfaces (SmartWatchlist add, poolStore.addItem) call this right
   * after persisting so the new symbol subscribes within ~250ms.
   */
  public resyncNow(): void {
    this.syncWatchlistSubscriptions().catch(err =>
      logger.error('MomentumSpikeDetectorService: resyncNow failed', err)
    );
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    logger.info('MomentumSpikeDetectorService: Stopping...');

    if (this.watchlistIntervalId) {
      clearInterval(this.watchlistIntervalId);
      this.watchlistIntervalId = null;
    }
    if (this.newsScannerIntervalId) {
      clearInterval(this.newsScannerIntervalId);
      this.newsScannerIntervalId = null;
    }

    // Unsubscribe from all ticks
    const keys = Array.from(this.subscribedKeys);
    upstoxWebSocketService.unsubscribe(keys, this.handleTick);
    this.subscribedKeys.clear();
    this.symbolStates.clear();
    this.notifyListeners();
  }

  private async syncWatchlistSubscriptions(): Promise<void> {
    const list = await this.buildWatchlist();
    const newKeys = new Set(list.map(item => item.instrumentKey));

    // Determine keys to unsubscribe
    const toUnsubscribe: string[] = [];
    this.subscribedKeys.forEach(key => {
      if (!newKeys.has(key)) {
        toUnsubscribe.push(key);
      }
    });

    // Determine keys to subscribe
    const toSubscribe: string[] = [];
    list.forEach(item => {
      if (!this.subscribedKeys.has(item.instrumentKey)) {
        toSubscribe.push(item.instrumentKey);

        // Initialize state if not present
        if (!this.symbolStates.has(item.symbol)) {
          this.symbolStates.set(item.symbol, {
            symbol: item.symbol,
            instrumentKey: item.instrumentKey,
            priceHistory: [],
            volumeHistory: [],
            lastAlertTimestamp: 0,
            baselineVolume: 2000, // placeholder ONLY - VOLUME_SURGE is suppressed until warmup completes
            observedMinutes: [],
            lastMinuteBoundary: Math.floor(Date.now() / 60000) * 60000,
            lastBoundaryCumVolume: null,
            fomoActiveUntil: 0,
            lastPrice: 0,
            peakPriceAtAlert: 0,
            direction: 'UP'
          });
        }
      }
    });

    if (toUnsubscribe.length > 0) {
      upstoxWebSocketService.unsubscribe(toUnsubscribe, this.handleTick);
      toUnsubscribe.forEach(key => this.subscribedKeys.delete(key));
    }

    if (toSubscribe.length > 0) {
      upstoxWebSocketService.subscribe(toSubscribe, this.handleTick);
      toSubscribe.forEach(key => this.subscribedKeys.add(key));
    }

    // Radar-idle bookkeeping (visible failure instead of silent blindness)
    if (this.subscribedKeys.size === 0 && isAlphaActiveHours()) {
      const now = Date.now();
      if (this.idleSinceTimestamp === null) this.idleSinceTimestamp = now;
      // Re-warn at most every 5 minutes so logs stay readable
      if (now - this.lastIdleWarningAt > 5 * 60 * 1000) {
        logger.warn('MomentumSpikeDetectorService: ALERT RADAR IDLE - zero instruments subscribed during active market hours. No spike alerts can fire.');
        this.lastIdleWarningAt = now;
      }
    } else {
      this.idleSinceTimestamp = null;
    }

    logger.info(`MomentumSpikeDetectorService: Subscribed to ${this.subscribedKeys.size} instruments.`);
  }

  private handleTick = (tick: UpstoxTick): void => {
    // GLOBAL BRIDGE: forward every watchlist tick into the shared tick store
    // so ALL consumers (SmartWatchlist rows, ticker surfaces) see live prices.
    // Previously these ticks died inside this service's private state, leaving
    // non-bootstrap symbols permanently stale in the UI.
    if (tick.instrument_key) {
      useGlobalTickStore.getState().setTick(tick);
    }

    // Locate the symbol matching this instrument key
    let targetSymbol: string | null = null;
    let targetState: SymbolMomentumState | null = null;

    for (const [symbol, state] of this.symbolStates.entries()) {
      if (state.instrumentKey === tick.instrument_key) {
        targetSymbol = symbol;
        targetState = state;
        break;
      }
    }

    if (!targetSymbol || !targetState || tick.ltp === null) return;

    const now = Date.now();
    const price = tick.ltp;
    targetState.lastPrice = price;

    // 1. Record price tick
    targetState.priceHistory.push({ price, timestamp: now });

    // 2. Record volume tick
    if (tick.volume !== null) {
      targetState.volumeHistory.push({ volume: tick.volume, timestamp: now });

      // Recompute baseline volume on minute boundaries.
      // BUGFIX (closed-bucket): tick.volume is CUMULATIVE daily volume. The old
      // math subtracted the first tick of the PREVIOUS minute from the CURRENT
      // (new-minute) cumulative tick, measuring ~1-2 minutes of volume and
      // permanently inflating the baseline ~2x - which pushed the effective
      // surge bar to ~5-6x real volume and silenced the 10-11 AM window.
      // Now: on each boundary crossing we take the cumulative delta since the
      // PREVIOUS crossing and divide by elapsed minutes = exact per-minute rate.
      const currentMinute = Math.floor(now / 60000) * 60000;
      if (currentMinute > targetState.lastMinuteBoundary) {
        if (targetState.lastBoundaryCumVolume !== null) {
          const elapsedMins = Math.max(1, Math.round((currentMinute - targetState.lastMinuteBoundary) / 60000));
          const minuteVol = tick.volume - targetState.lastBoundaryCumVolume;
          if (minuteVol > 0) {
            const perMinVol = minuteVol / elapsedMins;
            targetState.observedMinutes.push(perMinVol);
            if (targetState.observedMinutes.length > 20) {
              targetState.observedMinutes.shift();
            }
            // Recalculate baseline volume
            const sum = targetState.observedMinutes.reduce((a, b) => a + b, 0);
            targetState.baselineVolume = sum / targetState.observedMinutes.length;
          }
        }
        targetState.lastBoundaryCumVolume = tick.volume;
        targetState.lastMinuteBoundary = currentMinute;
      }
    }

    // Trim history arrays to keep last 10 minutes
    const tenMinsAgo = now - 10 * 60 * 1000;
    targetState.priceHistory = targetState.priceHistory.filter(p => p.timestamp >= tenMinsAgo);
    targetState.volumeHistory = targetState.volumeHistory.filter(v => v.timestamp >= tenMinsAgo);

    // 3. Evaluate spike conditions
    const event = this.evaluateSpikeConditions(targetState);
    if (event) {
      // Trigger news correlation asynchronously
      this.dispatchSpikeAlert(targetState, event);
    }
  };

  private evaluateSpikeConditions(state: SymbolMomentumState): MomentumSpikeEvent | null {
    const settings = useSettingsStore.getState();
    if (!settings.omniAlertEnabled || !settings.omniAlertSpikeEnabled) return null;

    const now = Date.now();
    const cooldownMs = (settings.omniAlertCooldownMinutes || 10) * 60 * 1000;

    // Check Cooldown
    if (now - state.lastAlertTimestamp < cooldownMs) return null;

    // Determine window based on mode
    let windowMins = 5;
    let thresholdPct = 1.0;

    if (settings.omniAlertSpikeMode === 'A') {
      windowMins = 3;
      thresholdPct = 0.5;
    } else if (settings.omniAlertSpikeMode === 'B' || settings.omniAlertSpikeMode === 'C') {
      windowMins = 5;
      thresholdPct = 1.0;
    } else if (settings.omniAlertSpikeMode === 'D') {
      windowMins = settings.omniAlertCustomWindowMinutes || 5;
      thresholdPct = settings.omniAlertCustomPctThreshold || 1.0;
    }

    const windowMs = windowMins * 60 * 1000;
    const windowStart = now - windowMs;

    // Find price at start of window
    const startTick = state.priceHistory.find(p => p.timestamp >= windowStart);
    if (!startTick) return null;

    const currentPrice = state.lastPrice;
    const movePct = ((currentPrice - startTick.price) / startTick.price) * 100;
    const direction: 'UP' | 'DOWN' = movePct >= 0 ? 'UP' : 'DOWN';
    const absMovePct = Math.abs(movePct);

    // Evaluate Volume Surge Condition
    // WARMUP GATE: the 2000-share seed baseline is a placeholder. Firing on it
    // caused instant false VOLUME_SURGE storms for every liquid name at
    // subscribe time (real per-minute volume is 10x-50x the seed). Volume
    // triggers stay suppressed until >=3 real minute buckets are observed.
    const baselineWarmedUp = state.observedMinutes.length >= 3;
    let isVolumeSurge = false;
    let volMult = 0;
    if (baselineWarmedUp && state.volumeHistory.length > 2 && state.baselineVolume > 0) {
      const oneMinAgo = now - 60 * 1000;
      const startVolTick = state.volumeHistory.find(v => v.timestamp >= oneMinAgo);
      if (startVolTick) {
        const lastMinuteVol = state.volumeHistory[state.volumeHistory.length - 1].volume - startVolTick.volume;
        volMult = lastMinuteVol / state.baselineVolume;
        const volumeMultiplierSetting = settings.omniAlertVolumeSurgeMultiplier || 3.0;
        if (volMult >= volumeMultiplierSetting) {
          isVolumeSurge = true;
        }
      }
    }

    // Match conditions
    const isPriceSpike = absMovePct >= thresholdPct;

    if (isPriceSpike || isVolumeSurge) {
      return {
        symbol: state.symbol,
        instrumentKey: state.instrumentKey,
        currentPrice,
        movePct,
        windowMinutes: windowMins,
        volumeMultiplier: parseFloat(volMult.toFixed(1)),
        direction,
        triggerType: isPriceSpike ? 'PRICE_SPIKE' : 'VOLUME_SURGE',
        timestamp: now
      };
    }

    return null;
  }

  private async dispatchSpikeAlert(state: SymbolMomentumState, event: MomentumSpikeEvent) {
    const settings = useSettingsStore.getState();

    // Correlate with News
    const news = await newsCorrelationService.matchNewsForSymbol(state.symbol);
    const hasNews = !!news;

    if (hasNews) {
      event.triggerType = 'NEWS_DRIVEN';
    }

    // If Mode C: Only fire if threshold is met OR news is detected.
    // COOLDOWN FIX: lastAlertTimestamp used to be stamped BEFORE this check,
    // so a rejected event burned the per-symbol cooldown and blocked later
    // genuine spikes. Stamp only when we actually commit to dispatching.
    if (settings.omniAlertSpikeMode === 'C' && !isPriceSpikeMet(event, settings) && !hasNews) {
      // Failed Mode C check - rejected WITHOUT consuming the cooldown
      return;
    }

    state.lastAlertTimestamp = event.timestamp;

    // Activate Anti-FOMO Guard
    const cooldownMins = settings.omniAlertCooldownMinutes || 10;
    state.fomoActiveUntil = Date.now() + cooldownMins * 60 * 1000;
    state.peakPriceAtAlert = event.currentPrice;
    state.direction = event.direction;

    this.notifyListeners();

    // Fire dispatch
    await omniAlertDispatcher.fire(event, news?.title);
  }

  private async scanForBreakingNews() {
    const settings = useSettingsStore.getState();
    if (!settings.omniAlertEnabled || !settings.omniAlertSpikeEnabled || !settings.omniAlertNewsAlwaysFires) return;

    logger.debug('MomentumSpikeDetectorService: Scanning watchlist for breaking news...');
    for (const [symbol, state] of this.symbolStates.entries()) {
      const news = await newsCorrelationService.matchNewsForSymbol(symbol, 10); // last 10 mins
      if (news && newsCorrelationService.isBreakingNews(news)) {
        // Cooldown check for breaking news alert
        const now = Date.now();
        const cooldownMs = (settings.omniAlertCooldownMinutes || 10) * 60 * 1000;
        if (now - state.lastAlertTimestamp < cooldownMs) continue;

        state.lastAlertTimestamp = now;

        // Build a news-only mock spike event
        const event: MomentumSpikeEvent = {
          symbol: state.symbol,
          instrumentKey: state.instrumentKey,
          currentPrice: state.lastPrice || 0,
          movePct: 0,
          windowMinutes: 0,
          volumeMultiplier: 0,
          direction: 'UP',
          triggerType: 'NEWS_DRIVEN',
          timestamp: now
        };

        await omniAlertDispatcher.fire(event, news.title);
      }
    }
  }

  getFomoState(symbol: string): 'NONE' | 'CHASING' | 'COOLING' | 'CLEARED' {
    const state = this.symbolStates.get(symbol.toUpperCase().trim());
    if (!state || state.fomoActiveUntil === 0) return 'NONE';

    const now = Date.now();
    const elapsedMs = now - (state.fomoActiveUntil - (useSettingsStore.getState().omniAlertCooldownMinutes || 10) * 60 * 1000);

    if (now > state.fomoActiveUntil) {
      return 'CLEARED';
    }

    const elapsedMins = elapsedMs / 60000;
    if (elapsedMins < 5) return 'CHASING'; // 0-5 mins
    if (elapsedMins < 15) return 'COOLING'; // 5-15 mins

    return 'CLEARED';
  }

  getFomoStateDetails(symbol: string) {
    const state = this.symbolStates.get(symbol.toUpperCase().trim());
    return state ? {
      peakPrice: state.peakPriceAtAlert,
      direction: state.direction,
      alertTime: state.fomoActiveUntil - (useSettingsStore.getState().omniAlertCooldownMinutes || 10) * 60 * 1000
    } : null;
  }

  getActiveFomoSymbols() {
    const result: Array<{ symbol: string; state: 'CHASING' | 'COOLING'; peakPrice: number; timeElapsed: number }> = [];
    const now = Date.now();
    const cooldownMs = (useSettingsStore.getState().omniAlertCooldownMinutes || 10) * 60 * 1000;
    
    for (const [symbol, state] of this.symbolStates.entries()) {
      if (state.fomoActiveUntil > now) {
        const elapsedMs = now - (state.fomoActiveUntil - cooldownMs);
        const elapsedMins = elapsedMs / 60000;
        const stateName = elapsedMins < 5 ? 'CHASING' : 'COOLING';
        result.push({
          symbol,
          state: stateName,
          peakPrice: state.peakPriceAtAlert,
          timeElapsed: Math.floor(elapsedMins)
        });
      }
    }
    return result;
  }
}

function isPriceSpikeMet(event: MomentumSpikeEvent, settings: any): boolean {
  if (event.triggerType === 'VOLUME_SURGE') return false;
  let thresholdPct = 1.0;
  if (settings.omniAlertSpikeMode === 'A') thresholdPct = 0.5;
  else if (settings.omniAlertSpikeMode === 'B' || settings.omniAlertSpikeMode === 'C') thresholdPct = 1.0;
  else if (settings.omniAlertSpikeMode === 'D') thresholdPct = settings.omniAlertCustomPctThreshold || 1.0;

  return Math.abs(event.movePct) >= thresholdPct;
}

export const momentumSpikeDetector = new MomentumSpikeDetectorService();
export default momentumSpikeDetector;
