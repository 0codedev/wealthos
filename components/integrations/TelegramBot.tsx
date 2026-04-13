import React, { useState } from 'react';
import { Send, Bell, Shield, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Investment } from '../../types';

interface TelegramBotProps {
    investments: Investment[];
}

export const TelegramBot: React.FC<TelegramBotProps> = ({ investments }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [botToken, setBotToken] = useState('');
    const [chatId, setChatId] = useState('');
    const [message, setMessage] = useState('');

    const handleConnect = () => {
        if (!botToken.trim() || !chatId.trim()) return;
        setIsConnecting(true);
        // Simulate waiting
        setTimeout(() => {
            setIsConnected(true);
            setIsConnecting(false);
            setShowConfig(false);
        }, 1000);
    };

    const handleSend = () => {
        if (!message) return;
        setMessage('');
        // Logic to send would go here
    };

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 h-full flex flex-col relative overflow-hidden group">
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                    <Send className="text-sky-500" size={20} /> Telegram
                </h3>
                <div className="flex items-center gap-2">
                    {isConnected && (
                        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" title="Connected" />
                    )}
                    <button
                        onClick={() => setShowConfig(!showConfig)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <Shield size={16} />
                    </button>
                </div>
            </div>

            {/* Configuration View */}
            {(showConfig || !isConnected) && (
                <div className="flex-1 flex flex-col space-y-3 animate-in fade-in slide-in-from-top-2">
                    <p className="text-xs text-slate-500 font-medium">Configure Bot Credentials</p>
                    <input
                        type="password"
                        placeholder="Bot Token"
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                        className="w-full p-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-sky-500 outline-none font-mono"
                    />
                    <input
                        type="text"
                        placeholder="Chat ID"
                        value={chatId}
                        onChange={(e) => setChatId(e.target.value)}
                        className="w-full p-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-sky-500 outline-none font-mono"
                    />
                    <button
                        onClick={handleConnect}
                        disabled={!botToken || !chatId || isConnecting}
                        className="w-full py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg font-bold text-xs transition-colors"
                    >
                        {isConnecting ? 'Connecting...' : 'Save & Connect'}
                    </button>
                    {!isConnected && (
                        <p className="text-[10px] text-slate-400 text-center mt-2">
                            Enter credentials to enable real-time alerts.
                        </p>
                    )}
                </div>
            )}

            {/* Main Interactive View (Only when connected and config hidden) */}
            {isConnected && !showConfig && (
                <div className="flex-1 flex flex-col animate-in fade-in">
                    <div className="flex-1 flex items-center justify-center opacity-50 overflow-hidden">
                        <Send size={40} className="text-sky-100 dark:text-sky-900/30 -rotate-12 transform scale-150" />
                    </div>

                    <div className="mt-auto space-y-2">
                        <div className="flex gap-2">
                            <input
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder="Type a manual alert..."
                                className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-sky-500 outline-none"
                            />
                            <button
                                onClick={handleSend}
                                className="bg-sky-500 hover:bg-sky-600 text-white p-2 rounded-lg transition-colors"
                            >
                                <Send size={14} />
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-400 text-center">
                            Bot is active: Monitoring anomalies & SIPs
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TelegramBot;
