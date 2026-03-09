// services/mce/gexExtractor.ts
// Pure functions that compute GEX aggregates from the existing option chain.
// All inputs read-only. Returns null when chain is unavailable.
// Spec: docs/superpowers/specs/2026-06-17-gex-lens-design.md §2, §3

import { optionChainService } from '../OptionChainService';
import { logger } from '../Logger';
import { GexFeatureVector, GexStrikeData } from './types';

const STRIKE_WINDOW = 10;
const GAMMA_DOLLAR_FACTOR = 0.01;
const CRORE = 1e7;

// CC68.27: Lot-size cache. The ShadowScreenerService fetches the F&O lot
// size table once per session; we cache it here in module scope so the GEX
// path doesn't re-read it on every per-stock call. Map is keyed by uppercase
// symbol. Populated via `setLotSizeMap()` (called by the Alpha Engine hub on
// warm) or auto-populated on first use if a map is passed inline.
let _lotSizeMap: Map<string, number> = new Map();

/**
 * CC68.27: Install the lot-size map for the current session. Called by
 * `useAlphaEngineState.warmAllAlphaCaches()` after the F&O Lot Sizes card
 * finishes its fetch. Subsequent `extractGexFeatures()` calls use the
 * real lot size for any F&O stock, instead of the hard-coded fallback of 50.
 */
export function setLotSizeMap(map: Map<string, number> | Record<string, number> | null | undefined): void {
  if (!map) {
    _lotSizeMap = new Map();
    return;
  }
  // Duck-type check: cross-realm Maps (e.g. created inside vitest with jsdom)
  // fail `instanceof Map` even though they're functionally identical. Detect
  // by presence of the Map API instead of the prototype chain.
  const isMapLike =
    typeof (map as Map<string, number>).get === 'function' &&
    typeof (map as Map<string, number>).set === 'function' &&
    typeof (map as Map<string, number>).entries === 'function';
  if (isMapLike) {
    const next = new Map<string, number>();
    for (const [k, v] of (map as Map<string, number>).entries()) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        next.set(String(k).toUpperCase(), v);
      }
    }
    _lotSizeMap = next;
  } else {
    _lotSizeMap = new Map();
    for (const [k, v] of Object.entries(map as Record<string, number>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        _lotSizeMap.set(k.toUpperCase(), v);
      }
    }
  }
}

export function getLotSizeMap(): Map<string, number> {
  return _lotSizeMap;
}

function findAtmStrike(spot: number, strikes: number[]): number | null {
  if (strikes.length === 0) return null;
  let best = strikes[0];
  let bestDist = Math.abs(spot - best);
  for (const s of strikes) {
    const d = Math.abs(spot - s);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

function stepFromStrikes(strikes: number[]): number {
  if (strikes.length < 2) return 50;
  const sorted = [...strikes].sort((a, b) => a - b);
  let minStep = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 0 && d < minStep) minStep = d;
  }
  return minStep === Infinity ? 50 : minStep;
}

function perStrikeGex(
  strike: number,
  ce: { oi: number; gamma?: number; iv?: number } | null,
  pe: { oi: number; gamma?: number; iv?: number } | null,
  lotSize: number,
  spot: number,
): GexStrikeData {
  const callOi = ce?.oi ?? 0;
  const putOi  = pe?.oi ?? 0;
  const callGamma = Number.isFinite(ce?.gamma) ? (ce?.gamma as number) : 0;
  const putGamma  = Number.isFinite(pe?.gamma) ? (pe?.gamma as number) : 0;

  // Textbook dealer convention
  const callDealerGamma = -callOi * callGamma;
  const putDealerGamma  =  putOi * putGamma;
  const strikeGexRaw    = callDealerGamma + putDealerGamma;

  const strikeGexRs     = strikeGexRaw * lotSize * spot * spot * GAMMA_DOLLAR_FACTOR;
  const strikeGexCrores = strikeGexRs / CRORE;

  return {
    strike,
    callOi,
    putOi,
    callGamma,
    putGamma,
    strikeGexCrores: Number.isFinite(strikeGexCrores) ? strikeGexCrores : 0,
  };
}

function computeAggregates(window: GexStrikeData[], spot: number): {
  netGexCrores: number;
  magnetStrike: number | null;
  magnetGexCrores: number | null;
  distanceToMagnetPct: number | null;
  dataQuality: 'THIN' | 'NORMAL' | 'DEEP';
} {
  if (window.length === 0) {
    return { netGexCrores: 0, magnetStrike: null, magnetGexCrores: null, distanceToMagnetPct: null, dataQuality: 'THIN' };
  }
  const withOi = window.filter(w => w.callOi + w.putOi > 0);
  const netGexCrores = withOi.reduce((s, w) => s + w.strikeGexCrores, 0);

  let magnetStrike: number | null = null;
  let magnetAbs = -1;
  for (const w of withOi) {
    const a = Math.abs(w.strikeGexCrores);
    if (a > magnetAbs) { magnetAbs = a; magnetStrike = w.strike; }
  }
  const magnetRow = magnetStrike == null ? undefined : withOi.find(w => w.strike === magnetStrike);
  const magnetGexCrores = magnetRow ? magnetRow.strikeGexCrores : null;
  const distanceToMagnetPct = magnetStrike == null || spot === 0
    ? null
    : Math.abs(spot - magnetStrike) / spot * 100;

  const dataQuality: 'THIN' | 'NORMAL' | 'DEEP' =
    withOi.length < 4  ? 'THIN'  :
    withOi.length <= 15 ? 'NORMAL' :
    'DEEP';

  return { netGexCrores, magnetStrike, magnetGexCrores, distanceToMagnetPct, dataQuality };
}

/**
 * CC68.27: Resolves the lot size for a given symbol.
 *
 * Resolution order (most specific first):
 *  1. Exact match in the session lot-size map (populated by
 *     `setLotSizeMap()` from `ShadowScreenerService.fetchLotSizes()`).
 *  2. Index-name heuristic (NIFTY → 25, BANKNIFTY → 15, …).
 *  3. Fallback to 50 (the legacy hard-coded default).
 *
 * The optional `lotSizeMap` parameter is provided for unit tests and for
 * one-shot callers that don't want to install the map globally. When
 * supplied, it is consulted *before* the module-scope cache.
 */
function defaultLotSize(symbol: string, lotSizeMap?: Map<string, number> | Record<string, number> | null): number {
  const upper = symbol.toUpperCase();

  // 1. Caller-supplied map (unit tests + one-shots)
  if (lotSizeMap) {
    // Same duck-type detection as setLotSizeMap (cross-realm Maps).
    const isMapLike =
      typeof (lotSizeMap as Map<string, number>).get === 'function' &&
      typeof (lotSizeMap as Map<string, number>).has === 'function';
    if (isMapLike) {
      const v = (lotSizeMap as Map<string, number>).get(upper);
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    } else if (typeof lotSizeMap === 'object') {
      const v = (lotSizeMap as Record<string, number>)[upper];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    }
  }

  // 2. Module-scope cache (populated by warmAllAlphaCaches)
  const cached = _lotSizeMap.get(upper);
  if (typeof cached === 'number' && Number.isFinite(cached) && cached > 0) return cached;

  // 3. Index-name heuristic
  if (upper.includes('BANKNIFTY')) return 15;
  if (upper.includes('MIDCPNIFTY')) return 75;
  if (upper.includes('FINNIFTY')) return 40;
  if (upper.includes('NIFTY')) return 25;
  if (upper.includes('SENSEX')) return 10;

  // 4. Legacy fallback — for any F&O stock we don't have a real lot size for
  return 50;
}

export async function extractGexFeatures(
  symbol: string,
  now: number,
  options?: { lotSizeMap?: Map<string, number> | Record<string, number> | null }
): Promise<GexFeatureVector | null> {
  let snapshot: any = null;
  try {
    snapshot = await optionChainService.fetchOptionChain(symbol);
  } catch (err) {
    logger.debug('[MCE][GEX] fetchOptionChain failed', { symbol, err });
    return null;
  }
  if (!snapshot || !snapshot.strikes || snapshot.strikes.length === 0) return null;

  const spot = Number(snapshot.underlyingValue) || 0;
  if (spot <= 0) return null;

  const allStrikes: number[] = snapshot.strikes.map((s: any) => s.strikePrice);
  const step = stepFromStrikes(allStrikes);
  const atm = findAtmStrike(spot, allStrikes);
  if (atm == null) return null;

  const upperBound = atm + STRIKE_WINDOW * step;
  const lowerBound = atm - STRIKE_WINDOW * step;
  const windowStrikes = snapshot.strikes
    .filter((s: any) => s.strikePrice >= lowerBound && s.strikePrice <= upperBound);

  const lotSize = defaultLotSize(symbol, options?.lotSizeMap);
  const window: GexStrikeData[] = windowStrikes.map((s: any) =>
    perStrikeGex(s.strikePrice, s.CE, s.PE, lotSize, spot)
  );

  const aggregates = computeAggregates(window, spot);

  let ivSkewAtm: number | null = null;
  const atmRow = windowStrikes.find((s: any) => s.strikePrice === atm);
  if (atmRow) {
    const ceIv = Number((atmRow.CE as any)?.iv);
    const peIv = Number((atmRow.PE as any)?.iv);
    if (Number.isFinite(ceIv) && Number.isFinite(peIv)) {
      ivSkewAtm = peIv - ceIv;
    }
  }

  return {
    symbol,
    asOf: now,
    expiry: snapshot.timestamp ?? null,
    spot,
    lotSize,
    window,
    netGexCrores: aggregates.netGexCrores,
    magnetStrike: aggregates.magnetStrike,
    magnetGexCrores: aggregates.magnetGexCrores,
    ivSkewAtm,
    distanceToMagnetPct: aggregates.distanceToMagnetPct,
    dataQuality: aggregates.dataQuality,
  };
}