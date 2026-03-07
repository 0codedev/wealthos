import { useSettingsStore } from "../../store/settingsStore";
import { logger } from "../Logger";
import { AIProvider, AIResponseWithMetadata } from "../../types/ai";
import { MODEL_REGISTRY, DEFAULT_MODELS, ModelMetadata } from "./models";
import { generateGemini, generateOpenAI, generateCohere, GenerationOptions, LLMResponse } from "./providers";
import { secureApiKeyStorage } from "../../utils/Encryption";
import { KeyPoolManager } from "./keyPool";
import { QuotaTracker } from "./quotaTracker";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

import { alphaCache } from "../../lib/alphaCache";

// --- CACHE & DEDUPLICATION ---
const llmInMemCache = new Map<string, { response: AIResponseWithMetadata, expires: number }>();
const pendingRequests = new Map<string, Promise<AIResponseWithMetadata>>();
const IN_MEM_TTL = 10 * 60 * 1000; // 10 minutes
const PERSISTENT_TTL_HOURS = 24;  // 24 hours

/**
 * Agnostic Intelligent Routing (AIR) Pipeline
 */
export async function llmPipeline(
  prompt: string,
  options?: GenerationOptions & { 
    modelOverride?: string,
    requireHighIntelligence?: boolean,
    audioData?: { data: string, mimeType: string },
    noCache?: boolean
  }
): Promise<AIResponseWithMetadata> {
  const cacheKey = JSON.stringify({ prompt, options });

  // 1. Request Deduplication
  if (pendingRequests.has(cacheKey)) {
    logger.debug('AIR Pipeline: Deduplicating in-flight request', undefined, 'LLM');
    return pendingRequests.get(cacheKey)!;
  }

  // 2. Cache Lookup (In-memory)
  if (!options?.noCache) {
    const cached = llmInMemCache.get(cacheKey);
    if (cached && Date.now() < cached.expires) {
      logger.debug('AIR Pipeline: In-memory cache hit', undefined, 'LLM');
      return cached.response;
    }
  }

  // 3. Cache Lookup (Persistent)
  if (!options?.noCache) {
    try {
        const persistent = await alphaCache.get(`llm_pipe:${hashString(cacheKey)}`);
        if (persistent && !persistent.isStale) {
            logger.debug('AIR Pipeline: Persistent cache hit', undefined, 'LLM');
            return persistent.data;
        }
    } catch (err: unknown) {
        // Silent catch for cache misses/errors
    }
  }

  const requestPromise = (async () => {
    try {
      const result = await executePipeline(prompt, options);
      
      // Update Caches
      if (!options?.noCache) {
        llmInMemCache.set(cacheKey, { 
          response: result, 
          expires: Date.now() + IN_MEM_TTL 
        });
        await alphaCache.set(`llm_pipe:${hashString(cacheKey)}`, result, PERSISTENT_TTL_HOURS);
      }
      
      return result;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

async function executePipeline(
  prompt: string,
  options?: GenerationOptions & { 
    modelOverride?: string,
    requireHighIntelligence?: boolean,
    audioData?: { data: string, mimeType: string }
  }
): Promise<AIResponseWithMetadata> {
  const settings = useSettingsStore.getState();
  const start = Date.now();

  // 1. Determine Candidate models
  const candidates: ModelMetadata[] = [];

  // Priority 1: User Explicit Override for this specific call
  if (options?.modelOverride) {
    const override = MODEL_REGISTRY.find(m => m.id === options.modelOverride);
    if (override) candidates.push(override);
  }

  // Priority 2: Global User Preference from Settings
  if (settings.preferredModelId) {
    const preferred = MODEL_REGISTRY.find(m => m.id === settings.preferredModelId);
    if (preferred && !candidates.find(c => c.id === preferred.id)) {
      candidates.push(preferred);
    }
  }

  // Priority 3: Task Defaults based on intelligence requirement
  const defaultId = options?.requireHighIntelligence ? DEFAULT_MODELS.highInt : DEFAULT_MODELS.speed;
  const defaultModel = MODEL_REGISTRY.find(m => m.id === defaultId);
  if (defaultModel && !candidates.find(c => c.id === defaultModel.id)) {
    candidates.push(defaultModel);
  }

  // Priority 4: Advanced Failover Chain (Task 1.1)
  const failoverChainIds = [
    "gemini-3.5-flash-latest",                       // Google — Best quality
    "gemini-3.1-flash-lite-latest",                  // Google — 500 req/day
    "meta-llama/llama-4-scout-17b-16e-instruct",     // Groq — 1000/day, ultra-fast
    "openai/gpt-oss-120b",                           // Cerebras — 14,400/day
    "gpt-oss-120b",                                  // Cerebras fallback alias  
    "moonshotai/kimi-k2.6:free",                     // OpenRouter — long context
    "mistral-small-latest",                          // Mistral — ~unlimited
    "@cf/meta/llama-4-scout",                        // Cloudflare — edge
  ];

  for (const id of failoverChainIds) {
      const model = MODEL_REGISTRY.find(m => m.id === id);
      if (model && !candidates.find(c => c.id === model.id)) {
          candidates.push(model);
      }
  }


  // 2. Execution Loop
  let lastError: Error | null = null;
  
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const isFallback = i > 0;

    let attemptsWithProviderKeys = 0;
    const maxProviderKeyAttempts = 3; // Try up to 3 keys from the pool if available
    let skipCandidate = false;

    while (attemptsWithProviderKeys < maxProviderKeyAttempts) {
      const apiKey = getApiKeyForProvider(model.provider, settings);
      if (!apiKey) {
        logger.debug(`AIR Pipeline: Skipping ${model.name} (${model.provider}) - API key missing.`);
        skipCandidate = true;
        break;
      }

      try {
        logger.debug(`AIR Pipeline: Trying ${model.name} (${model.provider})`, { isFallback }, 'LLM');

        let response: LLMResponse;
        
        if (model.provider === 'gemini') {
          response = await generateGemini(model.id, apiKey, prompt, options);
        } else if (model.provider === 'cohere') {
          response = await generateCohere(model.id, apiKey, prompt, options);
        } else {
          let endpoint = "";
          if (model.provider === 'omniroute') {
            const base = (settings.omnirouteEndpoint || "http://localhost:20128/v1").replace(/\/+$/, '');
            endpoint = `${base}/chat/completions`;
          } else if (model.provider === 'groq') {
            endpoint = GROQ_ENDPOINT;
          } else if (model.provider === 'openrouter') {
            endpoint = OPENROUTER_ENDPOINT;
          } else if (model.provider === 'mistral') {
            endpoint = "https://api.mistral.ai/v1/chat/completions";
          } else if (model.provider === 'cerebras') {
            endpoint = "https://api.cerebras.ai/v1/chat/completions";
          } else if (model.provider === 'github') {
            endpoint = "https://models.inference.ai.azure.com/chat/completions";
          } else if (model.provider === 'cloudflare') {
            const accountId = settings.cloudflareAccountId;
            if (!accountId) {
              throw new Error("Cloudflare Account ID is missing in settings.");
            }
            endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
          } else {
            throw new Error(`Unknown provider: ${model.provider}`);
          }

          response = await generateOpenAI(model.id, apiKey, endpoint, model.provider, prompt, options);
        }

        const latency = Date.now() - start;
        const attribution = `Generated by ${model.name}${isFallback ? ' (Fallback)' : ''} via ${model.provider} in ${latency}ms`;

        // Track successful call in QuotaTracker
        QuotaTracker.getInstance().trackCall(model.id, model.provider);

        return {
          ...response,
          latency,
          isFallback,
          attribution
        };

      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const message = lastError.message;
        
        // Check if rate limit (429) or token exhaustion
        if (message.includes("429") || message.includes("quota") || message.includes("EXHAUSTED") || message.includes("RESOURCE_EXHAUSTED")) {
            QuotaTracker.getInstance().markExhausted(model.id);
        }
        
        logger.warn(`AIR Pipeline: ${model.name} (${model.provider}) key #${attemptsWithProviderKeys + 1} failed: ${message}`);
        attemptsWithProviderKeys++;
      }
    }

    if (skipCandidate) {
      continue;
    }
  }

  throw lastError || new Error("All AI models and fallbacks failed to respond.");
}

/**
 * Helper to retrieve nested API keys from settings
 */
function getApiKeyForProvider(provider: AIProvider, settings: any): string | undefined {
  // First check key pool
  const poolKey = KeyPoolManager.getInstance().getNextKey(provider);
  if (poolKey) return poolKey;

  // Fallback to legacy/individual key settings
  if (provider === 'gemini') {
    if (settings.geminiApiKey) return settings.geminiApiKey;
    try {
      const secureKey = secureApiKeyStorage.get<string>();
      if (secureKey) return secureKey.trim();
    } catch {}
    try {
      const localKey = localStorage.getItem('gemini-api-key');
      if (localKey) {
        const trimmed = localKey.trim();
        try { secureApiKeyStorage.set(trimmed); } catch {}
        try { localStorage.removeItem('gemini-api-key'); } catch {}
        return trimmed;
      }
    } catch {}
    try {
      // @ts-ignore
      if (typeof import.meta !== 'undefined' && import.meta.env) {
        const envKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY;
        if (envKey) return envKey;
      }
    } catch {}
  }

  switch (provider) {
    case 'omniroute': return settings.omnirouteApiKey || "OR-wealthos-master-key";
    case 'gemini': return settings.geminiApiKey;
    case 'groq': return settings.groqApiKey;
    case 'openrouter': return settings.openRouterApiKey;
    case 'mistral': return settings.mistralApiKey;
    case 'cerebras': return settings.cerebrasApiKey;
    case 'github': return settings.githubToken;
    case 'cloudflare': return settings.cloudflareToken;
    case 'cohere': return settings.cohereApiKey;
    default: return undefined;
  }
}
