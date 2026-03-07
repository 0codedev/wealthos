// LiveMarketFeedService.ts - Agent M (Phase 4: Real-Time Market Intelligence)
// Singleton service for live price streaming via WebSocket with REST polling fallback.
// Free data sources: Yahoo Finance (proxy), NSE India, Finnhub (opt-in API key).

import { logger } from '../Logger';

export interface LiveQuote {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePercent: number;
  bid?: number;
  ask?: number;
  volume?: number;
  timestamp: number;
  source: FeedSource;
}
export type FeedSource = 'yahoo' | 'finnhub' | 'nse' | 'alphavantage' | 'polling';
export type FeedStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'fallback';
export type FeedListener = (quotes: Map<string, LiveQuote>) => void;
export type StatusListener = (status: FeedStatus) => void;

const YAHOO_POLL_URL = '/api/yahoo/v7/finance/quote';
const NSE_QUOTE_URL = '/api/nse/api/quote-equity';
const FINNHUB_REST = 'https://finnhub.io/api/v1/quote';
const POLL_INTERVAL_MS = 30000;
const RECONNECT_MAX_MS = 30000;
const YAHOO_WS_URL = 'wss://streamer.finance.yahoo.com/v7/finance/options';

class LiveMarketFeedService {
  private quotes: Map<string, LiveQuote> = new Map();
  private subscribers: Set<FeedListener> = new Set();
  private statusSubscribers: Set<StatusListener> = new Set();
  private status: FeedStatus = 'idle';
  private ws: WebSocket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private subscribedSymbols: Set<string> = new Set();
  private lastUpdated: number = 0;
  private finnhubApiKey: string | null = null;
  private started = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  private setStatus(s: FeedStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusSubscribers.forEach((cb) => { try { cb(s); } catch (e) { logger.error('LiveMarketFeedService status cb', e); } });
  }

  private notify() {
    this.lastUpdated = Date.now();
    this.subscribers.forEach((cb) => { try { cb(this.quotes); } catch (e) { logger.error('LiveMarketFeedService cb', e); } });
  }

  public getStatus(): FeedStatus { return this.status; }
  public getLastUpdated(): number { return this.lastUpdated; }
  public getQuote(symbol: string): LiveQuote | undefined { return this.quotes.get(symbol.toUpperCase()); }
  public getAllQuotes(): Map<string, LiveQuote> { return this.quotes; }
  public setFinnhubApiKey(key: string | null) { this.finnhubApiKey = key; }

  public on(cb: FeedListener): () => void { this.subscribers.add(cb); return () => { this.subscribers.delete(cb); }; }
  public onStatusChange(cb: StatusListener): () => void { this.statusSubscribers.add(cb); cb(this.status); return () => { this.statusSubscribers.delete(cb); }; }

  private handleOnline() { logger.info('[LiveFeed] Network online, reconnecting...'); this.start(); }
  private handleOffline() { logger.warn('[LiveFeed] Network offline, using last-known cache'); this.setStatus('disconnected'); this.stopPolling(); }

  public start() {
    if (this.subscribedSymbols.size === 0) { return; }
    this.started = true;
    this.connectWebSocket();
  }

  public stop() {
    this.subscribedSymbols.clear();
    this.disconnect();
    this.stopPolling();
    this.started = false;
    this.setStatus('idle');
  }

  public subscribe(symbols: string[]) {
    let added = false;
    symbols.forEach((s) => { const k = s.toUpperCase(); if (!this.subscribedSymbols.has(k)) { this.subscribedSymbols.add(k); added = true; } });
    if (!added) return;
    if (this.status === 'connected' || this.status === 'fallback') { this.refreshSubscriptions(); }
    else if (!this.started) { this.start(); }
  }

  public unsubscribe(symbols: string[]) {
    let removed = false;
    symbols.forEach((s) => { const k = s.toUpperCase(); if (this.subscribedSymbols.delete(k)) { this.quotes.delete(k); removed = true; } });
    if (removed) { this.refreshSubscriptions(); this.notify(); }
  }

  private connectWebSocket() {
    if (typeof WebSocket === 'undefined') { this.fallbackToPolling(); return; }
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(YAHOO_WS_URL);
      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.sendSubscriptions();
        this.stopPolling();
      };
      this.ws.onmessage = (ev) => this.handleMessage(ev);
      this.ws.onerror = () => { /* will trigger onclose */ };
      this.ws.onclose = () => {
        this.ws = null;
        this.setStatus('disconnected');
        this.scheduleReconnect();
      };
    } catch (e) {
      logger.warn('[LiveFeed] WebSocket construct failed, falling back to polling', e);
      this.fallbackToPolling();
    }
  }

  private disconnect() {
    if (this.ws) { try { this.ws.close(); } catch (_) { /* ignore */ } this.ws = null; }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer != null) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    logger.info('[LiveFeed] Reconnect in ' + delay + 'ms (attempt ' + this.reconnectAttempts + ')');
    this.reconnectTimer = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => { this.reconnectTimer = null; this.connectWebSocket(); }, delay);
    this.fallbackToPolling();
  }

  private handleMessage(ev: MessageEvent) {
    try {
      const data = typeof ev.data === 'string' ? ev.data : '';
      if (!data) return;
      const parsed = JSON.parse(data);
      if (parsed && parsed.id && typeof parsed.price === 'number') {
        this.updateQuote(parsed.id, parsed.price, 'yahoo');
      }
    } catch (e) { /* ignore malformed */ }
  }

  private sendSubscriptions() {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify({ subscribe: Array.from(this.subscribedSymbols) })); } catch (_) { /* ignore */ }
    }
  }

  private refreshSubscriptions() {
    if (this.ws && this.ws.readyState === 1) { this.sendSubscriptions(); } else { this.fallbackToPolling(); }
  }

  private updateQuote(symbol: string, price: number, source: FeedSource, extras: Partial<LiveQuote> = {}) {
    const key = symbol.toUpperCase();
    const prev = this.quotes.get(key);
    const change = extras.change !== undefined ? extras.change : (prev ? price - prev.price : 0);
    const changePercent = extras.changePercent !== undefined ? extras.changePercent : (prev && prev.price > 0 ? (change / prev.price) * 100 : 0);
    const quote: LiveQuote = { symbol: key, price, change, changePercent, timestamp: Date.now(), source, ...extras, name: extras.name || prev?.name };
    this.quotes.set(key, quote);
    this.notify();
  }

  public ingestQuote(quote: LiveQuote) { this.updateQuote(quote.symbol, quote.price, quote.source, quote); }

  private fallbackToPolling() {
    if (this.pollTimer != null) return;
    this.setStatus('fallback');
    void this.pollOnce();
    const t = typeof window !== 'undefined' ? window.setInterval : setInterval;
    this.pollTimer = t(() => { void this.pollOnce(); }, POLL_INTERVAL_MS);
  }

  private stopPolling() {
    if (this.pollTimer != null) {
      const c = typeof window !== 'undefined' ? window.clearInterval : clearInterval;
      c(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    const symbols = Array.from(this.subscribedSymbols);
    if (symbols.length === 0) return;
    if (this.finnhubApiKey) { await this.pollFinnhub(symbols); return; }
    const yahooBatch = symbols.filter((s) => /^[A-Z\.:\-]+$/.test(s));
    const nseBatch = symbols.filter((s) => !yahooBatch.includes(s));
    if (yahooBatch.length > 0) {
      try { await this.pollYahoo(yahooBatch); } catch (e) { logger.warn('[LiveFeed] Yahoo poll failed', e); }
    }
    if (nseBatch.length > 0) {
      try { await this.pollNSE(nseBatch); } catch (e) { logger.warn('[LiveFeed] NSE poll failed', e); }
    }
  }

  private async pollYahoo(symbols: string[]): Promise<void> {
    const url = YAHOO_POLL_URL + '?symbols=' + encodeURIComponent(symbols.join(','));
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const results = j?.quoteResponse?.results || [];
    for (const q of results) {
      if (typeof q.regularMarketPrice === 'number' && q.regularMarketPrice > 0) {
        this.updateQuote(q.symbol, q.regularMarketPrice, 'yahoo', {
          name: q.shortName || q.longName,
          change: q.regularMarketChange || 0,
          changePercent: q.regularMarketChangePercent || 0,
          volume: q.regularMarketVolume,
        });
      }
    }
  }

  private async pollNSE(symbols: string[]): Promise<void> {
    for (const symbol of symbols.slice(0, 10)) {
      try {
        const r = await fetch(NSE_QUOTE_URL + '?symbol=' + encodeURIComponent(symbol));
        if (!r.ok) continue;
        const j = await r.json();
        const info = j?.priceInfo;
        if (info && typeof info.lastPrice === 'number') {
          this.updateQuote(symbol, info.lastPrice, 'nse', {
            change: info.change,
            changePercent: info.pChange,
            volume: info.totalTradedVolume,
          });
        }
      } catch (_) { /* ignore individual failures */ }
    }
  }

  private async pollFinnhub(symbols: string[]): Promise<void> {
    if (!this.finnhubApiKey) return;
    for (const s of symbols.slice(0, 30)) {
      try {
        const r = await fetch(FINNHUB_REST + '?symbol=' + encodeURIComponent(s) + '&token=' + this.finnhubApiKey);
        if (!r.ok) continue;
        const j = await r.json();
        if (typeof j.c === 'number' && j.c > 0) {
          this.updateQuote(s, j.c, 'finnhub', { change: j.d || 0, changePercent: j.dp || 0 });
        }
      } catch (_) { /* ignore */ }
    }
  }

  public clearCache() {
    this.quotes.clear();
    this.notify();
  }

  public snapshot(): LiveQuote[] {
    return Array.from(this.quotes.values());
  }

}

export const liveMarketFeedService = new LiveMarketFeedService();
export default liveMarketFeedService;

