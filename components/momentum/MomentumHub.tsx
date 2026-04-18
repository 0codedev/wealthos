import React, { useState, useEffect, useCallback } from 'react';
import { 
    Zap, Bell, RefreshCw, Loader2, Globe, TrendingUp, TrendingDown, 
    AlertTriangle, MessageSquare, ExternalLink, Filter, Search,
    Radio, Activity, Play, Pause, Volume2, Clock, Twitter
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';
import { newsService, NewsArticle } from '../../services/NewsService';
import TwitterBridge from './TwitterBridge';
import TabHero from '../shared/TabHero';
import { formatDistanceToNow } from 'date-fns';
import NewsTradingPulse from '../../src/modules/trade-finder/components/NewsTradingPulse';


const MomentumHub: React.FC = () => {
    const [news, setNews] = useState<NewsArticle[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [filter, setFilter] = useState<'ALL' | 'POSITIVE' | 'NEGATIVE'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [isAutoRefresh, setIsAutoRefresh] = useState(true);
    const [activeTab, setActiveTab] = useState<'HEADLINES' | 'X_PULSE' | 'FILINGS' | 'SITREP'>('HEADLINES');
    const [newsSource, setNewsSource] = useState<'MARKET' | 'PORTFOLIO'>('MARKET');
    const isVisible = usePageVisibility();

    const loadNews = useCallback(async (showLoading = true, source = newsSource) => {
        if (showLoading) setIsLoading(true);
        try {
            const data = source === 'PORTFOLIO' 
                ? await newsService.fetchPortfolioNews()
                : await newsService.fetchMarketNews();
            setNews(data);
            setLastUpdated(new Date());
        } catch (error) {
            console.error('Failed to load news:', error);
        } finally {
            if (showLoading) setIsLoading(false);
        }
    }, [newsSource]);

    useEffect(() => {
        if (!isVisible) return;
        const isMarketHours = () => {
            const now = new Date();
            const hours = now.getHours();
            // User requested 8 AM to 4 PM optimization
            return hours >= 8 && hours < 16;
        };

        loadNews(true, newsSource);
        
        let interval: any;
        if (isAutoRefresh) {
            const pollInterval = isMarketHours() 
                ? 5 * 60 * 1000   // 5 mins during market hours (96 req/day max)
                : 60 * 60 * 1000; // 1 hour outside market hours
            
            interval = setInterval(() => loadNews(false, newsSource), pollInterval);
        }
        
        return () => clearInterval(interval);
    }, [loadNews, isAutoRefresh, isVisible, newsSource]);

    const filteredNews = news.filter(n => {
        const matchesFilter = filter === 'ALL' || n.sentiment === filter;
        const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             n.source.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesFilter && matchesSearch;
    });

    const getSentimentColor = (sentiment?: string) => {
        switch (sentiment) {
            case 'POSITIVE': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
            case 'NEGATIVE': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
            default: return 'text-slate-500 bg-slate-500/10 border-slate-500/20';
        }
    };

    const getCategoryIcon = (category: string) => {
        switch (category) {
            case 'BREAKING': return <Zap size={14} className="text-orange-500" />;
            case 'GLOBAL': return <Globe size={14} className="text-sky-500" />;
            case 'CORPORATE': return <Activity size={14} className="text-indigo-500" />;
            default: return <TrendingUp size={14} className="text-slate-500" />;
        }
    };



    return (
        <div className="space-y-6">
            <TabHero
                eyebrow="Momentum Center"
                title="Momentum Hub"
                description="Real-time market-moving news, institutional signals, and sentiment-driven momentum scanners."
                icon={Radio}
                iconTone="text-orange-500"
                gradientClassName="from-orange-50 via-white to-rose-50 dark:from-orange-950/20 dark:via-slate-950 dark:to-rose-950/20"
                chips={['Flash News', 'Sentiment Analysis', 'Institutional Scanners']}
                actions={
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 mr-2">
                            {(['HEADLINES', 'X_PULSE', 'SITREP', 'FILINGS'] as const).map((t) => (
                                <button
                                    key={t}
                                    onClick={() => setActiveTab(t)}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === t ? 'bg-white dark:bg-orange-600 text-orange-600 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    {t.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-800">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Auto-Refresh</span>
                            <button 
                                onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                                className={`w-8 h-4 rounded-full transition-colors relative ${isAutoRefresh ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                            >
                                <motion.div 
                                    animate={{ x: isAutoRefresh ? 16 : 2 }}
                                    className="absolute top-1 w-2 h-2 rounded-full bg-white"
                                />
                            </button>
                        </div>
                        <button
                            onClick={() => loadNews(true)}
                            disabled={isLoading}
                            className="flex items-center gap-2 bg-slate-900 dark:bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-800 dark:hover:bg-orange-500 transition-all disabled:opacity-50"
                        >
                            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            {isLoading ? 'Syncing...' : 'Sync Now'}
                        </button>
                    </div>
                }
            />

            <AnimatePresence mode="wait">
                {activeTab === 'HEADLINES' ? (
                    <motion.div
                        key="headlines"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                    >
                        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
                            {/* Left Column: Filters & Scanners */}
                            <div className="xl:col-span-1 space-y-6">
                                {/* Momentum Scanner Card */}
                                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-black text-sm uppercase tracking-tighter text-slate-800 dark:text-white flex items-center gap-2">
                                            <Zap size={18} className="text-orange-500" />
                                            ScanX Momentum
                                        </h3>
                                        <div className="px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-[10px] font-bold text-orange-500">
                                            PHASE 2
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500 mb-4">Automatic filter matching based on breaking news sentiment.</p>
                                    
                                    <div className="space-y-3">
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-700 opacity-50">
                                            <div className="flex items-center gap-2 mb-1">
                                                <TrendingUp size={14} className="text-emerald-500" />
                                                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">BULLISH SCANNER</span>
                                            </div>
                                            <p className="text-[9px] text-slate-500">Triggers on "Trade Deal", "Rate Cut", "Positive Earnings".</p>
                                        </div>
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-700 opacity-50">
                                            <div className="flex items-center gap-2 mb-1">
                                                <TrendingDown size={14} className="text-rose-500" />
                                                <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">BEARISH SCANNER</span>
                                            </div>
                                            <p className="text-[9px] text-slate-500">Triggers on "Geopolitical Tension", "Inflation Spike".</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Squawk Box Placeholder */}
                                <div className="bg-slate-900 rounded-2xl p-5 text-white overflow-hidden relative group">
                                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                        <Volume2 size={80} />
                                    </div>
                                    <div className="relative z-10">
                                        <div className="flex items-center gap-2 mb-2 text-orange-500">
                                            <Radio size={18} className={isVisible ? 'animate-pulse' : ''} />
                                            <span className="text-[10px] font-black uppercase">Market Squawk</span>
                                        </div>
                                        <h4 className="text-lg font-bold mb-2">FinancialJuice Live</h4>
                                        <p className="text-xs text-slate-400 mb-4">Hear the news before it hits the terminal. Professional audio feed for traders.</p>
                                        <button className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl py-3 text-sm font-bold transition-all">
                                            <Play size={16} fill="white" />
                                            Start Listening
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Live News Stream */}
                            <div className="xl:col-span-3 space-y-4">
                                {/* News Controls */}
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
                                            <button
                                                onClick={() => setNewsSource('MARKET')}
                                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${newsSource === 'MARKET' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                            >
                                                Market News
                                            </button>
                                            <button
                                                onClick={() => setNewsSource('PORTFOLIO')}
                                                className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${newsSource === 'PORTFOLIO' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                            >
                                                Portfolio News
                                            </button>
                                        </div>

                                        <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
                                            {(['ALL', 'POSITIVE', 'NEGATIVE'] as const).map((f) => (
                                                <button
                                                    key={f}
                                                    onClick={() => setFilter(f)}
                                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all ${filter === f ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    {f}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="relative flex-1 max-w-md">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                        <input
                                            type="text"
                                            placeholder="Search headlines or sources..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full bg-slate-100 dark:bg-slate-800 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-orange-500 transition-all"
                                        />
                                    </div>
                                </div>

                                {/* News Stream */}
                                <div className="space-y-4">
                                    <AnimatePresence mode="popLayout">
                                        {filteredNews.map((article, idx) => (
                                            <motion.div
                                                key={article.id}
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95 }}
                                                transition={{ delay: idx * 0.05 }}
                                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden hover:border-orange-500/50 transition-colors group"
                                            >
                                                <div className="flex flex-col md:flex-row">
                                                    {article.imageUrl && (
                                                        <div className="md:w-48 h-32 md:h-auto overflow-hidden">
                                                            <img 
                                                                src={article.imageUrl} 
                                                                alt="" 
                                                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                                            />
                                                        </div>
                                                    )}
                                                    <div className="flex-1 p-5">
                                                        <div className="flex flex-wrap items-center gap-2 mb-3">
                                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-500 uppercase">
                                                                {getCategoryIcon(article.category)}
                                                                {article.category}
                                                            </div>
                                                            <div className={`px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${getSentimentColor(article.sentiment)}`}>
                                                                {article.sentiment || 'NEUTRAL'}
                                                            </div>
                                                            <span className="text-[10px] text-slate-400 ml-auto flex items-center gap-1">
                                                                <Clock size={10} />
                                                                {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
                                                            </span>
                                                        </div>
                                                        <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-2 leading-tight group-hover:text-orange-500 transition-colors">
                                                            {article.title}
                                                        </h4>
                                                        <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-4">
                                                            {article.description}
                                                        </p>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                                                                <Globe size={14} />
                                                                {article.source}
                                                            </span>
                                                            <a 
                                                                href={article.url} 
                                                                target="_blank" 
                                                                rel="noopener noreferrer"
                                                                className="flex items-center gap-1.5 text-xs font-black text-orange-500 hover:text-orange-400 uppercase tracking-wider"
                                                            >
                                                                Full Story
                                                                <ExternalLink size={12} />
                                                            </a>
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>

                                    {filteredNews.length === 0 && !isLoading && (
                                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                            <Search size={48} className="mb-4 opacity-20" />
                                            <p className="text-sm font-bold">No matching headlines found.</p>
                                            <p className="text-xs opacity-60">Try adjusting your filters or search query.</p>
                                        </div>
                                    )}

                                    {isLoading && (
                                        <div className="space-y-4">
                                            {[1, 2, 3].map(i => (
                                                <div key={i} className="bg-slate-100 dark:bg-slate-800/50 animate-pulse rounded-2xl h-32 w-full" />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                ) : activeTab === 'X_PULSE' ? (
                    <motion.div
                        key="xpulse"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                    >
                        <TwitterBridge />
                    </motion.div>
                ) : activeTab === 'SITREP' ? (
                    <motion.div
                        key="sitrep"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                    >
                        <NewsTradingPulse theme="orange" />
                    </motion.div>
                ) : (
                    <motion.div
                        key="filings"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 min-h-[600px] flex flex-col items-center justify-center text-center"
                    >
                        <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-3xl flex items-center justify-center text-slate-900 dark:text-white mb-6 shadow-xl">
                            <Globe size={40} className="text-sky-500" />
                        </div>
                        <h3 className="text-2xl font-black tracking-tighter text-slate-900 dark:text-white mb-3">NSE/BSE Official Filings</h3>
                        <p className="text-slate-500 dark:text-slate-400 max-w-md mb-8">
                            Direct corporate announcement feeds from the exchanges. Absolute source of truth for mergers, wins, and defaults.
                        </p>
                        <button className="bg-sky-600 hover:bg-sky-500 text-white px-6 py-3 rounded-2xl text-sm font-bold transition-all shadow-lg shadow-sky-500/20">
                            Configure RSS Link
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MomentumHub;
