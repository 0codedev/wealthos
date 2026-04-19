import React from 'react';
import { Twitter, ExternalLink, Shield, RefreshCw } from 'lucide-react';

const TwitterBridge: React.FC = () => {
    React.useEffect(() => {
        // Function to initialize widgets
        const initTwitter = () => {
            if ((window as any).twttr && (window as any).twttr.widgets) {
                (window as any).twttr.widgets.load();
            }
        };

        // If script is already there, just load
        if (document.getElementById('twitter-wjs')) {
            initTwitter();
            return;
        }

        // Otherwise inject
        const script = document.createElement('script');
        script.id = 'twitter-wjs';
        script.src = "https://platform.twitter.com/widgets.js";
        script.async = true;
        script.onload = initTwitter;
        document.body.appendChild(script);

        return () => {
            // We don't remove the script to avoid re-fetching, 
            // but we could if we wanted a clean slate.
        };
    }, []);

    // Curated high-alpha accounts
    const accounts = [
        { handle: 'Deltaone', label: 'Raw Feed' },
        { handle: 'FirstSquawk', label: 'Global Macro' },
        { handle: 'zerohedge', label: 'Contra View' },
        { handle: 'WalterBloomberg', label: 'Terminal Feed' }
    ];

    const handleReload = () => {
        if ((window as any).twttr && (window as any).twttr.widgets) {
            (window as any).twttr.widgets.load();
        } else {
            // Re-inject script if missing
            const script = document.createElement('script');
            script.id = 'twitter-wjs';
            script.src = "https://platform.twitter.com/widgets.js";
            script.async = true;
            document.body.appendChild(script);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            <div className="lg:col-span-1 space-y-6">
                <div className="bg-slate-950 rounded-[32px] p-8 text-white relative overflow-hidden border border-white/5 h-full flex flex-col">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <Twitter size={120} />
                    </div>
                    
                    <div className="relative z-10 flex flex-col h-full">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl bg-sky-500/20 flex items-center justify-center text-sky-400">
                                    <Twitter size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-black tracking-tight">Social Pulse Bridge</h3>
                                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Zero-Latency Sentiment</p>
                                </div>
                            </div>
                            <button 
                                onClick={handleReload}
                                className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-sky-400 hover:border-sky-500/30 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
                            >
                                <RefreshCw size={14} /> Reload Pulse
                            </button>
                        </div>

                        <p className="text-sm text-slate-400 leading-relaxed mb-8">
                            This bridge connects to the "High-Alpha" network. We monitor institutional leaks and fast-breaking social headlines before they hit mainstream news terminals.
                        </p>

                        <div className="space-y-4 mb-8">
                            {accounts.map(acc => (
                                <div key={acc.handle} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-sky-500/30 transition-all group">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-500 text-[10px] font-black">
                                            @
                                        </div>
                                        <div>
                                            <p className="text-xs font-black text-white">@{acc.handle}</p>
                                            <p className="text-[10px] text-slate-500 font-bold uppercase">{acc.label}</p>
                                        </div>
                                    </div>
                                    <a 
                                        href={`https://twitter.com/${acc.handle}`} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="p-2 rounded-lg bg-white/5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all hover:text-white"
                                    >
                                        <ExternalLink size={14} />
                                    </a>
                                </div>
                            ))}
                        </div>

                        <div className="mt-auto p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-start gap-3">
                            <Shield size={16} className="text-sky-500 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-sky-200/70 leading-normal">
                                <span className="font-bold text-sky-400">Security Note:</span> This feed uses standard browser embeds. No private data is shared with X (Twitter).
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-[32px] border border-slate-200 dark:border-slate-800 overflow-hidden relative min-h-[600px]">
                <div className="absolute inset-0 overflow-y-auto custom-scrollbar">
                    {/* Twitter Timeline Embed */}
                    <a 
                        className="twitter-timeline" 
                        data-theme="dark" 
                        data-chrome="noheader nofooter noborders transparent"
                        href="https://twitter.com/Deltaone?ref_src=twsrc%5Etfw"
                    >
                        Loading Market Feed...
                    </a>
                </div>
            </div>
        </div>
    );
};

export default TwitterBridge;
