/**
 * MF NAV refresh frontend service (CC53).
 *
 * Wraps the two bridge endpoints:
 *   GET  /api/mf/status?codes=...
 *   POST /api/mf/refresh   body: { codes: string[] }
 *   POST /api/mf/codes     body: { codes: string[] }  (A6 — keeps the bridge
 *                                                    scheduler's code list current)
 *
 * Constraints: no new deps, uses safeAsync (CC45), same shape as other
 * bridge services in services/*.
 */
import { safeAsync } from '../utils/safeAsync';
import { useSettingsStore } from '../store/settingsStore';

const BRIDGE_BASE = 'http://127.0.0.1:8765';

export interface MfHolding {
  scheme_code: string;
  nav: number;
  nav_date: string;
  last_fetched_at: number;
}

export interface MfStatus {
  last_refresh_at: number | null;
  next_refresh_after: number | null;
  is_refreshing: boolean;
  holdings: MfHolding[];
}

export interface MfRefreshSummary {
  refreshed: number;
  failed: Array<{ scheme_code: string; reason: string }>;
  skipped: number;
  started_at: number;
  duration_ms: number;
}

export async function getMfStatus(codes: string[]): Promise<MfStatus> {
  const params = new URLSearchParams();
  if (codes.length > 0) params.set('codes', codes.join(','));
  const url = `${BRIDGE_BASE}/api/mf/status?${params.toString()}`;
  const r = await safeAsync(async () => {
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<MfStatus>;
  });
  if (!r.ok) throw r.error;
  return r.data;
}

export async function refreshMfNavs(codes: string[]): Promise<MfRefreshSummary> {
  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/mf/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json() as Promise<MfRefreshSummary>;
  });
  if (!r.ok) throw r.error;
  return r.data;
}

/**
 * A6 — Post the user's current amfi code list to the bridge so the
 * background 24h scheduler knows what to refresh.
 *
 * Gated on the existing `enableMutualFunds` Settings toggle. When the
 * toggle is OFF, this is a no-op (returns immediately, no fetch fires).
 * When the toggle is ON, fires on every call (typically called on
 * Portfolio Hub mount + on codes change).
 *
 * Returns void on success. Throws on non-204 (the toggle OFF path is
 * silent and returns undefined — the spec calls for silent retry).
 */
export async function postMfCodes(codes: string[]): Promise<void> {
  // CC45 gate: the same pattern PortfolioTab / PortfolioNavRefresh use.
  // We read the latest value from the store (not a hook) because this
  // function is called from a non-React useEffect — no need to subscribe.
  let enableMutualFunds = false;
  try {
    enableMutualFunds = useSettingsStore.getState().enableMutualFunds;
  } catch {
    // Settings store not initialized (very early mount). Default to OFF.
    enableMutualFunds = false;
  }
  if (!enableMutualFunds) {
    return;
  }

  const r = await safeAsync(async () => {
    const resp = await fetch(`${BRIDGE_BASE}/api/mf/codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
    });
    if (resp.status !== 204) {
      throw new Error(`HTTP ${resp.status}`);
    }
  });
  if (!r.ok) throw r.error;
}
