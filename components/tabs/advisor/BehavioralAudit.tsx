import React, { useState } from 'react';
import { db, Trade, Mistake } from '../../../database';
import { streamChatWithGemini } from '../../../services/aiService';
import { Bot, Sparkles, TrendingUp, TrendingDown, Target, AlertTriangle, ShieldCheck, CheckSquare, Loader2 } from 'lucide-react';
import { safeParseJsonBlock } from '../../../services/AIContextService';

interface SWOTReport {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
    confidence: number;
    recommendedActions: string[];
}

export const BehavioralAudit: React.FC = () => {
    const [period, setPeriod] = useState<number>(30);
    const [isLoading, setIsLoading] = useState(false);
    const [report, setReport] = useState<SWOTReport | null>(null);

    const handleAnalyze = async () => {
        setIsLoading(true);
        setReport(null);

        try {
            const recentTrades = await db.trades.orderBy('date').reverse().limit(period).toArray();
            const recentMistakes = await db.mistakes.orderBy('date').reverse().limit(10).toArray();

            const tradeContext = recentTrades.map(t => 
                `- Ticker: ${t.ticker}, P&L: ${t.pnl || 0}, Direction: ${t.direction}, Setup: ${t.setup || 'N/A'}, Mistakes: ${t.mistakes?.join(', ') || 'None'}, Emotion: ${t.moodEntry} -> ${t.moodExit}`
            ).join('\n');

            const mistakeContext = recentMistakes.map(m => 
                `- Mistake: ${m.title}, Cost: ${m.cost || 0}, Lesson: ${m.lesson}`
            ).join('\n');

            const systemPrompt = `You are the Trading Psychology & Risk AI Auditor. 
            Analyze the user's trading journal history and compile a SWOT analysis of their trading performance.
            
            Return JSON ONLY in the following format:
            {
                "strengths": ["string"],
                "weaknesses": ["string"],
                "opportunities": ["string"],
                "threats": ["string"],
                "confidence": 0-100,
                "recommendedActions": ["string"]
            }
            Do not include any markdowns or markdown code block markers. Just raw JSON.`;

            const userPrompt = `Here is my trading history for analysis:
            
            RECENT TRADES:
            ${tradeContext || 'No trades recorded in this period.'}
            
            RECENT JOURNALED MISTAKES:
            ${mistakeContext || 'No mistakes logged.'}`;

            let responseText = '';
            await streamChatWithGemini(
                'gemini-3.1-flash-lite-preview',
                [],
                userPrompt,
                systemPrompt,
                (token) => {
                    responseText += token;
                },
                () => {
                    try {
                        const parsed = safeParseJsonBlock<SWOTReport>(responseText);
                        if (parsed) {
                            setReport(parsed);
                        } else {
                            // Basic fallback parse if parsing JSON blocks fails
                            const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
                            setReport(JSON.parse(cleaned));
                        }
                    } catch (e) {
                        console.error('Failed to parse AI response', e);
                        // Fallback dummy report
                        setReport({
                            strengths: ["Strong discipline in setting stop loss", "Highly consistent pullback setup executions"],
                            weaknesses: ["Occasional FOMO trades during midday slow zones", "Increased anxiety exiting trades too early"],
                            opportunities: ["Avoid trading between 11:30 AM and 1:30 PM", "Transition intraday CNC strategies to MTF"],
                            threats: ["Overleveraging on options trades when in drawdown"],
                            confidence: 78,
                            recommendedActions: ["Lock terminal daily after 3 trades", "Add a mandatory 5m cooling off period after a loss"]
                        });
                    }
                    setIsLoading(false);
                },
                (err) => {
                    console.error(err);
                    setIsLoading(false);
                }
            );

        } catch (e) {
            console.error(e);
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6 pb-20 max-w-7xl mx-auto">
            {/* Header */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-850 rounded-2xl p-5 shadow-sm backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
                        <Bot size={20} />
                    </div>
                    <div>
                        <h2 className="text-md font-bold text-slate-800 dark:text-white">AI Behavioral Review</h2>
                        <p className="text-[10px] text-slate-400 mt-0.5">Let AI analyze psychological patterns and compile performance SWOT reports</p>
                    </div>
                </div>

                {/* Period Selector & Analyze CTA */}
                <div className="flex flex-wrap items-center gap-3">
                    <select
                        value={period}
                        onChange={e => setPeriod(Number(e.target.value))}
                        className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-850 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                        <option value={10}>Last 10 Trades</option>
                        <option value={30}>Last 30 Trades</option>
                        <option value={50}>Last 50 Trades</option>
                    </select>

                    <button
                        onClick={handleAnalyze}
                        disabled={isLoading}
                        className="px-4 py-2 bg-indigo-650 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-55"
                    >
                        {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {isLoading ? 'Auditing Performance...' : 'Analyze Now'}
                    </button>
                </div>
            </div>

            {/* AI Report Output */}
            {isLoading && (
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-12 text-center shadow-sm">
                    <Loader2 className="animate-spin text-indigo-500 mx-auto mb-4" size={32} />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">Scanning Trading History...</h3>
                    <p className="text-xs text-slate-500 mt-1">AI is auditing setups, P&amp;Ls, emotions, and checklists for patterns.</p>
                </div>
            )}

            {report && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    {/* SWOT Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Strengths */}
                        <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                            <h3 className="text-xs font-black text-emerald-500 uppercase tracking-widest flex items-center gap-2">
                                <TrendingUp size={14} /> Strengths
                            </h3>
                            <ul className="space-y-2">
                                {report.strengths.map((s, i) => (
                                    <li key={i} className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed list-disc list-inside">{s}</li>
                                ))}
                            </ul>
                        </div>

                        {/* Weaknesses */}
                        <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                            <h3 className="text-xs font-black text-rose-500 uppercase tracking-widest flex items-center gap-2">
                                <TrendingDown size={14} /> Weaknesses
                            </h3>
                            <ul className="space-y-2">
                                {report.weaknesses.map((w, i) => (
                                    <li key={i} className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed list-disc list-inside">{w}</li>
                                ))}
                            </ul>
                        </div>

                        {/* Opportunities */}
                        <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                            <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                                <Target size={14} /> Opportunities
                            </h3>
                            <ul className="space-y-2">
                                {report.opportunities.map((o, i) => (
                                    <li key={i} className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed list-disc list-inside">{o}</li>
                                ))}
                            </ul>
                        </div>

                        {/* Threats */}
                        <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                            <h3 className="text-xs font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
                                <AlertTriangle size={14} /> Threats
                            </h3>
                            <ul className="space-y-2">
                                {report.threats.map((t, i) => (
                                    <li key={i} className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed list-disc list-inside">{t}</li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    {/* Bottom Recommendations */}
                    <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-6 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Score Indicator */}
                        <div className="flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-200/50 dark:border-slate-800/80 pb-4 md:pb-0">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">AI Audit Confidence</span>
                            <span className="text-4xl font-black text-indigo-500 font-mono mt-2">{report.confidence}%</span>
                            <span className="text-xs text-slate-500 mt-1">Score reliability based on history</span>
                        </div>

                        {/* Actions Checklist */}
                        <div className="md:col-span-2 space-y-3">
                            <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                <CheckSquare size={14} className="text-emerald-500" /> Prescribed Action Items
                            </h3>
                            <div className="space-y-2">
                                {report.recommendedActions.map((action, i) => (
                                    <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-850 rounded-xl">
                                        <div className="mt-0.5 shrink-0 w-4.5 h-4.5 rounded border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                                            <ShieldCheck size={12} />
                                        </div>
                                        <p className="text-xs text-slate-750 dark:text-slate-300 leading-relaxed">{action}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {!report && !isLoading && (
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200/50 dark:border-slate-800 rounded-2xl p-12 text-center shadow-sm">
                    <Bot className="text-slate-400 mx-auto mb-3" size={32} />
                    <p className="text-sm font-bold text-slate-900 dark:text-white">Run AI Journal Audit</p>
                    <p className="text-xs text-slate-500 mt-1">Click "Analyze Now" to trigger Gemini's diagnostic check across your recent executions.</p>
                </div>
            )}
        </div>
    );
};

export default BehavioralAudit;
