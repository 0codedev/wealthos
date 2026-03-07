import { AIProvider } from "../../types/ai";

export interface ModelMetadata {
  id: string;
  name: string;
  provider: AIProvider;
  bestFor: string;
  contextWindow?: number;
  supportsJsonMode?: boolean;
  isHighIntelligence?: boolean;
  isFree?: boolean;
}

export const MODEL_REGISTRY: ModelMetadata[] = [
  // --- GOOGLE NATIVE MODELS (Primary Tier) ---
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "gemini",
    bestFor: "Complex reasoning, coding, math, STEM",
    isHighIntelligence: true,
    supportsJsonMode: true
  },
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    provider: "gemini",
    bestFor: "Multimodal reasoning, speed",
    supportsJsonMode: true
  },
  {
    id: "gemini-3.1-flash-lite-preview",
    name: "Gemini 3.1 Flash Lite",
    provider: "gemini",
    bestFor: "Ultra-fast, low latency (Primary Fallback)",
    supportsJsonMode: true
  },
  {
    id: "gemini-3.1-flash-image-preview",
    name: "Gemini 3.1 Flash Image",
    provider: "gemini",
    bestFor: "High-quality image generation"
  },
  {
    id: "gemini-3-pro-image-preview",
    name: "Gemini 3 Pro Image",
    provider: "gemini",
    bestFor: "High-quality image generation",
    isHighIntelligence: true
  },
  {
    id: "gemini-2.5-flash-preview-tts",
    name: "Gemini 2.5 Flash TTS",
    provider: "gemini",
    bestFor: "Text-to-speech generation"
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "gemini",
    bestFor: "Multimodal workhorse",
    supportsJsonMode: true
  },
  {
    id: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "gemini",
    bestFor: "Ultra-fast, low latency",
    supportsJsonMode: true
  },
  {
    id: "gemma-3-27b",
    name: "Gemma 3 27B",
    provider: "gemini",
    bestFor: "Open weights reasoning (14,400 req/day)",
    isHighIntelligence: true,
    supportsJsonMode: true
  },
  {
    id: "gemma-3-12b",
    name: "Gemma 3 12B",
    provider: "gemini",
    bestFor: "Balanced reasoning, high limits (14,400 req/day)",
    supportsJsonMode: true
  },
  {
    id: "gemma-3-4b",
    name: "Gemma 3 4B",
    provider: "gemini",
    bestFor: "Fast efficiency, high limits (14,400 req/day)",
    supportsJsonMode: true
  },
  {
    id: "gemma-3-1b",
    name: "Gemma 3 1B",
    provider: "gemini",
    bestFor: "Ultra-fast micro tasks, high limits (14,400 req/day)",
    supportsJsonMode: true
  },
  {
    id: "gemma-4-31b",
    name: "Gemma 4 31B",
    provider: "gemini",
    bestFor: "Next-gen open weights reasoning (1,500 req/day)",
    isHighIntelligence: true,
    supportsJsonMode: true
  },
  {
    id: "gemma-4-26b",
    name: "Gemma 4 26B",
    provider: "gemini",
    bestFor: "Next-gen open weights reasoning (1,500 req/day)",
    supportsJsonMode: true
  },

  // --- GROQ MODELS (Ultra-Fast Tier) ---
  {
    id: "llama-3.3-70b-versatile",
    name: "Llama 3.3 70B",
    provider: "groq",
    bestFor: "GPT-4 class intelligence, speed",
    isHighIntelligence: true,
    supportsJsonMode: true
  },
  {
    id: "deepseek-r1-distill-llama-70b",
    name: "DeepSeek R1 Distill",
    provider: "groq",
    bestFor: "Strong reasoning",
    isHighIntelligence: true
  },
  {
    id: "llama-3.1-8b-instant",
    name: "Llama 3.1 8B",
    provider: "groq",
    bestFor: "Instant response (UI interaction)",
    supportsJsonMode: true
  },
  {
    id: "gemma2-9b-it",
    name: "Gemma 2 9B",
    provider: "groq",
    bestFor: "Balanced open model"
  },
  {
    id: "meta-llama/llama-4-maverick-17b-128e-instruct",
    name: "Llama 4 Maverick 17B",
    provider: "groq",
    bestFor: "Next-gen preview",
    isHighIntelligence: true
  },
  {
    id: "moonshotai/kimi-k2-instruct",
    name: "Kimi K2 Instruct",
    provider: "groq",
    bestFor: "High context"
  },
  {
    id: "qwen/qwen3-32b",
    name: "Qwen 3 32B",
    provider: "groq",
    bestFor: "Advanced reasoning",
    isHighIntelligence: true
  },

  // --- OPENROUTER MODELS (Free Tier) ---
  { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (Free)", provider: "openrouter", bestFor: "Reasoning", isFree: true },
  { id: "minimax/minimax-m2.5:free", name: "MiniMax M2.5", provider: "openrouter", bestFor: "General", isFree: true },
  { id: "stepfun/step-3.5-flash:free", name: "Step 3.5 Flash", provider: "openrouter", bestFor: "Fast", isFree: true },
  { id: "arcee-ai/trinity-large-preview:free", name: "Trinity Large Preview", provider: "openrouter", bestFor: "Intelligence", isFree: true, isHighIntelligence: true },
  { id: "liquid/lfm-2.5-1.2b-thinking:free", name: "LiquidAI LFM2.5-Thinking", provider: "openrouter", bestFor: "Logic", isFree: true },
  { id: "liquid/lfm-2.5-1.2b-instruct:free", name: "LiquidAI LFM2.5-Instruct", provider: "openrouter", bestFor: "Instruction", isFree: true },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free", name: "NVIDIA Nemotron 3 Nano", provider: "openrouter", bestFor: "Efficiency", isFree: true },
  { id: "arcee-ai/trinity-mini:free", name: "Trinity Mini", provider: "openrouter", bestFor: "Efficiency", isFree: true },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free", name: "Qwen3 Next 80B", provider: "openrouter", bestFor: "High Intelligence", isFree: true, isHighIntelligence: true },
  { id: "nvidia/nemotron-nano-9b-v2:free", name: "NVIDIA Nemotron Nano 9B", provider: "openrouter", bestFor: "Edge", isFree: true },
  { id: "z-ai/glm-4.5-air:free", name: "Z.ai GLM 4.5 Air", provider: "openrouter", bestFor: "General", isFree: true },
  { id: "qwen/qwen3-coder-480b-a35b:free", name: "Qwen3 Coder 480B", provider: "openrouter", bestFor: "Coding", isFree: true, isHighIntelligence: true },
  { id: "venice/uncensored:free", name: "Venice Uncensored", provider: "openrouter", bestFor: "Privacy", isFree: true },
  { id: "google/gemma-3n-2b:free", name: "Google Gemma 3n 2B", provider: "openrouter", bestFor: "Fast", isFree: true },
  { id: "google/gemma-3n-4b:free", name: "Google Gemma 3n 4B", provider: "openrouter", bestFor: "Balanced", isFree: true },
  { id: "qwen/qwen3-4b:free", name: "Qwen3 4B", provider: "openrouter", bestFor: "Fast", isFree: true },
  { id: "mistralai/mistral-small-3.1-24b:free", name: "Mistral Small 3.1 24B", provider: "openrouter", bestFor: "Balanced", isFree: true },
  { id: "google/gemma-3-4b:free", name: "Google Gemma 3 4B", provider: "openrouter", bestFor: "Efficiency", isFree: true },
  { id: "google/gemma-3-12b:free", name: "Google Gemma 3 12B", provider: "openrouter", bestFor: "Balanced", isFree: true },
  { id: "google/gemma-3-27b:free", name: "Google Gemma 3 27B", provider: "openrouter", bestFor: "High Intelligence", isFree: true, isHighIntelligence: true },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Meta Llama 3.3 70B", provider: "openrouter", bestFor: "GPT-4 Class", isFree: true, isHighIntelligence: true },
  { id: "meta-llama/llama-3.2-3b-instruct:free", name: "Meta Llama 3.2 3B", provider: "openrouter", bestFor: "Ultra-Fast", isFree: true },
  { id: "nousresearch/hermes-3-405b-instruct:free", name: "Nous Hermes 3 405B", provider: "openrouter", bestFor: "Max Intelligence", isFree: true, isHighIntelligence: true },

  // --- MISTRAL MODELS (1B Tokens/Month) ---
  { id: "codestral-latest", name: "Codestral", provider: "mistral", bestFor: "Code Generation", isFree: true, supportsJsonMode: true },
  { id: "mistral-small-latest", name: "Mistral Small", provider: "mistral", bestFor: "General Reasoner", isFree: true, supportsJsonMode: true },
  { id: "mistral-large-latest", name: "Mistral Large", provider: "mistral", bestFor: "Deep Analysis", isHighIntelligence: true, supportsJsonMode: true },

  // --- CEREBRAS MODELS (Extreme Speed) ---
  { id: "gpt-oss-120b", name: "GPT-OSS 120B", provider: "cerebras", bestFor: "Pattern Scanning", isFree: true, isHighIntelligence: true },
  { id: "llama-3.1-70b", name: "Llama 3.1 70B", provider: "cerebras", bestFor: "High-speed reasoning", isFree: true },

  // --- GITHUB MODELS (Frontier Preview) ---
  { id: "gpt-5-preview", name: "GPT-5 (Preview)", provider: "github", bestFor: "Max Intelligence", isHighIntelligence: true },
  { id: "o3-mini", name: "o3-mini", provider: "github", bestFor: "Complex Reasoning", isHighIntelligence: true, supportsJsonMode: true },
  { id: "o4-mini", name: "o4-mini", provider: "github", bestFor: "Fast Intelligence", isFree: true, supportsJsonMode: true },

  // --- CLOUDFLARE MODELS ---
  { id: "@cf/meta/llama-4-scout", name: "Llama 4 Scout", provider: "cloudflare", bestFor: "Edge Performance", isFree: true },
  
  // --- NEW GROQ MODELS (June 2026) ---
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout", provider: "groq", bestFor: "Ultra-fast reasoning", isFree: true, supportsJsonMode: true },
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq)", provider: "groq", bestFor: "GPT-quality open source", isFree: true, isHighIntelligence: true },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B (Groq)", provider: "groq", bestFor: "Fast GPT-quality", isFree: true },
  { id: "groq/compound", name: "Groq Compound", provider: "groq", bestFor: "Multi-model orchestration", isFree: true },

  { id: "inclusionai/ling-3.0-flash-fin", name: "Ling 3.0 Flash Fin", provider: "openrouter", bestFor: "Institutional Finance Reasoning & Valuation", isHighIntelligence: true, supportsJsonMode: true },
  { id: "inclusionai/ling-3.0-flash-fin:free", name: "Ling 3.0 Flash Fin (Free)", provider: "openrouter", bestFor: "Financial Analysis (Free)", isFree: true, isHighIntelligence: true, supportsJsonMode: true },
  { id: "moonshotai/kimi-k2.6:free", name: "Kimi K2.6", provider: "openrouter", bestFor: "Long-context agent tasks", isFree: true, isHighIntelligence: true },
  { id: "openai/gpt-oss-120b:free", name: "GPT-OSS 120B (OR)", provider: "openrouter", bestFor: "GPT-quality reasoning", isFree: true, isHighIntelligence: true },
  { id: "deepseek/deepseek-v4-flash:free", name: "DeepSeek V4 Flash", provider: "openrouter", bestFor: "Fast + smart", isFree: true },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B", provider: "openrouter", bestFor: "Deep reasoning", isFree: true, isHighIntelligence: true },
  { id: "poolside/laguna-m.1:free", name: "Poolside Laguna M.1", provider: "openrouter", bestFor: "Code + agent reasoning", isFree: true },
  { id: "qwen/qwen3-coder:free", name: "Qwen3-Coder", provider: "openrouter", bestFor: "Best free code model", isFree: true },

  // --- NEW CLOUDFLARE MODELS (June 2026) ---
  { id: "@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6 (CF)", provider: "cloudflare", bestFor: "Long-context", isFree: true },
  { id: "@cf/nvidia/nemotron-3-120b-a12b", name: "Nemotron 3 120B (CF)", provider: "cloudflare", bestFor: "Reasoning", isFree: true },
  { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B (CF)", provider: "cloudflare", bestFor: "GPT-quality edge", isFree: true },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B (CF)", provider: "cloudflare", bestFor: "Efficient reasoning", isFree: true },

  // --- NEW GOOGLE GEMINI 3.x MODELS (June 2026) ---
  { id: "gemini-3.5-flash-latest", name: "Gemini 3.5 Flash", provider: "gemini", bestFor: "Best reasoning + quality", isHighIntelligence: true, supportsJsonMode: true },
  { id: "gemini-3-flash-latest", name: "Gemini 3 Flash", provider: "gemini", bestFor: "Balanced quality + speed", supportsJsonMode: true },
  { id: "gemini-3.1-flash-lite-latest", name: "Gemini 3.1 Flash-Lite", provider: "gemini", bestFor: "High-volume (500/day)", supportsJsonMode: true },
  { id: "gemini-3.1-flash-tts-latest", name: "Gemini 3.1 Flash TTS", provider: "gemini", bestFor: "Text-to-speech" },

  // --- COHERE MODELS ---
  { id: "command-a-plus-05-2026", name: "Command A+ (Cohere)", provider: "cohere", bestFor: "Reasoning + translation", isFree: true },
  { id: "command-a-reasoning-08-2025", name: "Command A Reasoning", provider: "cohere", bestFor: "Chain-of-thought", isFree: true },

  // --- OMNIROUTE UNIFIED AI GATEWAY MODELS (290+ Providers, 90+ Free) ---
  { id: "auto", name: "OmniRoute Auto-Router (Balanced)", provider: "omniroute", bestFor: "Auto-routes across 290+ providers (LKGP)", isHighIntelligence: true, isFree: true, supportsJsonMode: true },
  { id: "auto/coding", name: "OmniRoute Auto-Coding", provider: "omniroute", bestFor: "Quality-first code generation across top models", isHighIntelligence: true, isFree: true, supportsJsonMode: true },
  { id: "auto/fast", name: "OmniRoute Auto-Fast", provider: "omniroute", bestFor: "Lowest latency response", isFree: true, supportsJsonMode: true },
  { id: "auto/cheap", name: "OmniRoute Auto-Cheap", provider: "omniroute", bestFor: "Lowest token cost", isFree: true, supportsJsonMode: true },
  { id: "auto/offline", name: "OmniRoute Auto-Headroom", provider: "omniroute", bestFor: "Max quota headroom", isFree: true, supportsJsonMode: true },
  { id: "free-first", name: "OmniRoute Free-First Cascade", provider: "omniroute", bestFor: "Drains free providers before API keys", isFree: true, supportsJsonMode: true }
];

export const DEFAULT_MODELS = {
  highInt: "gemini-3.5-flash-latest",        // Best quality (was: gemini-3.1-pro-preview)
  speed: "gemini-3.1-flash-lite-latest",     // 500/day quota (was: llama-3.1-8b-instant)
  fallback: "mistral-small-latest",          // Virtually unlimited
  vision: "gemini-3-flash-latest",           // For image/chart analysis
  code: "qwen/qwen3-coder:free",             // Best free coder
  batch: "gpt-oss-120b"                      // Cerebras — 14,400/day
};
