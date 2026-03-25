import React, { useEffect, useState } from 'react';
import { alphaEngineService, MarketMood } from '../../services/AlphaEngineService';
import { TrendingUp, TrendingDown, Activity, Clock, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLiteModeStore } from '../../store/liteModeStore';
import { usePausedInterval } from '../../hooks/usePausedInterval';
import { ActionButton } from '../ui/ActionButton';

interface MarketMoodWidgetProps {
    autoRefresh?: boolean;
    refreshTrigger?: number;
    isVisible?: boolean;
}

const MarketMoodWidget: React.FC<MarketMoodWidgetProps> = ({ 
    autoRefresh = true, 
    refreshTrigger = 0,
    isVisible = true
}) => {
    const [mood, setMood] = useState<MarketMood | null>(() => alphaEngineService.getCachedMood());
    const [isLoading, setIsLoading] = useState(() => !alphaEngineService.getCachedMood());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<string>(() => new Date().toLocaleTimeString('en-US', { hour12: false }));
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    const fetchMood = async (isManual: boolean = false) => {
        try {
            if (!mood) setIsLoading(true);
            if (isManual) setIsRefreshing(true);
            const data = await alphaEngineService.fetchMarketMood(isManual);
            if (data) {
                setMood(data);
                setLastSyncTime(new Date().toLocaleTimeString('en-US', { hour12: false }));
            }
        } catch (error) {
            console.error('Failed to fetch market mood:', error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        // Fetch mood on mount and whenever refresh is triggered
        const isManual = refreshTrigger > 0;
        fetchMood(isManual);
    }, [refreshTrigger]);

    // P0#2: paused-when-hidden interval (was: setInterval unconditional)
    usePausedInterval(
      () => fetchMood(true),
      autoRefresh && isVisible ? 45_000 : null
    );

    if (isLoading) {
        return (
            <div className="bg-slate-900/50 backdrop-blur-md rounded-2xl p-6 border border-slate-800 animate-pulse h-32 flex items-center justify-center">
                <Activity className="w-8 h-8 text-indigo-400 opacity-50" />
            </div>
        );
    }

    if (!mood) {
        return null;
    }

    const totalVelocity = mood.ceVelocity + mood.peVelocity || 1;
    const bullishPercent = (mood.peVelocity / totalVelocity) * 100;
    const bearishPercent = (mood.ceVelocity / totalVelocity) * 100;

    if (isLiteMode) {
        return (
            <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl p-6 border border-slate-800/50 relative overflow-hidden shadow-lg">
                <div className="flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            Money Flux <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">LITE</span>
                            <ActionButton
                                size="xs"
                                icon={<RefreshCw size={11} />}
                                label="SYNC"
                                responsiveLabel
                                onClick={() => fetchMood(true)}
                                isLoading={isRefreshing}
                                disabled={isRefreshing}
                                title={`Refresh Market Mood (Last sync: ${lastSyncTime})`}
                            />
                        </h2>
                        <div className="mt-1 flex items-center gap-3">
                            <span className="text-emerald-400 font-mono text-sm">B: {bullishPercent.toFixed(0)}%</span>
                            <span className="text-rose-400 font-mono text-sm">S: {bearishPercent.toFixed(0)}%</span>
                        </div>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-all duration-300 hover:scale-[1.03] ${mood.isBullish ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                        {mood.isBullish ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        <span className="font-bold">{mood.isBullish ? 'BULLISH' : 'BEARISH'}</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl p-6 border border-slate-800/50 relative overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-slate-700/80 hover:shadow-[0_0_50px_rgba(99,102,241,0.1)]">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-slate-800 to-rose-500 opacity-20" />

            <div className="flex justify-between items-start mb-4">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        Money Flux <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 animate-breathe-red">LIVE</span>
                        <ActionButton
                            size="xs"
                            icon={<RefreshCw size={11} />}
                            label="SYNC"
                            responsiveLabel
                            onClick={() => fetchMood(true)}
                            isLoading={isRefreshing}
                            disabled={isRefreshing}
                            title={`Refresh Market Mood (Last sync: ${lastSyncTime})`}
                        />
                    </h2>
                    <p className="text-slate-400 text-sm mt-1">Nifty 50 Smart Money Position Buildup</p>
                </div>
                
                <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all duration-300 hover:scale-[1.02] hover:shadow-lg ${mood.isBullish ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:shadow-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20 text-rose-400 hover:shadow-rose-500/20'}`}>
                    {mood.isBullish ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                    <span className="font-semibold">{mood.isBullish ? 'BULLISH BIAS' : 'BEARISH BIAS'}</span>
                </div>
            </div>

            {/* Visual Flux Indicator */}
            <div className="mt-6">
                <div className="flex justify-between text-xs font-medium mb-2">
                    <span className="text-emerald-400">Bullish Positions</span>
                    <span className="text-rose-400">Bearish Positions</span>
                </div>
                
                <div className="h-4 bg-slate-800 rounded-full overflow-hidden flex">
                    <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${bullishPercent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full relative"
                        style={{ background: 'linear-gradient(to right, #10b981, #34d399)' }}
                    />
                    
                    <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${bearishPercent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full relative"
                        style={{ background: 'linear-gradient(to left, #ef4444, #f43f5e)' }}
                    />
                </div>
                
                <div className="flex justify-between mt-2 text-sm">
                    <span className="text-slate-300 font-mono">{bullishPercent.toFixed(1)}%</span>
                    <span className="text-slate-300 font-mono">{bearishPercent.toFixed(1)}%</span>
                </div>
            </div>
        </div>
    );
};

export default MarketMoodWidget;
