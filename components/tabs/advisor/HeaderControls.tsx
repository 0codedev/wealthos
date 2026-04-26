import React, { useState } from 'react';
import { Sparkles, ChevronDown, Check, Zap, Star, Shield, TrendingUp, Flame, Bot, Globe, Brain, BadgePercent } from 'lucide-react';

// --- Constants ---
import { AIModel, AIPersona } from '../../../types/ai';
import { MODEL_REGISTRY } from '../../../services/llm/models';

export const MODELS: AIModel[] = MODEL_REGISTRY.map(m => ({
    id: m.id,
    label: m.name,
    icon: m.isHighIntelligence ? Brain : (m.isFree ? BadgePercent : (m.provider === 'gemini' ? Bot : Zap)),
    description: m.bestFor,
    provider: m.provider,
    isHighIntelligence: m.isHighIntelligence,
    isFree: m.isFree
}));

export const PERSONAS: AIPersona[] = [
    { id: 'standard', label: 'Standard Advisor', icon: Shield, prompt: "You are a professional, balanced financial advisor. Focus on risk management and steady growth." },
    { id: 'buffett', label: 'Oracle of Omaha', icon: TrendingUp, prompt: "You are Warren Buffett. Speak in wise, folk-sy aphorisms. Focus on value, moats, and long-term holding. Disdain speculation." },
    { id: 'belfort', label: 'Wolf mode', icon: Zap, prompt: "You are Jordan Belfort (The Wolf of Wall Street). High energy, aggressive sales pitch style. Push for action, but keep it legal. Use phrases like 'Pick up the phone!' or 'Opportunity of a lifetime!'." },
    { id: 'roast', label: 'Roast Master', icon: Flame, prompt: "You are a savage comedian financial auditor. Roast the user's bad decisions mercilessly. accessible but brutal. Make fun of high risk/low reward trades." },
    { id: 'analyzer', label: 'Mistake Analyzer', icon: Brain, prompt: "You are an expert trading psychologist and performance coach. Analyze the user's trade history and mistakes provided in the context. Identify patterns of revenge trading, overtrading, or FOMO. Provide actionable guidelines to fix these specific behavioral leaks." },
];

// --- Sub Components ---

export const ModelSelector = ({ selected, onSelect }: { selected: string, onSelect: (id: string) => void }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectedModel = MODELS.find(m => m.id === selected) || MODELS[0];

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="inline-flex min-h-[34px] items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
            >
                <Sparkles size={14} className="text-indigo-500" />
                <span className="max-w-[160px] truncate">{selectedModel.label}</span>
                <ChevronDown size={14} className="opacity-50" />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute top-full right-0 mt-2 w-72 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                            {(['gemini', 'groq', 'openrouter'] as const).map(provider => {
                                const providerModels = MODELS.filter(m => m.provider === provider);
                                if (providerModels.length === 0) return null;

                                return (
                                    <div key={provider}>
                                        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950 border-y border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                                                {provider === 'gemini' ? <Bot size={12} className="text-indigo-500" /> : (provider === 'groq' ? <Zap size={12} className="text-amber-500" /> : <Globe size={12} className="text-emerald-500" />)}
                                                {provider} models
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-bold">{providerModels.length}</span>
                                        </div>
                                        {providerModels.map((m) => (
                                            <button
                                                key={m.id}
                                                onClick={() => { if (!m.disabled) { onSelect(m.id); setIsOpen(false); } }}
                                                disabled={m.disabled}
                                                className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors border-b last:border-0 border-slate-100 dark:border-slate-800/50 ${m.disabled ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                                            >
                                                <div className={`p-2 rounded-lg ${selected === m.id ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                                    <m.icon size={16} />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className={`text-xs font-bold ${selected === m.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-white'}`}>{m.label}</p>
                                                        {m.isHighIntelligence && <span className="px-1 py-0.5 rounded-[4px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[8px] font-bold">PRO</span>}
                                                        {m.isFree && <span className="px-1 py-0.5 rounded-[4px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-[8px] font-bold">FREE</span>}
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 line-clamp-1">{m.description}</p>
                                                </div>
                                                {selected === m.id && <Check size={14} className="ml-auto text-indigo-500" />}
                                            </button>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export const PersonaSelector = ({ selected, onSelect }: { selected: string, onSelect: (id: string) => void }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectedPersona = PERSONAS.find(p => p.id === selected) || PERSONAS[0];

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="inline-flex min-h-[34px] items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
            >
                <selectedPersona.icon size={14} className="text-fuchsia-500" />
                <span className="max-w-[130px] truncate">{selectedPersona.label}</span>
                <ChevronDown size={14} className="opacity-50" />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {PERSONAS.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => { onSelect(p.id); setIsOpen(false); }}
                                className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors border-b border-slate-100 dark:border-slate-800 last:border-0"
                            >
                                <div className={`p-2 rounded-lg ${selected === p.id ? 'bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                    <p.icon size={16} />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-slate-800 dark:text-white">{p.label}</p>
                                </div>
                                {selected === p.id && <Check size={14} className="ml-auto text-fuchsia-500" />}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
