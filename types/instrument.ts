export interface CanonicalInstrument {
  canonical_id: string; // e.g., NSE:SBIN, NSE:NIFTY_50
  asset_class: 'EQUITY' | 'DERIVATIVES' | 'INDEX';
  symbol: string;
  exchange: string;
  isin?: string;
  upstox_key?: string;
  dhan_security_id?: string;
  dhan_segment?: string;
  yahoo_ticker?: string;
  nse_symbol?: string;
  expiry?: string;
  strike?: number;
  option_type?: 'CE' | 'PE';
  aliases?: string[];
  supported_providers: string[];
}

/**
 * Resolves the Upstox instrument key for the canonical instrument.
 * Falls back to the canonical symbol if the specific key is missing.
 */
export function resolveUpstoxKey(inst: CanonicalInstrument): string {
  return inst.upstox_key || inst.symbol;
}

/**
 * Resolves the Dhan security ID/ID for the canonical instrument.
 * Falls back to empty string if missing.
 */
export function resolveDhanId(inst: CanonicalInstrument): string {
  return inst.dhan_security_id || '';
}
