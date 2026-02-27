/**
 * AmbientAIBrain — Central intelligence singleton.
 *
 * Merges all user data (trades, mistakes, portfolio, IPOs, goals)
 * with live market context and runs AI analysis per tab.
 * Results are cached per-tab (5 min TTL) to minimize API cost.
 */

import { Investment } from '../types';
import { llmPipeline } from './llm';
import { MarketPulseService, MarketPulse } from './MarketPulseService';
import { buildAmbientAIContext } from './AIContextService';
import { useSettingsStore } from '../store/settingsStore';
import { AstroPsychologyService } from './AstroPsychologyService';
import { TabContextInjector } from './TabContextInjector';

export type TabName =
    | 'dashboard'
    | 'portfolio'
    | 'journal'
    | 'ipo'
    | 'market'
    | 'growth'
    | 'academy'
    | 'momentum'
    | 'backtester'
    | 'alpha'
    | 'analytics'
    | 'trading';

export interface AIInsight {
    id: string;
    severity: 'critical' | 'warning' | 'positive' | 'info';
    title: string;
    body: string;
    action?: string; // CTA label
    actionTab?: string; // Tab to navigate to
}

export interface TabAIResult {
    tab: TabName;
    insights: AIInsight[];
    coachMessage: string; // 1-sentence directive
    tradeSignal?: 'go' | 'caution' | 'stop';
    tradeSignalReason?: string;
    model?: string; // Which model generated this result
    fetchedAt: number;
}

interface CacheEntry {
    result: TabAIResult;
    fetchedAt: number;
}

const CACHE_TTL_MAP: Record<TabName, number> = {
    dashboard: 30 * 60 * 1000,   // 30 mins
    portfolio: 2 * 60 * 60 * 1000, // 2 hours
    journal: 60 * 60 * 1000,     // 1 hour
    ipo: 6 * 60 * 60 * 1000,      // 6 hours
    market: 30 * 60 * 1000,      // 30 mins
    growth: 6 * 60 * 60 * 1000,    // 6 hours
    academy: 12 * 60 * 60 * 1000,  // 12 hours
    momentum: 60 * 60 * 1000,      // 1 hour
    backtester: 2 * 60 * 60 * 1000, // 2 hours
    alpha: 2 * 60 * 60 * 1000,     // 2 hours
    analytics: 60 * 60 * 1000,     // 1 hour
    trading: 30 * 60 * 1000        // 30 mins
};
const STORAGE_KEY = 'ambient_ai_cache';

const cache = new Map<string, CacheEntry>();
const pendingFetches = new Set<string>(); // Use string key (tab + hash)
// Per-tab failure-warning cooldown (see catch block in getInsights)
const failCooldown = new Map<string, { lastWarnAt: number; silentCount: number }>();
let circuitBreakerTrippedUntil = 0;

import { alphaCache } from '../lib/alphaCache';

// Initialize cache from alphaCache
async function loadCacheFromPersistent() {
    try {
        const cached = await alphaCache.get(STORAGE_KEY);
        if (cached && !cached.isStale) {
            Object.entries(cached.data).forEach(([key, value]) => {
                const entry = value as CacheEntry;
                cache.set(key, entry);
            });
        }
    } catch (err: unknown) {
        console.warn('[AmbientAIBrain] Failed to load cache from alphaCache', err);
    }
}

async function saveCacheToPersistent() {
    try {
        const data: Record<string, CacheEntry> = {};
        cache.forEach((value, key) => {
            data[key] = value;
        });
        await alphaCache.set(STORAGE_KEY, data, 24); // 24 hour persistence
    } catch (err: unknown) {
        console.warn('[AmbientAIBrain] Failed to save cache to alphaCache', err);
    }
}

loadCacheFromPersistent();

// ─── Context Builder ──────────────────────────────────────────────────────────

async function buildUnifiedContext(
    investments: Investment[],
    totalNetWorth: string,
    tab: TabName,
    tabLiveContext: string
): Promise<string> {
    const ambientContext = await buildAmbientAIContext(investments, totalNetWorth);
    const marketPulse: MarketPulse = await MarketPulseService.getPulse();
    const { astroProfile, isAstroPsychologyEnabled } = useSettingsStore.getState();
    const astroStats = isAstroPsychologyEnabled ? await AstroPsychologyService.getTodayAstroStats() : null;

    const lines: string[] = [
        `=== CTX: ${tab.toUpperCase()} ===`,
        (isAstroPsychologyEnabled && (tab === 'dashboard' || tab === 'journal')) ? [
            `ASTRO: ${astroProfile.lagna}, SAT:${astroProfile.disciplineStrength}, RAH:${astroProfile.tradingShadow}`,
            `STATS: T:${astroStats?.todayTradeCount}/${astroProfile.maxTradesPerDay}, F:₹${astroStats?.todayFees}, RI:${astroStats?.rahuIntensity}, SI:${astroStats?.saturnStrength}, S:${astroStats?.isInsideShadow ? 'SHADOW' : 'OK'}`
        ].join('\n') : "ASTRO: OFF",
        tabLiveContext,
        ambientContext.text,
        `--- MKT ---`,
        `Nifty: ${marketPulse.niftyTrend}, FII: ${marketPulse.fiiFlow}`,
        `Hot: ${marketPulse.hotSectors.join(',') || 'N/A'}, Avoid: ${marketPulse.avoidSectors.join(',') || 'N/A'}`,
        `Risk: ${marketPulse.geopoliticalRisk}, Head: ${marketPulse.headline}`,
        `Rec: ${marketPulse.tradingRecommendation}`,
    ];

    return lines.join('\n');
}

// ─── Prompt Builder per Tab ────────────────────────────────────────────────────

function buildTabPrompt(tab: TabName, context: string): string {
    const baseInstruction = `ROLE: "The Architect" (Elite Quant & Psychologist).
1. ANALYZE: Use CTX to find hidden risks.
2. SURGICAL: No generic advice. Use specific tickers/numbers.
3. BEHAVIOR: Enforce Saturnian discipline if Rahu Intensity > 60.
4. TONE: Professional, skeptical, data-obsessed.

JSON ONLY:
{
  "coachMessage": "surgical directive",
  "tradeSignal": "go|caution|stop",
  "tradeSignalReason": "1-sentence logic",
  "insights": [{"id": "id", "severity": "crit|warn|pos|info", "title": "title", "body": "body (max 2 sentences, include numbers)", "action": "cta", "actionTab": "tab"}]
}`;

    const tabFocus: Record<TabName, string> = {
        dashboard: 'Today\'s P&L vs goals, sector momentum risks.',
        portfolio: 'Concentration risks (tickers), rebalancing holdings > 20%.',
        journal: 'Pattern analysis, streaks, emotional state.',
        ipo: 'Capital efficiency, overdue IPOs, GMP quality.',
        market: 'Portfolio alignment, FII/DII divergence, sector rotation.',
        growth: 'Goal velocity, savings rate gap.',
        academy: 'Mistake-to-lesson mapping, skill gaps.',
        momentum: 'Breakouts, volume spikes, strict SL rules.',
        backtester: 'Performance metrics, Sharpe ratio, drawdowns.',
        alpha: 'Pattern alerts, accumulation signals, conviction scores.',
        analytics: 'Options Greeks, IV surface, Max Pain, correlation.',
        trading: 'Execution setups, intraday S/R, circuit breakers.'
    };

    return `${baseInstruction}\nFOCUS: ${tabFocus[tab]}\nCTX:\n${context}`;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseTabResult(raw: string, tab: TabName): TabAIResult {
    try {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) throw new Error('No JSON found');
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return {
            tab,
            insights: parsed.insights || [],
            coachMessage: parsed.coachMessage || 'Analyzing your data...',
            tradeSignal: parsed.tradeSignal,
            tradeSignalReason: parsed.tradeSignalReason,
            fetchedAt: Date.now(),
        };
    } catch {
        return {
            tab,
            insights: [{
                id: 'parse-error',
                severity: 'info',
                title: 'AI Analysis Loading',
                body: 'Your personalized analysis is being prepared. This may take a moment.',
            }],
            coachMessage: 'Analyzing your portfolio and trading patterns...',
            fetchedAt: Date.now(),
        };
    }
}

// ─── Main Brain API ───────────────────────────────────────────────────────────

export const AmbientAIBrain = {
    /**
     * Get AI insights for a specific tab.
     * Returns cached result immediately if fresh, otherwise fetches in background.
     * onUpdate is called when fresh data arrives.
     */
    async getInsights(
        tab: TabName,
        investments: Investment[],
        totalNetWorth: string,
        onUpdate?: (result: TabAIResult) => void,
        attempt: number = 0,
        force: boolean = false
    ) {
        const {
            modelGeneralId,
            modelCoachId,
            modelInsightsId,
            modelAlphaEngineId,
            modelMacroPulseId,
            modelJournalId,
            preferredModelId
        } = useSettingsStore.getState();


        // Strategy: Map specific tabs to their configured AI Engine models
        let primaryModel = preferredModelId || 'gemini-3.1-flash-lite-preview';

        if (tab === 'dashboard') primaryModel = modelCoachId || primaryModel;
        else if (tab === 'portfolio') primaryModel = modelInsightsId || primaryModel;
        else if (tab === 'journal') primaryModel = modelJournalId || primaryModel;
        else if (tab === 'growth') primaryModel = modelAlphaEngineId || primaryModel;
        else if (tab === 'market') primaryModel = modelMacroPulseId || primaryModel;
        else primaryModel = modelGeneralId || primaryModel;

        // Auto-migration: Redirect discontinued legacy models to new 3.1 versions
        if (primaryModel.includes('1.5')) {
            primaryModel = primaryModel.replace('1.5', '3.1');
            if (!primaryModel.endsWith('-preview')) primaryModel += '-preview';
        }

        // Create a unique key for this specific context (tab + model + investments + networth)
        const contextHash = JSON.stringify({
            model: primaryModel, // Changing model should invalidate cache!
            investmentsCount: investments.length,
            totalNetWorth,
            ids: investments.map(i => i.id).sort().join(',')
        });
        const cacheKey = `${tab}:${contextHash}`;

        if (force) {
            circuitBreakerTrippedUntil = 0;
            AmbientAIBrain.invalidateTab(tab);
        }

        const cached = cache.get(cacheKey);
        const now = Date.now();
        const ttl = CACHE_TTL_MAP[tab] || 3600000;

        if (!force && cached && now - cached.fetchedAt < ttl) {
            if (onUpdate) onUpdate(cached.result);
            return cached.result;
        }

        if (!force && onUpdate && cached) {
            onUpdate(cached.result); // Return stale while fetching fresh
        }

        // Circuit breaker check: if previous call failed, don't spam requests across tabs
        if (!force && now < circuitBreakerTrippedUntil) {
            return cached?.result || {
                tab,
                insights: [],
                coachMessage: 'AI services temporarily in backoff cooldown. Click refresh in settings to retry.',
                fetchedAt: 0,
            };
        }

        if (pendingFetches.has(cacheKey) && attempt === 0) {
            return cached?.result || {
                tab, insights: [], coachMessage: 'Analyzing...', fetchedAt: 0
            };
        }

        pendingFetches.add(cacheKey);

        // Select model based on attempt depth
        const currentModel = primaryModel;

        // Fire async fetch
        (async () => {
            const timeoutId = setTimeout(() => {
                if (pendingFetches.has(cacheKey)) {
                    console.warn(`[AmbientAIBrain] Tab ${tab} attempt timed out`);
                    pendingFetches.delete(cacheKey);
                }
            }, 25000); // 25s safety timeout

            try {
                const tabLiveContext = await TabContextInjector.build(tab, investments);
                const context = await buildUnifiedContext(investments, totalNetWorth, tab, tabLiveContext);
                const prompt = buildTabPrompt(tab, context);

                const options: Parameters<typeof llmPipeline>[1] = {
                    jsonMode: true,
                    noCache: force
                };
                if (currentModel) {
                    options.modelOverride = currentModel;
                }

                const response = await llmPipeline(prompt, options);

                clearTimeout(timeoutId);
                circuitBreakerTrippedUntil = 0; // reset circuit breaker on success
                const result = parseTabResult(response.text, tab);
                const modelUsed = response.modelId || currentModel;
                if (modelUsed) {
                    result.model = modelUsed; // Tag the result with the model used
                }
                const entry = { result, fetchedAt: Date.now() };
                cache.set(cacheKey, entry);
                saveCacheToPersistent();
                if (onUpdate) onUpdate(result);
                pendingFetches.delete(cacheKey);
            } catch (err: unknown) {
                clearTimeout(timeoutId);
                const message = err instanceof Error ? err.message : String(err);

                // Trip circuit breaker for 10 minutes to prevent repeat storms on tab switching
                circuitBreakerTrippedUntil = Date.now() + 10 * 60 * 1000;

                const cd = failCooldown.get(tab);
                if (!cd || now - cd.lastWarnAt > 10 * 60 * 1000) {
                    console.warn(`[AmbientAIBrain] Tab ${tab} failed (Model: ${currentModel}):`, message, cd?.silentCount ? `(+${cd.silentCount} suppressed since last warning)` : '');
                    failCooldown.set(tab, { lastWarnAt: now, silentCount: 0 });
                } else {
                    cd.silentCount++;
                }
                pendingFetches.delete(cacheKey);

                // Note: llmPipeline already manages multi-candidate failover internally.
                // Do not recurse here to prevent multiplying failures by N attempts.
                if (onUpdate) onUpdate({
                    tab,
                    insights: [{
                        id: 'ai-error',
                        severity: 'critical',
                        title: 'Intelligence Pipeline Offline',
                        body: 'All AI models failed to respond. Please check your internet connection or API keys in Settings.',
                    }],
                    coachMessage: 'AI services are currently unavailable. Check your configuration.',
                    fetchedAt: Date.now()
                });
            }
        })();

        return cached?.result || {
            tab,
            insights: [],
            coachMessage: 'Analyzing your data...',
            fetchedAt: 0,
        };
    },

    invalidateTab(tab: TabName) {
        // Clear all entries starting with this tab name
        cache.forEach((_, key) => {
            if (key.startsWith(`${tab}:`)) {
                cache.delete(key);
            }
        });
        saveCacheToPersistent();
    },

    invalidateAll() {
        cache.clear();
        saveCacheToPersistent();
    },

    getCached(tab: TabName): TabAIResult | null {
        // Since keys are now complex, we find the first entry matching this tab
        // that hasn't expired. This is just a fallback for immediate UI lookups.
        let result: TabAIResult | null = null;
        cache.forEach((entry, key) => {
            if (key.startsWith(`${tab}:`) && !result) {
                const ttl = CACHE_TTL_MAP[tab] || 3600000;
                if (Date.now() - entry.fetchedAt < ttl) {
                    result = entry.result;
                }
            }
        });
        return result;
    }
};
