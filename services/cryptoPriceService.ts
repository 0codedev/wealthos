/**
 * CoinGecko crypto price service (2026-06-19).
 *
 * Talks to Python bridge: GET /api/crypto/price?ids=&vs=
 * Bridge handles 60s in-memory caching to stay under CoinGecko free-tier limits.
 */
import { safeAsync } from '../utils/safeAsync';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

export type VsCurrency = 'inr' | 'usd' | 'eur';

export interface CryptoPriceResponse {
  prices: Record<string, Record<string, number>>;
  cached: boolean;
  vs: string;
}

export async function getCryptoPrices(
  ids: string[],
  vs: VsCurrency = 'inr',
): Promise<CryptoPriceResponse> {
  if (ids.length === 0) return { prices: {}, cached: false, vs };
  const params = new URLSearchParams({
    ids: ids.join(','),
    vs,
  });
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/crypto/price?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as CryptoPriceResponse;
  }, { context: 'coingecko' });
  if (!r.ok) throw r.error;
  return r.data;
}

export interface CcxtPriceResponse {
  symbol: string;
  exchange: string;
  ask: number;
  bid: number;
  last: number;
  volume: number;
  change: number;
  percentage: number;
  source: string;
}

/**
 * Fetch crypto price from the Python bridge's CCXT endpoint.
 */
export async function getCcxtPrice(
  exchange: string,
  symbol: string,
): Promise<CcxtPriceResponse> {
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/crypto/price/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as CcxtPriceResponse;
  }, { context: 'ccxt' });
  if (!r.ok) throw r.error;
  return r.data;
}

