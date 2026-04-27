import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Newspaper, RefreshCw, Layers, TrendingUp, Zap, Calendar, MessageSquare, Info } from 'lucide-react';
import { TelegramSummarizerService, MarketBrief } from '../../../services/TelegramSummarizerService';

import { usePageVisibility } from '../../../contexts/PageVisibilityContext';

export const MarketBriefCard: React.FC = () => {
    const [brief, setBrief] = useState<MarketBrief | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [messageCount, setMessageCount] = useState(0);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const isVisible = usePageVisibility();

    // Sync buffer count from service
    useEffect(() => {
        const interval = setInterval(() => {
            if (!isVisible) return;
            setMessageCount(TelegramSummarizerService.getBuffer().length);
        }, 1000);
        return () => clearInterval(interval);
    }, [isVisible]);

    // WebSocket Listener
    useEffect(() => {
        let ws: WebSocket;
        
        const connect = () => {
            ws = new WebSocket('ws://localhost:8080');
            
            ws.onopen = () => setIsListening(true);
            ws.onclose = () => {
                setIsListening(false);
                setTimeout(connect, 5000); // Reconnect
            };
            
            ws.onmessage = async (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'MARKET_MESSAGE') {
                        await TelegramSummarizerService.addMessage(data.text, data.senderName);
                    }
                } catch (error) {
                    console.error("MarketBriefCard WS Error:", error);
                }
            };
        };

        connect();
        return () => {
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
        };
    }, []);

    const generateBrief = async () => {
        setIsLoading(true);
        try {
            const result = await TelegramSummarizerService.generateBrief();
            if (result) {
                setBrief(result);
                setLastUpdated(new Date());
            }
        } catch (error) {
            console.error("Failed to generate brief:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-slate-900/40 border border-indigo-500/20 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden mb-6">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-indigo-500/20 rounded-xl text-indigo-400">
                        <Newspaper className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white tracking-tight">Today's Market Brief</h2>
                        <div className="flex items-center space-x-2 text-xs text-slate-400">
                            <span className={`inline-block w-2 h-2 rounded-full ${isListening ? `bg-emerald-500 ${isVisible ? 'animate-pulse' : ''}` : 'bg-red-500'}`} />
                            <span>{isListening ? 'Collecting Intelligence' : 'Ear Offline'}</span>
                            <span className="text-slate-600">|</span>
                            <span>{messageCount} messages in buffer</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    <button 
                        onClick={generateBrief}
                        disabled={isLoading || messageCount === 0}
                        className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all ${
                            isLoading || messageCount === 0 
                            ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                        }`}
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        <span>{isLoading ? 'Synthesizing...' : 'Refresh Brief'}</span>
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {!brief ? (
                <div className="py-12 flex flex-col items-center justify-center text-center border border-dashed border-slate-800 rounded-xl">
                    <MessageSquare className="w-12 h-12 text-slate-700 mb-4" />
                    <p className="text-slate-400 text-sm max-w-xs">
                        {messageCount > 0 
                            ? `${messageCount} messages collected. Click Refresh to generate your first AI summary.`
                            : "Waiting for market analysis from Telegram channels..."}
                    </p>
                </div>
            ) : (
                <motion.div 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }}
                    className="grid grid-cols-1 lg:grid-cols-2 gap-6"
                >
                    {/* Left Column: Outlooks */}
                    <div className="space-y-6">
                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                            <div className="flex items-center space-x-2 mb-3 text-emerald-400">
                                <TrendingUp className="w-4 h-4" />
                                <h3 className="text-sm font-semibold uppercase tracking-wider">Nifty Outlook</h3>
                            </div>
                            <p className="text-slate-300 text-sm leading-relaxed">{brief.niftyOutlook}</p>
                        </div>

                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                            <div className="flex items-center space-x-2 mb-3 text-blue-400">
                                <TrendingUp className="w-4 h-4" />
                                <h3 className="text-sm font-semibold uppercase tracking-wider">BankNifty Outlook</h3>
                            </div>
                            <p className="text-slate-300 text-sm leading-relaxed">{brief.bankNiftyOutlook}</p>
                        </div>

                        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                            <div className="flex items-center space-x-2 mb-3 text-amber-400">
                                <Layers className="w-4 h-4" />
                                <h3 className="text-sm font-semibold uppercase tracking-wider">Option Data Flow</h3>
                            </div>
                            <p className="text-slate-300 text-sm leading-relaxed">{brief.optionData}</p>
                        </div>
                    </div>

                    {/* Right Column: Levels & Events */}
                    <div className="space-y-6">
                        <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
                            <div className="px-4 py-3 bg-slate-800/50 border-b border-slate-800 flex justify-between items-center">
                                <h3 className="text-xs font-bold text-slate-400 uppercase">Intraday Key Levels</h3>
                                <Zap className="w-3 h-3 text-indigo-400" />
                            </div>
                            <div className="p-4 space-y-4">
                                <div>
                                    <span className="text-[10px] text-emerald-500 uppercase font-bold block mb-2">🟢 Support Zones</span>
                                    <div className="flex flex-wrap gap-2">
                                        {brief.keyLevels.support.map((lvl, idx) => (
                                            <span key={idx} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-medium">
                                                {lvl.toLocaleString()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="pt-2 border-t border-slate-800/50">
                                    <span className="text-[10px] text-red-500 uppercase font-bold block mb-2">🔴 Resistance Barriers</span>
                                    <div className="flex flex-wrap gap-2">
                                        {brief.keyLevels.resistance.map((lvl, idx) => (
                                            <span key={idx} className="bg-red-500/10 border border-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-medium">
                                                {lvl.toLocaleString()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4">
                                <div className="flex items-center space-x-2 mb-3 text-indigo-400">
                                    <Calendar className="w-4 h-4" />
                                    <h3 className="text-xs font-bold uppercase">Macro Events</h3>
                                </div>
                                <ul className="space-y-2">
                                    {brief.macroEvents.map((evt, idx) => (
                                        <li key={idx} className="text-xs text-slate-400 flex items-start space-x-2">
                                            <span className="text-indigo-500 mt-1">•</span>
                                            <span>{evt}</span>
                                        </li>
                                    ))}
                                    {brief.macroEvents.length === 0 && <li className="text-xs text-slate-600 italic">No events noted</li>}
                                </ul>
                            </div>
                            <div className="bg-slate-800/30 border border-slate-800 rounded-xl p-4">
                                <div className="flex items-center space-x-2 mb-3 text-purple-400">
                                    <Zap className="w-4 h-4" />
                                    <h3 className="text-xs font-bold uppercase">Market Themes</h3>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {brief.topThemes.map((theme, idx) => (
                                        <span key={idx} className="text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded">
                                            {theme}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer Info */}
                    <div className="lg:col-span-2 flex flex-col sm:flex-row sm:items-center justify-between pt-4 border-t border-slate-800 text-[10px] text-slate-500 gap-2">
                        <div className="flex items-center space-x-3">
                            <span className="flex items-center space-x-1">
                                <Info className="w-3 h-3" />
                                <span>Based on {brief.messageCount} messages from {brief.channelsSampled.join(', ')}</span>
                            </span>
                        </div>
                        <div className="flex items-center space-x-2 italic">
                            <span>Synthesized by Groq AI Intelligence</span>
                            <span className="text-slate-700">|</span>
                            <span>{lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : ''}</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
};
