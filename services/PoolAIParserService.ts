/**
 * PoolAIParserService
 * 
 * Multi-Modal AI parser for Momentum Pool 2.0.
 * Ingests unstructured social posts, tweets, Instagram captions, YouTube descriptions,
 * or OCR transcripts and extracts structured trading setup parameters in <500ms.
 * 
 * Uses Groq (llama-3.3-70b-versatile / llama-3.1-8b-instant) as primary ultra-low latency engine
 * with automatic fallback to Gemini Flash.
 */

import { quickAskGroq, chatWithGroq } from './groqService';
import { askGemini } from './aiService';
import { logger } from './Logger';
import { PlatformSourceType, HorizonType, TriggerType } from '../store/poolStore';

export interface ParsedPoolSetup {
  ticker: string;
  exchange: 'NSE_EQ' | 'NSE_FNO' | 'BSE_EQ' | 'MCX_COMM';
  platformSource: PlatformSourceType;
  creatorHandle?: string;
  sourceUrl?: string;
  horizon: HorizonType;
  triggerType: TriggerType;
  triggerPrice?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  target3?: number;
  catalystTags: string[];
  notes: string;
  riskRewardRatio?: number;
  confidence: number;
}

const SYSTEM_PROMPT = `You are an elite quantitative analyst extracting structured trading setups from Indian stock market social media posts (Twitter/X, Instagram, YouTube, Telegram).

Given raw text, extract the trade setup into strict JSON format with no markdown wrappers, backticks, or explanation.

JSON Schema:
{
  "ticker": "Symbol without exchange prefix (e.g. RELIANCE, DIXON, NIFTY 24500 CE, TATASTEEL)",
  "exchange": "NSE_EQ" | "NSE_FNO" | "BSE_EQ" | "MCX_COMM",
  "platformSource": "TWITTER" | "INSTAGRAM" | "YOUTUBE" | "TELEGRAM" | "TRADINGVIEW" | "PERSONAL_RESEARCH",
  "creatorHandle": "Analyst or creator handle with @ if mentioned, otherwise empty string",
  "horizon": "INTRADAY_SCALP" | "BTST_STBT" | "POSITIONAL_SWING" | "MOMENTUM_SHORT_TERM" | "MULTIBAGGER_LONG_TERM",
  "triggerType": "MARKET" | "ABOVE" | "BELOW" | "LIMIT",
  "triggerPrice": number or null,
  "stopLoss": number or null,
  "target1": number or null,
  "target2": number or null,
  "target3": number or null,
  "catalystTags": ["Array of recognized tags: Flat-Base Breakout, 52-Week High, Volume Shock, Cup & Handle, 9-EMA Snapback, RSI Bullish Divergence, Earnings Surprise, Order Book Win, Debt Reduction"],
  "notes": "Concise summary of rationale (1-2 sentences)",
  "confidence": number between 0.0 and 1.0
}

Rules:
1. If options or futures (CE, PE, FUT), set exchange to "NSE_FNO".
2. If index options without strike, extract the underlying.
3. If trigger says "buy above 14800", triggerType is "ABOVE" and triggerPrice is 14800.
4. Calculate targets from text (e.g. "Tgt 15200/15500" -> target1: 15200, target2: 15500).
5. Output ONLY valid parseable JSON.`;

class PoolAIParserService {
  /**
   * Parses raw social media text or caption into a structured setup
   */
  public async parseSocialPost(rawText: string, defaultSource: PlatformSourceType = 'TWITTER'): Promise<ParsedPoolSetup | null> {
    const text = rawText.trim();
    if (!text || text.length < 5) return null;

    let jsonStr = '';

    // Step 1: Try Groq first for ultra-low latency (<400ms)
    try {
      logger.info('[PoolAIParserService] Attempting parse with Groq...');
      jsonStr = await chatWithGroq('llama-3.3-70b-versatile', [], text, SYSTEM_PROMPT);
    } catch (groqErr) {
      logger.warn('[PoolAIParserService] Groq parse failed, falling back to Gemini Flash:', groqErr);
      try {
        const fullPrompt = `${SYSTEM_PROMPT}\n\nInput text to parse:\n"${text}"`;
        jsonStr = await askGemini(fullPrompt, false);
      } catch (geminiErr) {
        logger.error('[PoolAIParserService] Both Groq and Gemini Flash failed:', geminiErr);
        return this.fallbackRegexParser(text, defaultSource);
      }
    }

    try {
      const clean = jsonStr
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      
      const parsed = JSON.parse(clean);

      if (!parsed.ticker) {
        return this.fallbackRegexParser(text, defaultSource);
      }

      // Compute Risk/Reward ratio if levels present
      let rr: number | undefined = undefined;
      const trig = Number(parsed.triggerPrice) || 0;
      const sl = Number(parsed.stopLoss) || 0;
      const t1 = Number(parsed.target1) || 0;
      if (trig > 0 && sl > 0 && t1 > 0 && trig !== sl) {
        rr = Math.round((Math.abs(t1 - trig) / Math.abs(trig - sl)) * 100) / 100;
      }

      return {
        ticker: String(parsed.ticker).toUpperCase().replace(/NSE:|BSE:/i, '').trim(),
        exchange: parsed.exchange || 'NSE_EQ',
        platformSource: parsed.platformSource || defaultSource,
        creatorHandle: parsed.creatorHandle || undefined,
        sourceUrl: parsed.sourceUrl || undefined,
        horizon: parsed.horizon || 'POSITIONAL_SWING',
        triggerType: parsed.triggerType || 'MARKET',
        triggerPrice: trig || undefined,
        stopLoss: sl || undefined,
        target1: t1 || undefined,
        target2: Number(parsed.target2) || undefined,
        target3: Number(parsed.target3) || undefined,
        catalystTags: Array.isArray(parsed.catalystTags) ? parsed.catalystTags : ['Breakout'],
        notes: parsed.notes || text.slice(0, 150),
        riskRewardRatio: rr,
        confidence: Number(parsed.confidence) || 0.85,
      };
    } catch (parseErr) {
      logger.warn('[PoolAIParserService] JSON parse error, using heuristic fallback:', parseErr);
      return this.fallbackRegexParser(text, defaultSource);
    }
  }

  /**
   * Deterministic regex fallback when LLM APIs are offline
   */
  private fallbackRegexParser(text: string, defaultSource: PlatformSourceType): ParsedPoolSetup {
    const upper = text.toUpperCase();

    // Look for ticker pattern (e.g. BUY RELIANCE, DIXON, NIFTY 24500 CE)
    const tickerMatch = text.match(/\b([A-Z]{3,12}(?:-\w+)?|\b(?:NIFTY|BANKNIFTY|FINNIFTY|SENSEX)\s*\d{4,5}\s*(?:CE|PE))\b/i);
    const ticker = tickerMatch ? tickerMatch[1].toUpperCase() : 'UNKNOWN';

    // Look for numbers following BUY, ABOVE, CMP, SL, TGT
    const aboveMatch = text.match(/(?:ABOVE|TRIGGER|ENTRY|BUY AT|BUY)\s*(?:₹|INR)?\s*(\d+(?:\.\d+)?)/i);
    const slMatch = text.match(/(?:SL|STOPLOSS|STOP\s*LOSS|INVALIDATION)\s*(?:₹|INR)?\s*(\d+(?:\.\d+)?)/i);
    const tgtMatches = [...text.matchAll(/(?:TGT|TARGET|T1|T2)\s*(?:₹|INR)?\s*(\d+(?:\.\d+)?)/gi)];

    const trig = aboveMatch ? parseFloat(aboveMatch[1]) : undefined;
    const sl = slMatch ? parseFloat(slMatch[1]) : undefined;
    const t1 = tgtMatches[0] ? parseFloat(tgtMatches[0][1]) : undefined;
    const t2 = tgtMatches[1] ? parseFloat(tgtMatches[1][1]) : undefined;

    // Detect creator handle
    const handleMatch = text.match(/@([A-Za-z0-9_]{3,20})/);
    const handle = handleMatch ? `@${handleMatch[1]}` : undefined;

    // Detect tags
    const tags: string[] = [];
    if (/BREAKOUT|CUP|HEAD/i.test(text)) tags.push('Breakout');
    if (/VOLUME|SPIKE|20-DMA/i.test(text)) tags.push('Volume Shock');
    if (/EARNINGS|RESULT|ORDER/i.test(text)) tags.push('Earnings Surprise');
    if (/SWING/i.test(text)) tags.push('Positional Swing');
    if (tags.length === 0) tags.push('Technical Setup');

    let rr: number | undefined = undefined;
    if (trig && sl && t1 && trig !== sl) {
      rr = Math.round((Math.abs(t1 - trig) / Math.abs(trig - sl)) * 100) / 100;
    }

    return {
      ticker,
      exchange: /CE|PE|FUT/i.test(ticker) ? 'NSE_FNO' : 'NSE_EQ',
      platformSource: defaultSource,
      creatorHandle: handle,
      horizon: /SCALP|INTRADAY/i.test(text) ? 'INTRADAY_SCALP' : 'POSITIONAL_SWING',
      triggerType: aboveMatch ? 'ABOVE' : 'MARKET',
      triggerPrice: trig,
      stopLoss: sl,
      target1: t1,
      target2: t2,
      catalystTags: tags,
      notes: text.slice(0, 160),
      riskRewardRatio: rr,
      confidence: 0.60,
    };
  }
}

export const poolAIParserService = new PoolAIParserService();
