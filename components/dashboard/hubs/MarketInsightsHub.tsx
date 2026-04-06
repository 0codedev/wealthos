import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    ArrowLeft, Globe, Info, TrendingUp
} from 'lucide-react';
import { Investment } from '../../../types';

// Import newly created real-time Upstox components (Phase B)
import MarketStatusHeader from '../../market/MarketStatusHeader';
import SectorHeatmapGrid from '../../market/SectorHeatmapGrid';
import MarketBreadthPanel from '../../market/MarketBreadthPanel';
import TopMoversPanel from '../../market/TopMoversPanel';
import MarketCalendarWidget from '../../market/MarketCalendarWidget';
import MarketSentimentRadar from '../../market/MarketSentimentRadar';

interface MarketInsightsHubProps {
    onBack: () => void;
    stats: any;
    investments: Investment[];
}

export const MarketInsightsHub: React.FC<MarketInsightsHubProps> = ({
    onBack,
    stats,
    investments
}) => {
    // Calculate portfolio metrics for context
    const portfolioMetrics = useMemo(() => {
        const equityInvestments = investments.filter((i: Investment) =>
            i.type === 'Stocks' || i.type === 'ETF' || i.type === 'Smallcase'
        );
        const equityValue = equityInvestments.reduce((sum: number, i: Investment) => sum + (i.currentValue || 0), 0);
        const equityInvested = equityInvestments.reduce((sum: number, i: Investment) => sum + (i.investedAmount || 0), 0);
        const equityReturns = equityInvested > 0 ? ((equityValue - equityInvested) / equityInvested) * 100 : 0;
        const uniquePlatforms = new Set(equityInvestments.map((i: Investment) => i.platform)).size;
        
        return {
            equityValue,
            equityInvested,
            equityReturns,
            equityCount: equityInvestments.length,
            uniquePlatforms
        };
    }, [investments]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
        >
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        title="Go back"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold flex items-center gap-2">
                            <Globe className="text-indigo-500" />
                            Market Intelligence Hub
                        </h2>
                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                            Real-time Upstox data, market breadth indicators & sectoral analysis
                        </p>
                    </div>
                </div>
            </div>

            {/* B.1 — Market Status Header (Real-Time Index Quotes + VIX + Timings) */}
            <MarketStatusHeader />

            {/* B.3 & B.5 — Market Breadth + Calendar Countdown Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <MarketBreadthPanel />
                <MarketCalendarWidget />
            </div>

            {/* B.2 — Sector Performance Heatmap Grid */}
            <SectorHeatmapGrid />

            {/* B.4 — Top Movers Scanner (Gainers, Losers, Volume Surges & OI Leaders) */}
            <TopMoversPanel />

            {/* Portfolio Overview Correlation */}
            <div className="bg-slate-50 dark:bg-slate-950/20 border border-slate-200 dark:border-slate-900 rounded-xl p-6">
                <h3 className="text-sm font-black text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                    <TrendingUp size={16} className="text-indigo-600 dark:text-indigo-400" />
                    Portfolio Correlation Overview
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono">
                    <div className="p-4 bg-white dark:bg-slate-900/30 border border-slate-200 dark:border-slate-900 rounded-lg">
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-bold tracking-wider font-sans">Portfolio Value</div>
                        <div className="text-lg font-black text-slate-900 dark:text-white">₹{((stats?.totalValue || 0) / 100000).toFixed(2)}L</div>
                    </div>
                    <div className="p-4 bg-white dark:bg-slate-900/30 border border-slate-200 dark:border-slate-900 rounded-lg">
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-bold tracking-wider font-sans">Intraday Change</div>
                        <div className={`text-lg font-black ${(stats?.dayChange || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {(stats?.dayChange || 0) >= 0 ? '+' : ''}₹{(stats?.dayChange || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                    </div>
                    <div className="p-4 bg-white dark:bg-slate-900/30 border border-slate-200 dark:border-slate-900 rounded-lg">
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-bold tracking-wider font-sans">Total Returns</div>
                        <div className={`text-lg font-black ${(stats?.totalGain || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {(stats?.totalGain || 0) >= 0 ? '+' : ''}₹{((stats?.totalGain || 0) / 1000).toFixed(1)}K
                        </div>
                    </div>
                    <div className="p-4 bg-white dark:bg-slate-900/30 border border-slate-200 dark:border-slate-900 rounded-lg">
                        <div className="text-[10px] text-slate-500 mb-1 uppercase font-bold tracking-wider font-sans">Diversity Ratio</div>
                        <div className="text-lg font-black text-slate-900 dark:text-white">{stats?.diversityScore || 0}%</div>
                    </div>
                </div>
            </div>

            {/* Market Sentiment Radar */}
            <MarketSentimentRadar />

            {/* Info Banner */}
            <div className="bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 rounded-xl p-4 flex items-start gap-3">
                <Info className="text-indigo-600 dark:text-indigo-400 mt-0.5 flex-shrink-0" size={16} />
                <div className="text-xs text-indigo-800 dark:text-indigo-300">
                  <strong>Institutional Market Intelligence Suite:</strong> Powered by direct Upstox REST feeds. Track index circuits, 
                  sector-wide breadth, F&O top performers, and options theta premium decay countdowns dynamically in a unified command layout.
                </div>
              </div>
        </motion.div>
    );
};

export default MarketInsightsHub;
