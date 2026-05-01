import React, { useState, useEffect } from 'react';
import { liveQuery } from 'dexie';
import { db, Trade, Strategy } from '../../database';
import {
    BookOpen, Plus, Edit2, Trash2, Target, AlertTriangle,
    TrendingUp, TrendingDown, CheckCircle, XCircle, ChevronRight,
    Sparkles, X, Send, Bot, User, RotateCcw, Brain
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { streamChatWithGemini } from '../../services/aiService';

interface PlaybookEntry {
    id: string;
    name: string;
    description: string;
    rules: string[];
    winRate: number;
    avgRMultiple: number;
    totalTrades: number;
    isActive: boolean;
}

interface StrategyPlaybookProps {
    onSelectStrategy?: (strategy: PlaybookEntry) => void;
}

export const StrategyPlaybook: React.FC<StrategyPlaybookProps> = ({ onSelectStrategy }) => {
    const [strategies, setStrategies] = useState<PlaybookEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAdding, setIsAdding] = useState(false);
    const [newStrategy, setNewStrategy] = useState({ name: '', description: '', rules: '' });

    // AI Consultant State
    const [isAiOpen, setIsAiOpen] = useState(false);
    const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'model', text: string }[]>([]);
    const [aiInput, setAiInput] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [selectedForAi, setSelectedForAi] = useState<PlaybookEntry | null>(null);
    const [editingStrategy, setEditingStrategy] = useState<PlaybookEntry | null>(null);

    useEffect(() => {
        const subscription = liveQuery(() => db.strategies.toArray()).subscribe({
            next: (dbStrategies: Strategy[]) => {
                if (dbStrategies && dbStrategies.length > 0) {
                    setStrategies(dbStrategies.map((s: Strategy) => ({
                        id: s.id?.toString() || crypto.randomUUID(),
                        name: s.name,
                        description: s.description || '',
                        rules: s.rules,
                        winRate: s.winRate || 0,
                        avgRMultiple: s.avgRMultiple || 0,
                        totalTrades: s.totalTrades || 0,
                        isActive: s.isActive ?? true
                    })));
                } else if (dbStrategies && dbStrategies.length === 0) {
                    // Seed default if empty
                    setStrategies([
                        {
                            id: '1',
                            name: 'Breakout Hunter',
                            description: 'Trade breakouts from consolidation zones with volume confirmation',
                            rules: ['Wait for at least 5 candles of consolidation', 'Volume must be 1.5x average on breakout', 'Risk maximum 1% per trade', 'Target 2R minimum'],
                            winRate: 62, avgRMultiple: 1.8, totalTrades: 45, isActive: true
                        }
                    ]);
                }
                setIsLoading(false);
            },
            error: (err) => {
                console.error('StrategyPlaybook liveQuery error:', err);
                setIsLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleAddStrategy = async () => {
        if (newStrategy.name && newStrategy.description) {
            const entry = {
                name: newStrategy.name,
                description: newStrategy.description,
                rules: newStrategy.rules.split('\n').filter(r => r.trim()),
                winRate: 0,
                avgRMultiple: 0,
                totalTrades: 0,
                isActive: true
            };
            const id = await db.strategies.add(entry);
            setStrategies([...strategies, { ...entry, id: id.toString() }]);
            setNewStrategy({ name: '', description: '', rules: '' });
            setIsAdding(false);
        }
    };

    const toggleActive = async (id: string) => {
        const strategy = strategies.find(s => s.id === id);
        if (strategy) {
            const newStatus = !strategy.isActive;
            const dbId = parseInt(id);
            if (!isNaN(dbId)) await db.strategies.update(dbId, { isActive: newStatus });
            setStrategies(strategies.map(s => s.id === id ? { ...s, isActive: newStatus } : s));
        }
    };

    const deleteStrategy = async (id: string) => {
        const dbId = parseInt(id);
        if (!isNaN(dbId)) await db.strategies.delete(dbId);
        setStrategies(strategies.filter(s => s.id !== id));
    };

    const handleSendMessage = async () => {
        if (!aiInput.trim() || isAiLoading) return;

        const userMsg = aiInput.trim();
        setAiInput('');
        setAiMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsAiLoading(true);

        let fullResponse = '';
        const history = aiMessages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
        }));

        const systemInstruction = `You are the Wealth Aggregator AI Strategy Consultant. 
        Analyzing Playbook Strategy: ${selectedForAi?.name || 'General Inquiry'}
        Description: ${selectedForAi?.description || 'N/A'}
        Rules: ${selectedForAi?.rules.join(', ') || 'N/A'}
        
        Provide professional, quantitative feedback on the strategy, suggest improvements to the entry/exit rules, or discuss risk management. 
        Keep responses concise and data-driven.`;

        try {
            await streamChatWithGemini(
                'gemini-3.1-flash-lite-preview',
                history,
                userMsg,
                systemInstruction,
                (token) => {
                    fullResponse += token;
                    setAiMessages(prev => {
                        const last = prev[prev.length - 1];
                        if (last && last.role === 'model') {
                            return [...prev.slice(0, -1), { role: 'model', text: fullResponse }];
                        }
                        return [...prev, { role: 'model', text: fullResponse }];
                    });
                },
                () => setIsAiLoading(false),
                (err) => {
                    console.error('AI Pipeline Error:', err);
                    setAiMessages(prev => [...prev, {
                        role: 'model',
                        text: `⚠️ [Intelligence Pipeline Error]: ${err.message}. Please verify your API keys in Settings.`
                    }]);
                    setIsAiLoading(false);
                }
            );
        } catch (err: unknown) {
            console.error('AI Send Message Error:', err);
            const message = err instanceof Error ? err.message : String(err);
            setAiMessages(prev => [...prev, {
                role: 'model',
                text: `⚠️ Fatal Connection Error: ${message}`
            }]);
            setIsAiLoading(false);
        }
    };

    const handleUpdateStrategy = async () => {
        if (editingStrategy) {
            const dbId = parseInt(editingStrategy.id);
            if (!isNaN(dbId)) {
                await db.strategies.update(dbId, {
                    name: editingStrategy.name,
                    description: editingStrategy.description,
                    rules: editingStrategy.rules
                });
                setStrategies(strategies.map(s => s.id === editingStrategy.id ? editingStrategy : s));
                setEditingStrategy(null);
            }
        }
    };

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-amber-500/20">
                        <BookOpen size={24} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            Strategy Playbook
                            <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20 uppercase">Intelligence</span>
                        </h2>
                        <p className="text-sm text-slate-500">Curated rules for consistent edge</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                        onClick={() => {
                            setIsAiOpen(true);
                            if (aiMessages.length === 0) {
                                setAiMessages([{ role: 'model', text: "Hello! I am your Strategy Intelligence Consultant. Select any strategy to analyze or ask me a general question about building an edge." }]);
                            }
                        }}
                        className="flex-1 sm:flex-none px-4 py-2 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl font-bold border border-indigo-500/20 hover:bg-indigo-500/20 transition-all flex items-center justify-center gap-2"
                    >
                        <Sparkles size={18} /> Consult AI
                    </button>
                    <button
                        onClick={() => setIsAdding(true)}
                        className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
                    >
                        <Plus size={18} /> New Strategy
                    </button>
                </div>
            </div>

            {/* Add Strategy Form */}
            {isAdding && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800">
                    <h3 className="font-bold text-slate-900 dark:text-white mb-4">Add New Strategy</h3>
                    <div className="space-y-4">
                        <input
                            type="text"
                            placeholder="Strategy Name"
                            value={newStrategy.name}
                            onChange={(e) => setNewStrategy({ ...newStrategy, name: e.target.value })}
                            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                        />
                        <textarea
                            placeholder="Description"
                            value={newStrategy.description}
                            onChange={(e) => setNewStrategy({ ...newStrategy, description: e.target.value })}
                            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-20"
                        />
                        <textarea
                            placeholder="Rules (one per line)"
                            value={newStrategy.rules}
                            onChange={(e) => setNewStrategy({ ...newStrategy, rules: e.target.value })}
                            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-32"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={handleAddStrategy}
                                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-medium"
                            >
                                Save Strategy
                            </button>
                            <button
                                onClick={() => setIsAdding(false)}
                                className="px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Strategy Form */}
            {editingStrategy && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-indigo-500/30 shadow-xl shadow-indigo-500/5">
                    <div className="flex items-center gap-2 mb-4">
                        <Edit2 size={18} className="text-indigo-500" />
                        <h3 className="font-bold text-slate-900 dark:text-white">Edit Strategy</h3>
                    </div>
                    <div className="space-y-4">
                        <input
                            type="text"
                            placeholder="Strategy Name"
                            value={editingStrategy.name}
                            onChange={(e) => setEditingStrategy({ ...editingStrategy, name: e.target.value })}
                            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                        />
                        <textarea
                            placeholder="Description"
                            value={editingStrategy.description}
                            onChange={(e) => setEditingStrategy({ ...editingStrategy, description: e.target.value })}
                            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-20 text-sm"
                        />
                        <textarea
                            placeholder="Rules (one per line)"
                            value={editingStrategy.rules.join('\n')}
                            onChange={(e) => setEditingStrategy({ ...editingStrategy, rules: e.target.value.split('\n') })}
                            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 h-32 font-mono text-xs"
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={handleUpdateStrategy}
                                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold"
                            >
                                Update Strategy
                            </button>
                            <button
                                onClick={() => setEditingStrategy(null)}
                                className="px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-medium"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Strategies List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 list-rise">
                {isLoading ? (
                    <>
                        {[0, 1, 2, 3].map((i) => (
                            <div
                                key={`skeleton-${i}`}
                                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border-2 border-slate-200 dark:border-slate-800"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 pr-3 space-y-2">
                                        <div className="skeleton h-5 w-2/3" />
                                        <div className="skeleton h-3 w-full" />
                                    </div>
                                    <div className="skeleton h-7 w-7 rounded-lg" />
                                </div>
                                <div className="grid grid-cols-3 gap-2 mb-3">
                                    <div className="skeleton h-12 rounded-lg" />
                                    <div className="skeleton h-12 rounded-lg" />
                                    <div className="skeleton h-12 rounded-lg" />
                                </div>
                                <div className="space-y-2">
                                    <div className="skeleton h-3 w-5/6" />
                                    <div className="skeleton h-3 w-3/4" />
                                </div>
                            </div>
                        ))}
                    </>
                ) : strategies.length === 0 ? (
                    <div className="md:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-10 border-2 border-dashed border-slate-200 dark:border-slate-800 text-center">
                        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-500 mx-auto mb-3 flex items-center justify-center">
                            <BookOpen size={22} />
                        </div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">No strategies yet</p>
                        <p className="text-xs text-slate-500 mt-1">Click "New Strategy" to build your first playbook entry.</p>
                    </div>
                ) : strategies.map(strategy => (
                    <div
                        key={strategy.id}
                        className={`bg-white dark:bg-slate-900 rounded-2xl p-5 border-2 transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-xl ${
                            strategy.isActive
                                ? 'border-indigo-500 shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20'
                                : 'border-slate-200 dark:border-slate-800 opacity-60 hover:opacity-100 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                        onClick={() => {
                            onSelectStrategy?.(strategy);
                            setSelectedForAi(strategy);
                            setIsAiOpen(true);
                            if (aiMessages.length <= 1) {
                                setAiMessages([{ role: 'model', text: `I'm analyzing the "${strategy.name}" strategy. It has ${strategy.rules.length} rules. What would you like to optimize?` }]);
                            }
                        }}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                    {strategy.name}
                                    {strategy.isActive && (
                                        <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs rounded-full">
                                            Active
                                        </span>
                                    )}
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">{strategy.description}</p>
                            </div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleActive(strategy.id); }}
                                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                                >
                                    {strategy.isActive ? <XCircle size={16} className="text-slate-400" /> : <CheckCircle size={16} className="text-emerald-500" />}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setEditingStrategy(strategy); }}
                                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-indigo-500"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); deleteStrategy(strategy.id); }}
                                    className="p-1.5 hover:bg-rose-100 dark:hover:bg-rose-500/20 rounded-lg text-rose-500"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-center">
                                <p className={`text-sm font-bold ${strategy.winRate >= 50 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {strategy.winRate}%
                                </p>
                                <p className="text-[10px] text-slate-500">Win Rate</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-center">
                                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                                    {strategy.avgRMultiple}R
                                </p>
                                <p className="text-[10px] text-slate-500">Avg R</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded-lg text-center">
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                                    {strategy.totalTrades}
                                </p>
                                <p className="text-[10px] text-slate-500">Trades</p>
                            </div>
                        </div>

                        {/* Rules Preview */}
                        <div className="space-y-1">
                            {strategy.rules.slice(0, 2).map((rule, idx) => (
                                <p key={idx} className="text-xs text-slate-500 flex items-center gap-1">
                                    <Target size={10} className="text-indigo-500" /> {rule}
                                </p>
                            ))}
                            {strategy.rules.length > 2 && (
                                <p className="text-xs text-indigo-500 flex items-center gap-1">
                                    <ChevronRight size={10} /> +{strategy.rules.length - 2} more rules
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* AI CONSULTANT SIDEBAR */}
            <AnimatePresence>
                {isAiOpen && (
                    <>
                        <motion.div
                            key="ai-backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={() => setIsAiOpen(false)}
                            className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-[99]"
                        />
                        <motion.div
                            key="ai-panel"
                            initial={{ x: '100%', opacity: 0.6 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: '100%', opacity: 0 }}
                            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                            className="fixed -top-5 right-0 h-full w-[600px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-white/10 shadow-2xl z-[100] flex flex-col"
                        >
                        <div className="p-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
                                    <Brain size={20} className="text-amber-500" />
                                </div>
                                <div>
                                    <h4 className="text-lg font-bold text-slate-900 dark:text-white">Consultant AI</h4>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">Strategy Review</p>
                                </div>
                            </div>
                            <button onClick={() => setIsAiOpen(false)} className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {aiMessages.map((msg, i) => (
                                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] p-4 rounded-2xl text-sm ${msg.role === 'user'
                                            ? 'bg-indigo-600 text-white shadow-lg'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/5'
                                        }`}>
                                        <div className="flex items-center gap-2 mb-1.5 opacity-50">
                                            {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                                            <span className="text-[10px] font-bold uppercase tracking-tighter">{msg.role === 'user' ? 'You' : 'Analyst'}</span>
                                        </div>
                                        {msg.text}
                                    </div>
                                </div>
                            ))}
                            {isAiLoading && (
                                <div className="flex justify-start">
                                    <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-2xl text-slate-300 border border-slate-200 dark:border-white/5 flex items-center gap-2">
                                        <RotateCcw size={14} className="animate-spin text-amber-500" />
                                        <span className="text-xs italic text-slate-500">Synthesizing rules...</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-800/30">
                            {selectedForAi && (
                                <div className="mb-3 flex items-center justify-between p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
                                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400 truncate">Analyzing: {selectedForAi.name}</span>
                                    <button onClick={() => setSelectedForAi(null)} className="text-slate-400 hover:text-rose-500">
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                            <div className="relative">
                                <input
                                    value={aiInput}
                                    onChange={e => setAiInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                                    placeholder="Ask about strategy optimizations..."
                                    className="w-full bg-white dark:bg-slate-950 p-4 pr-12 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-500 transition-all text-sm text-slate-900 dark:text-white shadow-inner"
                                />
                                <button
                                    onClick={handleSendMessage}
                                    disabled={!aiInput.trim() || isAiLoading}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white disabled:opacity-50 shadow-lg shadow-indigo-600/20"
                                >
                                    <Send size={16} />
                                </button>
                            </div>
                        </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

export default StrategyPlaybook;
