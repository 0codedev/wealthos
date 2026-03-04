import { logger } from "./Logger";
import { GroqChatMessage } from "../types/ai";
import { llmPipeline } from "./llm";

/**
 * Chat with a Groq model using the Agnostic LLM Pipeline.
 * This provides automatic fallbacks and centralized key management.
 * 
 * @param model - The primary Groq model ID
 * @param history - Previous messages
 * @param message - User message
 * @param systemPrompt - Optional system instruction
 */
export const chatWithGroq = async (
    model: string,
    history: GroqChatMessage[],
    message: string,
    systemPrompt?: string
): Promise<string> => {
    // Convert history to Agnostic LLM format
    const contents = history.map(m => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }]
    }));

    // Append latest message
    contents.push({ role: 'user', parts: [{ text: message }] });

    try {
        const result = await llmPipeline(message, {
            modelOverride: model as any,
            systemPrompt: systemPrompt,
            contents: contents
        });
        return result.text;
    } catch (error) {
        logger.error(`Groq Service: Pipeline failed for ${model}`, error);
        throw error;
    }
};

/**
 * Quick ask for simple prompts (uses fastest model).
 */
export const quickAskGroq = async (prompt: string): Promise<string> => {
    return await chatWithGroq('llama-3.1-8b-instant', [], prompt);
};

/**
 * Deep reasoning with DeepSeek R1.
 */
export const deepThinkGroq = async (prompt: string): Promise<string> => {
    return await chatWithGroq('deepseek-r1-distill-llama-70b', [], prompt);
};

/**
 * Streaming chat with Groq - yields tokens as they arrive.
 * Keeping native implementation for now as AIR doesn't support streaming yet.
 */
export const streamChatWithGroq = async (
    model: string,
    history: GroqChatMessage[],
    message: string,
    systemPrompt: string | undefined,
    onToken: (token: string, fullText: string) => void,
    onComplete: (fullText: string) => void,
    onError: (error: Error) => void
): Promise<void> => {
    try {
        // We still need the key directly for streaming
        const storeData = localStorage.getItem('wealth-aggregator-logic');
        const apiKey = storeData ? JSON.parse(storeData).state?.groqApiKey : null;
        
        if (!apiKey) throw new Error("GROQ_API_KEY_MISSING");

        const messages: any[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
        messages.push(...history.map(m => {
            const role = (m as any).role;
            return { 
                role: role === 'model' ? 'assistant' : role, 
                content: m.content 
            };
        }));
        messages.push({ role: 'user', content: message });

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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

        if (!response.ok) throw new Error(`Groq Stream Error: ${response.status}`);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No reader");

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
                    } catch (e) {}
                }
            }
        }
        onComplete(fullText);
    } catch (error: unknown) {
        onError(error instanceof Error ? error : new Error(String(error)));
    }
};
