import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
    Link, Globe, ShieldCheck, Copy, 
    Terminal, Settings, Activity, Check, Plus
} from 'lucide-react';

interface WebhookStrategy {
    id: string;
    name: string;
    status: 'active' | 'paused';
    hits: number;
    lastHit: string | null;
    url: string;
}

const WebhookManagerWidget: React.FC = () => {
    const [copied, setCopied] = useState<string | null>(null);
    
    const [strategies] = useState<WebhookStrategy[]>([
        { id: '1', name: 'EMA Cross Sniper', status: 'active', hits: 142, lastHit: '10m ago', url: 'https://n8n.wealth.io/v1/trade/ema_cross' },
        { id: '2', name: 'RSI Divergence', status: 'paused', hits: 54, lastHit: '2h ago', url: 'https://n8n.wealth.io/v1/trade/rsi_div' }
    ]);

    const copyToClipboard = (url: string, id: string) => {
        navigator.clipboard.writeText(url);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="h-full flex flex-col bg-slate-900/50 rounded-2xl border border-slate-800 p-5 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/10 rounded-xl">
                        <Link className="text-indigo-400" size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-100 uppercase tracking-wider">Strategy Webhooks</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">TradingView {'->'} Dhan Bridge</p>
                    </div>
                </div>
                <button className="p-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-xl transition-all">
                    <Plus size={18} />
                </button>
            </div>

            {/* Strategy List */}
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                {strategies.map((strat) => (
                    <div key={strat.id} className="p-4 bg-slate-800/40 rounded-2xl border border-slate-700/50 hover:border-slate-600 transition-all group">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full ${strat.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                                <h4 className="text-[11px] font-black text-slate-200 uppercase tracking-tight">{strat.name}</h4>
                            </div>
                            <div className="flex items-center gap-2 text-[9px] font-bold text-slate-500">
                                <Activity size={10} />
                                <span>{strat.hits} Hits</span>
                            </div>
                        </div>

                        {/* URL Bar */}
                        <div className="flex gap-2 items-center">
                            <div className="flex-1 bg-slate-950 rounded-lg px-3 py-2 border border-slate-800 flex items-center justify-between group/url">
                                <span className="text-[9px] font-mono text-slate-500 truncate mr-2">{strat.url}</span>
                                <button 
                                    onClick={() => copyToClipboard(strat.url, strat.id)}
                                    className="text-slate-600 hover:text-indigo-400 transition-colors"
                                >
                                    {copied === strat.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                </button>
                            </div>
                            <button className="p-2 bg-slate-900 rounded-lg border border-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
                                <Settings size={14} />
                            </button>
                        </div>

                        {/* Footer Info */}
                        <div className="mt-3 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-[8px] font-black text-slate-600 uppercase">
                                <Terminal size={10} />
                                <span>Payload: JSON / Dhan Format</span>
                            </div>
                            <span className="text-[8px] font-bold text-slate-700 uppercase">Last Hit: {strat.lastHit || 'Never'}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Global Security Footer */}
            <div className="mt-6 p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10 flex items-center gap-3">
                <ShieldCheck size={16} className="text-emerald-400" />
                <p className="text-[10px] text-slate-400 leading-tight">
                    All webhooks are secured with 256-bit encryption and unique auth tokens. IP filtering active.
                </p>
            </div>
        </div>
    );
};

export default WebhookManagerWidget;
