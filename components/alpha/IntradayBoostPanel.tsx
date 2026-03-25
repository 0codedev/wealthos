import React, { useEffect, useState, useMemo } from 'react';
import { alphaEngineService, StockData } from '../../services/AlphaEngineService';
import { Activity, ArrowUp, ArrowDown, Zap, ExternalLink, RefreshCw } from 'lucide-react';
import { openTradingView } from '../../utils/navigation';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { score, buildInputsFromStock, smoothScoreObject, type ConvictionScore } from '../../services/alpha/ConvictionEngine';
import { mceOrchestrator } from '../../services/mce/orchestrator';

interface IntradayBoostPanelProps {
    onStockSelect: (stock: StockData) => void;
    selectedStock: StockData | null;
    autoRefresh?: boolean;
    refreshTrigger?: number;
    isVisible?: boolean;
    onBoosterMapUpdate?: (map: Record<string, { rank: number; score: number }>) => void;
}

const IntradayBoostPanel: React.FC<IntradayBoostPanelProps> = ({
    onStockSelect,
    selectedStock,
    autoRefresh = true,
    refreshTrigger = 0,
    isVisible = true,
    onBoosterMapUpdate
}) => {
    const [stocks, setStocks] = useState<StockData[]>(() => alphaEngineService.getCachedStocks());
    const [isLoading, setIsLoading] = useState(() => alphaEngineService.getCachedStocks().length === 0);
    const [isHovered, setIsHovered] = useState(false);
    const [displayStocks, setDisplayStocks] = useState<StockData[]>(() => alphaEngineService.getCachedStocks());
    const [limit, setLimit] = useState(20);
    const [convictionBySymbol, setConvictionBySymbol] = useState<Record<string, ConvictionScore>>({});

    // Sync latest stocks data into displayStocks when mouse is not hovering
    useEffect(() => {
        if (!isHovered) {
            setDisplayStocks(stocks);
        }
    }, [stocks, isHovered]);

    // Reset rendering limit when database length shifts
    useEffect(() => {
        setLimit(20);
    }, [displayStocks.length]);

    const fetchStocks = async (isManual: boolean = false) => {
        if (stocks.length === 0) setIsLoading(true);
        const data = await alphaEngineService.fetchFnOStocks(isManual);
        if (data) {
            setStocks(data);
            // CC68: also compute ConvictionEngine score for each stock
            // (best-effort, non-blocking, fire-and-forget). The mceOrchestrator
            // has its own 3-second dedupe so this is cheap to call repeatedly.
            const next: Record<string, ConvictionScore> = {};
            await Promise.all(
                data.slice(0, 50).map(async (s) => {
                    try {
                        const mcsSnap = await mceOrchestrator.score(s.symbol, 'PRE_ENTRY');
                        next[s.symbol] = smoothScoreObject(s.symbol, score(buildInputsFromStock(s, { mcs: mcsSnap })));
                    } catch {
                        next[s.symbol] = smoothScoreObject(s.symbol, score(buildInputsFromStock(s)));
                    }
                })
            );
            setConvictionBySymbol(next);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        const isManual = refreshTrigger > 0;
        fetchStocks(isManual);
    }, [refreshTrigger]);

    // P0#2: paused-when-hidden interval (was: setInterval unconditional)
    usePausedInterval(
      () => fetchStocks(true),
      autoRefresh && isVisible ? 45_000 : null
    );

    const allBoosters = useMemo(() => {
        // Sort displayStocks across all sectors by dayExtremeScore descending (highest to lowest)
        return [...displayStocks]
            .sort((a, b) => (b.dayExtremeScore || 0) - (a.dayExtremeScore || 0));
    }, [displayStocks]);

    useEffect(() => {
        if (onBoosterMapUpdate) {
            const map: Record<string, { rank: number; score: number }> = {};
            allBoosters.forEach((stock, idx) => {
                map[stock.symbol] = {
                    rank: idx + 1,
                    score: stock.dayExtremeScore || 0
                };
            });
            onBoosterMapUpdate(map);
        }
    }, [allBoosters, onBoosterMapUpdate]);

    const visibleBoosters = useMemo(() => {
        return allBoosters.slice(0, limit);
    }, [allBoosters, limit]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        if (target.scrollHeight - target.scrollTop - target.clientHeight < 50) {
            setLimit(prev => Math.min(prev + 20, allBoosters.length));
        }
    };

    if (isLoading && stocks.length === 0) {
        return (
            <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl p-6 border border-slate-800 animate-pulse h-[580px] flex items-center justify-center">
                <Activity className="w-8 h-8 text-indigo-400 opacity-50" />
            </div>
        );
    }

    return (
        <div 
            className="bg-slate-900/80 backdrop-blur-xl rounded-[2rem] border border-slate-800/50 relative shadow-2xl flex flex-col h-[580px] overflow-hidden"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Header */}
            <div className="p-5 border-b border-slate-800/50 bg-slate-850/30 flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                        <Zap size={14} className="text-yellow-400 fill-yellow-400 animate-pulse" /> Intraday Boost
                    </h2>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Top F&O Setups by Day's Extreme (All Sectors)</p>
                </div>
                
                <button 
                    onClick={() => fetchStocks(true)} 
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/50 rounded-xl transition-all"
                >
                    <RefreshCw size={11} className="text-slate-400" />
                </button>
            </div>

            {/* List */}
            <div 
                className="flex-1 overflow-auto no-scrollbar p-3 space-y-2 bg-slate-900/10"
                onScroll={handleScroll}
            >
                {visibleBoosters.map((stock) => {
                    const isSelected = selectedStock?.symbol === stock.symbol;
                    const isGreen = stock.percentChange >= 0;

                    return (
                        <div
                            key={stock.symbol}
                            onClick={() => onStockSelect(stock)}
                            className={`p-2.5 sm:p-3.5 rounded-2xl border flex items-center justify-between gap-2 cursor-pointer transition-all duration-200 group ${
                                isSelected 
                                    ? 'bg-indigo-500/15 border-indigo-500/35 shadow-lg shadow-indigo-500/5' 
                                    : 'bg-slate-800/30 border-slate-800/80 hover:bg-slate-800/60 hover:border-slate-700/80'
                            }`}
                        >
                            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                                <span className={`p-1.5 rounded-lg shrink-0 ${isGreen ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
                                    {isGreen ? (
                                        <ArrowUp size={14} className="text-emerald-400" />
                                    ) : (
                                        <ArrowDown size={14} className="text-rose-400" />
                                    )}
                                </span>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span 
                                            onClick={(e) => { e.stopPropagation(); openTradingView(stock.symbol); }}
                                            className="font-black text-slate-100 group-hover:text-indigo-400 transition-colors hover:underline text-sm tracking-tight flex items-center gap-1"
                                        >
                                            {stock.symbol}
                                            <ExternalLink size={10} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                                        </span>
                                        {stock.sector && (
                                            <span className="hidden sm:inline text-[9px] font-extrabold text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20 tracking-wider uppercase">
                                                {stock.sector}
                                            </span>
                                        )}
                                        {stock.apexSignal && stock.apexSignal !== 'NEUTRAL' && (
                                            <span className={`px-1.5 py-0.5 rounded text-[7px] font-black tracking-wider uppercase border animate-pulse ${
                                                stock.apexSignal === 'EXHAUSTION_APEX'
                                                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                                    : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                            }`}>
                                                {stock.apexSignal === 'EXHAUSTION_APEX' ? 'EXH' : 'ACC'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                                <div className="text-right">
                                    <span className={`inline-flex px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] font-bold font-mono ${
                                        isGreen 
                                            ? 'bg-emerald-500/10 text-emerald-400' 
                                            : 'bg-rose-500/10 text-rose-400'
                                    }`}>
                                        {isGreen ? '+' : ''}{(stock.percentChange || 0).toFixed(2)}%
                                    </span>
                                    <span className="text-[9px] text-slate-500 block font-mono font-bold mt-1">
                                        ₹{(stock.lastPrice || 0).toFixed(1)}
                                    </span>
                                </div>
                                
                                <div className="flex gap-1.5">
                                    <div className="bg-slate-850/60 border border-slate-700/30 p-2 rounded-xl text-center min-w-[40px] sm:min-w-[48px] shadow-inner">
                                        <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest block">G.Fac</span>
                                        <span className={`text-[11px] font-black font-mono ${(stock.gFactor || 0) >= 5.0 ? 'text-yellow-400' : 'text-slate-300'}`}>
                                            {(stock.gFactor || 0).toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="bg-slate-850/60 border border-slate-700/30 p-2 rounded-xl text-center min-w-[40px] sm:min-w-[48px] shadow-inner">
                                        <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest block">R.Fac</span>
                                        <span className={`text-[11px] font-black font-mono ${(stock.rFactor || 0) >= 1.5 ? 'text-emerald-400' : (stock.rFactor || 0) <= -1.5 ? 'text-rose-450' : 'text-slate-300'}`}>
                                            {(stock.rFactor || 1.0).toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="bg-slate-850/60 border border-slate-700/30 p-2 rounded-xl text-center min-w-[56px] sm:min-w-[70px] shadow-inner flex flex-col justify-center items-center">
                                        <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest block">D.Ext</span>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            {(() => {
                                                const score = isNaN(stock.dayExtremeScore) ? 0 : (stock.dayExtremeScore || 0);
                                                const scorePct = Math.round(score * 100);
                                                return (
                                                    <>
                                                        <div className="w-6 sm:w-8 h-1 bg-slate-800 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full ${
                                                                    stock.signal === 'Down'
                                                                        ? (score > 0.75 ? 'bg-rose-500' : score < 0.25 ? 'bg-emerald-500' : 'bg-slate-500')
                                                                        : (score > 0.75 ? 'bg-emerald-500' : score < 0.25 ? 'bg-rose-500' : 'bg-slate-500')
                                                                }`}
                                                                style={{ width: `${scorePct}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-[9px] font-black font-mono text-slate-300">
                                                            {scorePct}%
                                                        </span>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                    {/* CC68: ConvictionEngine score (4th mini-tile) */}
                                    <div
                                        className="bg-slate-850/60 border border-slate-700/30 p-2 rounded-xl text-center min-w-[44px] shadow-inner"
                                        title={convictionBySymbol[stock.symbol]?.reason || 'ConvictionEngine score'}
                                    >
                                        <span className="text-[8px] text-slate-500 uppercase font-black tracking-widest block">CX</span>
                                        {(() => {
                                            const cx = convictionBySymbol[stock.symbol]?.score;
                                            if (cx == null) {
                                                return <span className="text-[11px] font-black font-mono text-slate-500">…</span>;
                                            }
                                            const tone = cx >= 70 ? 'text-emerald-400' : cx >= 50 ? 'text-amber-400' : 'text-slate-400';
                                            return <span className={`text-[11px] font-black font-mono ${tone}`}>{cx}</span>;
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                {visibleBoosters.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-500">
                        <Activity className="w-8 h-8 mb-2 opacity-30 animate-pulse" />
                        <p className="text-xs">Waiting for F&O stock updates...</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(IntradayBoostPanel);
