import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, User, Send, Sparkles, AlertTriangle, Trash2, Download } from 'lucide-react';
import { usePortfolio } from '../../hooks/usePortfolio';
import { chatWithGemini } from '../../services/aiService';
import { ChatPart } from '../../types/ai';
import { formatCurrency } from '../../utils/helpers';

// Storage key for debate history
const BOARDROOM_STORAGE_KEY = 'boardroom_debate_history';

// Persona Definitions
const PERSONAS = [
    {
        id: 'oracle',
        name: 'The Oracle',
        role: 'Value Investor',
        avatar: '👴',
        color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
        systemPrompt: "You are 'The Oracle'. You speak in folksy wisdom, metaphors, and focus deeply on long-term value, moats, and patience. You are skeptical of crypto, hype, and high fees. You love productive assets. Always be polite but firm about fundamentals."
    },
    {
        id: 'futurist',
        name: 'The Futurist',
        role: 'Tech Maximalist',
        avatar: '🚀',
        color: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-200',
        systemPrompt: "You are 'The Futurist'. You are obsessed with disruption, AI, crypto, and exponential growth. You find traditional value investing boring. You encourage taking big bets on the future. You use modern slang (mildly) and are very optimistic."
    },
    {
        id: 'realist',
        name: 'The Ray',
        role: 'Macro Strategist',
        avatar: '🌐',
        color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
        systemPrompt: "You are 'The Ray'. You focus on macroeconomic cycles, debt crises, and diversification across asset classes and geographies. You are data-driven, slightly pessimistic, and obsessed with risk management and 'all-weather' portfolios."
    }
];

interface Message {
    id: string;
    sender: 'user' | 'oracle' | 'futurist' | 'realist';
    text: string;
    timestamp: Date;
}

export const Boardroom: React.FC = () => {
    const { investments, stats } = usePortfolio();

    // Initialize messages from localStorage
    const [messages, setMessages] = useState<Message[]>(() => {
        try {
            const saved = localStorage.getItem(BOARDROOM_STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
            }
        } catch (e) {
            console.warn('Failed to load boardroom history');
        }
        return [];
    });

    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Save messages to localStorage whenever they change
    useEffect(() => {
        if (messages.length > 0) {
            try {
                localStorage.setItem(BOARDROOM_STORAGE_KEY, JSON.stringify(messages));
            } catch (e) {
                console.warn('Failed to save boardroom history');
            }
        }
    }, [messages]);

    // Clear history handler
    const clearHistory = useCallback(() => {
        localStorage.removeItem(BOARDROOM_STORAGE_KEY);
        setMessages([]);
    }, []);

    // Export history handler
    const exportHistory = useCallback(() => {
        const text = messages.map(m => {
            const name = m.sender === 'user' ? 'You' : PERSONAS.find(p => p.id === m.sender)?.name || m.sender;
            return `[${new Date(m.timestamp).toLocaleString()}] ${name}: ${m.text}`;
        }).join('\n\n');

        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `boardroom_debate_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }, [messages]);

    // Initial Greeting
    useEffect(() => {
        if (messages.length === 0) {
            setMessages([
                { id: '1', sender: 'oracle', text: "Welcome to the boardroom. Let's discuss the long-term value of your holdings.", timestamp: new Date() },
                { id: '2', sender: 'realist', text: "We need to look at the risk exposure first. How is your diversification?", timestamp: new Date() },
                { id: '3', sender: 'futurist', text: "Boring! Let's talk about where the 100x growth is coming from!", timestamp: new Date() }
            ]);
        }
    }, [messages.length]);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    const handleSend = async () => {
        if (!input.trim()) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            sender: 'user',
            text: input,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput('');

        // Trigger AI Responses
        await generateResponses(input);
    };

    const generateResponses = async (userQuery: string) => {
        // Construct Context
        const portfolioContext = `
            User Portfolio Context:
            Total Net Worth: ${formatCurrency(stats?.totalCurrent || 0)}
            Top Holdings: ${investments.slice(0, 5).map(inv => `${inv.name} (${inv.currentValue})`).join(', ')}
            Asset Allocation: TBD
        `;

        // We'll pick 1 or 2 personas to respond to avoid clutter, or all 3 if it's a broad question
        // For now, let's have them response in order

        const sequence = ['oracle', 'futurist', 'realist'];

        for (const personaId of sequence) {
            const persona = PERSONAS.find(p => p.id === personaId)!;
            setIsTyping(personaId);

            try {
                const history = messages
                    .filter(m => m.sender === 'user' || m.sender === personaId)
                    .map(m => ({
                        role: m.sender === 'user' ? 'user' : 'model',
                        parts: [{ text: m.text }] as ChatPart[]
                    }));

                // Add current context to the specific prompt
                const fullPrompt = `${portfolioContext}\n\nUser Question: ${userQuery}\n\nRespond as your persona. Keep it under 2 sentences.`;

                // Call AI
                const responseText = await chatWithGemini(
                    'gemini-2.5-flash',
                    history,
                    fullPrompt,
                    persona.systemPrompt
                );

                setMessages(prev => [...prev, {
                    id: Date.now().toString() + personaId,
                    sender: personaId as any,
                    text: responseText,
                    timestamp: new Date()
                }]);

            } catch (error) {
                console.error(`Error getting response from ${persona.name}:`, error);
            }

            setIsTyping(null);
            // Small delay between speakers
            await new Promise(r => setTimeout(r, 1000));
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] bg-white dark:bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-200 dark:border-slate-800">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-between items-center">
                <div>
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Sparkles className="text-yellow-500" size={20} />
                        AI Boardroom
                    </h2>
                    <p className="text-xs text-slate-500">The Council is in session</p>
                </div>

                {/* Personas Status */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={exportHistory}
                        disabled={messages.length === 0}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-50 transition-colors"
                        title="Export debate history"
                    >
                        <Download size={16} />
                    </button>
                    <button
                        onClick={clearHistory}
                        disabled={messages.length === 0}
                        className="p-1.5 text-slate-400 hover:text-rose-500 disabled:opacity-50 transition-colors"
                        title="Clear history"
                    >
                        <Trash2 size={16} />
                    </button>
                    <div className="flex -space-x-2 ml-2">
                        {PERSONAS.map(p => (
                            <div key={p.id} className={`w-8 h-8 rounded-full border-2 border-white dark:border-slate-800 flex items-center justify-center text-sm cursor-help ${p.color}`} title={p.name}>
                                {p.avatar}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Chat Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/50">
                {messages.map((msg) => {
                    const isUser = msg.sender === 'user';
                    const persona = !isUser ? PERSONAS.find(p => p.id === msg.sender) : null;

                    return (
                        <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                            {!isUser && (
                                <div className={`w-8 h-8 rounded-full flex-shrink-0 mr-2 flex items-center justify-center text-sm shadow-sm ${persona?.color}`}>
                                    {persona?.avatar}
                                </div>
                            )}

                            <div className={`max-w-[70%] p-3 rounded-2xl shadow-sm border ${isUser
                                ? 'bg-indigo-600 text-white rounded-tr-none border-indigo-600'
                                : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-tl-none border-slate-100 dark:border-slate-700'
                                }`}>
                                {!isUser && (
                                    <p className="text-xs font-bold mb-1 opacity-70">{persona?.name}</p>
                                )}
                                <p className="text-sm leading-relaxed">{msg.text}</p>
                            </div>

                            {isUser && (
                                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex-shrink-0 ml-2 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                                    <User size={16} />
                                </div>
                            )}
                        </div>
                    );
                })}

                {isTyping && (
                    <div className="flex justify-start items-center gap-2 text-xs text-slate-400 ml-12 animate-pulse">
                        <span>{PERSONAS.find(p => p.id === isTyping)?.name} is thinking...</span>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask the council for advice..."
                        className="flex-1 px-4 py-3 bg-slate-100 dark:bg-slate-800 border-transparent focus:border-indigo-500 focus:ring-0 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 transition-all"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || !!isTyping}
                        className="p-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl shadow-lg shadow-indigo-500/20 transition-all"
                    >
                        <Send size={20} />
                    </button>
                </div>
                <div className="mt-2 text-center">
                    <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
                        <AlertTriangle size={10} />
                        AI generated content. Not financial advice.
                    </p>
                </div>
            </div>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(Boardroom);
