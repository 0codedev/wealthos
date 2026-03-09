import { streamChatWithGemini } from './aiService';

export interface MarketPulse {
    niftyTrend: 'bullish' | 'bearish' | 'neutral';
    fiiFlow: 'buying' | 'selling' | 'neutral';
    hotSectors: string[];
    avoidSectors: string[];
    geopoliticalRisk: 'low' | 'medium' | 'high';
    headline: string;
    details: string;
    tradingRecommendation: 'trade' | 'reduce' | 'pause' | 'avoid';
    confidence: number;
    fetchedAt: number;
}

const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours (User requested long cache)
let cachedPulse: MarketPulse | null = null;
let isFetching = false;
let fetchListeners: ((pulse: MarketPulse) => void)[] = [];

const DEFAULT_PULSE: MarketPulse = {
    niftyTrend: 'neutral',
    fiiFlow: 'neutral',
    hotSectors: [],
    avoidSectors: [],
    geopoliticalRisk: 'low',
    headline: 'Market data loading...',
    details: 'Fetching live market context via grounded AI search.',
    tradingRecommendation: 'pause',
    confidence: 0,
    fetchedAt: 0,
};

const MARKET_PULSE_PROMPT = `You are a live Indian stock market intelligence agent. Using your real-time search access, analyze the current market state RIGHT NOW and respond ONLY with a valid JSON object.

Query these specific data points:
1. Is Nifty50 trending up, down, or sideways today?
2. Are FIIs (Foreign Institutional Investors) net buyers or sellers today?
3. Which 2-3 sectors are showing strong momentum today (hot)?
4. Which 1-2 sectors should be avoided today (weak/risky)?
5. Any major geopolitical or macro events affecting Indian markets right now? (US Fed, China, oil prices, INR/USD)
6. One headline-level summary sentence.
7. What is your overall trading recommendation: 'trade' (safe, momentum present), 'reduce' (some risk, reduce size), 'pause' (wait for clarity), 'avoid' (high risk, stay out)?

Respond ONLY with this exact JSON format (no markdown, no explanation):
{
  "niftyTrend": "bullish|bearish|neutral",
  "fiiFlow": "buying|selling|neutral",
  "hotSectors": ["sector1", "sector2"],
  "avoidSectors": ["sector1"],
  "geopoliticalRisk": "low|medium|high",
  "headline": "One sentence summary of market state",
  "details": "2-3 sentence expanded context including key data points found",
  "tradingRecommendation": "trade|reduce|pause|avoid",
  "confidence": 85
}`;

function parseMarketPulse(raw: string): MarketPulse | null {
    try {
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) return null;
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return { ...DEFAULT_PULSE, ...parsed, fetchedAt: Date.now() };
    } catch {
        return null;
    }
}

export const MarketPulseService = {
    /**
     * Gets the latest grounded market pulse. Uses cache (10 min TTL).
     * Returns immediately with cached/default while fetching in background.
     */
    async getPulse(onUpdate?: (pulse: MarketPulse) => void): Promise<MarketPulse> {
        // Return cache if fresh
        if (cachedPulse && Date.now() - cachedPulse.fetchedAt < CACHE_TTL_MS) {
            if (onUpdate) onUpdate(cachedPulse);
            return cachedPulse;
        }

        // Register listener for update
        if (onUpdate) fetchListeners.push(onUpdate);

        // If already fetching, return default and let listener handle it
        if (isFetching) return cachedPulse || DEFAULT_PULSE;

        isFetching = true;
        let fullText = '';

        const onToken = (_token: string, text: string) => { fullText = text; };

        const onComplete = (text: string) => {
            const pulse = parseMarketPulse(text);
            if (pulse) {
                cachedPulse = pulse;
                fetchListeners.forEach(fn => fn(pulse));
            }
            fetchListeners = [];
            isFetching = false;
        };

        const onError = (err: Error) => {
            if (!err.message?.includes('API_KEY_MISSING')) {
                console.warn('[MarketPulseService] Grounded fetch failed:', err.message);
            }
            // Return a fallback if we have stale cache
            const fallback = cachedPulse || { ...DEFAULT_PULSE, fetchedAt: Date.now(), headline: 'Market data temporarily unavailable.' };
            fetchListeners.forEach(fn => fn(fallback));
            fetchListeners = [];
            isFetching = false;
        };

        // Fire grounded Gemini call (non-blocking)
        streamChatWithGemini(
            'gemini-3.1-flash-lite-preview',
            [],
            MARKET_PULSE_PROMPT,
            undefined,
            onToken,
            onComplete,
            onError,
            { googleSearchGrounding: true }
        ).catch(onError);

        return cachedPulse || DEFAULT_PULSE;
    },

    /** Force-refresh ignoring cache */
    invalidateCache() {
        cachedPulse = null;
    },

    getCached(): MarketPulse | null {
        return cachedPulse;
    }
};
