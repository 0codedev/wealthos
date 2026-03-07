// DataStreamRouter.ts - Bridge LiveMarketFeedService to named channels
import { liveMarketFeedService, LiveQuote } from './LiveMarketFeedService';
import { logger } from '../Logger';

type ChannelCallback = (quote: LiveQuote) => void;

class DataStreamRouter {
  private listeners: Map<string, Set<ChannelCallback>> = new Map();
  private channelToSymbolMap: Map<string, string> = new Map([
    ['nifty.spot', '^NSEI'],
    ['banknifty.spot', '^NSEBANK'],
    ['vix.value', '^INDIAVIX'],
  ]);
  private symbolToChannelMap: Map<string, Set<string>> = new Map();
  private unsubscriber: (() => void) | null = null;

  constructor() {
    this.rebuildSymbolToChannelMap();
  }

  private rebuildSymbolToChannelMap() {
    this.symbolToChannelMap.clear();
    this.channelToSymbolMap.forEach((symbol, channel) => {
      this.addSymbolMapping(symbol, channel);
    });
  }

  private addSymbolMapping(symbol: string, channel: string) {
    const sym = symbol.toUpperCase();
    if (!this.symbolToChannelMap.has(sym)) {
      this.symbolToChannelMap.set(sym, new Set());
    }
    this.symbolToChannelMap.get(sym)!.add(channel);
  }

  public subscribe(channel: string, callback: ChannelCallback): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);

    // Dynamic resolution of symbol for portfolio.{ticker} or generic ticker.channel
    let symbol = this.channelToSymbolMap.get(channel);
    if (!symbol) {
      if (channel.startsWith('portfolio.')) {
        const ticker = channel.replace('portfolio.', '');
        // Default Indian stock format is TICKER.NS on Yahoo
        symbol = ticker.toUpperCase().endsWith('.NS') ? ticker.toUpperCase() : `${ticker.toUpperCase()}.NS`;
        this.channelToSymbolMap.set(channel, symbol);
        this.addSymbolMapping(symbol, channel);
      } else {
        // Fallback: assume channel name is the ticker
        symbol = channel.toUpperCase();
        this.channelToSymbolMap.set(channel, symbol);
        this.addSymbolMapping(symbol, channel);
      }
    }

    // Subscribe symbol to the underlying market feed service
    liveMarketFeedService.subscribe([symbol]);

    // Ensure we are listening to feed service updates
    if (!this.unsubscriber) {
      this.unsubscriber = liveMarketFeedService.on((quotes) => this.handleFeedUpdate(quotes));
    }

    return () => {
      const set = this.listeners.get(channel);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.listeners.delete(channel);
          // Unsubscribe from LiveMarketFeedService if no one else is listening to this symbol
          const sym = this.channelToSymbolMap.get(channel);
          if (sym) {
            const hasOtherListeners = Array.from(this.symbolToChannelMap.get(sym.toUpperCase()) || []).some(
              (ch) => this.listeners.has(ch) && this.listeners.get(ch)!.size > 0
            );
            if (!hasOtherListeners) {
              liveMarketFeedService.unsubscribe([sym]);
            }
          }
        }
      }
      if (this.listeners.size === 0 && this.unsubscriber) {
        this.unsubscriber();
        this.unsubscriber = null;
      }
    };
  }

  private handleFeedUpdate(quotes: Map<string, LiveQuote>) {
    quotes.forEach((quote, symbol) => {
      const channels = this.symbolToChannelMap.get(symbol.toUpperCase());
      if (channels) {
        channels.forEach((channel) => {
          const callbacks = this.listeners.get(channel);
          if (callbacks) {
            callbacks.forEach((cb) => {
              try {
                cb(quote);
              } catch (err) {
                logger.error(`[DataStreamRouter] Error in callback for channel ${channel}`, err);
              }
            });
          }
        });
      }
    });
  }

  // Force route a direct quote injection
  public routeQuote(symbol: string, quote: LiveQuote) {
    const key = symbol.toUpperCase();
    const channels = this.symbolToChannelMap.get(key);
    if (channels) {
      channels.forEach((channel) => {
        const callbacks = this.listeners.get(channel);
        if (callbacks) {
          callbacks.forEach((cb) => {
            try { cb(quote); } catch (_) {}
          });
        }
      });
    }
  }
}

export const dataStreamRouter = new DataStreamRouter();
export default dataStreamRouter;
