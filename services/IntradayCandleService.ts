/**
 * CC68.44 — IntradayCandleService
 *
 * Thin cached layer over the two existing candle endpoints, normalized to the
 * CleanTrendEngine's `Candle` shape. Used by the Morning Momentum async pass
 * to score the institutional-footprint pattern.
 *
 *   - Today (live):  upstoxMarketDataService.getIntradayCandles → /api/upstox/intraday-candles
 *                    (cached by upstoxCacheService, auto-invalidates 15:00 IST = day-close cleanup)
 *   - Historical:    /api/upstox/historical-candles?interval=5minute → serves from the
 *                    parquet archive (python-bridge/parquet_query.query_candles) when the
 *                    live Upstox API has no data. This is the user's downloaded dataset.
 *   - Symbol→key:    /api/upstox/instruments/key (sqlite upstox_instruments), cached in-memory.
 *
 * F&O scope: callers pass FNO_STOCKS symbols only. In Focus Mode only the
 * dominant sector's candidates are fetched (≈10–20), not all 200.
 */
import { upstoxMarketDataService } from './UpstoxMarketDataService';
import type { Candle } from './alpha/CleanTrendEngine';

const instrumentKeyCache = new Map<string, string | null>();

/** Resolve a symbol (e.g. 'RELIANCE') to an Upstox instrument_key, cached per session. */
export async function resolveInstrumentKey(symbol: string, exchange = 'NSE_EQ'): Promise<string | null> {
  const sym = symbol.toUpperCase().trim();
  if (instrumentKeyCache.has(sym)) return instrumentKeyCache.get(sym) ?? null;
  try {
    const res = await fetch(`/api/python-nse/api/upstox/instruments/key?symbol=${encodeURIComponent(sym)}&exchange=${encodeURIComponent(exchange)}`);
    if (res.ok) {
      const json = await res.json();
      const key = json?.instrument_key ?? null;
      instrumentKeyCache.set(sym, key);
      return key;
    }
  } catch {
    /* fall through to null */
  }
  instrumentKeyCache.set(sym, null);
  return null;
}

/** Normalize the Upstox candle payload (array or object rows) into Candle[]. */
function normalize(payload: unknown): Candle[] {
  const rows: any[] = Array.isArray(payload) ? payload
    : Array.isArray((payload as any)?.data) ? (payload as any).data
    : Array.isArray((payload as any)?.candles) ? (payload as any).candles
    : [];
  const out: Candle[] = [];
  for (const r of rows) {
    // Upstox format: [timestamp, open, high, low, close, volume, open_interest]
    if (Array.isArray(r)) {
      out.push({ ts: String(r[0]), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] });
    } else if (r && typeof r === 'object') {
      out.push({ ts: String(r.ts ?? r.timestamp ?? ''), o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v });
    }
  }
  return out;
}

/** Today's live 5-min (default) candles for a symbol. Cached by upstoxCacheService. */
export async function getTodayCandles(symbol: string, interval = '5minute'): Promise<Candle[]> {
  let key: string | null = null;
  const upperSymbol = symbol.toUpperCase().trim();
  if (upperSymbol === 'NIFTY' || upperSymbol === 'NIFTY 50') key = 'NSE_INDEX|Nifty 50';
  else if (upperSymbol === 'BANKNIFTY' || upperSymbol === 'NIFTY BANK') key = 'NSE_INDEX|Nifty Bank';
  else if (upperSymbol === 'FINNIFTY' || upperSymbol === 'NIFTY FIN SERVICE') key = 'NSE_INDEX|Nifty Fin Service';
  else if (upperSymbol === 'MIDCPNIFTY' || upperSymbol === 'NIFTY MIDCAP 50') key = 'NSE_INDEX|Nifty Midcap 50';
  else if (upperSymbol === 'SENSEX') key = 'BSE_INDEX|SENSEX';
  else key = await resolveInstrumentKey(symbol);

  if (!key) return [];
  try {
    const data = await upstoxMarketDataService.getIntradayCandles(key, interval);
    return normalize(data);
  } catch {
    return [];
  }
}

/**
 * Historical 5-min candles for the 9:30-volume baseline. Served from the
 * parquet archive via the /historical-candles fallback when live Upstox has
 * no data. from/to = YYYY-MM-DD.
 */
export async function getHistoricalCandles(
  symbol: string,
  interval: string,
  fromDate: string,
  toDate: string,
): Promise<Candle[]> {
  const key = await resolveInstrumentKey(symbol);
  if (!key) return [];
  try {
    const res = await fetch(
      `/api/python-nse/api/upstox/historical-candles?instrument_key=${encodeURIComponent(key)}`
      + `&interval=${encodeURIComponent(interval)}`
      + `&from_date=${encodeURIComponent(fromDate)}`
      + `&to_date=${encodeURIComponent(toDate)}`,
    );
    if (res.ok) return normalize(await res.json());
  } catch {
    /* empty */
  }
  return [];
}

const timeKey = (ts: string): string => {
  const m = ts.match(/(\d{2}:\d{2})/);
  return m ? m[1] : ts;
};

interface CandleCacheRecord {
  key: string;
  date: string;
  data: Candle[];
  fetchedAt: number;
}

const memoryCandleCache = new Map<string, CandleCacheRecord>();
const MAX_CANDLE_CACHE_ENTRIES = 120;

function getFromCandleCache(key: string, date: string): Candle[] | null {
  const inMem = memoryCandleCache.get(key);
  if (inMem && inMem.date === date) {
    // refresh LRU order
    memoryCandleCache.delete(key);
    memoryCandleCache.set(key, inMem);
    return inMem.data;
  }
  try {
    const raw = sessionStorage.getItem(`candle_cache_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === date && Array.isArray(parsed.data)) {
        setInCandleCache(key, date, parsed.data);
        return parsed.data;
      }
    }
  } catch {
    // ignore sessionStorage errors
  }
  return null;
}

function setInCandleCache(key: string, date: string, data: Candle[]): void {
  if (memoryCandleCache.size >= MAX_CANDLE_CACHE_ENTRIES) {
    const oldestKey = memoryCandleCache.keys().next().value;
    if (oldestKey) memoryCandleCache.delete(oldestKey);
  }
  const record: CandleCacheRecord = {
    key,
    date,
    data: data.map(c => ({ ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })),
    fetchedAt: Date.now()
  };
  memoryCandleCache.set(key, record);
  try {
    sessionStorage.setItem(`candle_cache_${key}`, JSON.stringify(record));
  } catch {
    // ignore sessionStorage quota errors
  }
}

// In-memory historical candle prefetch/get helpers
export async function getOrFetchHistoricalCandles(
  symbol: string,
  interval: string,
  fromDate: string,
  toDate: string
): Promise<Candle[]> {
  const sym = symbol.toUpperCase().trim();
  const todayStr = new Date().toISOString().slice(0, 10);
  const cacheKey = `${todayStr}_${sym}_${interval}`;

  const cached = getFromCandleCache(cacheKey, todayStr);
  if (cached) {
    return cached;
  }

  const data = await getHistoricalCandles(sym, interval, fromDate, toDate);
  if (data.length > 0) {
    setInCandleCache(cacheKey, todayStr, data);
  }
  return data;
}

export async function bulkPrefetchHistoricalCandles(symbols: string[]): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(to.getTime() - 15 * 24 * 3600 * 1000); // 15 days
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const fromDate = fmt(from);
  const toDate = fmt(to);
  const interval = '5minute';

  const limit = 5;
  const uniqueSymbols = Array.from(new Set(symbols.map(s => s.toUpperCase().trim())));

  const chunks: string[][] = [];
  for (let i = 0; i < uniqueSymbols.length; i += limit) {
    chunks.push(uniqueSymbols.slice(i, i + limit));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const key = await resolveInstrumentKey(symbol);
          if (!key) return;

          const cacheKey = `${todayStr}_${symbol}_${interval}`;
          const cached = getFromCandleCache(cacheKey, todayStr);
          if (cached) {
            return;
          }
          await getOrFetchHistoricalCandles(symbol, interval, fromDate, toDate);
        } catch (err) {
          console.warn(`Failed to prefetch historical candles for ${symbol}:`, err);
        }
      })
    );
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Map to cache the historical time-of-day baseline average: sym -> { lastTime, avg }
interface HistAvgEntry {
  lastTime: string;
  avg: number;
}
const histAvgCache = new Map<string, HistAvgEntry>();
const timeOfDayRvolLoading = new Set<string>();

/** Clear ToD calculation caches (used on manual refresh) */
export function clearTimeOfDayRvolCache(symbols?: string[]): void {
  if (symbols) {
    for (const sym of symbols) {
      const s = sym.toUpperCase().trim();
      histAvgCache.delete(s);
      timeOfDayRvolLoading.delete(s);
    }
  } else {
    histAvgCache.clear();
    timeOfDayRvolLoading.clear();
  }
}

/** Get the time-of-day volume ratio (RVOL) compared to historical 5-min candles dynamically. */
export function getHistRatio(symbol: string, currentVolume?: number): number | null {
  const sym = symbol.toUpperCase().trim();

  // Determine current expected 5-min slot time (e.g. "09:45")
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const marketOpenMinutes = 9 * 60 + 15;
  const marketCloseMinutes = 15 * 60 + 30;
  const targetMinutes = Math.min(Math.max(currentMinutes, marketOpenMinutes), marketCloseMinutes);
  const slotMinutes = Math.floor(targetMinutes / 5) * 5;
  const hh = String(Math.floor(slotMinutes / 60)).padStart(2, '0');
  const mm = String(slotMinutes % 60).padStart(2, '0');
  const expectedLastTime = `${hh}:${mm}`;

  const cached = histAvgCache.get(sym);
  if (cached && cached.lastTime === expectedLastTime) {
    if (currentVolume !== undefined && currentVolume !== null) {
      return cached.avg > 0 ? currentVolume / cached.avg : 1.0;
    }
  }

  // Trigger background fetch if not already loading
  if (!timeOfDayRvolLoading.has(sym)) {
    timeOfDayRvolLoading.add(sym);
    (async () => {
      try {
        const today = await getTodayCandles(sym, '5minute');
        if (today.length === 0) return;

        const todayTimes = today.map(t => timeKey(t.ts)).sort();
        const lastTodayTime = todayTimes[todayTimes.length - 1] || expectedLastTime;

        const to = new Date();
        const from = new Date(to.getTime() - 15 * 24 * 3600 * 1000); // 15 days (~10 trading days)
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        
        const hist = await getOrFetchHistoricalCandles(sym, '5minute', fmt(from), fmt(to));
        if (hist.length === 0) return;

        const candlesByDate: Record<string, Candle[]> = {};
        for (const h of hist) {
          const dateStr = h.ts.slice(0, 10);
          if (!candlesByDate[dateStr]) candlesByDate[dateStr] = [];
          candlesByDate[dateStr].push(h);
        }

        const dailyVols: number[] = [];
        for (const [dateStr, dayCandles] of Object.entries(candlesByDate)) {
          let sum = 0;
          for (const c of dayCandles) {
            if (timeKey(c.ts) <= lastTodayTime) {
              sum += c.v;
            }
          }
          if (sum > 0) dailyVols.push(sum);
        }

        if (dailyVols.length > 0) {
          const histAvg = dailyVols.reduce((s, v) => s + v, 0) / dailyVols.length;
          histAvgCache.set(sym, { lastTime: lastTodayTime, avg: histAvg });
        }
      } catch (e) {
        console.error(`Failed to calculate time-of-day RVOL baseline for ${sym}:`, e);
      } finally {
        timeOfDayRvolLoading.delete(sym);
      }
    })();
  }

  // Fallback: If we have a cached average (even if for an older time slot), return ratio using currentVolume.
  // This keeps the UI responsive instead of flashing loading state.
  if (cached && currentVolume !== undefined && currentVolume !== null) {
    return cached.avg > 0 ? currentVolume / cached.avg : 1.0;
  }

  return null;
}
