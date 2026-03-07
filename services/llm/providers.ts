import { logger } from "../Logger";
import { AIProvider } from "../../types/ai";
import { withLLMCache } from "../../utils/llmCache";

export interface LLMResponse {
  text: string;
  modelId: string;
  provider: AIProvider;
  latency?: number;
}

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  jsonMode?: boolean;
  contents?: any[];
  tools?: any[];
}

// --- UTILS ---
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

async function retryWithBackoff<T>(fn: () => Promise<T>, retries = MAX_RETRIES, delay = BASE_DELAY_MS): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const err = error as any;
    if (err?.status === 401 || err?.status === 403 || retries === 0) throw error;
    logger.warn(`LLM Provider: Retrying in ${delay}ms... (${retries} left)`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryWithBackoff(fn, retries - 1, delay * 2);
  }
}

// --- PROVIDERS ---

/**
 * Native Google Gemini Adapter (using REST API via fetch)
 */
export async function generateGemini(
  modelId: string,
  apiKey: string,
  prompt: string,
  options?: GenerationOptions & { audioData?: { data: string, mimeType: string } }
): Promise<LLMResponse> {
  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const parts: any[] = [{ text: prompt }];
  
  if (options?.audioData) {
    parts.push({
      inlineData: {
        data: options.audioData.data,
        mimeType: options.audioData.mimeType
      }
    });
  }

  // Handle contents (history) correctly
  let finalContents = [];
  if (options?.contents && options.contents.length > 0) {
    finalContents = [...options.contents];
    // If audioData is present, append it to the last message if it's from user
    if (options.audioData) {
        const lastMsg = finalContents[finalContents.length - 1];
        if (!lastMsg.role || lastMsg.role === 'user') {
            lastMsg.role = 'user';
            lastMsg.parts.push({
                inlineData: {
                    data: options.audioData.data,
                    mimeType: options.audioData.mimeType
                }
            });
        }
    }
  } else {
    finalContents = [{ role: 'user', parts }];
  }

  const payload: any = {
    contents: finalContents,
    generationConfig: {
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxTokens ?? 2048,
    }
  };

  if (options?.tools) {
    payload.tools = options.tools;
  }

  if (options?.systemPrompt) {
    payload.systemInstruction = { parts: [{ text: options.systemPrompt }] };
  }

  if (options?.jsonMode) {
    payload.generationConfig.responseMimeType = "application/json";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  // CC11 — wrap the (model, prompt, options) tuple in a 5-min TTL cache.
  // Streaming, multimodal, and tool calls are excluded (audioData + tools
  // make the response non-deterministic across calls).
  const cacheable = !options?.audioData && !options?.tools;
  const fetcher = async (): Promise<LLMResponse> => {
    try {
      const responseData = await retryWithBackoff(async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!res.ok) {
          const err = await res.text();
          const error = new Error(err);
          (error as any).status = res.status;
          throw error;
        }
        return res.json();
      });

      clearTimeout(timeoutId);

      if (responseData.promptFeedback?.blockReason) {
        throw new Error(`Blocked: ${responseData.promptFeedback.blockReason}`);
      }
      if (responseData.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new Error('Blocked: SAFETY');
      }

      const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return {
        text,
        modelId,
        provider: 'gemini',
        latency: Date.now() - start
      };
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') throw new Error('AI request timed out (30s)');
      throw error;
    }
  };

  if (cacheable) {
    return withLLMCache(
      { loader: 'gemini:' + modelId, payload: { modelId, prompt, options } },
      fetcher
    );
  }
  return fetcher();
}

/**
 * Generic OpenAI-compatible Adapter (Groq, OpenRouter)
 */
export async function generateOpenAI(
  modelId: string,
  apiKey: string,
  endpoint: string,
  provider: AIProvider,
  prompt: string,
  options?: GenerationOptions
): Promise<LLMResponse> {
  const start = Date.now();
  
  let messages: any[] = [];
  if (options?.contents && options.contents.length > 0) {
    messages = options.contents.map(c => ({
      role: c.role === 'model' ? 'assistant' : c.role,
      content: c.parts?.[0]?.text || ""
    }));
  } else {
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
  }

  const body: any = {
    model: modelId,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2048,
  };

  if (options?.jsonMode) {
    body.response_format = { type: "json_object" };
    if (prompt && !prompt.toLowerCase().includes("json")) {
        messages[messages.length-1].content += "\n\nIMPORTANT: Return valid JSON only.";
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  // CC11 — wrap the (model, prompt, options) tuple in a 5-min TTL cache.
  // Same caveat as generateGemini: tool-bearing calls are not cached.
  const cacheable = !options?.tools;
  const fetcher = async (): Promise<LLMResponse> => {
    try {
      const response = await retryWithBackoff(async () => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
            'X-Title': 'Wealth Aggregator v2.0'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!res.ok) {
          const err = await res.text();
          const error = new Error(err);
          (error as any).status = res.status;
          throw error;
        }
        return res.json();
      });

      clearTimeout(timeoutId);

      return {
        text: response.choices[0].message.content,
        modelId,
        provider,
        latency: Date.now() - start
      };
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') throw new Error('AI request timed out (30s)');
      throw error;
    }
  };

  if (cacheable) {
    return withLLMCache(
      { loader: 'openai:' + provider + ':' + modelId, payload: { modelId, provider, endpoint, prompt, options } },
      fetcher
    );
  }
  return fetcher();
}

/**
 * Cohere API Adapter
 */
export async function generateCohere(
  modelId: string,
  apiKey: string,
  prompt: string,
  options?: GenerationOptions
): Promise<LLMResponse> {
  const start = Date.now();
  const endpoint = "https://api.cohere.com/v2/chat";

  let messages: any[] = [];
  if (options?.contents && options.contents.length > 0) {
    messages = options.contents.map(c => ({
      role: c.role === 'model' ? 'assistant' : c.role,
      content: c.parts?.[0]?.text || ""
    }));
  } else {
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
  }

  const body: any = {
    model: modelId,
    messages
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await retryWithBackoff(async () => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        const err = await res.text();
        const error = new Error(err);
        (error as any).status = res.status;
        throw error;
      }
      return res.json();
    });

    clearTimeout(timeoutId);

    let text = "";
    if (response.message?.content) {
      if (Array.isArray(response.message.content)) {
        text = response.message.content[0]?.text || "";
      } else if (typeof response.message.content === 'string') {
        text = response.message.content;
      }
    }

    return {
      text,
      modelId,
      provider: 'cohere',
      latency: Date.now() - start
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') throw new Error('AI request timed out (30s)');
    throw error;
  }
}
