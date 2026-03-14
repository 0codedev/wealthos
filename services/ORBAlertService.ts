import { upstoxWebSocketService, UpstoxTick } from './UpstoxWebSocketService';
import { omniAlertDispatcher } from './OmniAlertDispatcher';
import { resolveInstrumentKey, getTodayCandles } from './IntradayCandleService';
import { isMarketHours } from '../types/trust';
import { useSettingsStore } from '../store/settingsStore';
import { logger } from './Logger';

interface IndexState {
  instrumentKey: string;
  symbol: string; // e.g. "NIFTY"
  high915to930: number;
  low915to930: number;
  dayHigh: number;
  dayLow: number;
  lastPrice: number;
  initialized: boolean;
  priceHistory: Array<{ price: number; timestamp: number }>;
}

class ORBAlertService {
  private static instance: ORBAlertService;
  private indices: Map<string, IndexState> = new Map();
  private lastAlertTimes: Map<string, number> = new Map();
  private isRunning = false;
  private settingsUnsubscribe: (() => void) | null = null;
  private handleTickBound = (tick: UpstoxTick) => this.handleTick(tick);

  private readonly INDEX_KEYS = {
    'NIFTY': 'NSE_INDEX|Nifty 50',
    'BANKNIFTY': 'NSE_INDEX|Nifty Bank',
    'FINNIFTY': 'NSE_INDEX|Nifty Fin Service',
    'MIDCPNIFTY': 'NSE_INDEX|Nifty Midcap 50',
    'SENSEX': 'BSE_INDEX|SENSEX'
  };

  private constructor() {
    // Initialize states
    Object.entries(this.INDEX_KEYS).forEach(([symbol, key]) => {
      this.indices.set(key, {
        instrumentKey: key,
        symbol,
        high915to930: 0,
        low915to930: Infinity,
        dayHigh: 0,
        dayLow: Infinity,
        lastPrice: 0,
        initialized: false,
        priceHistory: []
      });
    });
  }

  public static getInstance(): ORBAlertService {
    if (!ORBAlertService.instance) {
      ORBAlertService.instance = new ORBAlertService();
    }
    return ORBAlertService.instance;
  }

  /**
   * Helper to convert date to IST date object
   */
  private getISTDate(date: Date = new Date()): Date {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    return new Date(utc + 5.5 * 60 * 60000);
  }

  /**
   * Get dynamic end time of Opening Range based on setting (e.g. 9:15 + 15 = 9:30)
   */
  private getORBEndTimeNum(): number {
    const timeframe = useSettingsStore.getState().orbTimeframe || 15;
    let endHour = 9;
    let endMin = 15 + timeframe;
    if (endMin >= 60) {
      endHour += Math.floor(endMin / 60);
      endMin = endMin % 60;
    }
    return endHour * 100 + endMin;
  }

  /**
   * Initial backfill of today's candles to populate ORB high/low and HOD/LOD.
   * This handles the case where the application is opened mid-session.
   */
  public async initializeTodayRanges() {
    logger.info('[ORBAlertService] Backfilling today\'s ranges for indices...');
    const orbEndTime = this.getORBEndTimeNum();
    const enabledIndices = useSettingsStore.getState().orbAlertIndices || ['NIFTY', 'BANKNIFTY', 'SENSEX'];

    for (const [key, state] of this.indices.entries()) {
      if (!enabledIndices.includes(state.symbol)) {
        continue;
      }
      try {
        // Fetch today's 1-minute candles
        const candles = await getTodayCandles(state.symbol, '1minute');
        if (candles.length === 0) {
          logger.debug(`[ORBAlertService] No today's candles returned for ${state.symbol}`);
          continue;
        }

        let high915 = 0;
        let low915 = Infinity;
        let dayHigh = 0;
        let dayLow = Infinity;

        candles.forEach((c) => {
          // Parse candle timestamp (standard ISO or epoch string)
          const candleDate = new Date(c.ts);
          const istCandle = this.getISTDate(candleDate);
          
          const hours = istCandle.getHours();
          const minutes = istCandle.getMinutes();
          const timeNum = hours * 100 + minutes;

          // Compute 9:15 to ORB End range (inclusive of 9:15, up to ORB End)
          if (timeNum >= 915 && timeNum <= orbEndTime) {
            if (c.h > high915) high915 = c.h;
            if (c.l < low915) low915 = c.l;
          }

          // Compute overall day high/low
          if (c.h > dayHigh) dayHigh = c.h;
          if (c.l < dayLow) dayLow = c.l;
        });

        state.high915to930 = high915;
        state.low915to930 = low915;
        state.dayHigh = dayHigh;
        state.dayLow = dayLow;
        state.initialized = true;

        logger.info(`[ORBAlertService] Backfilled ${state.symbol}: ORB [${low915 === Infinity ? 'N/A' : low915} - ${high915}] (up to ${orbEndTime}), DayRange [${dayLow === Infinity ? 'N/A' : dayLow} - ${dayHigh}]`);
      } catch (err) {
        logger.error(`[ORBAlertService] Error backfilling range for ${state.symbol}:`, err);
      }
    }
  }

  /**
   * Starts monitoring index ticks
   */
  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Backfill today's range
    await this.initializeTodayRanges();

    // Subscribe to settings change to dynamically update subscriptions
    this.settingsUnsubscribe = useSettingsStore.subscribe((state, prevState) => {
      if (JSON.stringify(state.orbAlertIndices) !== JSON.stringify(prevState.orbAlertIndices)) {
        this.resyncSubscriptions(state.orbAlertIndices, prevState.orbAlertIndices);
      }
    });

    // Subscribe to currently enabled indices via WebSockets
    const enabledIndices = useSettingsStore.getState().orbAlertIndices || ['NIFTY', 'BANKNIFTY', 'SENSEX'];
    const keys = Array.from(this.indices.entries())
      .filter(([key, state]) => enabledIndices.includes(state.symbol))
      .map(([key]) => key);

    logger.info(`[ORBAlertService] Subscribing to ${keys.length} index feeds: ${keys.join(', ')}`);
    if (keys.length > 0) {
      upstoxWebSocketService.subscribe(keys, this.handleTickBound);
    }
  }

  /**
   * Stops monitoring
   */
  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
      this.settingsUnsubscribe = null;
    }

    const keys = Array.from(this.indices.keys());
    upstoxWebSocketService.unsubscribe(keys, this.handleTickBound);
    logger.info('[ORBAlertService] Monitoring stopped.');
  }

  private resyncSubscriptions(current: string[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'], prev: string[] = ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    if (!this.isRunning) return;

    const toUnsubscribe: string[] = [];
    const toSubscribe: string[] = [];

    // Find newly disabled
    prev.forEach(sym => {
      if (!current.includes(sym)) {
        const key = Object.entries(this.INDEX_KEYS).find(([s]) => s === sym)?.[1];
        if (key) toUnsubscribe.push(key);
      }
    });

    // Find newly enabled
    current.forEach(sym => {
      if (!prev.includes(sym)) {
        const key = Object.entries(this.INDEX_KEYS).find(([s]) => s === sym)?.[1];
        if (key) toSubscribe.push(key);
      }
    });

    if (toUnsubscribe.length > 0) {
      logger.info(`[ORBAlertService] Unsubscribing from disabled index feeds: ${toUnsubscribe.join(', ')}`);
      upstoxWebSocketService.unsubscribe(toUnsubscribe, this.handleTickBound);
    }

    if (toSubscribe.length > 0) {
      logger.info(`[ORBAlertService] Subscribing to newly enabled index feeds: ${toSubscribe.join(', ')}`);
      upstoxWebSocketService.subscribe(toSubscribe, this.handleTickBound);
    }
  }

  /**
   * Main tick handler
   */
  private handleTick(tick: UpstoxTick) {
    const key = tick.instrument_key;
    const state = this.indices.get(key);
    if (!state || tick.ltp === null || tick.ltp === undefined) return;

    const enabledIndices = useSettingsStore.getState().orbAlertIndices || ['NIFTY', 'BANKNIFTY', 'SENSEX'];
    if (!enabledIndices.includes(state.symbol)) return;

    const ltp = tick.ltp;
    state.lastPrice = ltp;

    // Track price history for velocity calculations
    const nowMs = Date.now();
    state.priceHistory.push({ price: ltp, timestamp: nowMs });
    // Keep only last 120 seconds
    state.priceHistory = state.priceHistory.filter(p => nowMs - p.timestamp <= 120 * 1000);

    // Calculate velocity (points change per minute over the last 2 minutes)
    let velocityStr = 'N/A';
    if (state.priceHistory.length > 1) {
      const oldest = state.priceHistory[0];
      const timeDiffSec = (nowMs - oldest.timestamp) / 1000;
      if (timeDiffSec > 5) {
        const pointDiff = ltp - oldest.price;
        const pointsPerMin = (pointDiff / timeDiffSec) * 60;
        const pctPerMin = (pointsPerMin / oldest.price) * 100;
        const directionSign = pointsPerMin >= 0 ? '+' : '';
        velocityStr = `${directionSign}${pointsPerMin.toFixed(1)} pts/min (${directionSign}${pctPerMin.toFixed(2)}%/min)`;
      }
    }

    // 0. High-Frequency Index Velocity Spike Detection
    const settings = useSettingsStore.getState();
    if (settings.indexVelocityAlertsEnabled && state.priceHistory.length > 1) {
      let windowSec = 15;
      let thresholdPct = 0.10;

      if (settings.indexVelocityMode === 'A') {
        windowSec = 5;
        thresholdPct = 0.05;
      } else if (settings.indexVelocityMode === 'B') {
        windowSec = 15;
        thresholdPct = 0.10;
      } else if (settings.indexVelocityMode === 'C') {
        windowSec = 30;
        thresholdPct = 0.20;
      } else if (settings.indexVelocityMode === 'D') {
        windowSec = settings.indexVelocityCustomWindow || 10;
        thresholdPct = settings.indexVelocityCustomPct || 0.08;
      }

      const windowMs = windowSec * 1000;
      const targetTime = nowMs - windowMs;

      // Find the tick closest to targetTime
      let baseTick = state.priceHistory[0];
      let closestDiff = Math.abs(baseTick.timestamp - targetTime);
      for (const p of state.priceHistory) {
        const diff = Math.abs(p.timestamp - targetTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          baseTick = p;
        }
      }

      const timeDeltaSec = (nowMs - baseTick.timestamp) / 1000;
      // Only verify if we have sufficient history depth (at least 75% of lookback window)
      if (timeDeltaSec >= windowSec * 0.75) {
        const pointDiff = ltp - baseTick.price;
        const pctChange = (pointDiff / baseTick.price) * 100;
        const absPctChange = Math.abs(pctChange);

        if (absPctChange >= thresholdPct) {
          const cooldownPeriod = (settings.indexVelocityCooldownMinutes || 3) * 60 * 1000;
          const cooldownKey = `${state.symbol}-VELOCITY-SPIKE`;
          const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
          if (nowMs - lastAlert > cooldownPeriod) {
            this.lastAlertTimes.set(cooldownKey, nowMs);
            const direction = pointDiff > 0 ? 'UP' : 'DOWN';
            const sign = pointDiff > 0 ? '+' : '';
            const spikeVelocityStr = `${sign}${pointDiff.toFixed(1)} pts in ${timeDeltaSec.toFixed(1)}s (${sign}${(pointDiff / timeDeltaSec * 60).toFixed(1)} pts/min)`;
            
            this.triggerAlert({
              symbol: state.symbol,
              instrumentKey: state.instrumentKey,
              currentPrice: ltp,
              movePct: pctChange,
              direction,
              triggerType: 'INDEX_VELOCITY_SPIKE',
              detail: `Velocity Spike: Index moved ${sign}${pointDiff.toFixed(1)} pts (${sign}${pctChange.toFixed(2)}%) in ${timeDeltaSec.toFixed(1)}s`,
              velocity: spikeVelocityStr
            });
          }
        }
      }
    }

    const istNow = this.getISTDate();
    const hours = istNow.getHours();
    const minutes = istNow.getMinutes();
    const timeNum = hours * 100 + minutes;
    const orbEndTime = this.getORBEndTimeNum();

    // 1. Maintain ORB High & Low dynamically during 9:15 - ORB End AM IST
    if (timeNum >= 915 && timeNum <= orbEndTime) {
      if (ltp > state.high915to930) {
        state.high915to930 = ltp;
      }
      if (ltp < state.low915to930) {
        state.low915to930 = ltp;
      }
    }

    // 2. Track overall HOD / LOD
    const isFirstRun = state.dayHigh === 0;
    let newHOD = false;
    let newLOD = false;

    if (isFirstRun) {
      state.dayHigh = ltp;
      state.dayLow = ltp;
    } else {
      if (ltp > state.dayHigh) {
        state.dayHigh = ltp;
        newHOD = true;
      }
      if (ltp < state.dayLow) {
        state.dayLow = ltp;
        newLOD = true;
      }
    }

    // Do not fire alerts on first initialization tick
    if (isFirstRun) return;

    // Alerts only run during standard market trading hours
    if (!isMarketHours()) return;

    const cooldownPeriod = 30 * 60 * 1000; // 30-min cooldown

    // 3. Opening Range Breakout (ORB) Alerts - starts after ORB End AM IST
    if (timeNum > orbEndTime && state.high915to930 > 0 && state.low915to930 < Infinity) {
      // Bullish ORB Breakout
      if (ltp > state.high915to930) {
        const cooldownKey = `${state.symbol}-ORB-UP`;
        const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
        if (nowMs - lastAlert > cooldownPeriod) {
          this.lastAlertTimes.set(cooldownKey, nowMs);
          this.triggerAlert({
            symbol: state.symbol,
            instrumentKey: state.instrumentKey,
            currentPrice: ltp,
            movePct: ((ltp - state.high915to930) / state.high915to930) * 100,
            direction: 'UP',
            triggerType: 'ORB_BREAKOUT',
            detail: `Broke ${useSettingsStore.getState().orbTimeframe}-min ORB High of ₹${state.high915to930.toFixed(2)}`,
            velocity: velocityStr
          });
        }
      }
      // Bearish ORB Breakout
      else if (ltp < state.low915to930) {
        const cooldownKey = `${state.symbol}-ORB-DOWN`;
        const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
        if (nowMs - lastAlert > cooldownPeriod) {
          this.lastAlertTimes.set(cooldownKey, nowMs);
          this.triggerAlert({
            symbol: state.symbol,
            instrumentKey: state.instrumentKey,
            currentPrice: ltp,
            movePct: ((state.low915to930 - ltp) / state.low915to930) * -100,
            direction: 'DOWN',
            triggerType: 'ORB_BREAKOUT',
            detail: `Broke ${useSettingsStore.getState().orbTimeframe}-min ORB Low of ₹${state.low915to930.toFixed(2)}`,
            velocity: velocityStr
          });
        }
      }
    }

    // 4. Day High/Low Breach Alerts
    if (newHOD && timeNum > orbEndTime) {
      const cooldownKey = `${state.symbol}-HOD-BREACH`;
      const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
      if (nowMs - lastAlert > cooldownPeriod) {
        this.lastAlertTimes.set(cooldownKey, nowMs);
        this.triggerAlert({
          symbol: state.symbol,
          instrumentKey: state.instrumentKey,
          currentPrice: ltp,
          movePct: 0,
          direction: 'UP',
          triggerType: 'HOD_BREAKOUT',
          detail: `Breached prior HOD. New HOD is ₹${ltp.toFixed(2)}`,
          velocity: velocityStr
        });
      }
    } else if (newLOD && timeNum > orbEndTime) {
      const cooldownKey = `${state.symbol}-LOD-BREACH`;
      const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
      if (nowMs - lastAlert > cooldownPeriod) {
        this.lastAlertTimes.set(cooldownKey, nowMs);
        this.triggerAlert({
          symbol: state.symbol,
          instrumentKey: state.instrumentKey,
          currentPrice: ltp,
          movePct: 0,
          direction: 'DOWN',
          triggerType: 'LOD_BREAKOUT',
          detail: `Breached prior LOD. New LOD is ₹${ltp.toFixed(2)}`,
          velocity: velocityStr
        });
      }
    }

    // 5. Day High/Low Proximity Alerts (within 0.1%)
    if (timeNum > orbEndTime) {
      const proxPct = 0.001; // 0.1%
      
      // Proximity to Day High
      const distToHigh = state.dayHigh - ltp;
      if (distToHigh > 0 && distToHigh / state.dayHigh <= proxPct) {
        const cooldownKey = `${state.symbol}-HOD-PROX`;
        const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
        if (nowMs - lastAlert > cooldownPeriod) {
          this.lastAlertTimes.set(cooldownKey, nowMs);
          this.triggerAlert({
            symbol: state.symbol,
            instrumentKey: state.instrumentKey,
            currentPrice: ltp,
            movePct: (distToHigh / state.dayHigh) * 100,
            direction: 'UP',
            triggerType: 'HOD_PROXIMITY',
            detail: `Approaching HOD (₹${state.dayHigh.toFixed(2)}). Dist: ${(distToHigh / state.dayHigh * 100).toFixed(2)}%`,
            velocity: velocityStr
          });
        }
      }

      // Proximity to Day Low
      const distToLow = ltp - state.dayLow;
      if (distToLow > 0 && distToLow / state.dayLow <= proxPct) {
        const cooldownKey = `${state.symbol}-LOD-PROX`;
        const lastAlert = this.lastAlertTimes.get(cooldownKey) || 0;
        if (nowMs - lastAlert > cooldownPeriod) {
          this.lastAlertTimes.set(cooldownKey, nowMs);
          this.triggerAlert({
            symbol: state.symbol,
            instrumentKey: state.instrumentKey,
            currentPrice: ltp,
            movePct: (distToLow / state.dayLow) * 100,
            direction: 'DOWN',
            triggerType: 'LOD_PROXIMITY',
            detail: `Approaching LOD (₹${state.dayLow.toFixed(2)}). Dist: ${(distToLow / state.dayLow * 100).toFixed(2)}%`,
            velocity: velocityStr
          });
        }
      }
    }
  }

  /**
   * Dispatches the event using OmniAlertDispatcher
   */
  private async triggerAlert(data: {
    symbol: string;
    instrumentKey: string;
    currentPrice: number;
    movePct: number;
    direction: 'UP' | 'DOWN';
    triggerType: 'ORB_BREAKOUT' | 'HOD_BREAKOUT' | 'LOD_BREAKOUT' | 'HOD_PROXIMITY' | 'LOD_PROXIMITY' | 'INDEX_VELOCITY_SPIKE';
    detail: string;
    velocity?: string;
  }) {
    const enabledTypes = useSettingsStore.getState().enabledOrbTriggerTypes || ['ORB_BREAKOUT', 'HOD_BREAKOUT', 'LOD_BREAKOUT', 'HOD_PROXIMITY', 'LOD_PROXIMITY'];
    if (data.triggerType !== 'INDEX_VELOCITY_SPIKE' && !enabledTypes.includes(data.triggerType)) return;

    logger.warn(`[ORBAlertService] ALERT TRIGGERED: ${data.symbol} - ${data.triggerType} (${data.detail})`);

    const event = {
      symbol: data.symbol,
      instrumentKey: data.instrumentKey,
      currentPrice: data.currentPrice,
      movePct: data.movePct,
      windowMinutes: useSettingsStore.getState().orbTimeframe || 15,
      volumeMultiplier: 0,
      direction: data.direction,
      triggerType: data.triggerType,
      timestamp: Date.now(),
      velocity: data.velocity || 'N/A'
    };

    try {
      await omniAlertDispatcher.fire(event, data.detail);
    } catch (err) {
      logger.error('[ORBAlertService] Failed to dispatch via OmniAlertDispatcher:', err);
    }
  }
}

export const orbAlertService = ORBAlertService.getInstance();
