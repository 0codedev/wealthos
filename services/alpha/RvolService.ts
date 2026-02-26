import { getHistoricalCandles } from '../IntradayCandleService';
import { logger } from '../Logger';

export type RvolTimeSlot = string; // format: "HH:MM" in IST

export interface RvolInterpretation {
  label: string;
  color: string; // Tailwind/CSS color class or hex
  strategyHint: string;
}

export const RVOL_THRESHOLDS = {
  ema_snapback: 1.5,
  morning_snapback: 1.5,
  upper_circuit: 5.0,
  upper_circuit_sub_a: 10.0,
  fno_orb_retest: 1.5,
};

// Cache for historical averages: symbol -> timeSlot -> average volume
interface BaselineCache {
  [symbol: string]: {
    [timeSlot: string]: number; // average volume
  };
}

// Memory cache as fallback/primary
const baselineMemoryCache: BaselineCache = {};

// Caching keys for sessionStorage
const BASELINE_CACHE_KEY = 'alpha_rvol_baselines_v1';
const RVOL_VALUE_CACHE_PREFIX = 'alpha_rvol_value:';

/**
 * Gets IST HH:MM from Date or ISO timestamp
 */
export function getISTTimeSlot(dateInput: Date | string | number): string {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour')?.value || '00';
    const minute = parts.find((p) => p.type === 'minute')?.value || '00';
    return `${hour}:${minute}`;
  } catch (err) {
    // Fallback if Intl formatter fails
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  }
}

/**
 * Load baselines from sessionStorage if available
 */
function loadBaselinesFromStorage(): BaselineCache {
  if (typeof window === 'undefined' || !window.sessionStorage) return {};
  try {
    const data = window.sessionStorage.getItem(BASELINE_CACHE_KEY);
    return data ? JSON.parse(data) : {};
  } catch (err) {
    logger.warn('RvolService: Failed to parse sessionStorage baselines', err);
    return {};
  }
}

/**
 * Save baselines to sessionStorage
 */
function saveBaselinesToStorage(cache: BaselineCache) {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(BASELINE_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    logger.warn('RvolService: Failed to save baselines to sessionStorage', err);
  }
}

/**
 * Fetch 20-day historical averages for each time slot.
 * Integrates Upstox candle query with Yahoo Finance fallback.
 */
export async function fetchHistoricalSlotVolumes(symbol: string): Promise<Record<string, number>> {
  const cleanSymbol = symbol.toUpperCase().trim();
  
  // 1. Check Memory Cache
  if (baselineMemoryCache[cleanSymbol]) {
    return baselineMemoryCache[cleanSymbol];
  }

  // 2. Check SessionStorage Cache
  const storageCache = loadBaselinesFromStorage();
  if (storageCache[cleanSymbol]) {
    baselineMemoryCache[cleanSymbol] = storageCache[cleanSymbol];
    return storageCache[cleanSymbol];
  }

  const averages: Record<string, number> = {};
  let success = false;

  // 3. Query Upstox historical candles (1-minute interval, 30 days lookback to guarantee 20 trading days)
  try {
    const endDateStr = new Date().toISOString().split('T')[0];
    const startDateStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    logger.info(`RvolService: Fetching Upstox historical candles for ${cleanSymbol}`);
    const candles = await getHistoricalCandles(cleanSymbol, '1minute', startDateStr, endDateStr);

    if (candles && candles.length > 0) {
      // Group volume by timeSlot
      const slotsData: Record<string, number[]> = {};
      candles.forEach((candle) => {
        if (!candle.ts || isNaN(candle.v)) return;
        const slot = getISTTimeSlot(candle.ts);
        if (!slotsData[slot]) slotsData[slot] = [];
        slotsData[slot].push(candle.v);
      });

      // Calculate SMA20 (or average of all available days) per slot
      Object.keys(slotsData).forEach((slot) => {
        const volumes = slotsData[slot];
        const sum = volumes.reduce((acc, v) => acc + v, 0);
        averages[slot] = sum / volumes.length;
      });

      success = Object.keys(averages).length > 0;
    }
  } catch (err) {
    logger.warn(`RvolService: Upstox historical fetch failed for ${cleanSymbol}, trying Yahoo fallback`, err);
  }

  // 4. Yahoo Finance Fallback
  if (!success) {
    try {
      logger.info(`RvolService: Falling back to Yahoo Finance for ${cleanSymbol}`);
      const yahooSymbol = cleanSymbol.endsWith('.NS') || cleanSymbol.startsWith('^') ? cleanSymbol : `${cleanSymbol}.NS`;
      const url = `/api/yahoo/v8/finance/chart/${yahooSymbol}?interval=1m&range=5d`;
      
      const response = await fetch(url);
      if (response.ok) {
        const json = await response.json();
        const result = json.chart?.result?.[0];
        
        if (result && result.timestamp && result.indicators?.quote?.[0]) {
          const timestamps: number[] = result.timestamp;
          const volumes: (number | null)[] = result.indicators.quote[0].volume || [];
          
          const slotsData: Record<string, number[]> = {};
          
          timestamps.forEach((ts, idx) => {
            const vol = volumes[idx];
            if (vol === null || isNaN(vol)) return;
            const slot = getISTTimeSlot(ts * 1000); // ts is in seconds
            if (!slotsData[slot]) slotsData[slot] = [];
            slotsData[slot].push(vol);
          });

          Object.keys(slotsData).forEach((slot) => {
            const vols = slotsData[slot];
            const sum = vols.reduce((acc, v) => acc + v, 0);
            averages[slot] = sum / vols.length;
          });

          success = Object.keys(averages).length > 0;
        }
      }
    } catch (err) {
      logger.error(`RvolService: Yahoo Finance fallback failed for ${cleanSymbol}`, err);
    }
  }

  if (success) {
    // Save to caches
    baselineMemoryCache[cleanSymbol] = averages;
    const updatedCache = { ...loadBaselinesFromStorage(), [cleanSymbol]: averages };
    saveBaselinesToStorage(updatedCache);
    return averages;
  }

  return {};
}

/**
 * Calculates current RVOL for a symbol given its current volume and timeSlot.
 * Implements 45-second sessionStorage caching for calculated RVOLs.
 */
export function calculateRvol(symbol: string, currentBarVolume: number, timeSlot: string): number {
  const cleanSymbol = symbol.toUpperCase().trim();
  const cacheKey = `${RVOL_VALUE_CACHE_PREFIX}${cleanSymbol}:${timeSlot}`;

  // 1. Check SessionStorage cache for computed RVOL (45s TTL)
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const cached = window.sessionStorage.getItem(cacheKey);
      if (cached) {
        const { value, expiresAt } = JSON.parse(cached);
        if (Date.now() < expiresAt) {
          return value;
        }
      }
    } catch (err) {
      // Non-fatal
    }
  }

  // 2. Fetch baseline averages
  const baselines = baselineMemoryCache[cleanSymbol] || loadBaselinesFromStorage()[cleanSymbol];
  if (!baselines || !baselines[timeSlot]) {
    // If not cached, trigger fetch in background so next request gets it
    fetchHistoricalSlotVolumes(cleanSymbol).catch(() => {});
    return 1.0; // Return neutral 1.0 on cache miss
  }

  const avgVol = baselines[timeSlot];
  if (avgVol <= 0) return 1.0;

  const rvolValue = currentBarVolume / avgVol;

  // 3. Cache computed RVOL value for 45 seconds
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const cacheData = {
        value: rvolValue,
        expiresAt: Date.now() + 45000,
      };
      window.sessionStorage.setItem(cacheKey, JSON.stringify(cacheData));
    } catch (err) {
      // Non-fatal
    }
  }

  return rvolValue;
}

/**
 * Interprets the RVOL value into labels, colors, and strategy triggers
 */
export function interpretRvol(rvol: number): RvolInterpretation {
  if (rvol < 0.8) {
    return {
      label: 'Dead',
      color: '#EF4444', // Red
      strategyHint: '❌ KILL (all strategies)',
    };
  }
  if (rvol <= 1.4) {
    return {
      label: 'Retail Only',
      color: '#9CA3AF', // Grey
      strategyHint: 'Skip — no institutional edge',
    };
  }
  if (rvol <= 1.9) {
    return {
      label: 'Elevated',
      color: '#F59E0B', // Yellow/Amber
      strategyHint: 'EMA Snapback scalp OK',
    };
  }
  if (rvol <= 2.9) {
    return {
      label: 'Smart Money',
      color: '#F97316', // Orange
      strategyHint: 'Good for all strategies',
    };
  }
  if (rvol <= 4.9) {
    return {
      label: 'Institutional',
      color: '#10B981', // Green
      strategyHint: 'Morning Snapback threshold',
    };
  }
  if (rvol <= 9.9) {
    return {
      label: 'High Conviction',
      color: '#059669', // Emerald
      strategyHint: 'Pre-UC threshold',
    };
  }
  return {
    label: 'Explosive / UC',
    color: '#06B6D4', // Cyan
    strategyHint: 'Sub-A UC threshold',
  };
}
