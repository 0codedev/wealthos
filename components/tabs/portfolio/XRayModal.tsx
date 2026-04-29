import React, { useState } from 'react';
import { X, Activity, PieChart, Layers, Flame, LayoutGrid, Heart, Zap } from 'lucide-react';
import { Investment } from '../../../types';
import { AnalyticsView } from './AnalyticsView';
import { RiskEngineView } from './RiskEngineView';
import { HealthScoreCard } from '../../shared/PortfolioTools';
import { formatCurrency } from '../../../utils/helpers';
import { motion, AnimatePresence } from 'framer-motion';

interface XRayModalProps {
    investments: Investment[];
    totalAssets: number;
    onClose: () => void;
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
    setSimulatorAsset: (inv: Investment | null) => void;
}

type Tab = 'HEALTH' | 'SECTOR' | 'OVERLAP' | 'RISK';

export const XRayView: React.FC<XRayModalProps> = ({
    investments, totalAssets, onClose, formatCurrency, isPrivacyMode, setSimulatorAsset
}) => {
    const [activeTab, setActiveTab] = useState<Tab>('HEALTH');

    return (
        <div className="w-full min-h-[600px] flex flex-col animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-900/40 w-full rounded-2xl shadow-sm dark:shadow-2xl overflow-hidden flex flex-col border border-slate-200 dark:border-slate-800 transition-all">

                {/* Header - Optimized with Parallel Tabs */}
                <div className="h-14 shrink-0 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 bg-slate-50 dark:bg-slate-900/40">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 bg-purple-500/10 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg border border-purple-200 dark:border-purple-800/50">
                                <Activity size={18} />
                            </div>
                            <div>
                                <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-none">Intelligence Engine</h2>
                                <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest mt-1">Portfolio Deep Dive</p>
                            </div>
                        </div>

                        {/* Parallel Tabs */}
                        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner">
                            <button
                                onClick={() => setActiveTab('HEALTH')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'HEALTH'
                                    ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                <Heart size={14} className={activeTab === 'HEALTH' ? "fill-current" : ""} /> Health
                            </button>
                            <button
                                onClick={() => setActiveTab('SECTOR')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'SECTOR'
                                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                <PieChart size={14} /> Sector
                            </button>
                            <button
                                onClick={() => setActiveTab('OVERLAP')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'OVERLAP'
                                    ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                <Layers size={14} /> Overlap
                            </button>
                            <button
                                onClick={() => setActiveTab('RISK')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'RISK'
                                    ? 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                <Flame size={14} /> Risk
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content Area - Scrollable */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 bg-slate-50 dark:bg-slate-950/50 shadow-inner">
                    <div className="max-w-7xl mx-auto">

                        {activeTab === 'HEALTH' && (
                            <div className="space-y-6">
                                <div className="p-4 bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-900/30 rounded-2xl mb-6 shadow-sm">
                                    <h3 className="font-bold text-purple-900 dark:text-purple-300 mb-2 flex items-center gap-2">
                                        <Activity size={18} /> Portfolio Health Check
                                    </h3>
                                    <p className="text-sm text-purple-700 dark:text-purple-400 font-medium">
                                        Analyzing {investments.length} assets based on diversification, expense ratios, consistency, and risk-adjusted returns.
                                    </p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {investments.map(inv => (
                                        <HealthScoreCard key={inv.id} investment={inv} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeTab === 'SECTOR' && (
                            <AnalyticsView
                                investments={investments}
                                formatCurrency={formatCurrency}
                                isPrivacyMode={isPrivacyMode}
                            />
                        )}

                        {activeTab === 'RISK' && (
                            <RiskEngineView
                                investments={investments}
                                totalAssets={totalAssets}
                                formatCurrency={formatCurrency}
                                setSimulatorAsset={setSimulatorAsset}
                            />
                        )}

                        {activeTab === 'OVERLAP' && (
                            <OverlapAnalysisView
                                investments={investments}
                                formatCurrency={formatCurrency}
                            />
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Sub-Component for Overlap Analysis ---
const OverlapAnalysisView: React.FC<{
    investments: Investment[];
    formatCurrency: (val: number) => string;
}> = ({ investments, formatCurrency }) => {
    const [data, setData] = useState<{
        direct: Map<string, number>;
        indirect: Map<string, number>;
        total: Map<string, number>;
        metadata: Map<string, { name: string, sector: string }>;
    } | null>(null);
    const [loading, setLoading] = useState(true);

    React.useEffect(() => {
        const analyze = async () => {
            setLoading(true);
            const { directExposure, indirectExposure, totalExposure, stockMetadata } = await import('../../../services/FundLookthroughService')
                .then(m => m.fundLookthroughService.analyzePortfolio(investments));

            setData({
                direct: directExposure,
                indirect: indirectExposure,
                total: totalExposure,
                metadata: stockMetadata
            });
            setLoading(false);
        };
        analyze();
    }, [investments]);

    if (loading) return (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 h-full">
            <LayoutGrid className="animate-spin mb-4 text-indigo-500" size={48} />
            <p className="text-sm font-black uppercase tracking-widest animate-pulse">Scanning fund documents (AI Lookthrough)...</p>
        </div>
    );

    if (!data || data.total.size === 0) return (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 h-full">
            <Layers size={48} className="mb-4 opacity-50 text-slate-300 dark:text-slate-700" />
            <p className="font-bold uppercase tracking-widest text-xs">No significant overlap data found.</p>
        </div>
    );

    // Sort by Total Value
    const sortedStocks = Array.from(data.total.entries())
        .map(([ticker, val]) => ({
            ticker,
            val,
            direct: data.direct.get(ticker) || 0,
            indirect: data.indirect.get(ticker) || 0,
            meta: data.metadata.get(ticker)
        }))
        .sort((a, b) => b.val - a.val)
        .slice(0, 10); // Top 10

    return (
        <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* 1. Stacked Bar Chart (Composition) */}
                <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <h3 className="font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2 uppercase tracking-tight">
                        <Layers size={18} className="text-indigo-600 dark:text-indigo-500" /> True Exposure X-Ray (Top 10)
                    </h3>
                    <div className="space-y-5">
                        {sortedStocks.map((stock) => {
                            const totalVal = stock.val;

                            return (
                                <div key={stock.ticker} className="group">
                                    <div className="flex justify-between text-xs font-bold mb-1.5">
                                        <div className="flex items-center gap-2">
                                            <span className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded font-mono text-[10px] text-slate-600 dark:text-slate-400">{stock.ticker}</span>
                                            <span className="text-slate-900 dark:text-slate-200 font-bold">{stock.meta?.name}</span>
                                        </div>
                                        <div className="flex gap-3">
                                            <span className="text-slate-500 dark:text-slate-400 font-mono">{formatCurrency(stock.val)}</span>
                                        </div>
                                    </div>

                                    {/* The Stacked Bar */}
                                    <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex relative border border-slate-200 dark:border-transparent shadow-inner">
                                        {/* Direct Portion */}
                                        {stock.direct > 0 && (
                                            <div
                                                className="bg-indigo-600 dark:bg-indigo-500 group-hover:bg-indigo-500 dark:group-hover:bg-indigo-400 transition-colors relative"
                                                style={{ width: `${(stock.direct / totalVal) * 100}%` }}
                                            />
                                        )}
                                        {/* Indirect Portion */}
                                        {stock.indirect > 0 && (
                                            <div
                                                className="bg-purple-500/70 dark:bg-purple-400/70 group-hover:bg-purple-500 dark:group-hover:bg-purple-400 transition-colors relative"
                                                style={{ width: `${(stock.indirect / totalVal) * 100}%` }}
                                            />
                                        )}
                                    </div>
                                    <div className="flex justify-between mt-1 text-[9px] font-black uppercase tracking-widest opacity-60 group-hover:opacity-100 transition-opacity">
                                        <span className={stock.direct > 0 ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"}>
                                            Direct: {formatCurrency(stock.direct)}
                                        </span>
                                        <span className={stock.indirect > 0 ? "text-purple-600 dark:text-purple-400" : "text-slate-400"}>
                                            Indirect: {formatCurrency(stock.indirect)}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 2. Insight Card */}
                <div className="space-y-4">
                    <div className="bg-gradient-to-br from-indigo-600 to-purple-700 dark:from-indigo-900 dark:to-purple-950 rounded-2xl p-6 text-white shadow-lg border border-indigo-400/20">
                        <h4 className="font-bold text-lg mb-2 flex items-center gap-2">
                             <Zap size={20} className="text-yellow-400 animate-pulse" /> Hidden Concentration
                        </h4>
                        <p className="text-xs text-indigo-100 opacity-90 leading-relaxed mb-6 font-medium">
                            You effectively own <span className="font-black text-white bg-white/20 px-1.5 py-0.5 rounded">{formatCurrency(sortedStocks[0]?.val || 0)}</span> of <strong className="text-white underline">{sortedStocks[0]?.ticker}</strong>.
                            Analysis reveals that {(sortedStocks[0]?.indirect / sortedStocks[0]?.val * 100).toFixed(0)}% of your exposure to this asset is hidden inside Mutual Funds.
                        </p>
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] bg-black/20 dark:bg-white/10 p-3 rounded-xl border border-white/10">
                            <Layers size={14} /> Unbundled Intelligence View
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Risk Exposure Legend</h4>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-4 h-4 rounded-lg bg-indigo-600 dark:bg-indigo-500 shadow-sm shadow-indigo-500/20"></div>
                                <span className="text-xs font-bold text-slate-900 dark:text-slate-300">Direct Ownership (Stocks)</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-4 h-4 rounded-lg bg-purple-500/70 dark:bg-purple-400/70 shadow-sm shadow-purple-500/20"></div>
                                <span className="text-xs font-bold text-slate-900 dark:text-slate-300">Lookthrough (Via MFs)</span>
                            </div>
                        </div>
                        <p className="mt-6 text-[10px] text-slate-500 italic leading-relaxed">
                            Aggregates individual stock weightages across all your mutual funds to show your true portfolio concentration.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
