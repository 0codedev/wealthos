import { useCosmicGovernorStore } from '../store/cosmicGovernorStore';
import { useSettingsStore } from '../store/settingsStore';
import { notificationService } from './NotificationService';
import { MomentumSpikeEvent } from './TelegramAlertService';
import { CrossTabCorrelator } from './CrossTabCorrelator';
import { db, PoolVerdict, PoolItem } from '../database';
import { logger } from './Logger';
import { llmPipeline } from './llm';
import { MarketPulseService } from './MarketPulseService';
import { isAlphaActiveHours } from '../types/trust';
import { orderBookIntelligenceService } from './OrderBookIntelligenceService';
import { orbAlertService } from './ORBAlertService';
import { momentumSpikeDetector } from './MomentumSpikeDetectorService';
import { indexVelocityHftTrader } from './IndexVelocityHftTrader';

export class ProactiveAlertEngine {
  private static instance: ProactiveAlertEngine;
  private intervalId: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null = null;
  private levelAlertIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastLevelAlerts: Map<string, number> = new Map();
  private lastTradeCount = 0;
  private unsubOrderBookSignal: (() => void) | null = null;
  private lastAlertTimes: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): ProactiveAlertEngine {
    if (!ProactiveAlertEngine.instance) {
      ProactiveAlertEngine.instance = new ProactiveAlertEngine();
    }
    return ProactiveAlertEngine.instance;
  }

  public start() {
    if (this.intervalId) return;

    // Start ORB and Day High/Low tracking
    orbAlertService.start();

    // Start Momentum Spike Detector
    momentumSpikeDetector.start().catch(err => {
      logger.error('ProactiveAlertEngine: Failed to start momentumSpikeDetector', err);
    });

    // Start HFT Index Velocity Trader (alerts always; sandbox trades only if
    // the user enabled hftAutoTradeSandboxEnabled in Settings)
    indexVelocityHftTrader.start().catch(err => {
      logger.error('ProactiveAlertEngine: Failed to start indexVelocityHftTrader', err);
    });

    // Subscribe to order book signal changes for proactive alert detection
    this.unsubOrderBookSignal = orderBookIntelligenceService.onGlobalSignalChange((signal) => {
      this.handleOrderBookSignalChange(signal);
    });

    // Initial check after 15 seconds
    setTimeout(() => {
      this.check();
    }, 15000);

    // Check every 5 minutes
    this.intervalId = setInterval(() => {
      this.check();
    }, 5 * 60 * 1000);

    // SPRINT 2.B1 — watchlist level-alert monitor (fast cadence, cheap check)
    this.levelAlertIntervalId = setInterval(() => {
      try { this.checkWatchlistLevelAlerts(); } catch (e) { logger.error('LevelAlert monitor error', e); }
    }, 30_000);
  }

  public stop() {
    // Stop ORB and Day High/Low tracking
    orbAlertService.stop();

    // Stop Momentum Spike Detector
    momentumSpikeDetector.stop();

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.levelAlertIntervalId) {
      clearInterval(this.levelAlertIntervalId);
      this.levelAlertIntervalId = null;
    }
    if (this.unsubOrderBookSignal) {
      this.unsubOrderBookSignal();
      this.unsubOrderBookSignal = null;
    }
  }

  private handleOrderBookSignalChange(signal: any) {
    if (signal.signal !== 'REVERSAL_RISK') return;

    const settings = useSettingsStore.getState();
    if (!settings.isUpstoxEnabled || !settings.showOrderBookDepth) return;

    if (!isAlphaActiveHours()) return;

    let watchlisted = false;
    try {
      const saved = localStorage.getItem('smart_watchlist_v2');
      if (saved) {
        const watchlistItems = JSON.parse(saved);
        const cleanSymbol = signal.symbol.split(':').pop() || '';
        watchlisted = watchlistItems.some((item: any) => 
          (item.ticker.toUpperCase() === cleanSymbol.toUpperCase() ||
          item.ticker.toUpperCase() === signal.symbol.toUpperCase()) &&
          !item.archived
        );
      }
    } catch (err) {
      logger.error('ProactiveAlertEngine: Failed to check watchlist', err);
    }

    if (!watchlisted) return;

    const now = Date.now();
    const lastAlertTime = this.lastAlertTimes.get(signal.symbol) || 0;
    const fiveMinutes = 5 * 60 * 1000;
    if (now - lastAlertTime < fiveMinutes) return;

    this.lastAlertTimes.set(signal.symbol, now);

    const cleanSym = signal.symbol.split(':').pop() || '';
    const askWallPrice = signal.largestAskWall?.price || 0;
    const askWallQty = signal.largestAskWall?.qty || 0;
    
    let wallDetails = '';
    if (signal.hasAskWallAbove && askWallPrice > 0) {
      wallDetails = `Ask wall at ₹${askWallPrice.toLocaleString('en-IN')} (${askWallQty.toLocaleString('en-IN')} qty). `;
    }

    const title = `🚨 Reversal Risk`;
    const body = `[${cleanSym}] ${wallDetails}Momentum Score: ${signal.momentumContinuationScore}. Consider exit.`;

    notificationService.send({
      title,
      body,
      tag: `reversal-risk-${cleanSym}`,
      requireInteraction: true
    });
  }

  /**
   * Adaptive AI Alerting
   * Analyzes state and generates a "Surgical" notification if risk is detected.
   */
  private async runAdaptiveCheck() {
    const govStore = useCosmicGovernorStore.getState();
    const marketPulse = await MarketPulseService.getPulse();
    
    // Only run AI check if something is "interesting" to save tokens
    const isHighRiskMarket = marketPulse.niftyTrend.toLowerCase().includes('volatile') || marketPulse.geopoliticalRisk !== 'low';
    const isEmotionalUser = govStore.isCircuitBreakerActive || govStore.tiltScore > 50;

    if (!isHighRiskMarket && !isEmotionalUser) return;

    const prompt = `
      You are the Proactive Risk Engine for Wealth Dashboard V2. 
      CONTEXT:
      - Market: ${marketPulse.headline} (${marketPulse.niftyTrend})
      - User State: Tilt Score ${govStore.tiltScore}, Circuit Breaker ${govStore.isCircuitBreakerActive ? 'ACTIVE' : 'OFF'}
      
      GOAL: Generate ONE high-impact, short notification to keep the user safe.
      
      RULES:
      1. Be surgical and slightly alarming if risk is high.
      2. If they are tilting, tell them to close the app.
      3. Return ONLY JSON: { "title": "...", "body": "..." }
    `;

    try {
      const response = await llmPipeline(prompt, {
        modelOverride: 'llama-3.1-8b-instant',
        jsonMode: true
      });
      const alert = JSON.parse(response.text.replace(/```json|```/g, '').trim());
      
      notificationService.send({
        title: alert.title,
        body: alert.body,
        tag: 'proactive-ai-risk'
      });
    } catch (e) {
      logger.error("ProactiveAlertEngine: AI check failed", e);
    }
  }

  private async check() {
    // Run pre-market news digest (independent of AI Coach setting)
    await this.runPreMarketNewsDigest();

    const settings = useSettingsStore.getState();
    if (!settings.isAICoachEnabled) return;

    logger.info("ProactiveAlertEngine: Running scheduled diagnostic check...");
    const govStore = useCosmicGovernorStore.getState();

    // Run Adaptive AI Check
    this.runAdaptiveCheck();

    const now = new Date();
    // TIMEZONE FIX: hour gate was local-machine time while the dedup key was
    // a UTC calendar date. After 18:30 IST the UTC date rolls to TOMORROW, so
    // the stored key silently matched and skipped the next morning brief.
    // Both gate and key now use explicit IST wall-clock.
    const istNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 60 * 60000);
    const currentHour = istNow.getHours();
    const todayStr = `${istNow.getFullYear()}-${String(istNow.getMonth() + 1).padStart(2, '0')}-${String(istNow.getDate()).padStart(2, '0')}`;
    const lastBriefDate = localStorage.getItem('wealth_ai_last_brief_date');

    if (currentHour >= 9 && lastBriefDate !== todayStr) {
      logger.info("ProactiveAlertEngine: Triggering morning brief...");
      notificationService.send({
        title: "☀️ Morning Financial Briefing Ready",
        body: "Tap to view today's F&O market sentiment, astrological planetary shadow warnings, and target updates.",
        tag: 'morning-briefing'
      });
      localStorage.setItem('wealth_ai_last_brief_date', todayStr);
    }

    const today = new Date().toISOString().split('T')[0];
    const todayTrades = await db.trades.where('date').startsWith(today).toArray();
    const currentTradeCount = todayTrades.length;

    if (currentTradeCount > this.lastTradeCount) {
      logger.info("ProactiveAlertEngine: New trades detected. Triggering immediate cross-tab correlation.");
      this.lastTradeCount = currentTradeCount;
      CrossTabCorrelator.getInstance().correlate(true);
    }

    if (govStore.isCircuitBreakerActive) {
      const lastTiltAlertTime = Number(localStorage.getItem('wealth_ai_last_tilt_alert') || '0');
      const oneHour = 60 * 60 * 1000;

      if (Date.now() - lastTiltAlertTime > oneHour) {
        notificationService.send({
          title: "⚠️ Cosmic Circuit Breaker Triggered",
          body: `Trading is restricted: ${govStore.blockReason || 'Cognitive bias threshold exceeded.'}`,
          tag: 'circuit-breaker',
          requireInteraction: true
        });
        localStorage.setItem('wealth_ai_last_tilt_alert', String(Date.now()));
      }
    }
  }

  /**
   * Proactive Pool Verdict Alert Dispatcher (CC39)
   */
  public async proactivePoolVerdict(verdict: PoolVerdict, item: PoolItem) {
    const now = Date.now();
    const lastAlertTime = this.lastAlertTimes.get(verdict.ticker) || 0;
    const fiveMinutes = 5 * 60 * 1000;
    if (now - lastAlertTime < fiveMinutes) return;
    this.lastAlertTimes.set(verdict.ticker, now);

    const title = `🚀 Pool Verdict: ${verdict.ticker}`;
    const body = `${verdict.verdict} (Score: ${verdict.score}). ${verdict.summary}`;
    notificationService.send({
      title,
      body,
      tag: `pool-verdict-${verdict.ticker}-${now}`,
      requireInteraction: true
    });

    // SPRINT 2.B3: guarantee a real instrument key before dispatch - an empty
    // key made the fired event untraceable on charts and broke downstream
    // subscriptions for symbols the poll engine never resolved.
    let instrumentKey = item.instrumentKey || '';
    if (!instrumentKey) {
      try {
        const { upstoxInstrumentService } = await import('./UpstoxInstrumentService');
        const keys = await upstoxInstrumentService.getInstrumentKeys([verdict.ticker], 'NSE_EQ');
        instrumentKey = keys[verdict.ticker] || '';
      } catch { /* fallthrough with '' */ }
    }

    const event: MomentumSpikeEvent = {
      symbol: verdict.ticker,
      instrumentKey,
      currentPrice: item.lastPrice || 0,
      movePct: verdict.score,
      windowMinutes: 0,
      volumeMultiplier: 0,
      direction: verdict.verdict.includes('BUY') ? 'UP' : 'DOWN',
      triggerType: 'VERDICT_FIRE',
      timestamp: now
    };

    try {
      const { omniAlertDispatcher } = require('./OmniAlertDispatcher') as typeof import('./OmniAlertDispatcher');
      await omniAlertDispatcher.fire(event, verdict.summary);
    } catch (err) {
      logger.error('ProactiveAlertEngine: Failed to trigger omniAlertDispatcher', err);
    }
  }

  /**
   * SPRINT 2.B1 — Watchlist level-alert monitor.
   * For items with alertsEnabled, compares the live tick price (from the spike
   * detector's per-symbol state) against targetBuyPrice / targetSellPrice and
   * fires a crossing alert once per side per 6 hours.
   */
  private checkWatchlistLevelAlerts() {
    const settings = useSettingsStore.getState();
    if (!settings.omniAlertEnabled) return;

    let items: any[] = [];
    try {
      items = JSON.parse(localStorage.getItem('smart_watchlist_v2') || '[]');
    } catch { return; }

    const armed = items.filter((i: any) => i && i.alertsEnabled && !i.archived && Number(i.targetBuyPrice) > 0);
    if (armed.length === 0) return;

    const now = Date.now();
    const cooldownMs = 6 * 60 * 60 * 1000; // one alert per side per 6h

    for (const it of armed) {
      const ticker = String(it.ticker || '').toUpperCase();
      const ltp = momentumSpikeDetector.getLivePrice(ticker);
      if (!ltp) continue;

      const buyLevel = Number(it.targetBuyPrice) || 0;
      const sellLevel = Number(it.targetSellPrice) || 0;

      const fire = (side: 'BUY' | 'SELL', level: number, direction: 'below' | 'above') => {
        const key = `${ticker}-${side}`;
        const last = this.lastLevelAlerts.get(key) || 0;
        if (now - last < cooldownMs) return;
        this.lastLevelAlerts.set(key, now);

        notificationService.send({
          title: `🎯 ${ticker} ${side === 'BUY' ? 'buy zone reached' : 'sell target hit'}`,
          body: `LTP ₹${ltp.toFixed(2)} crossed ${direction} your ₹${level.toFixed(2)} level.`,
          tag: `wl-level-${key}-${now}`,
          requireInteraction: true
        });
        logger.warn(`[LevelAlert] ${ticker} LTP ${ltp} crossed ${direction} ${side} level ${level}`);
      };

      if (buyLevel > 0 && ltp <= buyLevel) fire('BUY', buyLevel, 'below');
      if (sellLevel > 0 && ltp >= sellLevel) fire('SELL', sellLevel, 'above');
    }
  }

  /**
   * Pre-market news analysis and alert dispatch (8:45 AM IST)
   */
  private async runPreMarketNewsDigest() {
    const settings = useSettingsStore.getState();
    if (!settings.preMarketDigestEnabled) return;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const lastPremarketDate = localStorage.getItem('wealth_last_premarket_digest_date');

    if (lastPremarketDate === todayStr) return; // already ran today

    // Check if time is >= preMarketDigestTime (default 08:45) - IST wall-clock
    const [targetHour, targetMin] = (settings.preMarketDigestTime || '08:45').split(':').map(Number);
    const istNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + 5.5 * 60 * 60000);
    const currentHour = istNow.getHours();
    const currentMin = istNow.getMinutes();

    const isPastTime = (currentHour > targetHour) || (currentHour === targetHour && currentMin >= targetMin);
    if (!isPastTime) return;

    logger.info(`[ProactiveAlertEngine] Triggering 8:45 AM pre-market news digest...`);

    try {
      // 1) Fetch pool symbols
      const poolItems = await db.pool_items.toArray();
      const poolSymbols = poolItems.map(item => item.ticker.toUpperCase());

      // 2) Fetch news
      const { newsService } = await import('./NewsService');
      let newsArticles: import('./NewsService').NewsArticle[] = [];
      if (poolSymbols.length > 0) {
        newsArticles = await newsService.fetchUpstoxNews(poolSymbols);
      }
      if (newsArticles.length === 0) {
        newsArticles = await newsService.fetchMarketNews();
      }

      if (newsArticles.length === 0) {
        logger.warn(`[ProactiveAlertEngine] No pre-market news articles found.`);
        localStorage.setItem('wealth_last_premarket_digest_date', todayStr);
        return;
      }

      // 3) Analyze via GROQ LLM
      const headlinesText = newsArticles.slice(0, 15).map((n, i) => `${i + 1}. [${n.source}] ${n.title} - ${n.description}`).join('\n');
      
      const prompt = `
        You are the Pre-market News Analyst for Wealth Dashboard.
        Analyze the following pre-market news articles and headlines:
        ${headlinesText}
        
        GOAL: Synthesize a highly actionable, concise pre-market brief for the user.
        Identify which stocks are in the news, determine their trend direction (BULLISH/BEARISH/NEUTRAL), estimate key price levels to watch, and provide specific opening hours advice (e.g., "focus on the first 1 hour", "wait for pullback to support").
        
        Format the response as a clear text message using inline HTML bold tags only (e.g. <b>STOCKS IN NEWS</b>).
        DO NOT wrap the response in <html>, <head>, or <body> tags. Just output the content blocks directly.
        - Use <b>STOCKS IN NEWS</b> to list stocks.
        - Use <b>BULLISH OUTLOOK</b> for bullish stocks and levels.
        - Use <b>BEARISH OUTLOOK</b> for bearish stocks and levels.
        - Use <b>TACTICAL STRATEGY</b> for opening hours strategy.
        Keep the message under 200 words. Keep it professional and high-impact.
      `;

      const response = await llmPipeline(prompt, {
        modelOverride: settings.modelTelegramNewsId || 'llama-3.1-8b-instant',
        noCache: true
      });
      
      // Clean any accidental structural HTML tags
      let digestMsg = (response.text || '').replace(/<\/?(html|head|body|title)>/gi, '').trim();

      // 4) Dispatch
      // Browser notification
      notificationService.send({
        title: "📰 Pre-Market News Digest",
        body: "Detailed technical levels and outlook dispatched to Telegram.",
        tag: 'premarket-digest'
      });

      // Telegram Bot
      const { telegramAlertService } = await import('./TelegramAlertService');
      if (settings.telegramEnabled && telegramAlertService.isConfigured()) {
        await telegramAlertService.send(digestMsg);
      }



      logger.info(`[ProactiveAlertEngine] Pre-market news digest successfully sent.`);
      localStorage.setItem('wealth_last_premarket_digest_date', todayStr);
    } catch (err) {
      logger.error(`[ProactiveAlertEngine] Failed to run pre-market news digest:`, err);
    }
  }
}
