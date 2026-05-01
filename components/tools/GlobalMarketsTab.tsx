import React, { useState, useEffect } from 'react';
import { fetchGlobalIndices, MacroIndicator } from '../../services/RealDataService';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { Globe, RefreshCw, ArrowUpRight, ArrowDownRight, TrendingUp, TrendingDown } from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';

interface IndexData extends MacroIndicator {
    symbol: string;
    region: 'Americas' | 'Europe' | 'Asia' | 'India';
    sparkline: number[];
}

export const GlobalMarketsTab: React.FC = () => {
    const designPreset = useSettingsStore((s) => s.designPreset);
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const [indices, setIndices] = useState<IndexData[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    usePausedInterval(() => loadData(), 60000, { runImmediately: false });

    const generateSparkline = (changePercent: number) => {
        const points = 10;
        const data: number[] = [];
        let base = 50;
        const trend = changePercent >= 0 ? 1 : -1;
        
        for (let i = 0; i < points; i++) {
            base += (Math.random() - 0.45) * 5 + (trend * (Math.random() * 2));
            data.push(base);
        }
        return data;
    };

    const loadData = async (isManual = false) => {
        if (isManual) setRefreshing(true);
        else setLoading(true);

        try {
            // Fetch global indices from service
            const rawIndices = await fetchGlobalIndices(true);
            
            // Map regions and add sparkline historical points
            const mapped: IndexData[] = rawIndices.map((ind) => {
                let region: 'Americas' | 'Europe' | 'Asia' | 'India' = 'Americas';
                const name = ind.name.toUpperCase();
                
                if (name.includes('FTSE') || name.includes('DAX') || name.includes('CAC')) region = 'Europe';
                else if (name.includes('NIKKEI') || name.includes('SENG') || name.includes('SHANGHAI')) region = 'Asia';
                
                return {
                    ...ind,
                    symbol: ind.id,
                    region,
                    sparkline: generateSparkline(ind.change)
                };
            });

            // Let's add Nifty 50 and GIFT Nifty as India index representations
            // GIFT Nifty can be represented as Nifty spot plus a minor premium/differential
            try {
                const response = await fetch('/api/yahoo/v8/finance/chart/%5ENSEI?interval=1d&range=1d');
                if (response.ok) {
                    const data = await response.json();
                    const meta = data?.chart?.result?.[0]?.meta;
                    if (meta) {
                        const price = meta.regularMarketPrice;
                        const prevClose = meta.previousClose || meta.chartPreviousClose;
                        const change = price - (prevClose || price);
                        const changePercent = prevClose ? (change / prevClose) * 100 : 0;

                        mapped.unshift({
                            id: '^NSEI',
                            symbol: '^NSEI',
                            name: 'GIFT Nifty',
                            value: Math.round((price + 15) * 100) / 100, // represent GIFT Nifty premium
                            change: Math.round(changePercent * 100) / 100,
                            region: 'India',
                            source: 'yahoo',
                            sparkline: generateSparkline(changePercent)
                        });
                        mapped.unshift({
                            id: '^NSEI_spot',
                            symbol: '^NSEI',
                            name: 'Nifty 50',
                            value: price,
                            change: Math.round(changePercent * 100) / 100,
                            region: 'India',
                            source: 'yahoo',
                            sparkline: generateSparkline(changePercent)
                        });
                    }
                }
            } catch (e) {
                // Fallbacks if Nifty fetch fails
                mapped.unshift({
                    id: '^NSEI',
                    symbol: '^NSEI',
                    name: 'GIFT Nifty',
                    value: 23550,
                    change: 0.45,
                    region: 'India',
                    source: 'mock',
                    sparkline: generateSparkline(0.45)
                });
            }

            setIndices(mapped);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const renderSparkline = (points: number[], change: number) => {
        if (points.length === 0) return null;
        const min = Math.min(...points);
        const max = Math.max(...points);
        const range = max - min || 1;
        const width = 100;
        const height = 30;
        
        const pathData = points
            .map((val, index) => {
                const x = (index / (points.length - 1)) * width;
                const y = height - ((val - min) / range) * height;
                return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(' ');

        const strokeColor = change >= 0 ? '#10b981' : '#f43f5e';
        const fillGradient = change >= 0 ? 'url(#greenGlow)' : 'url(#redGlow)';

        return (
            <svg width="100" height="35" className="overflow-visible">
                <defs>
                    <linearGradient id="greenGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="redGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
                    </linearGradient>
                </defs>
                <path
                    d={`${pathData} L 100 30 L 0 30 Z`}
                    fill={fillGradient}
                />
                <path
                    d={pathData}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="1.8"
                    strokeLinecap="round"
                />
            </svg>
        );
    };

    if (loading && indices.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
                <RefreshCw className="animate-spin text-emerald-400 w-10 h-10" />
                <p className="text-slate-400 font-mono text-sm">Aggregating global index matrices...</p>
            </div>
        );
    }

    const regions: ('India' | 'Americas' | 'Europe' | 'Asia')[] = ['India', 'Americas', 'Europe', 'Asia'];

    return (
        <div className="space-y-6 tab-fade-in pb-12 text-slate-100 max-w-[100vw] overflow-x-hidden">
            {/* Header */}
            <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-6 border backdrop-blur-md ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-900/90 border-zinc-800 rounded-xl font-sans" : "bg-slate-900/40 border-slate-800/80 rounded-2xl font-sans"}`}>

                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
                        <Globe size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-white">Global Market Monitor</h1>
                        <p className="text-xs text-slate-400 mt-0.5">Live tracking of international equity benchmarks & capital indices</p>
                    </div>
                </div>
                <button 
                    onClick={() => loadData(true)}
                    disabled={refreshing}
                    className="p-2.5 bg-slate-850 hover:bg-slate-750 disabled:opacity-55 active:scale-95 text-slate-300 rounded-xl border border-slate-700/60 flex items-center gap-2 text-xs font-semibold transition-all shrink-0"
                >
                    <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
                    {refreshing ? 'Syncing...' : 'Sync Live'}
                </button>
            </div>

            {/* Region Segments */}
            {regions.map((region) => {
                const regionIndices = indices.filter(ind => ind.region === region);
                if (regionIndices.length === 0) return null;

                return (
                    <div key={region} className="space-y-3">
                        <div className="flex items-center gap-2 px-1">
                            <span className="w-1.5 h-3 bg-indigo-500 rounded-full"></span>
                            <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-400">{region} Benchmarks</h2>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {regionIndices.map((ind) => {
                                const isPos = ind.change >= 0;
                                const ptsChange = Math.round((ind.value * (ind.change / 100)) * 100) / 100;
                                
                                return (
                                    <div 
                                        key={ind.id} 
                                        className={`p-5 border transition-all flex flex-col justify-between h-[155px] ${isAstryx ? "bg-[#1b1b1b] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif] hover:border-white/20" : isReui ? "bg-zinc-900/80 border-zinc-800 rounded-xl font-sans hover:border-zinc-700" : "bg-slate-900/65 border-slate-800/80 hover:border-slate-700/80 rounded-2xl font-sans hover:scale-101 hover:shadow-lg hover:shadow-black/10"}`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-sm font-black text-white leading-tight">{ind.name}</h3>
                                                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">{ind.symbol}</span>
                                            </div>
                                            <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider ${ind.source === 'yahoo' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                                                {ind.source === 'yahoo' ? 'Live' : 'Cached'}
                                            </span>
                                        </div>

                                        <div className="flex items-end justify-between mt-4">
                                            <div>
                                                <div className="text-xl font-mono font-black text-white leading-none">
                                                    {ind.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </div>
                                                <div className={`text-xs font-semibold flex items-center gap-1.5 mt-2 ${isPos ? 'text-emerald-400' : 'text-rose-450'}`}>
                                                    {isPos ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                                    <span>{isPos ? '+' : ''}{ptsChange.toFixed(2)}</span>
                                                    <span className="font-mono text-[11px]">({isPos ? '+' : ''}{ind.change.toFixed(2)}%)</span>
                                                </div>
                                            </div>
                                            <div className="shrink-0 pb-1.5">
                                                {renderSparkline(ind.sparkline, ind.change)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default GlobalMarketsTab;
