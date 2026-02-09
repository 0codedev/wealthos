export interface DataTrustState {
  source: 'dhan' | 'upstox' | 'yahoo' | 'nse' | 'cache' | 'fallback' | 'offline';
  freshness: 'live' | 'cached' | 'stale' | 'degraded';
  lastUpdated: number;
  diagnostic?: string;
}

export interface SourceResult<T> {
  data: T | null;
  source: 'upstox' | 'dhan' | 'yahoo' | 'nse' | 'sqlite' | 'parquet' | 'cache' | 'fallback' | 'offline';
  asOf: string | null;
  fetchedAt: string; // ISO string
  freshness: 'live' | 'fresh' | 'stale' | 'expired' | 'cached' | 'degraded';
  status: 'ok' | 'degraded' | 'unavailable' | 'demo_only';
  confidence: number;
  fallbackChain: string[];
  diagnostic?: string;
  lineage?: string[];
}

/**
 * Calculates the age of a SourceResult in seconds.
 */
export function getSourceResultAge(result: SourceResult<any>): number {
    const fetched = new Date(result.fetchedAt).getTime();
    if (Number.isNaN(fetched)) return 0;
    const now = Date.now();
    return Math.max(0, Math.floor((now - fetched) / 1000));
}


/**
 * Checks if the current time is within Indian stock market hours (Monday - Friday, 9:15 AM - 3:30 PM IST).
 */
export function isMarketHours(date: Date = new Date()): boolean {
  // Convert current time to Indian Standard Time (IST: UTC + 5:30)
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 60 * 60000;
  const istDate = new Date(utc + istOffset);

  const day = istDate.getDay(); // 0 = Sunday, 6 = Saturday
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const time = hours * 100 + minutes;

  const isWeekend = day === 0 || day === 6;
  const isTradingHours = time >= 915 && time <= 1530;

  return !isWeekend && isTradingHours;
}

/**
 * Checks if the current time is within active market operations hours (Monday - Friday, 9:00 AM - 3:45 PM IST).
 * Used to pause background sync/polling and WebSockets outside active hours to save resources.
 */
export function isAlphaActiveHours(date: Date = new Date()): boolean {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 60 * 60000;
  const istDate = new Date(utc + istOffset);

  const day = istDate.getDay(); // 0 = Sunday, 6 = Saturday
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const time = hours * 100 + minutes;

  const isWeekend = day === 0 || day === 6;
  const isActiveTime = time >= 900 && time <= 1545;

  return !isWeekend && isActiveTime;
}

