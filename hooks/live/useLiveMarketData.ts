// useLiveMarketData.ts - Agent M (Phase 4)
// React hook to subscribe to LiveMarketFeedService for a given set of tickers.
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { liveMarketFeedService, LiveQuote, FeedStatus } from '../../services/live/LiveMarketFeedService';

export interface LiveMarketHook {
  prices: Map<string, LiveQuote>;
  quotes: LiveQuote[];
  isConnected: boolean;
  status: FeedStatus;
  lastUpdated: number;
  getQuote: (symbol: string) => LiveQuote | undefined;
}

export function useLiveMarketData(symbols: string[]): LiveMarketHook {
  const symbolsKey = useMemo(() => [...symbols].sort().join(','), [symbols]);
  const sorted = useMemo(() => [...symbols].sort(), [symbolsKey]);
  const [prices, setPrices] = useState<Map<string, LiveQuote>>(() => liveMarketFeedService.getAllQuotes());
  const [status, setStatus] = useState<FeedStatus>(() => liveMarketFeedService.getStatus());
  const [lastUpdated, setLastUpdated] = useState<number>(() => liveMarketFeedService.getLastUpdated());

  useEffect(() => {
    if (sorted.length === 0) return;
    liveMarketFeedService.subscribe(sorted);
    const unsubQ = liveMarketFeedService.on((q) => {
      setPrices(new Map(q));
      setLastUpdated(liveMarketFeedService.getLastUpdated());
    });
    const unsubS = liveMarketFeedService.onStatusChange((s) => setStatus(s));
    return () => {
      liveMarketFeedService.unsubscribe(sorted);
      unsubQ();
      unsubS();
    };
  }, [symbolsKey]);

  const quotesArray = useMemo(() => sorted.map((s) => prices.get(s)).filter(Boolean) as LiveQuote[], [prices, sorted]);
  const getQuote = useCallback((s: string) => prices.get(s.toUpperCase()), [prices]);

  return { prices, quotes: quotesArray, isConnected: status === 'connected', status, lastUpdated, getQuote };
}

export default useLiveMarketData;
