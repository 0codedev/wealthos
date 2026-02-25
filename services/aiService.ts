import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { logger } from "./Logger";
import { ChatPart } from "../types/ai";
import { secureApiKeyStorage, getApiKey as getSecureApiKey } from "../utils/Encryption";
import { llmPipeline } from "./llm";
import { MODEL_REGISTRY } from "./llm/models";
import { sanitizePromptInput } from "./SecurityService";
import { SEBI_COMPLIANCE_CORE, AUDIO_TRIAGE_PROMPT } from "./llm/prompts";
import { upstoxMarketDataService } from "./UpstoxMarketDataService";
import { dhanBrokerService } from "./DhanBrokerService";
import { InstitutionalWeatherService } from "./alpha/InstitutionalWeatherService";

export { SEBI_COMPLIANCE_CORE };

// --- API CONFIG ---
const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GLOBAL_THROTTLE_MS = 2000; // Paced to 2 seconds
let lastCallTimestamp = 0;
const CALL_HISTORY: number[] = [];
const MAX_CALLS_PER_MINUTE = 30; 
const SAFETY_KILL_SWITCH = false; // ENABLED: AI calls are allowed
const USER_TRIGGERED_ONLY = true; // If true, background processes are blocked from calling AI

/**
 * Gets the Gemini API key from secure storage or environment variables.
 * SECURITY: Never hardcode API keys - they get exposed in production bundles.
 * 
 * Priority:
 * 1. Secure encrypted storage (most secure)
 * 2. Environment variable (VITE_GEMINI_API_KEY)
 * 
 * @throws Error if no API key is configured
 */
const getApiKey = (): string => {
    let apiKey: string | null | undefined = null;

    // 1. PRIMARY: Try secure encrypted storage
    try {
        const secureKey = secureApiKeyStorage.get<string>();
        if (secureKey) {
            apiKey = secureKey.trim();
            logger.debug('AI Service: Using API Key from secure storage', undefined, 'AIService');
        }
    } catch (e) {
        logger.warn('AI Service: Unable to read from secure storage');
    }

    // 2. LAST RESORT: Environment Variables (Vite)
    if (!apiKey) {
        try {
            // @ts-ignore - Vite injects import.meta.env at build time
            if (typeof import.meta !== 'undefined' && import.meta.env) {
                apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY;
            }
        } catch (e) {
            logger.warn('AI Service: Unable to access environment variables');
        }
    }

    // 3. No key found - throw helpful error
    if (!apiKey) {
        throw new Error(
            'API_KEY_MISSING: No Gemini API key configured. ' +
            'Please add your key in Settings or set VITE_GEMINI_API_KEY in .env.local'
        );
    }

    return apiKey;
};

// --- RETRY WITH EXPONENTIAL BACKOFF ---
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries = MAX_RETRIES,
    delay = BASE_DELAY_MS
): Promise<T> {
    try {
        return await fn();
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // Don't retry on auth errors, bad requests, or blocked content
        if (message.includes('401') ||
            message.includes('403') ||
            message.includes('400') ||
            message.includes('API key not valid') ||
            message.includes('Blocked')) {
            throw error;
        }

        if (retries > 0) {
            logger.warn(`AI Service: Retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return retryWithBackoff(fn, retries - 1, delay * 2);
        }
        throw error;
    }
}

import { alphaCache } from '../lib/alphaCache';

// --- AI RESPONSE CACHE ---
const AI_CACHE_TTL_HOURS = 24; // Persist AI insights for 24 hours

async function getCachedResponse(promptHash: string): Promise<string | null> {
    const cached = await alphaCache.get(`ai_res:${promptHash}`);
    if (cached && !cached.isStale) {
        logger.debug('AI Service: Cache hit (Persistent)');
        return cached.data;
    }
    return null;
}

async function setCachedResponse(promptHash: string, response: string): Promise<void> {
    await alphaCache.set(`ai_res:${promptHash}`, response, AI_CACHE_TTL_HOURS);
}

function hashPrompt(prompt: string): string {
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
        const char = prompt.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// --- ROBUST FETCH HELPER (with retry) ---
async function generateWithFallback(
    primaryModel: string,
    fallbackModel: string,
    payload: any,
    options?: { systemPrompt?: string; jsonMode?: boolean; audioData?: any }
): Promise<string> {
    // --- GLOBAL KILL SWITCH ---
    if (SAFETY_KILL_SWITCH) {
        logger.error('AI Service: [EMERGENCY HALT] AI calls are globally disabled by SAFETY_KILL_SWITCH.');
        throw new Error('AI_DISABLED: The AI engine is currently offline for maintenance/safety.');
    }

    // --- SAFETY THROTTLE ---
    const now = Date.now();
    
    // 1. Minimum Interval Check
    if (now - lastCallTimestamp < GLOBAL_THROTTLE_MS) {
        const wait = GLOBAL_THROTTLE_MS - (now - lastCallTimestamp);
        logger.warn(`AI Service: Safety throttle active (Pacing requests). Waiting ${wait}ms...`);
        await new Promise(resolve => setTimeout(resolve, wait));
    }
    
    // 2. Frequency Check (Calls per minute)
    const oneMinuteAgo = Date.now() - 60000;
    while (CALL_HISTORY.length > 0 && CALL_HISTORY[0] < oneMinuteAgo) {
        CALL_HISTORY.shift();
    }
    
    if (CALL_HISTORY.length >= MAX_CALLS_PER_MINUTE) {
        logger.error(`AI Service: [RATE LIMIT] Exceeded ${MAX_CALLS_PER_MINUTE} calls/min. Blocking request to protect quota.`);
        throw new Error('AI_RATE_LIMIT: Too many requests. Please wait a minute.');
    }
    
    lastCallTimestamp = Date.now();
    CALL_HISTORY.push(lastCallTimestamp);

    // Extract prompt from Gemini-style payload if prompt string not provided
    let prompt = payload.contents?.[0]?.parts?.[0]?.text || "";
    if (prompt) {
        prompt = sanitizePromptInput(prompt);
        if (payload.contents?.[0]?.parts?.[0]) {
            payload.contents[0].parts[0].text = prompt;
        }
    }
    
    try {
        // Route through the new Agnostic LLM Pipeline
        const result = await llmPipeline(prompt, {
            modelOverride: primaryModel as any,
            systemPrompt: options?.systemPrompt,
            jsonMode: options?.jsonMode,
            audioData: options?.audioData, // CRITICAL: Pass the audio data!
            contents: payload.contents, // CRITICAL: Pass the chat history!
            tools: payload.tools // CRITICAL: Pass search grounding tools!
        });
        
        return result.text;
    } catch (error: unknown) {
        logger.error(`AI Service: Pipeline execution failed for ${primaryModel}.`, error);
        throw error;
    }
}


// --- Audio Helper Functions (Encoding/Decoding) ---
function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

function createPCM16Blob(data: Float32Array): { data: string; mimeType: string } {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    let binary = '';
    const bytes = new Uint8Array(int16.buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' };
}

// --- Feature 1: Conversational Voice (Live API) ---
// NOTE: Keeping SDK for Live API as it requires WebSocket complexity.
export class LiveVoiceSession {
    private inputContext: AudioContext | null = null;
    private outputContext: AudioContext | null = null;
    private nextStartTime = 0;
    private sources = new Set<AudioBufferSourceNode>();
    private stream: MediaStream | null = null;

    async start(userContextInstruction: string) {
        // Initialize contexts
        this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        await this.outputContext.resume();

        const outputNode = this.outputContext.createGain();
        outputNode.connect(this.outputContext.destination);

        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        const fullSystemInstruction = `${SEBI_COMPLIANCE_CORE}\n\nUSER CONTEXT: ${userContextInstruction}`;
        const apiKey = getApiKey();

        // Try to instantiate SDK - if it fails, we can't do Live API
        let ai;
        try {
            ai = new GoogleGenAI({ apiKey });
        } catch (e) {
            logger.error("SDK Init Failed for Live Voice", e);
            throw new Error("Voice features unavailable due to SDK mismatch.");
        }

        const connectSession = async (model: string) => {
            return await ai.live.connect({
                model: model,
                callbacks: {
                    onopen: () => {
                        logger.info(`Gemini Live: Session Connected (${model})`);
                        if (!this.inputContext || !this.stream) return;
                        const source = this.inputContext.createMediaStreamSource(this.stream);
                        const scriptProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const pcmBlob = createPCM16Blob(inputData);
                            sessionPromise.then(session => {
                                try { session.sendRealtimeInput({ media: pcmBlob }); } catch (err) { }
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(this.inputContext.destination);
                    },
                    onmessage: async (msg: LiveServerMessage) => {
                        const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (base64Audio && this.outputContext) {
                            this.nextStartTime = Math.max(this.nextStartTime, this.outputContext.currentTime);
                            try {
                                const audioBuffer = await decodeAudioData(decode(base64Audio), this.outputContext, 24000, 1);
                                const source = this.outputContext.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(outputNode);
                                source.addEventListener('ended', () => this.sources.delete(source));
                                source.start(this.nextStartTime);
                                this.nextStartTime += audioBuffer.duration;
                                this.sources.add(source);
                            } catch (decodeErr) { logger.error("Audio decode error:", decodeErr); }
                        }
                    },
                    onclose: () => { this.stop(); },
                    onerror: (err) => { logger.error("Gemini Live: Error", err); this.stop(); }
                },
                config: {
                    systemInstruction: fullSystemInstruction,
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
                }
            });
        };

        let sessionPromise: Promise<any>;
        try {
            logger.info("Gemini Live: Attempting gemini-2.5-flash...");
            sessionPromise = connectSession('gemini-2.5-flash');
            await sessionPromise;
        } catch (e) {
            logger.warn("Gemini Live: 2.5 failed, falling back to 2.5-flash-lite", e);
            sessionPromise = connectSession('gemini-2.5-flash-lite');
        }

        if (sessionPromise) {
            sessionPromise.catch((err) => {
                logger.error("Gemini Live: Connection failed", err);
                this.stop();
                throw err;
            });
        }
        return sessionPromise;
    }

    stop() {
        if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
        if (this.inputContext) { this.inputContext.close(); this.inputContext = null; }
        if (this.outputContext) { this.outputContext.close(); this.outputContext = null; }
        this.sources.forEach(source => { try { source.stop(); } catch (e) { } });
        this.sources.clear();
    }
}

// --- Feature 2: Search Grounding ---
export const searchWeb = async (query: string) => {
    return await generateWithFallback(
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite-preview',
        {
            contents: [{ parts: [{ text: query }] }],
            tools: [{ google_search: {} }]
        }
    );
}

// --- Feature 3: General Intelligence (Pro/Flash) ---
export const askGemini = async (prompt: string, usePro: boolean = false) => {
    // Check cache first
    const promptKey = hashPrompt(prompt);
    const cached = await getCachedResponse(promptKey);
    if (cached) return cached;

    const primary = usePro ? 'gemini-3.1-pro-preview' : 'gemini-3-flash-preview';
    const fallback = 'gemini-3.1-flash-lite-preview';
    
    const result = await generateWithFallback(primary, fallback, {
        contents: [{ parts: [{ text: prompt }] }]
    });

    // Cache the response
    await setCachedResponse(promptKey, result);
    return result;
}

// --- Feature 4: AI Powered Chatbot (Multi-Modal) ---
// ChatPart imported from ../types/ai

export const chatWithGemini = async (
    model: string,
    history: { role: string, parts: ChatPart[] }[],
    message: string | ChatPart[],
    systemInstruction?: string
) => {
    // logger.debug(`AI Service: Chatting... requested model: ${model}`);

    let primary = model;
    let fallback = 'gemini-3.1-flash-lite-preview';

    // Smart Fallback Logic
    if (model && model.includes('3.1')) {
        fallback = 'gemini-3.1-flash-lite-preview';
    } else if (model && model.includes('3')) {
        fallback = 'gemini-3-flash-preview';
    }

    // Format history for REST API
    const contents = history.map(h => ({
        role: h.role,
        parts: h.parts
    }));

    // Add new message
    const newParts = typeof message === 'string' ? [{ text: message }] :
        Array.isArray(message) ? message : [message];
    contents.push({ role: 'user', parts: newParts as any });

    const payload: any = {
        contents,
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined
    };

    return await generateWithFallback(primary, fallback, payload);
}

/**
 * Agnostic AI Router for Streaming Chat.
 * Detects the provider and routes to the appropriate streaming implementation.
 */
export const streamChatWithGemini = async (
    model: string,
    history: { role: string, parts: ChatPart[] }[],
    message: string | ChatPart[],
    systemInstruction: string | undefined,
    onToken: (token: string, fullText: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void,
    options: { googleSearchGrounding?: boolean, thinkingMode?: boolean } = {}
): Promise<void> => {
    try {
        const modelInfo = MODEL_REGISTRY.find(m => m.id === model);
        const provider = modelInfo?.provider || 'gemini';
        
        if (provider === 'groq') {
            const apiKey = getSecureApiKey('groq');
            if (!apiKey) throw new Error("Groq API Key missing in settings");
            
            const msgText = typeof message === 'string' ? message : 
                           Array.isArray(message) ? (message[0] as any).text : (message as any).text;
            
            const openAIHistory = history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role,
                content: (h.parts[0] as any).text || ""
            }));

            return await streamChatWithOpenAICompatible(
                "https://api.groq.com/openai/v1/chat/completions",
                apiKey,
                model,
                openAIHistory,
                msgText,
                systemInstruction,
                onToken,
                onComplete,
                onError
            );
        }

        if (provider === 'openrouter') {
            const apiKey = getSecureApiKey('openrouter');
            if (!apiKey) throw new Error("OpenRouter API Key missing in settings");

            const msgText = typeof message === 'string' ? message : 
                           Array.isArray(message) ? (message[0] as any).text : (message as any).text;
            
            const openAIHistory = history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role,
                content: (h.parts[0] as any).text || ""
            }));

            return await streamChatWithOpenAICompatible(
                "https://openrouter.ai/api/v1/chat/completions",
                apiKey,
                model,
                openAIHistory,
                msgText,
                systemInstruction,
                onToken,
                onComplete,
                onError
            );
        }

        if (provider === 'mistral') {
            const apiKey = getSecureApiKey('mistral');
            if (!apiKey) throw new Error("Mistral API Key missing in settings");

            const msgText = typeof message === 'string' ? message : 
                           Array.isArray(message) ? (message[0] as any).text : (message as any).text;
            
            const openAIHistory = history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role,
                content: (h.parts[0] as any).text || ""
            }));

            return await streamChatWithOpenAICompatible(
                "https://api.mistral.ai/v1/chat/completions",
                apiKey,
                model,
                openAIHistory,
                msgText,
                systemInstruction,
                onToken,
                onComplete,
                onError
            );
        }

        if (provider === 'cerebras') {
            const apiKey = getSecureApiKey('cerebras');
            if (!apiKey) throw new Error("Cerebras API Key missing in settings");

            const msgText = typeof message === 'string' ? message : 
                           Array.isArray(message) ? (message[0] as any).text : (message as any).text;
            
            const openAIHistory = history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role,
                content: (h.parts[0] as any).text || ""
            }));

            return await streamChatWithOpenAICompatible(
                "https://api.cerebras.ai/v1/chat/completions",
                apiKey,
                model,
                openAIHistory,
                msgText,
                systemInstruction,
                onToken,
                onComplete,
                onError
            );
        }

        if (provider === 'github') {
            const apiKey = getSecureApiKey('github');
            if (!apiKey) throw new Error("GitHub Token missing in settings");

            const msgText = typeof message === 'string' ? message : 
                           Array.isArray(message) ? (message[0] as any).text : (message as any).text;
            
            const openAIHistory = history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role,
                content: (h.parts[0] as any).text || ""
            }));

            return await streamChatWithOpenAICompatible(
                "https://models.inference.ai.azure.com/chat/completions",
                apiKey,
                model,
                openAIHistory,
                msgText,
                systemInstruction,
                onToken,
                onComplete,
                onError
            );
        }

        if (provider === 'cloudflare') {
            const apiKey = getSecureApiKey('cloudflare');
            const storeData = localStorage.getItem('wealth-aggregator-logic');
            const settings = storeData ? JSON.parse(storeData).state : {};
            const accountId = settings.cloudflareAccountId;

            if (!apiKey || !accountId) throw new Error("Cloudflare Token or Account ID missing in settings");

            const msgText = typeof message === 'string' ? message : 
                           Array.isArray(message) ? (message[0] as any).text : (message as any).text;
            
            const openAIHistory = history.map(h => ({
                role: h.role === 'model' ? 'assistant' : h.role,
                content: (h.parts[0] as any).text || ""
            }));

            return await streamChatWithOpenAICompatible(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
                apiKey,
                model,
                openAIHistory,
                msgText,
                systemInstruction,
                onToken,
                onComplete,
                onError
            );
        }

        // Default to Gemini
        return await streamChatWithGeminiInternal(
            model, history, message, systemInstruction, 
            onToken, onComplete, onError, options
        );
    } catch (err: unknown) {
        console.error("[streamChatWithGemini Router] Error:", err);
        const error = err instanceof Error ? err : new Error(String(err));
        onError(error);
    }
}

/**
 * Streaming chat with Gemini - yields tokens as they arrive.
 * This provides the premium "typing" effect like ChatGPT.
 */
/**
 * Internal implementation for Gemini streaming via Google REST API
 */
async function streamChatWithGeminiInternal(
    model: string,
    history: { role: string, parts: ChatPart[] }[],
    message: string | ChatPart[],
    systemInstruction: string | undefined,
    onToken: (token: string, fullText: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void,
    options: { googleSearchGrounding?: boolean, thinkingMode?: boolean } = {}
): Promise<void> {
    try {
        const apiKey = getApiKey();

        // Format history for REST API
        const contents = history.map(h => ({
            role: h.role,
            parts: h.parts
        }));

        // Add new message
        const newParts = typeof message === 'string' ? [{ text: message }] :
            Array.isArray(message) ? message : [message];
        contents.push({ role: 'user', parts: newParts as any });

        const payload: any = {
            contents,
            systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
            generationConfig: {
                temperature: options.thinkingMode ? 0.7 : 0.9,
                topP: 0.95,
                topK: 64,
                maxOutputTokens: 8192,
            }
        };

        // Add Search Grounding tool if enabled
        if (options.googleSearchGrounding) {
            payload.tools = [{ googleSearchRetrieval: {} }];
        }

        // Use streamGenerateContent endpoint
        const url = `${API_BASE_URL}/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error (${response.status}): ${errText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE format: data: {...}\n\n
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;

                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) {
                            fullText += text;
                            onToken(text, fullText);
                        }
                    } catch (e) {
                        // Ignore parse errors for incomplete chunks
                    }
                }
            }
        }

        onComplete(fullText);
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        onError(err);
    }
}

// --- Feature 5: Analyze Images ---
export const analyzeImage = async (base64Image: string, prompt: string = "Analyze this image") => {
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
    return await generateWithFallback(
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite-preview',
        {
            contents: [{
                parts: [
                    { inlineData: { mimeType: 'image/png', data: cleanBase64 } },
                    { text: prompt }
                ]
            }]
        }
    );
}

// --- Feature 6: Fast AI Responses ---
export const quickAsk = async (prompt: string) => {
    return await generateWithFallback(
        'gemini-3.1-flash-lite-preview',
        'gemini-3-flash-preview',
        { contents: [{ parts: [{ text: prompt }] }] }
    );
}

// --- Feature 7: Thinking Mode ---
export const deepThink = async (prompt: string) => {
    // logger.debug("AI Service: Deep thinking...", prompt);
    const fullPrompt = `${SEBI_COMPLIANCE_CORE}\n\nQUERY: ${prompt}`;
    // Note: Thinking config might not be supported in v1beta REST API yet or requires specific field
    // We'll omit thinkingConfig for safety in REST fallback or pass it if known working
    return await generateWithFallback(
        'gemini-3.1-pro-preview',
        'gemini-3-flash-preview',
        {
            contents: [{ parts: [{ text: fullPrompt }] }]
        }
    );
}

/**
 * Generic streaming chat for OpenAI-compatible APIs (Groq, OpenRouter, etc.)
 */
export const streamChatWithOpenAICompatible = async (
    endpoint: string,
    apiKey: string,
    model: string,
    history: { role: string, content: string }[],
    message: string,
    systemInstruction: string | undefined,
    onToken: (token: string, fullText: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void
): Promise<void> => {
    try {
        const messages: any[] = systemInstruction ? [{ role: 'system', content: systemInstruction }] : [];
        messages.push(...history.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : m.role,
            content: m.content
        })));
        messages.push({ role: 'user', content: message });

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.7,
                stream: true
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Streaming API Error (${response.status}): ${errText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;

                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const delta = json.choices?.[0]?.delta?.content;
                        if (delta) {
                            fullText += delta;
                            onToken(delta, fullText);
                        }
                    } catch (e) {
                        // Incomplete chunk
                    }
                }
            }
        }
        onComplete(fullText);
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        onError(err);
    }
};

/**
 * Breakthrough 3.1: Native Audio Analysis
 * Sends raw audio directly to Gemini 2.5 Flash for multimodal understanding.
 */
export async function analyzeVoiceAudio(audioBlob: Blob): Promise<any> {
    const base64Audio = await blobToBase64(audioBlob);
    
    try {
        const result = await generateWithFallback(
            'gemini-2.5-flash', 
            'gemini-3.1-flash-lite-preview',
            { contents: [{ role: 'user', parts: [{ text: AUDIO_TRIAGE_PROMPT }] }] },
            { 
                jsonMode: true,
                audioData: {
                    data: base64Audio.split(',')[1],
                    mimeType: 'audio/webm'
                }
            } as any
        );

        // Sanitize response (remove markdown if present)
        const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);

    } catch (e) {
        logger.error('AI Service: Native Audio analysis failed', e);
        return {
            transcript: "Unable to hear clearly.",
            emotion: "Indeterminate",
            risk_level: "Low",
            risk_score: 0,
            sentiment: "Connection jitter or silence detected.",
            coach_tip: "Try speaking again in a clear voice.",
            command: null
        };

    }
}

/**
 * Helper: Convert Blob to Base64
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
    });
}

/**
 * Bundles Upstox live market context and Dhan ledger records into a read-only system prompt block.
 */
export async function getAIAnalystContext(): Promise<string> {
    try {
        // 1. Fetch Upstox Index Quotes
        const indexSymbols = ['NSE_INDEX|Nifty 50', 'NSE_INDEX|Nifty Bank', 'NSE_INDEX|India VIX'];
        const quotes = await upstoxMarketDataService.getFullQuotes(indexSymbols).catch(() => null);
        
        const niftyQuote = quotes ? quotes['NSE_INDEX|Nifty 50'] : null;
        const bankNiftyQuote = quotes ? quotes['NSE_INDEX|Nifty Bank'] : null;
        const vixQuote = quotes ? quotes['NSE_INDEX|India VIX'] : null;

        // 2. Fetch Upstox FII/DII Net Flow History
        const fiiHistory = await upstoxMarketDataService.getFiiHistory('CM').catch(() => []);
        const diiHistory = await upstoxMarketDataService.getDiiHistory().catch(() => []);
        
        const fiiNetFlow = fiiHistory.length > 0 ? (fiiHistory[0].net_amount ?? fiiHistory[0].net_value ?? 0) : 0;
        const diiNetFlow = diiHistory.length > 0 ? (diiHistory[0].net_amount ?? diiHistory[0].net_value ?? 0) : 0;
        
        // 3. Compute Institutional Weather Bias
        const weather = InstitutionalWeatherService.computeWeather(fiiNetFlow, diiNetFlow);

        // 4. Fetch Upstox NIFTY PCR
        const pcrRes = await upstoxMarketDataService.getPCR('NIFTY').catch(() => null);
        const pcr = pcrRes && typeof pcrRes.pcr === 'number' ? pcrRes.pcr : 0.95;

        // 5. Fetch Dhan Ledger Records (last 30 days)
        const toDate = new Date().toISOString().split('T')[0];
        const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const ledger = await dhanBrokerService.fetchLedger(fromDate, toDate).catch(() => []);

        // 6. Format Consolidated Prompt Block
        let marketBlock = `=== UPSTOX LIVE MARKET SUMMARY ===\n`;
        if (niftyQuote) {
            marketBlock += `- Nifty 50 LTP: ${niftyQuote.last_price} | Change: ${niftyQuote.net_change}\n`;
        }
        if (bankNiftyQuote) {
            marketBlock += `- Nifty Bank LTP: ${bankNiftyQuote.last_price} | Change: ${bankNiftyQuote.net_change}\n`;
        }
        if (vixQuote) {
            marketBlock += `- India VIX LTP: ${vixQuote.last_price} (Volatility Index)\n`;
        }
        marketBlock += `- Nifty PCR: ${pcr}\n`;
        marketBlock += `- FII CM Flow: ${fiiNetFlow} Cr | DII CM Flow: ${diiNetFlow} Cr\n`;
        marketBlock += `- Institutional Weather: ${weather.label} (${weather.icon}) - ${weather.description}\n`;

        let ledgerBlock = `=== DHAN TRANSACTIONS LEDGER (Last 30 Days) ===\n`;
        if (ledger.length > 0) {
            ledgerBlock += ledger.slice(0, 10).map(l => 
                `- [${l.voucherDate}] Narration: ${l.narration || l.voucherDesc} | Debit: ${l.debit} | Credit: ${l.credit} | Balance: ${l.runBal}`
            ).join('\n');
            if (ledger.length > 10) {
                ledgerBlock += `\n... and ${ledger.length - 10} more ledger transaction entries.`;
            }
        } else {
            ledgerBlock += `No ledger transaction entries fetched for this period or broker authentication offline.`;
        }

        return `\n\n=== LIVE MARKET INTELLIGENCE & TRANSACTION LEDGER CONTEXT ===\n${marketBlock}\n${ledgerBlock}\n============================================================\n`;
    } catch (err) {
        logger.error('Failed to build AI Analyst Context:', err);
        return `\n\n=== LIVE MARKET & LEDGER CONTEXT ===\nUnavailable due to background sync errors.\n====================================\n`;
    }
}

