import { logger } from '../Logger';
import { alphaEngineService, StockData } from '../AlphaEngineService';
import { upstoxMarketDataService } from '../UpstoxMarketDataService';
import { optionChainService } from '../OptionChainService';
import { ShadowScreenerService, DerivativeSummaryItem } from './ShadowScreenerService';
import { useSettingsStore } from '../../store/settingsStore';
import { upstoxCacheService } from '../UpstoxCacheService';
import { useCapabilityStore } from '../../store/capabilityStore';
import { ProvenanceGuard } from './provenance_guard';
import { FundamentalVerdictEngine } from './FundamentalVerdictEngine';

export interface MarketRegime {
  label: 'TRENDING UP' | 'TRENDING DOWN' | 'RANGE-BOUND' | 'DISTRIBUTION' | 'ACCUMULATION';
  description: string;
  color: string; // Tailwind class
  recommendations: string[];
  vix: number;
  pcr: number;
  fiiNetFlow: number;
  adr: number;
  sectorBreadth: number;
  longBuildupCount: number;
  shortBuildupCount: number;
  isMarketClosed: boolean;
  asOf: string;
}

export interface SmartMoneySignal {
  score: number; // -100 to +100
  trend: 'STRONG BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG BEARISH';
  color: string;
}

export interface StockConviction {
  symbol: string;
  convictionScore: number; // 0-100
  gFactor: number;
  oiQuadrant: 'LONG BUILDUP' | 'SHORT BUILDUP' | 'SHORT COVERING' | 'LONG UNWINDING' | 'NEUTRAL';
  fundamentalScore: number;
  ownershipScore: number;
  ivRank: number;
  newsSentimentModifier: number;
  hasActiveNews: boolean;
}

export interface NewsSentimentItem {
  id: string;
  title: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  score: number; // -1 to +1
}

class SignalFusionService {
  private static instance: SignalFusionService;
  private newsCache: Record<string, NewsSentimentItem[]> = {};
  private cachedRegime: MarketRegime | null = null;
  private cachedCompass: SmartMoneySignal | null = null;

  // Add promise caches
  private derivativeSummaryPromise: Promise<DerivativeSummaryItem[]> | null = null;
  private optionChainPromises: Record<string, Promise<any>> = {};
  private fundamentalsPromises: Record<string, Promise<any>> = {};
  private newsPromises: Record<string, Promise<NewsSentimentItem[]>> = {};

  private constructor() {}

  static getInstance(): SignalFusionService {
    if (!SignalFusionService.instance) {
      SignalFusionService.instance = new SignalFusionService();
    }
    return SignalFusionService.instance;
  }

  clearCache() {
    this.newsCache = {};
    this.cachedRegime = null;
    this.cachedCompass = null;
    this.derivativeSummaryPromise = null;
    this.optionChainPromises = {};
    this.fundamentalsPromises = {};
    this.newsPromises = {};
  }

  async getDerivativeSummaryCached(): Promise<DerivativeSummaryItem[]> {
    if (!this.derivativeSummaryPromise) {
      this.derivativeSummaryPromise = ShadowScreenerService.fetchDerivativeSummary('').catch((err) => {
        this.derivativeSummaryPromise = null; // Clear on error so next call can retry
        throw err;
      });
    }
    return this.derivativeSummaryPromise;
  }

  async getOptionChainCached(symbol: string): Promise<any> {
    const sym = symbol.toUpperCase().trim();
    if (!this.optionChainPromises[sym]) {
      this.optionChainPromises[sym] = optionChainService.fetchOptionChain(sym).catch((err) => {
        delete this.optionChainPromises[sym];
        throw err;
      });
    }
    return this.optionChainPromises[sym];
  }

  async getFundamentalsCached(isin: string, aspect: string): Promise<any> {
    const key = `${isin}_${aspect}`;
    if (!this.fundamentalsPromises[key]) {
      this.fundamentalsPromises[key] = upstoxMarketDataService.getCompanyFundamentals(isin, aspect as any).catch((err) => {
        delete this.fundamentalsPromises[key];
        throw err;
      });
    }
    return this.fundamentalsPromises[key];
  }

  /**
   * Evaluates the current market regime based on multi-source data points.
   */
  async getMarketRegime(bypassCache = false): Promise<MarketRegime> {
    if (!bypassCache && this.cachedRegime) {
      return this.cachedRegime;
    }
    try {
      // 1. Check market hours status
      const statusRes = await upstoxMarketDataService.getMarketStatus().catch(() => null);
      const isValidMarketStatus = statusRes && 
        typeof statusRes.status === 'string' && 
        statusRes.status !== 'error' && 
        statusRes.status !== 'success' && 
        ['open', 'closed', 'pre-open', 'post-close'].includes(statusRes.status.toLowerCase());
      const isMarketClosed = isValidMarketStatus 
        ? statusRes.status.toLowerCase() !== 'open' 
        : !this.checkIsLiveTradingHours();

      // 2. Fetch VIX and Nifty PCR
      const vixQuote = await upstoxMarketDataService.getFullQuotes(['INDIA VIX']).catch(() => null);
      const vix = vixQuote && vixQuote['INDIA VIX'] ? vixQuote['INDIA VIX'].last_price : 14.5;

      const pcrRes = await upstoxMarketDataService.getPCR('NIFTY').catch(() => null);
      const pcr = pcrRes && typeof pcrRes.pcr === 'number' ? pcrRes.pcr : 0.95;

      // 3. FII Cash flow net values
      const fiiHistory = await upstoxMarketDataService.getFiiHistory('CM').catch(() => []);
      const fiiNetFlow = fiiHistory.length > 0 ? (fiiHistory[0].net_amount ?? fiiHistory[0].net_value ?? 0) : 0;

      // 4. Advance-Decline Ratio (ADR)
      const stocks = alphaEngineService.getCachedStocks();
      const advances = stocks.filter(s => s.percentChange > 0).length;
      const declines = stocks.filter(s => s.percentChange < 0).length;
      const adr = declines > 0 ? Number((advances / declines).toFixed(2)) : advances;

      // 5. Sector Breadth Score
      const sectors = alphaEngineService.getCachedSectors();
      const sectorsUp = sectors.filter(s => s.percentChange > 0).length;
      const sectorBreadth = sectors.length > 0 ? Number(((sectorsUp / sectors.length) * 100).toFixed(1)) : 50.0;

      // 6. OI Buildup Breadth (count long vs short buildups)
      let longBuildupCount = 0;
      let shortBuildupCount = 0;

      try {
        const derivativeSummary = await this.getDerivativeSummaryCached().catch(() => []);
        derivativeSummary.forEach(item => {
          if (item.built_up === 'long_build_up') longBuildupCount++;
          else if (item.built_up === 'short_build_up') shortBuildupCount++;
        });
      } catch (err) {
        // Fallback estimations based on stock signals
        longBuildupCount = stocks.filter(s => s.percentChange > 0.5).length;
        shortBuildupCount = stocks.filter(s => s.percentChange < -0.5).length;
      }

      // Regime Classification Algorithm
      let label: MarketRegime['label'] = 'RANGE-BOUND';
      let description = 'Market is consolidating within key support and resistance bands. Momentum indicators suggest neutral/flat rotation.';
      let color = 'text-sky-400';
      let recommendations = [
        'Prefer non-directional option writing (Iron Condors, Short Straddles).',
        'Avoid buying OTM options; time decay (theta) is unfavorable.',
        'Focus on stock-specific alpha plays with strong G-Factor scores.'
      ];

      // Trending Up conditions
      if (pcr > 1.2 && fiiNetFlow > 500 && vix < 17 && adr > 1.5 && sectorBreadth > 70) {
        label = 'TRENDING UP';
        description = 'Strong institutional accumulation and bullish breadth are driving a steady market rally. Volatility remains calm.';
        color = 'text-emerald-400';
        recommendations = [
          'Prefer buying ATM calls or selling puts on index pullbacks.',
          'Hold long momentum equity stocks with G-Factor > 7.0.',
          'Avoid aggressive short positions; trend continuation is highly probable.'
        ];
      }
      // Trending Down conditions
      else if (pcr < 0.8 && fiiNetFlow < -1000 && vix > 18 && adr < 0.6 && sectorBreadth < 30) {
        label = 'TRENDING DOWN';
        description = 'Sustained institutional distribution and expanding panic selling. Volatility is rising quickly.';
        color = 'text-rose-400';
        recommendations = [
          'Hedge equity portfolios using index put options or short futures.',
          'Focus on defensive sectors (Pharma, FMCG) if entering fresh longs.',
          'Avoid buying speculative midcaps; conserve cash for support reversals.'
        ];
      }
      // Distribution phase (High volatility, heavy FII selling, mixed breadth near highs)
      else if (vix > 16 && fiiNetFlow < -500 && pcr < 0.95 && adr < 0.9) {
        label = 'DISTRIBUTION';
        description = 'Smart money is quietly exiting positions near highs while retail participation keeps prices elevated. Volatility rising.';
        color = 'text-amber-500';
        recommendations = [
          'Trim profits in high-beta equity holdings showing fatigue.',
          'Deploy protective puts or Bear Call Spreads on index resistance.',
          'Avoid chasing fresh breakout setups.'
        ];
      }
      // Accumulation phase (Low volatility, positive FII flows, stabilizing PCR near lows)
      else if (vix < 15 && fiiNetFlow > 200 && pcr > 1.0 && adr > 1.1) {
        label = 'ACCUMULATION';
        description = 'Institutions are systematically buying at key support levels, forming a strong macro market floor.';
        color = 'text-indigo-400';
        recommendations = [
          'Gradually build long investments in quality stocks displaying strong PE/fundamentals.',
          'Deploy Bull Put Spreads or Covered Calls to lock in premium gains.',
          'Accumulate top driver sectors (Banking, IT) as they base out.'
        ];
      }

      const result: MarketRegime = {
        label,
        description,
        color,
        recommendations,
        vix,
        pcr,
        fiiNetFlow,
        adr,
        sectorBreadth,
        longBuildupCount,
        shortBuildupCount,
        isMarketClosed,
        asOf: new Date().toLocaleTimeString()
      };
      this.cachedRegime = result;
      return result;
    } catch (error) {
      logger.error('SignalFusionService: Error calculating market regime:', error);
      const isClosed = !this.checkIsLiveTradingHours();
      return {
        label: 'RANGE-BOUND',
        description: 'Failed to fetch complete indicators. Defaulting to safe range-bound mode.',
        color: 'text-slate-400',
        recommendations: ['Monitor diagnostics panel.', 'Verify Upstox connection token status.'],
        vix: 15.0,
        pcr: 1.0,
        fiiNetFlow: 0,
        adr: 1.0,
        sectorBreadth: 50.0,
        longBuildupCount: 0,
        shortBuildupCount: 0,
        isMarketClosed: isClosed,
        asOf: new Date().toLocaleTimeString()
      };
    }
  }

  /**
   * Calculates the composite Smart Money Compass Score (-100 to +100).
   */
  async getSmartMoneyCompass(bypassCache = false): Promise<SmartMoneySignal> {
    if (!bypassCache && this.cachedCompass) {
      return this.cachedCompass;
    }
    try {
      // 1. Intraday Price Trend Score (-35 to +35 points)
      let trendScore = 0;
      const sectors = alphaEngineService.getCachedSectors();
      const niftySector = sectors.find(s => s.sector === 'NIFTY 50');
      if (niftySector && niftySector.highPrice && niftySector.lowPrice && niftySector.highPrice > niftySector.lowPrice) {
        const range = niftySector.highPrice - niftySector.lowPrice;
        const rangePosition = (niftySector.lastPrice - niftySector.lowPrice) / range; // 0 to 1
        const rangeScore = (rangePosition - 0.5) * 70; // -35 to +35
        
        const openDiffPct = niftySector.openPrice && niftySector.openPrice > 0 
          ? ((niftySector.lastPrice - niftySector.openPrice) / niftySector.openPrice) * 100 
          : 0;
        const openScore = Math.min(35, Math.max(-35, openDiffPct * 35)); // -35 to +35
        
        trendScore = Math.round(rangeScore * 0.6 + openScore * 0.4);
      }

      // 2. FII Net Flow direction (-15 to +15 points)
      const fiiHistory = await upstoxMarketDataService.getFiiHistory('CM').catch(() => []);
      const fiiNet = fiiHistory.length > 0 ? (fiiHistory[0].net_amount ?? fiiHistory[0].net_value ?? 0) : 0;
      let fiiScore = 0;
      if (fiiNet > 1000) fiiScore = 15;
      else if (fiiNet < -1000) fiiScore = -15;
      else fiiScore = (fiiNet / 1000) * 15;

      // 3. OI Quadrant Bias (-30 to +30 points)
      let oiScore = 0;
      try {
        const derivativeSummary = await this.getDerivativeSummaryCached().catch(() => []);
        let longBuildup = 0;
        let shortBuildup = 0;
        let shortCovering = 0;
        let longUnwinding = 0;
        
        derivativeSummary.forEach(item => {
          if (item.built_up === 'long_build_up') longBuildup++;
          else if (item.built_up === 'short_build_up') shortBuildup++;
          else if (item.built_up === 'short_covering') shortCovering++;
          else if (item.built_up === 'long_unwinding') longUnwinding++;
        });

        const totalBuildup = longBuildup + shortBuildup + shortCovering + longUnwinding;
        if (totalBuildup > 0) {
          const bullishForce = longBuildup + shortCovering;
          const bearishForce = shortBuildup + longUnwinding;
          oiScore = ((bullishForce - bearishForce) / totalBuildup) * 30;
        }
      } catch (err) {
        // Fallback to stock indices direction
        const stocks = alphaEngineService.getCachedStocks();
        const upCount = stocks.filter(s => s.percentChange > 0).length;
        const total = stocks.length;
        if (total > 0) {
          oiScore = ((upCount - (total - upCount)) / total) * 30;
        }
      }

      // 4. PCR Contrarian / Momentum (-20 to +20 points)
      const pcrRes = await upstoxMarketDataService.getPCR('NIFTY').catch(() => null);
      const pcr = pcrRes && typeof pcrRes.pcr === 'number' ? pcrRes.pcr : 0.95;
      let pcrScore = 0;
      
      // Standalone PCR scoring (higher PCR is institutionally bullish as put sellers increase support)
      if (pcr >= 1.4) pcrScore = 20; // Extreme bullish support
      else if (pcr <= 0.6) pcrScore = -20; // Extreme bearish resistance
      else {
        pcrScore = ((pcr - 1.0) / 0.4) * 20;
      }

      // Aggregate
      const compositeScore = Math.min(100, Math.max(-100, Math.round(trendScore + fiiScore + oiScore + pcrScore)));
      
      let trend: SmartMoneySignal['trend'] = 'NEUTRAL';
      let color = 'text-slate-400';
      
      if (compositeScore >= 60) {
        trend = 'STRONG BULLISH';
        color = 'text-emerald-400';
      } else if (compositeScore >= 15) {
        trend = 'BULLISH';
        color = 'text-sky-400';
      } else if (compositeScore <= -60) {
        trend = 'STRONG BEARISH';
        color = 'text-rose-500';
      } else if (compositeScore <= -15) {
        trend = 'BEARISH';
        color = 'text-amber-500';
      }

      const result: SmartMoneySignal = {
        score: compositeScore,
        trend,
        color
      };
      this.cachedCompass = result;
      return result;
    } catch (error) {
      logger.error('SignalFusionService: Error calculating Smart Money Compass:', error);
      return { score: 0, trend: 'NEUTRAL', color: 'text-slate-400' };
    }
  }

  /**
   * Evaluates the local sentiment of news headlines affecting a specific stock.
   */
  async getNewsSentimentForStock(symbol: string): Promise<NewsSentimentItem[]> {
    const sym = symbol.toUpperCase().trim();
    if (this.newsCache[sym]) {
      return this.newsCache[sym];
    }
    if (!this.newsPromises[sym]) {
      this.newsPromises[sym] = (async () => {
        const isUpstoxEnabled = useSettingsStore.getState().isUpstoxEnabled;
        const cacheKey = `upstox_news_sentiment_${sym}`;

        if (!isUpstoxEnabled) {
          const stale = upstoxCacheService.getStale<NewsSentimentItem[]>(cacheKey);
          if (stale) {
            this.newsCache[sym] = stale;
            return stale;
          }
          return [];
        }

        const cap = useCapabilityStore.getState().capabilities['news'];
        if (cap.state !== 'available') {
          const stale = upstoxCacheService.get<NewsSentimentItem[]>(cacheKey);
          return stale || [];
        }

        try {
          const data = await upstoxCacheService.executeWithCache(
            cacheKey,
            async () => {
              const response = await fetch(`/api/python-nse/api/upstox/news?symbol=${encodeURIComponent(sym)}`);
              if (response.ok) {
                const res = await response.json();
                const guardedRes = ProvenanceGuard.guard<any>(res);
                if (guardedRes && guardedRes.status === 'demo_only') {
                  useCapabilityStore.getState().setCapabilityState('news', 'demo_only', 'Upstox news endpoint returned demo-only fallback.');
                  return [];
                }
                const articlesData = (guardedRes && guardedRes.data) || guardedRes || [];
                let articles: any[] = [];
                if (Array.isArray(articlesData)) {
                  articles = articlesData;
                } else if (typeof articlesData === 'object' && articlesData !== null) {
                  const symbolKey = Object.keys(articlesData).find(
                    k => k.toUpperCase() === sym.toUpperCase()
                  );
                  if (symbolKey && Array.isArray(articlesData[symbolKey])) {
                    articles = articlesData[symbolKey];
                  } else {
                    articles = Object.values(articlesData).flat();
                  }
                }
                
                const sentimentItems: NewsSentimentItem[] = articles.map((art: any) => {
                  let sentiment: NewsSentimentItem['sentiment'] = 'NEUTRAL';
                  let score = 0;
                  
                  if (art.sentiment) {
                    sentiment = art.sentiment.toUpperCase();
                    score = sentiment === 'POSITIVE' ? 1.0 : sentiment === 'NEGATIVE' ? -1.0 : 0;
                  } else {
                    const text = ((art.title || '') + ' ' + (art.description || '')).toLowerCase();
                    const positiveWords = ['beat', 'exceed', 'growth', 'record', 'gain', 'buy', 'expansion', 'profit', 'dividend'];
                    const negativeWords = ['investigation', 'query', 'drop', 'fall', 'loss', 'warning', 'lawsuit', 'fine', 'penalty'];
                    
                    let posCount = 0;
                    let negCount = 0;
                    positiveWords.forEach(w => { if (text.includes(w)) posCount++; });
                    negativeWords.forEach(w => { if (text.includes(w)) negCount++; });
                    
                    if (posCount > negCount) {
                      sentiment = 'POSITIVE';
                      score = 0.5;
                    } else if (negCount > posCount) {
                      sentiment = 'NEGATIVE';
                      score = -0.7;
                    }
                  }
                  
                  return {
                    id: art.id || String(Math.random()),
                    title: art.title || 'Market Update',
                    sentiment,
                    score
                  };
                });
                return sentimentItems;
              }
              throw new Error(`Upstox news status ${response.status}`);
            },
            () => {
              useCapabilityStore.getState().setCapabilityState('news', 'demo_only', 'News fetch failed, running in demo-only mode.');
              return [];
            }
          );
          if (data) {
            this.newsCache[sym] = data;
            return data;
          }
        } catch (err) {
          logger.error(`SignalFusionService: Error fetching news sentiment for ${sym}:`, err);
        }
        return [];
      })();
    }
    return this.newsPromises[sym];
  }

  /**
   * Computes the Trade Conviction Score (0-100) for a stock list.
   */
  async computeTradeConviction(stock: StockData): Promise<StockConviction> {
    const symbol = stock.symbol;
    
    // 1. G-Factor (30% weight) -> stock.gFactor is already scaled 0-10
    const gFactorWeight = 0.30;
    const gFactorScore = (stock.gFactor ?? 5) * 10; // scale to 0-100

    // 2. OI Quadrant Bias (25% weight)
    const oiQuadrantWeight = 0.25;
    let oiQuadrant: StockConviction['oiQuadrant'] = 'NEUTRAL';
    let oiScore = 50; // Neutral baseline

    try {
      const derivativeSummary = await this.getDerivativeSummaryCached().catch(() => []);
      const item = derivativeSummary.find(d => d.symbol_name.toUpperCase() === symbol.toUpperCase());
      if (item && item.built_up) {
        const builtUp = item.built_up.toLowerCase();
        if (builtUp === 'long_build_up') {
          oiQuadrant = 'LONG BUILDUP';
          oiScore = 100; // Strong bullish bias
        } else if (builtUp === 'short_covering') {
          oiQuadrant = 'SHORT COVERING';
          oiScore = 80;  // Moderately bullish bias
        } else if (builtUp === 'long_unwinding') {
          oiQuadrant = 'LONG UNWINDING';
          oiScore = 30;  // Moderately bearish bias
        } else if (builtUp === 'short_build_up') {
          oiQuadrant = 'SHORT BUILDUP';
          oiScore = 0;   // Strong bearish bias
        }
      }
    } catch (err) {
      // Fallback based on daily direction
      if (stock.percentChange > 1.0) {
        oiQuadrant = 'LONG BUILDUP';
        oiScore = 90;
      } else if (stock.percentChange < -1.0) {
        oiQuadrant = 'SHORT BUILDUP';
        oiScore = 10;
      }
    }

    // 3. Fundamental Score (20% weight)
    const fundamentalWeight = 0.20;
    let fundamentalScore = 60; // Safe average fallback
    let alphaConfirmation = false;

    try {
      const resolved = await upstoxMarketDataService.resolveSymbol(symbol).catch(() => null);
      if (resolved && resolved.isin) {
        const [profile, keyRatios, shareholding, competitors, balanceSheet, cashFlow, incomeStatement] = await Promise.all([
          this.getFundamentalsCached(resolved.isin, 'profile').catch(() => null),
          this.getFundamentalsCached(resolved.isin, 'key-ratios').catch(() => null),
          this.getFundamentalsCached(resolved.isin, 'shareholding').catch(() => null),
          this.getFundamentalsCached(resolved.isin, 'competitors').catch(() => null),
          this.getFundamentalsCached(resolved.isin, 'balance-sheet').catch(() => null),
          this.getFundamentalsCached(resolved.isin, 'cash-flow').catch(() => null),
          this.getFundamentalsCached(resolved.isin, 'income-statement').catch(() => null)
        ]);

        const aspects = {
          'profile': profile,
          'key-ratios': keyRatios,
          'shareholding': shareholding,
          'competitors': competitors,
          'balance-sheet': balanceSheet,
          'cash-flow': cashFlow,
          'income-statement': incomeStatement
        };

        const verdict = FundamentalVerdictEngine.generateVerdict(aspects);
        alphaConfirmation = verdict.alphaConfirmation;

        const keyRatiosGuarded = ProvenanceGuard.guard<any>(keyRatios);
        if (keyRatiosGuarded) {
          let score = 0;
          if ((keyRatiosGuarded.roe ?? 0) > 15) score += 25;
          if ((keyRatiosGuarded.roce ?? 0) > 15) score += 25;
          if ((keyRatiosGuarded.debt_to_equity ?? 1) < 0.5) score += 25;
          if ((keyRatiosGuarded.revenue_growth_yoy ?? 0) > 10) score += 25;
          fundamentalScore = score > 0 ? score : 50;
        }
      }
    } catch (err) {
      logger.warn(`Failed to fetch live fundamentals or ProvenanceGuard blocked for ${symbol}:`, err);
      fundamentalScore = 0; // Fallback: rate it zero / neutral stance
    }

    // 4. Ownership Flow Score (15% weight)
    const ownershipWeight = 0.15;
    let ownershipScore = 50; // Neutral fallback

    try {
      const resolved = await upstoxMarketDataService.resolveSymbol(symbol).catch(() => null);
      if (resolved && resolved.isin) {
        const shareholding = ProvenanceGuard.guard<any>(await this.getFundamentalsCached(resolved.isin, 'shareholding'));
        if (shareholding && shareholding.quarters && shareholding.quarters.length > 0) {
          const q = shareholding.quarters[0];
          const fiiChange = q.fii - (shareholding.quarters[1]?.fii ?? q.fii);
          const diiChange = q.dii - (shareholding.quarters[1]?.dii ?? q.dii);
          const promoterChange = q.promoter - (shareholding.quarters[1]?.promoter ?? q.promoter);
          const rawFlow = (fiiChange * 0.4) + (diiChange * 0.3) + (promoterChange * 0.3);
          
          ownershipScore = Math.min(100, Math.max(0, 50 + Math.round(rawFlow * 15)));
        }
      }
    } catch (err) {
      logger.warn(`Failed to fetch live ownership flow or ProvenanceGuard blocked for ${symbol}:`, err);
      ownershipScore = 50; // Neutral fallback (stance 50/100)
    }

    // 5. IV Rank / Level (10% weight) -> Lower IV is better for buying options/leverage conviction
    const ivWeight = 0.10;
    let ivScore = 70; // Good neutral setup

    try {
      const chainSnapshot = await this.getOptionChainCached(symbol).catch(() => null);
      if (chainSnapshot && chainSnapshot.strikes && chainSnapshot.strikes.length > 0) {
        // Average IV from ATM strikes (strikes closest to underlyingValue)
        const sortedStrikes = [...chainSnapshot.strikes].sort((a, b) => 
          Math.abs(a.strikePrice - chainSnapshot.underlyingValue) - Math.abs(b.strikePrice - chainSnapshot.underlyingValue)
        );
        const atmStrikes = sortedStrikes.slice(0, 5);
        const totalIv = atmStrikes.reduce((sum, strike) => {
          const ivCE = strike.CE?.iv || 0;
          const ivPE = strike.PE?.iv || 0;
          return sum + (ivCE || ivPE || 20); // fall back to 20% if 0
        }, 0);
        const avgIv = totalIv / 5; // percent
        
        // Higher IV gets lower buy conviction score (expensive premium risk)
        if (avgIv > 40) ivScore = 20;
        else if (avgIv > 25) ivScore = 50;
        else ivScore = 90;
      }
    } catch (err) {
      // Keep default
    }

    // 6. News Sentiment Modifier
    const newsSentiment = await this.getNewsSentimentForStock(symbol);
    const hasActiveNews = newsSentiment.length > 0;
    let newsSentimentModifier = 0;

    if (hasActiveNews) {
      // Calculate average news score
      const totalScore = newsSentiment.reduce((sum, item) => sum + item.score, 0);
      const avgScore = totalScore / newsSentiment.length;

      // Penalize heavily for negative news, boost slightly for positive
      if (avgScore < -0.3) {
        newsSentimentModifier = Math.round(avgScore * 30); // up to -30 penalty
      } else if (avgScore > 0.3) {
        newsSentimentModifier = Math.round(avgScore * 10);  // up to +10 boost
      }
    }

    // Calculate final weighted score
    let baseConviction = (
      (gFactorScore * gFactorWeight) +
      (oiScore * oiQuadrantWeight) +
      (fundamentalScore * fundamentalWeight) +
      (ownershipScore * ownershipWeight) +
      (ivScore * ivWeight)
    );

    // Apply alphaConfirmation modifier (±0.05 on 0-1 scale translates to ±5 on 0-100 scale)
    baseConviction += alphaConfirmation ? 5 : -5;

    const convictionScore = Math.min(100, Math.max(0, Math.round(baseConviction + newsSentimentModifier)));

    return {
      symbol,
      convictionScore,
      gFactor: stock.gFactor,
      oiQuadrant,
      fundamentalScore,
      ownershipScore,
      ivRank: ivScore,
      newsSentimentModifier,
      hasActiveNews
    };
  }

  /**
   * Helper to check if current time is within live trading hours (Mon-Fri 9:15 AM - 3:30 PM IST)
   */
  private checkIsLiveTradingHours(): boolean {
    const now = new Date();
    try {
      const istFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour12: false,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
      const parts = istFormatter.formatToParts(now);
      const partMap: Record<string, string> = {};
      parts.forEach(p => { partMap[p.type] = p.value; });
      
      const weekday = partMap['weekday']; // e.g. "Mon", "Tue" etc.
      if (weekday === 'Sat' || weekday === 'Sun') return false;
      
      const hour = parseInt(partMap['hour'], 10);
      const minute = parseInt(partMap['minute'], 10);
      
      const currentMins = hour * 60 + minute;
      const startMins = 9 * 60 + 15; // 9:15 AM
      const endMins = 15 * 60 + 30;  // 3:30 PM
      
      return currentMins >= startMins && currentMins <= endMins;
    } catch (e) {
      // Fallback to local time if Intl fails
      const day = now.getDay();
      if (day === 0 || day === 6) return false;
      const hour = now.getHours();
      const minute = now.getMinutes();
      const currentMins = hour * 60 + minute;
      return currentMins >= 555 && currentMins <= 930;
    }
  }
  
  // Custom interface bridge method because Upstox API uses both spellings
  private async getCompanyCompanyFundamentals(isin: string, aspect: any) {
    return upstoxMarketDataService.getCompanyFundamentals(isin, aspect);
  }
}

export const signalFusionService = SignalFusionService.getInstance();
