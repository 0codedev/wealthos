import { logger } from '../Logger';
import { fetchConsolidatedFiiDii } from '../RealDataService';
import { liveMarketFeedService, LiveQuote } from '../live/LiveMarketFeedService';

export interface SentinelTelemetry {
  vix: number;
  fiiNet: number;
  niftySpot: number;
  nifty200EMA: number;
  isVixSpike: boolean;
  isFiiSelling: boolean;
  isEmaTesting: boolean;
  confluenceScore: number; // 0 to 3
}

export type SentinelListener = (telemetry: SentinelTelemetry) => void;

/** NSE holidays observed by the sentinel (subset — extend as needed). */
const NSE_HOLIDAYS_2026 = new Set<string>([
  '2026-01-26', // Republic Day
  '2026-03-04', // Holi
  '2026-04-03', // Good Friday
  '2026-05-01', // Maharashtra Day
  '2026-08-15', // Independence Day
  '2026-10-02', // Gandhi Jayanti
  '2026-11-08', // Diwali
  '2026-11-25', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
]);

/** Returns true if the current IST time is inside NSE cash-market hours. */
export function isWithinMarketHours(now: Date = new Date()): boolean {
  // Convert to IST (UTC+5:30)
  const istMs = now.getTime() + (5.5 * 60 - now.getTimezoneOffset()) * 60_000;
  const ist = new Date(istMs);
  const day = ist.getUTCDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const ymd = ist.toISOString().slice(0, 10);
  if (NSE_HOLIDAYS_2026.has(ymd)) return false;
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  // 09:00 – 15:30 IST
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

class MarketSentinel {
  private static instance: MarketSentinel;
  private listeners = new Set<SentinelListener>();
  private lastTelemetry: SentinelTelemetry | null = null;
  private isRunning = false;
  private unsubFeed: (() => void) | null = null;
  private fiiCache: number = 0;
  private lastFiiFetch: number = 0;
  private lastSnapshotHash: string = '';
  private lastSnapshotAt: number = 0;

  // CC32 — cached 200 EMA. Only recompute on update200EMA().
  private nifty200EMAReference = 22850;

  private constructor() {}

  static getInstance(): MarketSentinel {
    if (!MarketSentinel.instance) {
      MarketSentinel.instance = new MarketSentinel();
    }
    return MarketSentinel.instance;
  }

  /**
   * Start the real-time event subscription.
   * CC32 — gates polling on `isWithinMarketHours`; outside hours the sentinel
   * holds the last known telemetry and skips FII refresh.
   */
  start() {
    if (this.isRunning) return;

    // Subscribe to LiveMarketFeedService updates
    liveMarketFeedService.subscribe(['^NSEI', '^INDIAVIX']);
    this.unsubFeed = liveMarketFeedService.on(() => {
      void this.executeRealtimeTick();
    });

    this.isRunning = true;
    logger.info(`[MarketSentinel] Started real-time MarketSentinel (listening to LiveMarketFeedService).`);

    // Initial execution
    void this.executeRealtimeTick();
  }

  /**
   * Stop subscription.
   */
  stop() {
    if (this.unsubFeed) {
      this.unsubFeed();
      this.unsubFeed = null;
    }
    liveMarketFeedService.unsubscribe(['^NSEI', '^INDIAVIX']);
    this.isRunning = false;
    logger.info('[MarketSentinel] Stopped background sentinel.');
  }

  /**
   * CC32 — Snapshots are coalesced: identical telemetry within a 2-second
   * window is dropped to prevent notification spam during re-quotes.
   */
  private shouldEmit(telemetry: SentinelTelemetry): boolean {
    const now = Date.now();
    const hash = `${telemetry.vix}|${telemetry.fiiNet}|${telemetry.niftySpot}|${telemetry.isVixSpike ? 1 : 0}|${telemetry.isFiiSelling ? 1 : 0}|${telemetry.isEmaTesting ? 1 : 0}`;
    if (hash === this.lastSnapshotHash && now - this.lastSnapshotAt < 2_000) {
      return false;
    }
    this.lastSnapshotHash = hash;
    this.lastSnapshotAt = now;
    return true;
  }

  /**
   * Run the telemetry scan reacting to live events.
   */
  async executeRealtimeTick() {
    try {
      // CC32 — gate on market hours. If we're outside the trading window,
      // we still emit the last telemetry so subscribed components keep
      // showing live values, but we skip the expensive FII fetch.
      const marketOpen = isWithinMarketHours();

      // 1. Fetch live quotes from feed cache
      const niftyQuote = liveMarketFeedService.getQuote('^NSEI');
      const vixQuote = liveMarketFeedService.getQuote('^INDIAVIX');

      const niftySpot = niftyQuote?.price ?? 23500;
      const vix = vixQuote?.price ?? 15;

      // 2. Fetch FII net flow (throttle REST call to once every 10 minutes)
      const now = Date.now();
      if (marketOpen && now - this.lastFiiFetch > 10 * 60 * 1000) {
        try {
          const fiiHistory = await fetchConsolidatedFiiDii(1).catch(() => []);
          this.fiiCache = fiiHistory?.[0]?.fii_cash ?? 0;
          this.lastFiiFetch = now;
        } catch (_) {
          // keep cached value
        }
      }
      const fiiNet = this.fiiCache;

      // 3. Evaluate sentinel metrics
      const isVixSpike = vix > 18;
      const isFiiSelling = fiiNet < -1500; // Rs. 1500 Crore net outflows
      const niftyEMADiff = Math.abs(niftySpot - this.nifty200EMAReference) / this.nifty200EMAReference;
      const isEmaTesting = niftyEMADiff <= 0.015; // Within 1.5% of the 200 EMA

      let confluenceScore = 0;
      if (isVixSpike) confluenceScore++;
      if (isFiiSelling) confluenceScore++;
      if (isEmaTesting) confluenceScore++;

      const telemetry: SentinelTelemetry = {
        vix,
        fiiNet,
        niftySpot,
        nifty200EMA: this.nifty200EMAReference,
        isVixSpike,
        isFiiSelling,
        isEmaTesting,
        confluenceScore
      };

      // CC32 — coalesce: only update + notify if the snapshot is meaningfully new
      if (this.shouldEmit(telemetry)) {
        this.lastTelemetry = telemetry;
        this.notifyListeners(telemetry);
      }
    } catch (err) {
      logger.error('[MarketSentinel] Error during real-time telemetry tick', err);
    }
  }

  // Listener pattern
  subscribe(listener: SentinelListener): () => void {
    this.listeners.add(listener);
    if (this.lastTelemetry) {
      listener(this.lastTelemetry);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(telemetry: SentinelTelemetry) {
    this.listeners.forEach(l => {
      try {
        l(telemetry);
      } catch (err) {
        logger.error('[MarketSentinel] Listener callback threw error', err);
      }
    });
  }

  getLastTelemetry(): SentinelTelemetry | null {
    return this.lastTelemetry;
  }

  update200EMA(val: number) {
    this.nifty200EMAReference = val;
    logger.info(`[MarketSentinel] Updated Nifty 200 EMA Reference to ${val}`);
    void this.executeRealtimeTick();
  }
}

export const marketSentinel = MarketSentinel.getInstance();
export default marketSentinel;
