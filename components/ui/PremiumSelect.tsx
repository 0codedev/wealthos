import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Sparkles, Zap, Brain, Bot, Shield, Globe, Activity } from 'lucide-react';

interface Option {
    id: string;
    name: string;
    provider?: string;
    isHighIntelligence?: boolean;
}

interface PremiumSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    placeholder?: string;
    label?: string;
    icon?: React.ReactNode;
}

export const PremiumSelect: React.FC<PremiumSelectProps> = ({
    value,
    onChange,
    options,
    placeholder = "Select Model",
    label,
    icon
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(opt => opt.id === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const getProviderIcon = (provider?: string) => {
        switch (provider?.toLowerCase()) {
            case 'gemini': return <Brain size={12} className="text-blue-400" />;
            case 'groq': return <Zap size={12} className="text-orange-400" />;
            case 'mistral': return <Sparkles size={12} className="text-purple-400" />;
            case 'cerebras': return <Activity size={12} className="text-emerald-400" />;
            case 'github': return <Globe size={12} className="text-slate-400" />;
            case 'cloudflare': return <Shield size={12} className="text-amber-400" />;
            default: return <Bot size={12} className="text-indigo-400" />;
        }
    };

    return (
        <div className="relative w-full" ref={containerRef}>
            {label && (
                <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400/80">
                    {label}
                </label>
            )}

            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    group flex w-full items-center justify-between gap-3 rounded-2xl border 
                    bg-white/50 p-3 text-left transition-all duration-300 backdrop-blur-md
                    dark:bg-slate-900/50 
                    ${isOpen
                        ? 'border-indigo-500 shadow-lg shadow-indigo-500/10 ring-2 ring-indigo-500/10'
                        : 'border-slate-200 hover:border-indigo-400/50 dark:border-slate-800 dark:hover:border-indigo-500/40'
                    }
                `}
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`
                        flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition-colors
                        ${isOpen ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}
                    `}>
                        {icon || (selectedOption ? getProviderIcon(selectedOption.provider) : <Bot size={14} />)}
                    </div>
                    <div className="flex flex-col min-w-0">
                        <span className={`text-xs font-bold truncate ${selectedOption ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>
                            {selectedOption ? selectedOption.name : placeholder}
                        </span>
                        {selectedOption?.provider && (
                            <span className="text-[9px] font-medium uppercase tracking-tight text-slate-400">
                                {selectedOption.provider}
                            </span>
                        )}
                    </div>
                </div>
                <ChevronDown
                    size={16}
                    className={`shrink-0 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-indigo-500' : 'group-hover:translate-y-0.5'}`}
                />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 5, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        className="absolute z-[100] mt-2 w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white/95 p-2 shadow-2xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95"
                    >
                        <div className="max-h-[320px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                            {/* System Default Option */}
                            <button
                                type="button"
                                onClick={() => { onChange(''); setIsOpen(false); }}
                                className={`
                                    flex w-full items-center justify-between rounded-xl p-2.5 text-left transition-all
                                    ${value === ''
                                        ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
                                    }
                                `}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                                        <Bot size={12} />
                                    </div>
                                    <span className="text-xs font-bold">System Default (Optimized)</span>
                                </div>
                                {value === '' && <Check size={14} className="text-indigo-500" />}
                            </button>

                            <div className="my-2 border-t border-slate-100 dark:border-slate-800" />

                            {/* Providers Grouping */}
                            {Array.from(new Set(options.map(o => o.provider))).map(provider => (
                                <div key={provider} className="mb-2 last:mb-0">
                                    <p className="px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400/60">
                                        {provider}
                                    </p>
                                    <div className="space-y-0.5">
                                        {options.filter(o => o.provider === provider).map(opt => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => { onChange(opt.id); setIsOpen(false); }}
                                                className={`
                                                    flex w-full items-center justify-between rounded-xl p-2.5 text-left transition-all
                                                    ${value === opt.id
                                                        ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400'
                                                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-900'
                                                    }
                                                `}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                                        {getProviderIcon(opt.provider)}
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-xs font-bold truncate">{opt.name}</span>
                                                        {opt.isHighIntelligence && (
                                                            <span className="text-[8px] font-medium text-emerald-500 uppercase tracking-tight">Frontier Model</span>
                                                        )}
                                                    </div>
                                                </div>
                                                {value === opt.id && <Check size={14} className="text-indigo-500 shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
