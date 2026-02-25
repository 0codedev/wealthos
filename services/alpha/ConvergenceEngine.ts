export interface SignalBreakdown {
  momentumScore: number;
  pulseCategory: string | null;
  sectorName: string | null;
  sectorChange: number;
  dailyCandlePattern: string | null;
  weeklyCandlePattern: string | null;
  orbMinutes: number | null;
  valuationUpside: number | null;
  qualityRating: string | null;
}

export interface ScoredStock {
  symbol: string;
  companyName: string;
  ltp: number;
  change: number;
  sector: string;
  convictionScore: number;
  signalCount: number;
  tier: 'PERFECT' | 'CONFIRMED' | 'DEVELOPING' | 'SPECULATIVE' | 'NONE';
  direction: 'bullish' | 'bearish';
  signals: {
    momentum: boolean;
    pulse: boolean;
    sectorStrength: boolean;
    dailyCandle: boolean;
    weeklyCandle: boolean;
    orb: boolean;
    valuation: boolean;
    quality: boolean;
  };
  signalDetails: SignalBreakdown;
}

export interface RawSignalData {
  Symbol: string;
  Change?: number;
  Open?: number;
  Low?: number;
  High?: number;
  CompanyName?: string;
  LTP?: number;
  Sector?: string;
  "Strength Factor"?: number;
  [key: string]: any;
}

interface SectorData {
  sectorName: string;
  sectorScore: number;
  sectorChange: number;
}

interface ValuationData {
  type: string;
  data: any;
}

interface SignalRecord {
  symbol: string;
  // Master
  masterData?: RawSignalData;
  // Pulse
  pulseCategory?: string;
  // Sector
  sectorData?: SectorData;
  // Candles
  dailyPattern?: string;
  dailyPatternSentiment?: 'Bullish' | 'Bearish';
  weeklyPattern?: string;
  weeklyPatternSentiment?: 'Bullish' | 'Bearish';
  // ORB
  orbData?: any;
  orbMinutes?: number;
  // Valuation
  valuationData?: ValuationData;
  // Quality
  qualityData?: any;
}

export class ConvergenceEngine {
  private static CACHES = {
    MASTER: 'alpha_cache_master',
    CATEGORIZED: 'alpha_cache_pulse_categorized',
    SECTOR_BOOSTER: 'sz_sector_booster',
    CANDLE_DAILY: 'alpha_cache_candle_daily',
    CANDLE_WEEKLY: 'alpha_cache_candle_weekly',
    HISTORICAL: 'alpha_cache_historical',
    ORB: 'alpha_cache_orb',
    VALUATION: 'alpha_cache_valuation',
    QUALITY: 'alpha_cache_quality_total_score_high',
  };

  public static getMinimumModulesLoaded(): number {
    let count = 0;
    Object.values(this.CACHES).forEach((key) => {
      const data = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
      if (data && data !== '[]' && data !== '{}') count++;
    });
    return count;
  }

  private static safeParse<T>(key: string, defaultVal: T | null = null): T | null {
    try {
      if (typeof sessionStorage === 'undefined') return defaultVal;
      const val = sessionStorage.getItem(key);
      return val ? JSON.parse(val) as T : defaultVal;
    } catch {
      return defaultVal;
    }
  }

  public static loadAllCaches() {
    return {
      master: this.safeParse(this.CACHES.MASTER, []),
      pulseCategorized: this.safeParse(this.CACHES.CATEGORIZED, {}),
      sectorBooster: this.safeParse(this.CACHES.SECTOR_BOOSTER, []),
      candleDaily: this.safeParse(this.CACHES.CANDLE_DAILY, {}),
      candleWeekly: this.safeParse(this.CACHES.CANDLE_WEEKLY, {}),
      historical: this.safeParse(this.CACHES.HISTORICAL, {}), // Using if needed
      orb: this.safeParse(this.CACHES.ORB, {}),
      valuation: this.safeParse(this.CACHES.VALUATION, {}),
      quality: this.safeParse(this.CACHES.QUALITY, []),
    };
  }

  private static buildSymbolMap(caches: any): Map<string, SignalRecord> {
    const map = new Map<string, SignalRecord>();

    const getOrCreate = (sym: string): SignalRecord => {
      const formatted = sym.toUpperCase();
      if (!map.has(formatted)) {
        map.set(formatted, { symbol: formatted });
      }
      return map.get(formatted)!;
    };

    // 1. Master List
    (caches.master as RawSignalData[] || []).forEach((s) => {
      const rec = getOrCreate(s.Symbol);
      rec.masterData = s;
    });

    // 2. Pulse Categorized
    Object.entries(caches.pulseCategorized || {}).forEach(([category, list]) => {
      (list as any[]).forEach((s: any) => {
        const rec = getOrCreate(s.Symbol);
        // Map gap_up, top_gainers, open_low -> bullish
        rec.pulseCategory = category;
        if (!rec.masterData) rec.masterData = { Symbol: s.Symbol, ...s };
      });
    });

    // 3. Sector Booster
    (caches.sectorBooster || []).forEach((sector: any) => {
      (sector.stock_list || []).forEach((s: any) => {
        const rec = getOrCreate(s.symbol_name);
        rec.sectorData = {
          sectorName: sector.sector,
          sectorScore: sector.current_score || 0,
          sectorChange: parseFloat(sector.change_per) || 0,
        };
      });
    });

    // 4. Candle Daily
    Object.entries(caches.candleDaily || {}).forEach(([pattern, list]) => {
      if (pattern === 'available_pattens') return;
      (list as any[]).forEach((s: any) => {
        const rec = getOrCreate(s.symbol_name);
        rec.dailyPattern = pattern;
        rec.dailyPatternSentiment = s.pattern_sentiment;
        if (!rec.masterData) rec.masterData = { Symbol: s.symbol_name, LTP: s.last_trade_price, Change: s.change_percent };
      });
    });

    // 5. Candle Weekly
    Object.entries(caches.candleWeekly || {}).forEach(([pattern, list]) => {
      if (pattern === 'available_pattens') return;
      (list as any[]).forEach((s: any) => {
        const rec = getOrCreate(s.symbol_name);
        rec.weeklyPattern = pattern;
        rec.weeklyPatternSentiment = s.pattern_sentiment;
        if (!rec.masterData) rec.masterData = { Symbol: s.symbol_name, LTP: s.last_trade_price, Change: s.change_percent };
      });
    });

    // 6. ORB
    Object.entries(caches.orb || {}).forEach(([key, list]) => {
      const parts = key.split('_');
      const minutesPart = parts[0];
      const minutes = minutesPart ? parseInt(minutesPart) : 0;
      (list as any[]).forEach((s: any) => {
        const rec = getOrCreate(s.symbol_name);
        rec.orbData = s;
        rec.orbMinutes = minutes;
        if (!rec.masterData) rec.masterData = { Symbol: s.symbol_name, LTP: s.last_trade_price, Change: s.change_percent };
      });
    });

    // 7. Valuation
    Object.entries(caches.valuation || {}).forEach(([key, list]) => {
      (list as any[]).forEach((s: any) => {
        const rec = getOrCreate(s.symbol_name);
        rec.valuationData = {
          type: key, // 'under_valued' or 'over_valued'
          data: s
        };
        if (!rec.masterData) rec.masterData = { Symbol: s.symbol_name, LTP: s.last_trade_price, Change: 0 };
      });
    });

    // 8. Quality
    (caches.quality || []).forEach((s: any) => {
      const rec = getOrCreate(s.symbol_name);
      rec.qualityData = s;
      if (!rec.masterData) rec.masterData = { Symbol: s.symbol_name, LTP: s.cmp, Change: 0 };
    });

    return map;
  }

  public static runConvergenceScan(direction: 'bullish' | 'bearish' | 'both', mode: 'intraday' | 'swing', caches?: any): ScoredStock[] {
    const finalCaches = caches || this.loadAllCaches();
    const map = this.buildSymbolMap(finalCaches);

    const results: ScoredStock[] = [];

    map.forEach((rec, symbol) => {
      const master: RawSignalData = rec.masterData || { Symbol: symbol };
      
      let bullishScore = 0;
      let bearishScore = 0;
      
      let signalsBullish = { momentum: false, pulse: false, sectorStrength: false, dailyCandle: false, weeklyCandle: false, orb: false, valuation: false, quality: false };
      let signalsBearish = { momentum: false, pulse: false, sectorStrength: false, dailyCandle: false, weeklyCandle: false, orb: false, valuation: false, quality: false };

      const details: SignalBreakdown = {
        momentumScore: master["Strength Factor"] || 0,
        pulseCategory: rec.pulseCategory || null,
        sectorName: rec.sectorData?.sectorName || null,
        sectorChange: rec.sectorData?.sectorChange || 0,
        dailyCandlePattern: rec.dailyPattern || null,
        weeklyCandlePattern: rec.weeklyPattern || null,
        orbMinutes: rec.orbMinutes || null,
        valuationUpside: rec.valuationData ? (((rec.valuationData.data.intrinsic_value - rec.valuationData.data.last_trade_price) / rec.valuationData.data.last_trade_price) * 100) : null,
        qualityRating: rec.qualityData?.rating || null
      };

      // 1. Momentum
      const change = master.Change || 0;
      const open = master.Open || 0;
      const low = master.Low || 0;
      const high = master.High || 0;
      const isOpenLow = open > 0 && open === low;
      const isOpenHigh = open > 0 && open === high;

      if (change > 2 || isOpenLow) {
        bullishScore += 100;
        signalsBullish.momentum = true;
      }
      if (change < -2 || isOpenHigh) {
        bearishScore += 100;
        signalsBearish.momentum = true;
      }

      // 2. Pulse
      if (rec.pulseCategory) {
        if (['top_gainers', 'gap_up', 'open_low'].includes(rec.pulseCategory)) {
          bullishScore += 100;
          signalsBullish.pulse = true;
        } else if (['top_losers', 'gap_down', 'open_high'].includes(rec.pulseCategory)) {
          bearishScore += 100;
          signalsBearish.pulse = true;
        }
      }

      // 3. Sector Strength
      if (rec.sectorData) {
        if (rec.sectorData.sectorChange > 0) {
          bullishScore += 100;
          signalsBullish.sectorStrength = true;
        } else if (rec.sectorData.sectorChange < 0) {
          bearishScore += 100;
          signalsBearish.sectorStrength = true;
        }
      }

      // 4. Daily Candle
      if (rec.dailyPatternSentiment === 'Bullish') {
        bullishScore += 100;
        signalsBullish.dailyCandle = true;
      } else if (rec.dailyPatternSentiment === 'Bearish') {
        bearishScore += 100;
        signalsBearish.dailyCandle = true;
      }

      // 5. Weekly Candle
      if (rec.weeklyPatternSentiment === 'Bullish') {
        bullishScore += 100;
        signalsBullish.weeklyCandle = true;
      } else if (rec.weeklyPatternSentiment === 'Bearish') {
        bearishScore += 100;
        signalsBearish.weeklyCandle = true;
      }

      // 6. ORB
      if (rec.orbData) {
        if (rec.orbData.breakout === 'Bullish') {
          bullishScore += 100;
          signalsBullish.orb = true;
        } else if (rec.orbData.breakout === 'Bearish') {
          bearishScore += 100;
          signalsBearish.orb = true;
        }
      }

      // 7. Valuation
      const valWeight = mode === 'intraday' ? 50 : 100;
      if (rec.valuationData) {
        const roce = parseFloat(rec.valuationData.data.roce_per) || 0;
        if (rec.valuationData.type === 'under_valued' && roce > 15) {
          bullishScore += valWeight;
          signalsBullish.valuation = true;
        } else if (rec.valuationData.type === 'over_valued') {
          bearishScore += valWeight;
          signalsBearish.valuation = true;
        }
      }

      // 8. Quality
      if (rec.qualityData) {
        const rating = rec.qualityData.rating?.toUpperCase();
        if (rating === 'STRONG BUY') {
          bullishScore += 100;
          signalsBullish.quality = true;
        } else if (rating === 'BUY') {
          bullishScore += 50;
          signalsBullish.quality = true;
        } else if (rating === 'SELL' || rating === 'STRONG SELL') {
          bearishScore += 100;
          signalsBearish.quality = true;
        }
      }

      const dominantDirection = bullishScore >= bearishScore ? 'bullish' : 'bearish';
      const score = Math.max(bullishScore, bearishScore);
      const activeSignals = dominantDirection === 'bullish' ? signalsBullish : signalsBearish;
      
      const signalCount = Object.values(activeSignals).filter(Boolean).length;

      let tier: ScoredStock['tier'] = 'NONE';
      if (signalCount === 8) tier = 'PERFECT';
      else if (signalCount >= 6) tier = 'CONFIRMED';
      else if (signalCount >= 4) tier = 'DEVELOPING';
      else if (signalCount >= 1) tier = 'SPECULATIVE';

      if (score > 0) {
        results.push({
          symbol,
          companyName: master.CompanyName || '',
          ltp: master.LTP || 0,
          change: master.Change || 0,
          sector: rec.sectorData?.sectorName || master.Sector || 'N/A',
          convictionScore: score,
          signalCount,
          tier,
          direction: dominantDirection,
          signals: activeSignals,
          signalDetails: details
        });
      }
    });

    let filtered = results;
    if (direction !== 'both') {
      filtered = results.filter(r => r.direction === direction);
    }

    return filtered.sort((a, b) => b.convictionScore - a.convictionScore || b.change - a.change);
  }

  public static getWhyThisTrade(stock: ScoredStock): string[] {
    const reasons: string[] = [];
    const d = stock.signalDetails;

    if (stock.signals.momentum) {
      reasons.push(`Momentum: High structural momentum with a ${stock.change.toFixed(2)}% move.`);
    }
    if (stock.signals.pulse) {
      const category = (d.pulseCategory || '').replace('_', ' ').toUpperCase();
      reasons.push(`Pulse Feed: Confirmed in ${category} momentum category.`);
    }
    if (stock.signals.sectorStrength && d.sectorName) {
      reasons.push(`Sector Tailwind: Supported by ${d.sectorName} which is trending (${d.sectorChange.toFixed(2)}%).`);
    }
    if (stock.signals.dailyCandle && d.dailyCandlePattern) {
      reasons.push(`Technical (Daily): Formed a ${d.dailyCandlePattern} pattern.`);
    }
    if (stock.signals.weeklyCandle && d.weeklyCandlePattern) {
      reasons.push(`Technical (Weekly): Macro confirmation via ${d.weeklyCandlePattern} pattern.`);
    }
    if (stock.signals.orb && d.orbMinutes) {
      reasons.push(`Breakout: Successfully breached the ${d.orbMinutes}-minute Opening Range.`);
    }
    if (stock.signals.valuation && d.valuationUpside !== null) {
      if (stock.direction === 'bullish') {
        reasons.push(`Fundamentals: Undervalued with ~${d.valuationUpside.toFixed(1)}% intrinsic upside and ROCE > 15%.`);
      } else {
        reasons.push(`Fundamentals: Quantifiably overvalued according to intrinsic calculations.`);
      }
    }

    if (stock.signals.quality && d.qualityRating) {
      reasons.push(`AI Diagnostic: Institutional Rating is ${d.qualityRating}.`);
    }

    return reasons;
  }
}
