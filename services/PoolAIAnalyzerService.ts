import { llmPipeline } from './llm';
import { resolveInstrumentKey, getTodayCandles } from './IntradayCandleService';
import { usePoolStore } from '../store/poolStore';
import { logger } from './Logger';

export interface AIAnalysisResult {
  ticker: string;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'CONSOLIDATION';
  verdict: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  entryZone: string;
  target1: number;
  target2: number;
  stopLoss: number;
  timeframe: string;
  convictionScore: number;
  summary: string;
}

class PoolAIAnalyzerService {
  private static instance: PoolAIAnalyzerService;

  private constructor() {}

  public static getInstance(): PoolAIAnalyzerService {
    if (!PoolAIAnalyzerService.instance) {
      PoolAIAnalyzerService.instance = new PoolAIAnalyzerService();
    }
    return PoolAIAnalyzerService.instance;
  }

  /**
   * Helper to identify swing highs and swing lows (local extremes)
   */
  private findSupportResistance(candles: any[], windowSize = 5): { supports: number[]; resistances: number[] } {
    const supports: number[] = [];
    const resistances: number[] = [];

    for (let i = windowSize; i < candles.length - windowSize; i++) {
      let isMin = true;
      let isMax = true;

      for (let j = -windowSize; j <= windowSize; j++) {
        if (j === 0) continue;
        if (candles[i + j].l < candles[i].l) isMin = false;
        if (candles[i + j].h > candles[i].h) isMax = false;
      }

      if (isMin) supports.push(candles[i].l);
      if (isMax) resistances.push(candles[i].h);
    }

    // Sort and get unique clusters or top values
    const uniqueSupports = [...new Set(supports)]
      .sort((a, b) => a - b)
      .slice(-3); // Get 3 closest support levels
    
    const uniqueResistances = [...new Set(resistances)]
      .sort((a, b) => b - a)
      .slice(-3); // Get 3 closest resistance levels

    return { supports: uniqueSupports, resistances: uniqueResistances };
  }

  /**
   * Main analysis execution method
   */
  public async analyzeSymbol(ticker: string, depth: 'quick' | 'deep' = 'deep'): Promise<AIAnalysisResult | null> {
    logger.info(`[PoolAIAnalyzerService] Starting ${depth} AI analysis for ${ticker}...`);

    try {
      const cleanTicker = ticker.toUpperCase().trim();
      
      // Resolve to key
      const key = await resolveInstrumentKey(cleanTicker);
      if (!key) {
        logger.error(`[PoolAIAnalyzerService] Could not resolve instrument key for ${cleanTicker}`);
        return null;
      }

      // Fetch live price
      let currentPrice = 0;
      try {
        const quotesRes = await fetch(`/api/python-nse/api/upstox/ltp-quotes?symbols=${cleanTicker}`);
        if (quotesRes.ok) {
          const quotes = await quotesRes.json();
          currentPrice = quotes[key]?.last_price || 0;
        }
      } catch (err) {
        logger.warn(`[PoolAIAnalyzerService] Failed to fetch live quote, falling back to candle close:`, err);
      }

      // Fetch today's candles for latest close
      let candles: any[] = [];
      try {
        candles = await getTodayCandles(cleanTicker, '1minute');
        if (currentPrice === 0 && candles.length > 0) {
          currentPrice = candles[candles.length - 1].c;
        }
      } catch (err) {
        logger.warn(`[PoolAIAnalyzerService] Failed to fetch 1-min candles:`, err);
      }

      let computedContext = '';

      if (depth === 'deep') {
        // Fetch 6 months of daily candles (approx 125 trading days)
        const toDateStr = new Date().toISOString().split('T')[0];
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 180);
        const fromDateStr = fromDate.toISOString().split('T')[0];

        try {
          const res = await fetch(
            `/api/python-nse/api/upstox/historical-candles?instrument_key=${encodeURIComponent(key)}` +
            `&interval=day&from_date=${fromDateStr}&to_date=${toDateStr}`
          );
          if (res.ok) {
            const data = await res.json();
            const histCandles = data?.data?.candles || [];
            
            if (histCandles.length > 0) {
              const closePrices = histCandles.map((c: any) => Array.isArray(c) ? Number(c[4]) : Number(c.c));
              const highPrices = histCandles.map((c: any) => Array.isArray(c) ? Number(c[2]) : Number(c.h));
              const lowPrices = histCandles.map((c: any) => Array.isArray(c) ? Number(c[3]) : Number(c.l));

              // Compute SMAs
              const last50 = closePrices.slice(-50);
              const sma50 = last50.reduce((a: number, b: number) => a + b, 0) / Math.max(1, last50.length);

              const last200 = closePrices.slice(-200);
              const sma200 = last200.reduce((a: number, b: number) => a + b, 0) / Math.max(1, last200.length);

              // Find local swings
              const candleObjects = histCandles.map((c: any) => {
                if (Array.isArray(c)) {
                  return { h: Number(c[2]), l: Number(c[3]), c: Number(c[4]) };
                }
                return { h: Number(c.h), l: Number(c.l), c: Number(c.c) };
              });
              const { supports, resistances } = this.findSupportResistance(candleObjects);

              computedContext = `
                COMPUTED STATS (6-Month Daily candles):
                - Current Price: ₹${currentPrice.toFixed(2)}
                - 50-day Simple Moving Average (SMA50): ₹${sma50.toFixed(2)}
                - 200-day Simple Moving Average (SMA200): ₹${sma200.toFixed(2)}
                - Near-term Support Levels: ${supports.map(s => '₹' + s.toFixed(2)).join(', ')}
                - Near-term Resistance Levels: ${resistances.map(r => '₹' + r.toFixed(2)).join(', ')}
                - Position vs SMA50: ${currentPrice > sma50 ? 'Above (Bullish trend)' : 'Below (Bearish trend)'}
                - Position vs SMA200: ${currentPrice > sma200 ? 'Above (Long-term Bullish)' : 'Below (Long-term Bearish)'}
              `;
            }
          }
        } catch (err) {
          logger.warn(`[PoolAIAnalyzerService] Historical candles fetch failed:`, err);
        }
      }

      const prompt = `
        You are the Momentum Pool Trading Specialist. Perform a ${depth} technical analysis for stock ticker "${cleanTicker}".
        
        CONTEXT:
        - Stock Ticker: ${cleanTicker}
        - Current Price: ₹${currentPrice}
        ${computedContext}
        
        GOAL: Determine target entry price, stop loss, sell targets, conviction score, and trend structure.
        
        OUTPUT FORMAT (Strict JSON Mode):
        {
          "ticker": "${cleanTicker}",
          "trend": "BULLISH", // BULLISH, BEARISH, NEUTRAL, or CONSOLIDATION
          "verdict": "BUY", // STRONG_BUY, BUY, HOLD, SELL, or STRONG_SELL
          "entryZone": "₹2400 - ₹2420",
          "target1": 2500,
          "target2": 2600,
          "stopLoss": 2350,
          "timeframe": "2-3 weeks",
          "convictionScore": 8, // 1 to 10 scale
          "summary": "Short technical justification..."
        }

        RULES:
        1. Be realistic and surgical. The stopLoss must be placed at a logical support level.
        2. Targets (target1, target2) must represent reasonable resistance levels based on current price.
        3. Do NOT include markdown styling or outer wrap, just output the raw JSON object.
      `;

      const response = await llmPipeline(prompt, {
        jsonMode: true,
        requireHighIntelligence: true,
        noCache: true
      });

      const parsed: AIAnalysisResult = JSON.parse(response.text.replace(/```json|```/g, '').trim());
      logger.info(`[PoolAIAnalyzerService] Successfully analyzed ${cleanTicker}:`, parsed);

      // Now, update this item in the Pool Watchlist database if it exists
      const poolStore = usePoolStore.getState();
      const existingItem = poolStore.items.find(i => i.ticker.toUpperCase() === cleanTicker);
      
      if (existingItem && existingItem.id) {
        const patch: any = {
          targetBuyPrice: Number(parsed.entryZone.replace(/[^\d.-]/g, '').split('-')[0]) || undefined,
          targetSellPrice: parsed.target1 || undefined,
          stopLoss: parsed.stopLoss || undefined,
          notes: `${existingItem.notes || ''}\n[AI Analysis (${depth}) - ${new Date().toLocaleDateString()}]: ${parsed.summary} (Conviction: ${parsed.convictionScore}/10)`.trim()
        };

        await poolStore.updateItem(existingItem.id, patch);
        logger.info(`[PoolAIAnalyzerService] Updated watchlist item ${existingItem.id} in Dexie.`);
      }

      return parsed;
    } catch (err) {
      logger.error(`[PoolAIAnalyzerService] Failed to analyze symbol ${ticker}:`, err);
      return null;
    }
  }
}

export const poolAIAnalyzerService = PoolAIAnalyzerService.getInstance();
