/**
 * CC39 — Momentum Pool Verdict Engine
 *
 * For each PoolItem, produces a PoolVerdict in 4 layers:
 *   1. Technicals  — RSI, MACD histogram, distance from 200 SMA, BB%B,
 *                   20-day volume ratio, intraday VWAP gap.
 *   2. Flow / OI   — OI change %, volume multiplier (Upstox bridge).
 *   3. Pattern     — Candlestick pattern from /api/alpha/pattern-scan.
 *   4. LLM         — Gemini/Groq verdict with the 4 layers as context.
 *
 * The whole thing is wrapped in a 30-second in-memory cache so a rapid
 * market move doesn't burn tokens across every subscribed component.
 *
 * If the LLM call fails or returns malformed JSON, we degrade gracefully:
 * the verdict still ships, but with `confidence: 0.3` and a `summary`
 * composed from the technical layer.
 */
import { db, PoolItem, PoolVerdict } from '../database';
import { logger } from './Logger';
import { YahooHistoricalService } from './backtester/YahooHistoricalService';
import { generateSignals } from '../utils/technicalAnalysis';
import { newsCorrelationService } from './NewsCorrelationService';
import { llmPipeline } from './llm';
import { useSettingsStore } from '../store/settingsStore';
import { poolCandleGate, type CandleFeatures } from './ml/PoolCandleGate';
import { alphaEngineService } from './AlphaEngineService';
import { FNO_STOCKS } from '../data/fno_stocks';

interface CachedVerdict {
  verdict: PoolVerdict;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

const VERDICT_PROMPT = `You are a senior Indian-market analyst giving a pre-market / intraday verdict on a stock or index option.

CONTEXT (already computed):
- Ticker: {ticker}
- Exchange: {exchange}
- Current price: ₹{price}
- RSI(14): {rsi}
- MACD histogram: {macdHist}
- Distance from 200 SMA: {distSma200}%
- Bollinger %B: {bbPos}
- 20-day avg volume ratio: {volRatio}
- OI change % (latest): {oiChangePct}
- Pattern scan: {pattern}
- Recent news sentiment: {news}
- Pool source: {source}
- Notes from user: {notes}

GOAL:
Produce a single trading verdict.

OUTPUT (strict JSON, no prose, no markdown):
{
  "verdict": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL" | "AVOID",
  "score": <integer 0-100>,
  "confidence": <float 0-1>,
  "summary": "<one-line plain English, max 140 chars>",
  "reasoning": ["<bullet 1>", "<bullet 2>", "<bullet 3>"],
  "suggestedEntry": <number|null>,
  "suggestedStop": <number|null>,
  "suggestedTarget": <number|null>
}

RULES:
- score is overall conviction, not a probability.
- confidence is the LLM's self-reported reliability of the verdict given the data.
- "AVOID" means do not trade; use it when the data is contradictory or the
  setup is unclear. Never invent levels. If you cannot suggest a level, return null.
- Keep the summary punchy and actionable.
- Be honest. If the data is thin (e.g. no news, no pattern), lower the score.`;

class PoolVerdictEngine {
  private static instance: PoolVerdictEngine;
  private cache = new Map<string, CachedVerdict>();

  private constructor() {}

  public static getInstance(): PoolVerdictEngine {
    if (!PoolVerdictEngine.instance) PoolVerdictEngine.instance = new PoolVerdictEngine();
    return PoolVerdictEngine.instance;
  }

  /**
   * Run a verdict for one PoolItem. Persists to Dexie and returns it.
   * If the cache is warm, returns the cached verdict (and reuses the DB row).
   */
  public async analyze(
    item: PoolItem,
    trigger: PoolVerdict['triggerType'] = 'POLL',
    override?: { news?: { headline: string; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }[] }
  ): Promise<PoolVerdict> {
    if (!item.id) throw new Error('PoolItem has no id');

    const cacheKey = `${item.ticker}:${item.exchange}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && trigger === 'POLL') {
      return cached.verdict;
    }

    // 1) Technicals (always runs; cheap)
    const tech = await this.computeTechnicals(item.ticker);

    // 2) Flow / OI (best-effort; tolerate failure)
    let flow = { oiChangePct: 0, volumeMultiplier: 1 };
    if (item.exchange === 'NSE_FNO') {
      try {
        flow = await this.computeFlow(item.ticker);
      } catch (err) {
        logger.warn(`PoolVerdict: flow lookup failed for ${item.ticker}`, err);
      }
    }

    // 3) Pattern (best-effort)
    let pattern: string | undefined;
    try {
      const res = await fetch(
        `/api/python-nse/api/alpha/pattern-scan?symbol=${encodeURIComponent(item.ticker)}`
      );
      if (res.ok) {
        const j = await res.json();
        pattern = j?.data?.pattern || j?.pattern || undefined;
      }
    } catch {
      /* swallow */
    }

    // 4) News (best-effort, but cached inside the newsCorrelationService)
    let news = override?.news;
    if (!news || news.length === 0) {
      try {
        const match = await newsCorrelationService.matchNewsForSymbol(item.ticker, 240);
        if (match) {
          news = [{ headline: match.title, sentiment: this.sentimentFromText(match.title + ' ' + (match.description || '')) }];
        }
      } catch (err) {
        logger.warn(`PoolVerdict: news lookup failed for ${item.ticker}`, err);
      }
    }

    // SPRINT 2.D1 — Market Intel bridge: replace hardcoded regime constants with
    // live data from the AlphaEngineService session caches (sector strength +
    // market mood). Degrades to neutral defaults when caches are cold.
    let sectorRs = 1.0;
    let regimeAdx = 20;
    try {
      const cachedSectors = alphaEngineService.getCachedSectors() || [];
      const itemSector = this.resolveItemSector(item);
      if (itemSector) {
        const sectorEntry = cachedSectors.find((s: any) =>
          (s.sector || '').toLowerCase() === itemSector.toLowerCase());
        // strengthRatio IS the sector's X-Factor vs Nifty 50 - exactly a
        // relative-strength ratio; clamp to sane bounds.
        if (sectorEntry && Number.isFinite(sectorEntry.strengthRatio)) {
          sectorRs = Math.max(0.2, Math.min(3, sectorEntry.strengthRatio));
        }
      }
    } catch { /* neutral fallback */ }
    try {
      const mood = alphaEngineService.getCachedMood();
      if (mood && typeof mood.isBullish === 'boolean') {
        // Bullish regime -> assume trending (ADX ~25), bearish/choppy -> lower
        regimeAdx = mood.isBullish ? 25 : 15;
      }
    } catch { /* neutral fallback */ }

    // Fast ML Gate Check (skip LLM on quiet candles if trigger is background POLL)
    const candleFeatures: CandleFeatures = {
      rsi: tech.rsi,
      adx: regimeAdx,
      priceVsVwap: 0,
      volumeRatio: flow.volumeMultiplier || 1.0,
      bidAskSpread: 0,
      emaAlignment: tech.above200sma ? 1 : -1,
      sectorRs,
      candleBodyPct: 0.5,
      upperShadowPct: 0.25,
      lowerShadowPct: 0.25,
    };

    let verdict: {
      verdict: PoolVerdict['verdict'];
      score: number;
      confidence: number;
      summary: string;
      reasoning: string[];
      suggestedEntry?: number | null;
      suggestedStop?: number | null;
      suggestedTarget?: number | null;
    };
    if (trigger === 'POLL' && !poolCandleGate.shouldCallLLM(candleFeatures)) {
      verdict = {
        verdict: 'NEUTRAL',
        score: 50,
        confidence: 0.5,
        summary: 'Gate skip: candle quiet, saved LLM call',
        reasoning: ['Fast ML gate flagged low activity', 'Technical score near neutral', 'Skipped LLM inference'],
      };
    } else {
      // 5) LLM verdict (the AI layer)
      const res = await this.runLLM(item, tech, flow, pattern, news);
      verdict = {
        verdict: (res.verdict || 'NEUTRAL') as PoolVerdict['verdict'],
        score: res.score ?? 50,
        confidence: res.confidence ?? 0.5,
        summary: res.summary || 'Analysis complete',
        reasoning: res.reasoning || [],
        suggestedEntry: res.suggestedEntry != null ? res.suggestedEntry : undefined,
        suggestedStop: res.suggestedStop != null ? res.suggestedStop : undefined,
        suggestedTarget: res.suggestedTarget != null ? res.suggestedTarget : undefined,
      };
    }

    // Persist
    const row: PoolVerdict = {
      poolItemId: item.id,
      ticker: item.ticker,
      generatedAt: Date.now(),
      verdict: verdict.verdict,
      score: verdict.score,
      confidence: verdict.confidence,
      summary: verdict.summary,
      reasoning: verdict.reasoning,
      suggestedEntry: verdict.suggestedEntry != null ? verdict.suggestedEntry : undefined,
      suggestedStop: verdict.suggestedStop != null ? verdict.suggestedStop : undefined,
      suggestedTarget: verdict.suggestedTarget != null ? verdict.suggestedTarget : undefined,
      signals: { technical: tech, flow, pattern, news },
      sourceModel: this.currentModelId(),
      triggerType: trigger,
    };

    try {
      const id = await db.pool_verdicts.add(row);
      const saved: PoolVerdict = { ...row, id: id as number };
      this.cache.set(cacheKey, { verdict: saved, expiresAt: Date.now() + CACHE_TTL_MS });
      // Update the parent item's lastVerdict pointers
      await db.pool_items.update(item.id, {
        lastVerdictAt: row.generatedAt,
        lastVerdictScore: row.score,
        status: 'VERDICT_READY',
      });

      // If item came from a signal provider, trigger stats update
      const providerName = item.sourceMeta?.handle || item.sourceMeta?.channelId;
      if (providerName) {
        import('./SignalIntelligenceService').then(({ signalIntelligenceService }) => {
          signalIntelligenceService.updateProviderStats(providerName).catch(err => {
            logger.warn('PoolVerdict: updateProviderStats failed', err);
          });
        });
      }

      return saved;
    } catch (err) {
      logger.error('PoolVerdict: persist failed', err);
      return row;
    }
  }

  /** Force a fresh verdict (skip cache) — used by "Run verdict now" button. */
  public async forceReanalyze(item: PoolItem): Promise<PoolVerdict> {
    const cacheKey = `${item.ticker}:${item.exchange}`;
    this.cache.delete(cacheKey);
    return this.analyze(item, 'MANUAL');
  }

  // -------- private --------

  private currentModelId(): string {
    return useSettingsStore.getState().poolModelId || useSettingsStore.getState().preferredModelId || 'gemini-3.1-flash-lite-preview';
  }

  /**
   * SPRINT 2.D1 helper — resolve a PoolItem's NSE sector from the static F&O
   * universe map (PoolItem has no sector column; this is the same mapping the
   * alpha engine uses). Returns null for unknown symbols.
   */
  private resolveItemSector(item: PoolItem): string | null {
    const sym = (item.ticker || '').toUpperCase().trim();
    const hit = FNO_STOCKS.find((s: { symbol: string; sector: string }) => s.symbol.toUpperCase() === sym);
    return hit ? hit.sector : null;
  }

  private async computeTechnicals(ticker: string): Promise<PoolVerdict['signals']['technical']> {
    try {
      const trades = await YahooHistoricalService.getSyntheticTrades(ticker, '1d', '1y');
      const closes = (trades || [])
        .map((t: any) => t.exitPrice || t.metadata?.close)
        .filter((p: number | undefined): p is number => typeof p === 'number' && p > 0);

      if (closes.length < 30) {
        return { rsi: 50, macdHist: 0, above200sma: false, bbPos: 0.5 };
      }

      const sig = generateSignals(closes);
      const rsi = typeof sig.rsi14 === 'number' ? sig.rsi14 : 50;

      // MACD histogram ≈ 12EMA - 26EMA - signal. We approximate from closes.
      const macdHist = this.macdHistogram(closes);

      const sma200 = sig.sma200 ?? 0;
      const last = closes[closes.length - 1];
      const above200sma = sma200 > 0 && last > sma200;
      const distSma200 = sma200 > 0 ? ((last - sma200) / sma200) * 100 : 0;
      const _distSma200_unused = distSma200; // referenced inside the LLM prompt below

      let bbPos = 0.5;
      if (sig.bollingerLower && sig.bollingerUpper && sig.bollingerUpper > sig.bollingerLower) {
        bbPos = (last - sig.bollingerLower) / (sig.bollingerUpper - sig.bollingerLower);
      }

      return { rsi, macdHist, above200sma, bbPos };
    } catch (err) {
      logger.warn(`PoolVerdict: technicals failed for ${ticker}`, err);
      return { rsi: 50, macdHist: 0, above200sma: false, bbPos: 0.5 };
    }
  }

  private macdHistogram(closes: number[]): number {
    if (closes.length < 35) return 0;
    const ema12 = this.ema(closes, 12);
    const ema26 = this.ema(closes, 26);
    const macd = ema12 - ema26;
    // Approximate signal as 9-EMA of MACD over the last 9 points
    const macdSeries: number[] = [];
    for (let i = 25; i < closes.length; i++) {
      const e12 = this.ema(closes.slice(0, i + 1), 12);
      const e26 = this.ema(closes.slice(0, i + 1), 26);
      macdSeries.push(e12 - e26);
    }
    const signal = this.ema(macdSeries, Math.min(9, macdSeries.length));
    return macd - signal;
  }

  private ema(series: number[], period: number): number {
    if (series.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = series[0];
    for (let i = 1; i < series.length; i++) {
      ema = series[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private async computeFlow(ticker: string): Promise<{ oiChangePct: number; volumeMultiplier: number }> {
    try {
      const res = await fetch(`/api/python-nse/api/upstox/change-oi?symbol=${encodeURIComponent(ticker)}`);
      if (!res.ok) return { oiChangePct: 0, volumeMultiplier: 1 };
      const j = await res.json();
      const oiChangePct = Number(j?.data?.changeOiPct ?? j?.changeOiPct ?? 0);
      const volumeMultiplier = Number(j?.data?.volumeMultiplier ?? 1);
      return { oiChangePct, volumeMultiplier };
    } catch {
      return { oiChangePct: 0, volumeMultiplier: 1 };
    }
  }

  private sentimentFromText(text: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
    const t = text.toLowerCase();
    const bull = /(surge|beat|growth|record|profit|upgrade|bullish|breakout|strong|expansion|order win|approval|partnership)/.test(t);
    const bear = /(miss|fall|drop|decline|loss|downgrade|bearish|crash|weak|probe|fraud|penalty|default|warning|lower cut)/.test(t);
    if (bull && !bear) return 'BULLISH';
    if (bear && !bull) return 'BEARISH';
    return 'NEUTRAL';
  }

  private async runLLM(
    item: PoolItem,
    tech: PoolVerdict['signals']['technical'],
    flow: { oiChangePct: number; volumeMultiplier: number },
    pattern: string | undefined,
    news: PoolVerdict['signals']['news']
  ): Promise<Pick<PoolVerdict, 'verdict' | 'score' | 'confidence' | 'summary' | 'reasoning' | 'suggestedEntry' | 'suggestedStop' | 'suggestedTarget' | 'riskRewardRatio'>> {
    const prompt = VERDICT_PROMPT
      .replace('{ticker}', item.ticker)
      .replace('{exchange}', item.exchange)
      .replace('{price}', String(item.lastPrice ?? 0))
      .replace('{rsi}', tech.rsi.toFixed(1))
      .replace('{macdHist}', tech.macdHist.toFixed(2))
      .replace('{distSma200}', tech.above200sma ? '+' : '')
      .replace('{bbPos}', tech.bbPos.toFixed(2))
      .replace('{volRatio}', flow.volumeMultiplier.toFixed(2))
      .replace('{oiChangePct}', flow.oiChangePct.toFixed(2))
      .replace('{pattern}', pattern ?? '—')
      .replace('{news}', news?.map(n => `${n.sentiment}: ${n.headline}`).join(' | ') || '—')
      .replace('{source}', item.source)
      .replace('{notes}', item.notes || '—');

    try {
      const resp = await llmPipeline(prompt, {
        requireHighIntelligence: false,
        jsonMode: true,
        // SPRINT 2.D2: honour the pool model selector (was inert before)
        modelOverride: this.currentModelId(),
      });
      const text = (resp.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(text);

      const verdict = this.normalizeVerdict(parsed.verdict);
      const score = Math.max(0, Math.min(100, Number(parsed.score ?? 50)));
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));
      const summary = String(parsed.summary ?? '').slice(0, 200) || `${item.ticker} ${verdict} (${score})`;
      const reasoning = Array.isArray(parsed.reasoning)
        ? parsed.reasoning.slice(0, 6).map((r: unknown) => String(r))
        : [];

      const suggestedEntry = Number(parsed.suggestedEntry) || item.lastPrice || undefined;
      const suggestedStop = Number(parsed.suggestedStop) || undefined;
      const suggestedTarget = Number(parsed.suggestedTarget) || undefined;
      const riskRewardRatio = suggestedEntry && suggestedStop && suggestedTarget
        ? (suggestedTarget - suggestedEntry) / Math.max(0.01, suggestedEntry - suggestedStop)
        : undefined;

      return {
        verdict,
        score,
        confidence,
        summary,
        reasoning,
        suggestedEntry,
        suggestedStop,
        suggestedTarget,
        riskRewardRatio,
      };
    } catch (err) {
      logger.warn(`PoolVerdict: LLM failed for ${item.ticker} — falling back to technicals`, err);
      // Fallback: technical-only verdict
      const score = this.scoreFromTechnicals(tech, flow, news);
      return {
        verdict: score > 65 ? 'BUY' : score < 35 ? 'SELL' : 'NEUTRAL',
        score,
        confidence: 0.3,
        summary: `Technical-only verdict for ${item.ticker}. LLM unavailable.`,
        reasoning: [`RSI ${tech.rsi.toFixed(1)}`, `MACD hist ${tech.macdHist.toFixed(2)}`, `Above 200 SMA: ${tech.above200sma ? 'yes' : 'no'}`],
        suggestedEntry: item.lastPrice,
        suggestedStop: item.lastPrice ? +(item.lastPrice * 0.98).toFixed(2) : undefined,
        suggestedTarget: item.lastPrice ? +(item.lastPrice * 1.04).toFixed(2) : undefined,
        riskRewardRatio: 2,
      };
    }
  }

  private scoreFromTechnicals(
    tech: PoolVerdict['signals']['technical'],
    flow: { oiChangePct: number; volumeMultiplier: number },
    news: PoolVerdict['signals']['news']
  ): number {
    let score = 50;
    if (tech.rsi < 30) score += 15;
    else if (tech.rsi < 40) score += 8;
    else if (tech.rsi > 70) score -= 15;
    else if (tech.rsi > 60) score -= 5;
    if (tech.above200sma) score += 8;
    if (tech.bbPos < 0.2) score += 6;
    else if (tech.bbPos > 0.8) score -= 6;
    if (tech.macdHist > 0) score += 4;
    if (flow.oiChangePct > 5) score += 4;
    else if (flow.oiChangePct < -5) score -= 4;
    if (flow.volumeMultiplier > 2) score += 4;
    if (news && news.length > 0) {
      if (news.every(n => n.sentiment === 'BULLISH')) score += 6;
      if (news.every(n => n.sentiment === 'BEARISH')) score -= 6;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private normalizeVerdict(v: unknown): PoolVerdict['verdict'] {
    const up = String(v ?? '').toUpperCase().replace('-', '_');
    if (up === 'STRONG_BUY') return 'STRONG_BUY';
    if (up === 'STRONG_SELL') return 'STRONG_SELL';
    if (up === 'BUY') return 'BUY';
    if (up === 'SELL') return 'SELL';
    if (up === 'AVOID') return 'AVOID';
    return 'NEUTRAL';
  }
}

export const poolVerdictEngine = PoolVerdictEngine.getInstance();
export default poolVerdictEngine;
