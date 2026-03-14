/**
 * OpenFIGI ISIN / CUSIP / TICKER resolver service (2026-06-19).
 *
 * Talks to Python bridge: GET /api/openfigi/search?q=&id_type=&exchange_code=
 * No new deps — wraps fetch + safeAsync.
 */
import { safeAsync } from '../utils/safeAsync';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

export type FigiIdType = 'ISIN' | 'CUSIP' | 'SEDOL' | 'TICKER';

export interface FigiHit {
  figi?: string;
  securityType?: string;
  marketSector?: string;
  ticker?: string;
  name?: string;
  exchCode?: string;
  shareClassFIGI?: string;
  uniqueID?: string;
}

export interface FigiSearchResponse {
  hits: FigiHit[];
  cached: boolean;
}

export interface FigiSearchOptions {
  q: string;
  idType?: FigiIdType;
  exchangeCode?: string;
}

export async function searchFigi(opts: FigiSearchOptions): Promise<FigiSearchResponse> {
  const params = new URLSearchParams({ q: opts.q });
  if (opts.idType) params.set('id_type', opts.idType);
  if (opts.exchangeCode) params.set('exchange_code', opts.exchangeCode);

  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/openfigi/search?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()) as FigiSearchResponse;
  }, { context: 'openfigi' });
  if (!r.ok) throw r.error;
  return r.data;
}
