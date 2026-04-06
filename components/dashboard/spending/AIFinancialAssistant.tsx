import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bot, Send, Sparkles, TrendingUp, TrendingDown, PiggyBank, Calculator,
    Wallet, Target, Lightbulb, ChevronDown, User, Loader2, XCircle
} from 'lucide-react';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    suggestions?: string[];
}

interface AIFinancialAssistantProps {
    formatCurrency?: (val: number) => string;
    onClose?: () => void;
}

// Pre-defined AI responses for common queries (simulated)
const AI_RESPONSES: Record<string, { response: string; suggestions: string[] }> = {
    'budget': {
        response: "Based on your spending patterns, I recommend the 50/30/20 rule: 50% needs (₹25,000), 30% wants (₹15,000), and 20% savings (₹10,000) for a ₹50,000 monthly income. Your current spending shows you're exceeding 'wants' by 15%. Would you like me to create a custom budget plan?",
        suggestions: ['Create budget plan', 'Show spending breakdown', 'Set savings goal']
    },
    'save': {
        response: "I've identified 3 ways to save more this month:\n\n1. **Subscription audit** - You have 5 active subscriptions totaling ₹2,500/month. Cancel unused ones.\n2. **Dining optimization** - Restaurant spending is 40% of food budget. Cooking 3 more meals/week saves ₹3,000.\n3. **Utility efficiency** - Your electricity bill is 20% above average. Consider energy-saving habits.\n\nPotential monthly savings: ₹8,500",
        suggestions: ['Audit subscriptions', 'Create meal plan', 'Set spending limits']
    },
    'invest': {
        response: "Based on your risk profile and goals, here's my recommendation:\n\n📊 **Emergency Fund**: Already have 3 months covered ✅\n📈 **SIP Allocation**: Increase monthly SIP by ₹5,000 to reach goal faster\n💰 **Tax Saving**: You have ₹50,000 unused in 80C limit\n\nWould you like a detailed investment plan?",
        suggestions: ['Show tax saving options', 'Optimize SIP', 'Project retirement']
    },
    'default': {
        response: "I'm your AI Financial Assistant! I can help you with:\n\n💰 **Budget Planning** - Create and track monthly budgets\n📊 **Spending Analysis** - Identify patterns and optimization opportunities\n🎯 **Goal Setting** - Plan for major purchases, emergency fund, retirement\n💡 **Smart Suggestions** - Personalized tips to improve your finances\n\nWhat would you like to explore?",
        suggestions: ['Help me budget', 'How can I save more?', 'Investment advice']
    }
};

const AIFinancialAssistant: React.FC<AIFinancialAssistantProps> = ({
    formatCurrency = (v) => `₹${v.toLocaleString()}`,
    onClose
}) => {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            role: 'assistant',
            content: "👋 Hi! I'm your AI Financial Assistant. I'm here to help you manage your money smarter. Ask me about budgeting, savings, or investments!",
            timestamp: new Date(),
            suggestions: ['Help me budget', 'How can I save more?', 'Investment advice']
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isExpanded, setIsExpanded] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const getAIResponse = (query: string): { response: string; suggestions: string[] } => {
        const lowerQuery = query.toLowerCase();
        if (lowerQuery.includes('budget') || lowerQuery.includes('plan')) {
            return AI_RESPONSES['budget'];
        }
        if (lowerQuery.includes('save') || lowerQuery.includes('saving') || lowerQuery.includes('cut')) {
            return AI_RESPONSES['save'];
        }
        if (lowerQuery.includes('invest') || lowerQuery.includes('sip') || lowerQuery.includes('mutual')) {
            return AI_RESPONSES['invest'];
        }
        return AI_RESPONSES['default'];
    };

    const handleSend = async (text?: string) => {
        const messageText = text || input.trim();
        if (!messageText) return;

        // Add user message
        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: messageText,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsTyping(true);

        // Simulate AI thinking
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

        // Get response
        const { response, suggestions } = getAIResponse(messageText);

        const assistantMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: response,
            timestamp: new Date(),
            suggestions
        };

        setMessages(prev => [...prev, assistantMessage]);
        setIsTyping(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 via-indigo-950/30 to-slate-900 rounded-3xl border border-indigo-500/20 overflow-hidden shadow-2xl flex flex-col h-[500px]">
            {/* Header */}
            <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                        <Bot size={22} className="text-white" />
                    </div>
                    <div>
                        <h3 className="text-white font-bold flex items-center gap-2">
                            AI Financial Assistant
                            <Sparkles size={14} className="text-amber-300" />
                        </h3>
                        <p className="text-white/60 text-xs">Powered by WealthAgg AI</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <ChevronDown size={18} className={`text-white transition-transform ${isExpanded ? '' : 'rotate-180'}`} />
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                            <XCircle size={18} className="text-white/60 hover:text-white" />
                        </button>
                    )}
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="flex-1 flex flex-col overflow-hidden"
                    >
                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {messages.map((message) => (
                                <motion.div
                                    key={message.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div className={`max-w-[85%] ${message.role === 'user' ? 'order-1' : 'order-2'}`}>
                                        <div className={`rounded-2xl px-4 py-3 ${message.role === 'user'
                                                ? 'bg-indigo-600 text-white rounded-tr-sm'
                                                : 'bg-slate-800 text-slate-200 rounded-tl-sm border border-slate-700'
                                            }`}>
                                            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                                        </div>

                                        {/* Suggestions */}
                                        {message.suggestions && message.suggestions.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                {message.suggestions.map((suggestion, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => handleSend(suggestion)}
                                                        className="text-xs px-3 py-1.5 bg-indigo-500/20 text-indigo-400 rounded-full hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors"
                                                    >
                                                        {suggestion}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <p className="text-[9px] text-slate-500 mt-1">
                                            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mx-2 ${message.role === 'user'
                                            ? 'bg-slate-700 order-2'
                                            : 'bg-indigo-500/20 order-1'
                                        }`}>
                                        {message.role === 'user'
                                            ? <User size={14} className="text-slate-300" />
                                            : <Bot size={14} className="text-indigo-400" />
                                        }
                                    </div>
                                </motion.div>
                            ))}

                            {/* Typing indicator */}
                            {isTyping && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="flex items-center gap-3"
                                >
                                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                                        <Bot size={14} className="text-indigo-400" />
                                    </div>
                                    <div className="flex items-center gap-1 px-4 py-2 bg-slate-800 rounded-2xl border border-slate-700">
                                        <Loader2 size={14} className="text-indigo-400 animate-spin" />
                                        <span className="text-xs text-slate-400">AI is thinking...</span>
                                    </div>
                                </motion.div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input */}
                        <div className="p-4 border-t border-slate-800 bg-slate-900/50">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask about budgets, savings, investments..."
                                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm placeholder:text-slate-500 focus:border-indigo-500 outline-none transition-colors"
                                />
                                <button
                                    onClick={() => handleSend()}
                                    disabled={!input.trim() || isTyping}
                                    className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-xl transition-colors"
                                >
                                    <Send size={18} />
                                </button>
                            </div>
                            <div className="flex items-center gap-3 mt-3 overflow-x-auto pb-1">
                                <span className="text-[10px] text-slate-500 shrink-0">Quick:</span>
                                {['Budget tips', 'Save money', 'Track spending', 'Set goal'].map(quick => (
                                    <button
                                        key={quick}
                                        onClick={() => handleSend(quick)}
                                        className="text-[10px] px-2 py-1 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 hover:text-white border border-slate-700 whitespace-nowrap transition-colors"
                                    >
                                        {quick}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default AIFinancialAssistant;
