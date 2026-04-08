
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, Sparkles, TrendingUp, PiggyBank, Target, Lightbulb, Zap, X, BrainCircuit } from 'lucide-react';
import { usePageVisibility } from '../../../contexts/PageVisibilityContext';

interface AICopilotWidgetProps {
    formatCurrency?: (val: number) => string;
}

// Pro Quick Actions
const QUICK_ACTIONS = [
    { id: 'portfolio', label: 'Portfolio Health', icon: <TrendingUp size={12} />, prompt: "Analyze my portfolio health" },
    { id: 'savings', label: 'Saving Opportunities', icon: <PiggyBank size={12} />, prompt: "Where can I save more?" },
    { id: 'goals', label: 'Goal Projection', icon: <Target size={12} />, prompt: "Am I on track for my goals?" },
    { id: 'market', label: 'Market Sentiment', icon: <Zap size={12} />, prompt: "What's the market mood today?" },
];

const AI_RESPONSES: Record<string, string> = {
    'portfolio': "Your portfolio has outperformed the Nifty 50 by 2.4% this quarter. Alpha generation is strong in Banking sectors, but Tech exposure is lagging. Consider rebalancing.",
    'saving': "I've detected ₹12,400 in recurring subscriptions. Consolidating your streaming services could save ₹4,500 annually. View details?",
    'goals': "At your current SIP rate of ₹25k, you will hit your ₹50L milestone 4 months ahead of schedule. Great momentum! 🚀",
    'market': "Market sentiment is currently 'Cautiously Optimistic'. VIX is low at 13.2. Good time to deploy cash into large caps.",
    'default': "I am F.I.N.N (Financial Intelligence Neural Network). I can simulate scenarios, audit your spending, or optimize your tax strategy. Ready when you are."
};

const TypewriterText: React.FC<{ text: string; onComplete?: () => void }> = ({ text, onComplete }) => {
    const [displayedText, setDisplayedText] = useState('');
    const isVisible = usePageVisibility();

    useEffect(() => {
        if (!isVisible) return;
        let i = 0;
        const timer = setInterval(() => {
            setDisplayedText(text.slice(0, i + 1));
            i++;
            if (i >= text.length) {
                clearInterval(timer);
                onComplete?.();
            }
        }, 15); // Faster typing speed for "Tech" feel
        return () => clearInterval(timer);
    }, [text, onComplete, isVisible]);

    return <p className="text-sm leading-relaxed text-indigo-100 font-medium font-mono">{displayedText}</p>;
};

const AICopilotWidget: React.FC<AICopilotWidgetProps> = ({ formatCurrency = (v) => `₹${v.toLocaleString()}` }) => {
    const [query, setQuery] = useState('');
    const [conversation, setConversation] = useState<{ type: 'user' | 'ai'; text: string; id: number }[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const isVisible = usePageVisibility();

    // Initial greeting
    useEffect(() => {
        if (conversation.length === 0) {
            setConversation([{ type: 'ai', text: AI_RESPONSES['default'], id: Date.now() }]);
        }
    }, [conversation.length]);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [conversation, isThinking]);

    const handleQuery = async (text: string) => {
        if (!text.trim()) return;

        const userMsg = { type: 'user' as const, text, id: Date.now() };
        setConversation(prev => [...prev, userMsg]);
        setQuery('');
        setIsThinking(true);

        // Simulate network delay
        await new Promise(r => setTimeout(r, 1500));

        let responseKey = 'default';
        const lower = text.toLowerCase();
        if (lower.includes('portfolio') || lower.includes('health')) responseKey = 'portfolio';
        else if (lower.includes('save') || lower.includes('saving')) responseKey = 'saving';
        else if (lower.includes('goal') || lower.includes('track')) responseKey = 'goals';
        else if (lower.includes('market') || lower.includes('sentiment')) responseKey = 'market';

        setConversation(prev => [...prev, { type: 'ai' as const, text: AI_RESPONSES[responseKey], id: Date.now() + 1 }]);
        setIsThinking(false);
    };

    return (
        <div className="relative bg-slate-950 rounded-3xl border border-indigo-500/20 shadow-2xl overflow-hidden h-full flex flex-col group ring-1 ring-white/5">
            {/* Holographic Grid Background */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.05)_1px,transparent_1px)] bg-[size:30px_30px] pointer-events-none perspective-[500px]" style={{ transform: 'perspective(500px) rotateX(20deg)' }} />
            <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/20 via-transparent to-slate-950 pointer-events-none" />

            {/* Moving Scanner Line */}
            <div className={`absolute inset-0 bg-gradient-to-b from-transparent via-indigo-500/5 to-transparent h-[50%] pointer-events-none ${isVisible ? 'animate-scan' : ''}`} />

            {/* Header */}
            <div className="relative z-10 flex items-center justify-between px-5 pt-5 pb-3 border-b border-indigo-500/10">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-10 h-10 bg-indigo-600/20 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(79,70,229,0.3)] border border-indigo-500/30">
                            <Bot size={20} className="text-indigo-400" />
                        </div>
                        <div className={`absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-950 shadow-[0_0_10px_#10b981] ${isVisible ? 'animate-pulse' : ''}`} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white tracking-wide flex items-center gap-2">
                            F.I.N.N <span className="text-[10px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 rounded font-mono">BETA</span>
                        </h3>
                        <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mt-0.5">Neural Interface V2.0</p>
                    </div>
                </div>
                <button
                    onClick={() => setConversation([])}
                    className="p-2 text-slate-500 hover:text-white transition-colors hover:bg-white/5 rounded-lg"
                    title="Reset Context"
                >
                    <Sparkles size={16} />
                </button>
            </div>

            {/* Chat Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 relative z-10 scrollbar-thin scrollbar-thumb-indigo-900/50 scrollbar-track-transparent">
                <AnimatePresence initial={false}>
                    {conversation.map((msg) => (
                        <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, x: msg.type === 'user' ? 20 : -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${msg.type === 'user'
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 rounded-br-none'
                                : 'bg-slate-900/80 border border-indigo-500/20 text-slate-200 backdrop-blur-md rounded-bl-none shadow-xl'
                                }`}>
                                {msg.type === 'ai' ? (
                                    <div className="flex gap-3">
                                        <div className="mt-1">
                                            <BrainCircuit size={16} className="text-indigo-400" />
                                        </div>
                                        <TypewriterText text={msg.text} />
                                    </div>
                                ) : (
                                    <p className="text-sm font-medium">{msg.text}</p>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {isThinking && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                        <div className="bg-slate-900/50 border border-indigo-500/10 px-4 py-3 rounded-2xl rounded-bl-none flex items-center gap-1.5 backdrop-blur-sm">
                            <span className={`text-xs font-mono text-indigo-400 mr-2 ${isVisible ? 'animate-pulse' : ''}`}>PROCESSING</span>
                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" />
                        </div>
                    </motion.div>
                )}
            </div>

            {/* Input & Quick Actions */}
            <div className="relative z-10 px-4 pb-4 pt-2 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent">
                {/* Horizontal Scroll Chips */}
                {conversation.length < 3 && (
                    <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none mask-fade-sides">
                        {QUICK_ACTIONS.map(action => (
                            <button
                                key={action.id}
                                onClick={() => handleQuery(action.prompt)}
                                className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-indigo-950/20 border border-indigo-500/20 hover:border-indigo-400/50 hover:bg-indigo-900/30 rounded-full transition-all group/chip"
                            >
                                <div className="text-indigo-400 group-hover/chip:text-indigo-300 transition-colors">
                                    {action.icon}
                                </div>
                                <span className="text-[10px] font-bold text-slate-400 group-hover/chip:text-white whitespace-nowrap">
                                    {action.label}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {/* Input Field */}
                <div className="relative group/input">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl opacity-20 group-focus-within/input:opacity-75 transition-opacity duration-500 blur-sm" />
                    <div className="relative flex items-center bg-slate-900 rounded-xl overflow-hidden border border-slate-800 group-focus-within/input:border-transparent transition-colors">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleQuery(query)}
                            placeholder="Ask F.I.N.N..."
                            className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder:text-slate-600 outline-none font-medium"
                            disabled={isThinking}
                        />
                        <button
                            onClick={() => handleQuery(query)}
                            disabled={!query.trim() || isThinking}
                            className="p-2 mr-1 text-slate-400 hover:text-indigo-400 disabled:opacity-50 transition-colors"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes scan {
                    0% { transform: translateY(-100%); }
                    100% { transform: translateY(200%); }
                }
                .animate-scan {
                    animation: scan 8s linear infinite;
                }
            `}</style>

        </div>
    );
};

export default AICopilotWidget;
