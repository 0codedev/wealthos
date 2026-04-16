
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ShieldCheck, ShieldAlert, Zap, Target, Search, AlertCircle, ChevronRight, Scale } from 'lucide-react';
import { Trade } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { llmPipeline } from '../../services/llm';
import { logger } from '../../services/Logger';
import { EmptyState } from '../shared/EmptyState';

interface TradeAuditorProps {
    trades: Trade[];
    onClose?: () => void;
}

export const TradeAuditor: React.FC<TradeAuditorProps> = ({ trades, onClose }) => {
    const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);
    const [isAuditing, setIsAuditing] = useState(false);
    const [auditResult, setAuditResult] = useState<string | null>(null);

    const auditedTrades = useMemo(() => {
        return trades.filter(t => t.marketThesis && t.coreLesson).sort((a, b) => {
            // Sort by loss magnitude to find the most "important" lessons
            return (a.pnl || 0) - (b.pnl || 0);
        });
    }, [trades]);

    const selectedTrade = useMemo(() => {
        return auditedTrades.find(t => t.id === selectedTradeId);
    }, [auditedTrades, selectedTradeId]);

    const handleAudit = async () => {
        if (!selectedTrade) return;
        setIsAuditing(true);
        
        const prompt = `
            You are a Trading Compliance Auditor. Compare this trader's pre-trade thesis with their post-trade lesson.
            
            TRADE: ${selectedTrade.ticker} (${selectedTrade.direction})
            PNL: ${selectedTrade.pnl}
            THESIS: "${selectedTrade.marketThesis}"
            LESSON: "${selectedTrade.coreLesson}"
            
            GOAL: Identify if the trader is lying to themselves or if they followed their process.
            Detect "Thesis-Lesson Mismatch" (e.g. thesis was logic-based but lesson was emotional).
            
            Return ONLY a 2-3 sentence verdict. Be direct and objective.
        `;

        try {
            const response = await llmPipeline(prompt, {
                modelOverride: 'gemini-3.1-flash-lite-preview',
                requireHighIntelligence: false
            });
            setAuditResult(response.text);
        } catch (error) {
            logger.error("TradeAuditor: AI Audit failed", error);
            setAuditResult("Compliance Audit unavailable at this moment.");
        } finally {
            setIsAuditing(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-950 text-slate-200">
            {/* Header */}
            <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-lg">
                        <Scale className="text-indigo-400" size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">AI Compliance Auditor</h2>
                        <p className="text-xs text-slate-500">Mapping Thesis vs. Reality</p>
                    </div>
                </div>
                {onClose && (
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        Close
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                {/* List of Trades */}
                <div className="w-full md:w-1/3 border-r border-slate-800 overflow-y-auto custom-scrollbar">
                    <div className="p-4 space-y-2">
                        {auditedTrades.length === 0 ? (
                            <EmptyState
                                variant="minimal"
                                type="no-trades"
                                message="No trades found with both Thesis and Lessons logged."
                                icon={Search}
                            />
                        ) : (
                            auditedTrades.map(trade => (
                                <button
                                    key={trade.id}
                                    onClick={() => {
                                        setSelectedTradeId(trade.id!);
                                        setAuditResult(null);
                                    }}
                                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                                        selectedTradeId === trade.id
                                            ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/20'
                                            : 'bg-slate-900/50 border-slate-800/50 hover:bg-slate-900'
                                    }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-sm">{trade.ticker}</span>
                                        <span className={`text-[10px] font-mono font-bold ${trade.pnl && trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                            {trade.pnl ? (trade.pnl >= 0 ? '+' : '') + formatCurrency(trade.pnl) : '0.00'}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 truncate mb-2">{trade.date}</p>
                                    <div className="flex gap-1 overflow-hidden">
                                        {trade.mistakes?.slice(0, 2).map(m => (
                                            <span key={m} className="text-[8px] bg-slate-800 px-1.5 py-0.5 rounded text-slate-400 border border-slate-700">{m}</span>
                                        ))}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Audit View */}
                <div className="flex-1 p-6 overflow-y-auto custom-scrollbar bg-slate-950/50">
                    <AnimatePresence mode="wait">
                        {selectedTrade ? (
                            <motion.div
                                key={selectedTrade.id}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="space-y-6"
                            >
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                                        <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <Brain size={12} /> The Thesis (Logic)
                                        </h3>
                                        <p className="text-sm text-slate-300 leading-relaxed italic">
                                            "{selectedTrade.marketThesis}"
                                        </p>
                                    </div>
                                    <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                                        <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            <ShieldCheck size={12} /> The Lesson (Reality)
                                        </h3>
                                        <p className="text-sm text-slate-300 leading-relaxed italic">
                                            "{selectedTrade.coreLesson}"
                                        </p>
                                    </div>
                                </div>

                                <div className="flex justify-center py-4">
                                    <button
                                        onClick={handleAudit}
                                        disabled={isAuditing}
                                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold text-sm flex items-center gap-2 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50"
                                    >
                                        {isAuditing ? <Zap className="animate-spin" size={16} /> : <Search size={16} />}
                                        {isAuditing ? 'Auditing Self-Deception...' : 'Perform Compliance Audit'}
                                    </button>
                                </div>

                                {auditResult && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="bg-indigo-500/10 border border-indigo-500/30 p-6 rounded-2xl relative overflow-hidden"
                                    >
                                        <div className="absolute top-0 right-0 p-4 opacity-10">
                                            <Zap size={80} className="text-indigo-400" />
                                        </div>
                                        <h3 className="text-sm font-black text-indigo-300 uppercase mb-4 flex items-center gap-2">
                                            <ShieldAlert size={16} /> AI Auditor's Verdict
                                        </h3>
                                        <p className="text-base text-slate-200 leading-relaxed relative z-10">
                                            {auditResult}
                                        </p>
                                        <div className="mt-6 flex items-center gap-4">
                                            <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                                                <div 
                                                    className={`h-full ${auditResult.includes('Gap') ? 'bg-amber-500 w-1/2' : auditResult.includes('Mismatch') ? 'bg-rose-500 w-1/4' : 'bg-emerald-500 w-full'}`} 
                                                />
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-500 uppercase">Compliance Health</span>
                                        </div>
                                    </motion.div>
                                )}

                                <div className="grid grid-cols-3 gap-4 pt-4">
                                    <div className="text-center">
                                        <p className="text-[10px] text-slate-500 uppercase mb-1">Compliance Score</p>
                                        <p className="text-lg font-bold text-white">{selectedTrade.complianceScore || 0}%</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] text-slate-500 uppercase mb-1">Tilt Score</p>
                                        <p className="text-lg font-bold text-rose-400">{selectedTrade.tiltScore || 0}%</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] text-slate-500 uppercase mb-1">Grade</p>
                                        <p className={`text-lg font-bold ${selectedTrade.grade?.includes('A') ? 'text-emerald-400' : 'text-amber-400'}`}>{selectedTrade.grade || 'N/A'}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                                <ShieldCheck size={48} className="mb-4 text-slate-700" />
                                <h3 className="text-lg font-bold mb-2">Select a trade to audit</h3>
                                <p className="text-sm max-w-xs">Select a trade from the left to compare your pre-trade thesis with your post-trade lesson.</p>
                            </div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};
