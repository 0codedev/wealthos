import { type LucideIcon } from 'lucide-react';

export interface ChatPart {
    text?: string;
    inlineData?: { mimeType: string; data: string; };
}

export interface GeminiFormatMessage {
    role: string;
    parts: ChatPart[];
}

export interface GroqChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
}

export type AIProvider = 'gemini' | 'groq' | 'openrouter' | 'mistral' | 'cerebras' | 'github' | 'cloudflare' | 'cohere' | 'omniroute';

export interface AIModel {
    id: string;
    label: string;
    icon: LucideIcon;
    description: string;
    provider: AIProvider;
    disabled?: boolean;
    isHighIntelligence?: boolean;
    isFree?: boolean;
    supportsJsonMode?: boolean;
}

export interface AIResponseWithMetadata {
    text: string;
    modelId: string;
    provider: AIProvider;
    latency: number;
    isFallback: boolean;
    attribution: string;
}

export interface AIPersona {
    id: string;
    label: string;
    icon: LucideIcon;
    prompt: string;
}

export interface StreamingCallbacks {
    onToken: (token: string, fullText: string) => void;
    onComplete: (fullText: string) => void;
    onError: (error: Error) => void;
}
