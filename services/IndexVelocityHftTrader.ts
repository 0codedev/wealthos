/**
 * IndexVelocityHftTrader — HFT-style index momentum capture (SANDBOX ONLY).
 *
 * Vision this implements: prop-desk-style velocity capture on NIFTY.
 * 1. Learn the marginal recent volatility: rolling average abs 1-min % move.
 * 2. On each CONFIRMATION CANDLE CLOSE (default 2-min), compare the closed
 *    candle's move against that baseline. A giant news/HFT-driven sweep shows
 *    up as a multi-sigma burst (e.g. 4x baseline) instead of a fixed threshold,
 *    so the trigger adapts to calm vs violent regimes automatically.
 * 3. Alert leg always fires through OmniAlertDispatcher (INDEX_VELOCITY_SPIKE).
 * 4. Trade leg ONLY when the user has explicitly enabled sandbox auto-trading
 *    in Settings -> Alerts -> Index Velocity (HFT) -> Auto-Trading. Orders go
 *    exclusively to the OpenAlgo SANDBOX via the python-bridge proxy, tagged
 *    strategy HFT_Velocity_SANDBOX. There is deliberately NO real-money path
 *    in this file.
 *
 * Continuation thesis: a confirmed abnormal index candle frequently extends
 * for the following minutes; we enter directionally at candle close with an
 * ATM option and let OpenAlgo sandbox track the paper result (feeding the
 * future self-improvement loop).
 */
import { useSettingsStore } from '../store/settingsStore';
import { upstoxWebSocketService, UpstoxTick } from './UpstoxWebSocketService';
import { omniAlertDispatcher } from './OmniAlertDispatcher';
import { logger } from './Logger';
import { isAlphaActiveHours } from '../types/trust';

const NIFTY_KEY = 'NSE_INDEX|Nifty 50';
const MIN_BASELINE_SAMPLES = 15;
const BASELINE_WINDOW_MINUTES = 30;
/** Absolute floor (%) so a dead-calm regime doesn't trigger on noise. */
const MOVE_FLOOR_PCT = 0.25;

interface MinuteBar {
  minuteStart: number; // epoch ms floored to minute
  close: number;       // last seen price in that minute
}

class IndexVelocityHftTrader {
  private isRunning = false;
  private bars: MinuteBar[] = [];
  private currentMinuteStart = 0;
  private currentPrice = 0;
  private lastTriggerAt = 0;
  private tradesToday = 0;
  private tradesDateKey = '';
  private pendingEvaluationMinute = 0;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('[HFT-Velocity] Starting index velocity watcher (NIFTY).');
    upstoxWebSocketService.subscribe([NIFTY_KEY], this.handleTickBound);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    upstoxWebSocketService.unsubscribe([NIFTY_KEY], this.handleTickBound);
    logger.info('[HFT-Velocity] Stopped.');
  }

  public getStatus() {
    const s = useSettingsStore.getState();
    return {
      running: this.isRunning,
      baselineReady: this.baselineVolPct !== null,
      baselineVolPct: this.baselineVolPct,
      samples: this.bars.length - 1,
      lastTriggerAt: this.lastTriggerAt,
      tradesToday: this.tradesToday,
      autoTradeEnabled: s.hftAutoTradeSandboxEnabled === true,
    };
  }

  private handleTickBound = (tick: UpstoxTick): void => this.handleTick(tick);

  private handleTick(tick: UpstoxTick): void {
    if (!this.isRunning || tick.ltp === null || tick.instrument_key !== NIFTY_KEY) return;

    const now = Date.now();
    const minuteStart = Math.floor(now / 60000) * 60000;
    this.currentPrice = tick.ltp;

    // Seed first bar lazily
    if (this.bars.length === 0) {
      this.currentMinuteStart = minuteStart;
      this.bars.push({ minuteStart, close: tick.ltp });
      return;
    }

    if (minuteStart > this.currentMinuteStart) {
      // Previous minute just closed -> its bar holds the last tick of that minute
      this.onMinuteClose(this.currentMinuteStart);
      this.currentMinuteStart = minuteStart;
      this.bars.push({ minuteStart, close: tick.ltp });
      if (this.bars.length > BASELINE_WINDOW_MINUTES + 5) this.bars.shift();
    } else {
      this.bars[this.bars.length - 1].close = tick.ltp;
    }
  }

  /** Rolling baseline: mean absolute 1-min % change across recent closed bars. */
  private get baselineVolPct(): number | null {
    if (this.bars.length < MIN_BASELINE_SAMPLES + 1) return null;
    const window = this.bars.slice(-BASELINE_WINDOW_MINUTES);
    let sum = 0;
    let n = 0;
    for (let i = 1; i < window.length; i++) {
      const prev = window[i - 1].close;
      if (prev <= 0) continue;
      sum += Math.abs((window[i].close - prev) / prev) * 100;
      n++;
    }
    return n >= MIN_BASELINE_SAMPLES ? sum / n : null;
  }

  private onMinuteClose(closedMinuteStart: number): void {
    const settings = useSettingsStore.getState();
    if (!settings.indexVelocityAlertsEnabled) return;

    // Evaluate only once per confirmation-window boundary
    const confirmMins = Math.max(1, settings.hftConfirmWindowMinutes || 2);
    if (this.pendingEvaluationMinute === closedMinuteStart) return;
    if ((closedMinuteStart / 60000) % confirmMins !== 0) {
      // Only evaluate every Nth minute so candles align (e.g. :00, :02, :04)
      return;
    }
    this.pendingEvaluationMinute = closedMinuteStart;

    const baseline = this.baselineVolPct;
    if (baseline === null) return;

    // Move of the confirmation window = current close vs close N bars ago
    const windowBars = this.bars.slice(-(confirmMins + 1));
    if (windowBars.length < confirmMins + 1) return;
    const refPrice = windowBars[0].close;
    const nowPrice = this.currentPrice || windowBars[windowBars.length - 1].close;
    if (refPrice <= 0) return;

    const movePct = ((nowPrice - refPrice) / refPrice) * 100;
    const absMove = Math.abs(movePct);
    const required = Math.max(baseline * (settings.hftVolMultiplier || 4), MOVE_FLOOR_PCT);

    if (absMove < required) return;

    // Cooldown guard
    const cooldownMs = (settings.indexVelocityCooldownMinutes || 3) * 60 * 1000;
    if (Date.now() - this.lastTriggerAt < cooldownMs) return;
    this.lastTriggerAt = Date.now();

    const direction: 'UP' | 'DOWN' = movePct >= 0 ? 'UP' : 'DOWN';

    logger.warn(
      `[HFT-Velocity] VELOCITY BURST: ${movePct.toFixed(2)}% over ${confirmMins}m ` +
      `vs baseline ${baseline.toFixed(3)}%/min (${(absMove / Math.max(baseline, 1e-6)).toFixed(1)}x). Direction ${direction}.`
    );

    // ---- ALERT LEG (always) ----
    omniAlertDispatcher.fire({
      symbol: 'NIFTY',
      instrumentKey: NIFTY_KEY,
      currentPrice: nowPrice,
      movePct,
      windowMinutes: confirmMins,
      volumeMultiplier: parseFloat((absMove / Math.max(baseline, 1e-6)).toFixed(1)),
      direction,
      triggerType: 'INDEX_VELOCITY_SPIKE',
      timestamp: Date.now(),
      velocity: `${absMove.toFixed(2)}% vs ${baseline.toFixed(3)}%/min baseline (${confirmMins}-min candle close)`
    }).catch(e => logger.error('[HFT-Velocity] dispatch failed', e));

    // ---- TRADE LEG (sandbox-only, human-gated) ----
    if (settings.hftAutoTradeSandboxEnabled === true) {
      this.executeSandboxEntry(direction, movePct, baseline, confirmMins).catch(e =>
        logger.error('[HFT-Velocity] sandbox entry failed', e)
      );
    }
  }

  private resetDailyCounterIfNeeded(): void {
    const key = new Date().toDateString();
    if (key !== this.tradesDateKey) {
      this.tradesDateKey = key;
      this.tradesToday = 0;
    }
  }

  /**
   * SANDBOX-ONLY directional entry: nearest-weekly ATM option via the
   * python-bridge OpenAlgo proxy. No real-money code path exists here by design.
   */
  private async executeSandboxEntry(
    direction: 'UP' | 'DOWN',
    movePct: number,
    baseline: number,
    confirmMins: number
  ): Promise<void> {
    const settings = useSettingsStore.getState();

    this.resetDailyCounterIfNeeded();
    if (this.tradesToday >= (settings.hftMaxTradesPerDay || 5)) {
      logger.warn(`[HFT-Velocity] Daily sandbox trade cap reached (${this.tradesToday}). Skipping.`);
      return;
    }
    if (!isAlphaActiveHours()) {
      logger.warn('[HFT-Velocity] Outside active market hours. Skipping sandbox entry.');
      return;
    }

    const optionType = direction === 'UP' ? 'CE' : 'PE';
    const symbol = buildAtmOptionSymbol(this.currentPrice, optionType);

    const reasoning =
      `Candle-close burst ${movePct.toFixed(2)}% in ${confirmMins}m | baseline ${baseline.toFixed(3)}%/min | ` +
      `entry ${direction === 'UP' ? 'long CE' : 'long PE'} continuation`;

    try {
      const resp = await fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          action: 'BUY',
          exchange: 'NSE_FNO',
          quantity: settings.hftQuantity || 75,
          reasoning
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.status === 'success') {
        this.tradesToday++;
        logger.info(`[HFT-Velocity] SANDBOX ORDER PLACED ${symbol} (${reasoning}). OrderId: ${data.orderid ?? 'ok'} [${this.tradesToday}/${settings.hftMaxTradesPerDay || 5} today]`);
      } else {
        logger.error(`[HFT-Velocity] SANDBOX ORDER REJECTED for ${symbol}: HTTP ${resp.status} ${JSON.stringify(data).slice(0, 200)}`);
      }
    } catch (err) {
      logger.error('[HFT-Velocity] Sandbox order network error:', err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Build the nearest-weekly ATM option symbol, e.g. NIFTY26AUG24500CE.
 * Weekly expiries fall on Thursday; if today IS Thursday we still target next
 * week's expiry after 15:00 IST to avoid same-day expiry entries.
 */
export function buildAtmOptionSymbol(indexLtp: number, optionType: 'CE' | 'PE'): string {
  const strikeStep = 50;
  const atm = Math.round(indexLtp / strikeStep) * strikeStep;

  const istNow = new Date(Date.now() + new Date().getTimezoneOffset() * 60000 + 5.5 * 3600000);
  const dow = istNow.getDay(); // 4 = Thursday
  const daysUntilThursday = (4 - dow + 7) % 7;
  let expiry = new Date(istNow.getTime() + daysUntilThursday * 86400000);
  if (daysUntilThursday === 0 && istNow.getHours() >= 15) {
    expiry = new Date(expiry.getTime() + 7 * 86400000);
  }

  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const yy = String(expiry.getFullYear()).slice(-2);
  const mmm = months[expiry.getMonth()];
  return `NIFTY${yy}${mmm}${atm}${optionType}`;
}

export const indexVelocityHftTrader = new IndexVelocityHftTrader();
export default indexVelocityHftTrader;
