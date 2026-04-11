
import React, { useState, useEffect } from 'react';
import { usePortfolioStore } from '../../store/portfolioStore';
import { useShallow } from 'zustand/react/shallow';
import { Investment } from '../../types';
import InsiderRadar from './InsiderRadar';
import BulkDealScanner from './BulkDealScanner';
import TaxHarvester from './TaxHarvester';
import { 
    Zap, Activity, Radio, AlertOctagon, 
    Radar, BarChart3, Calculator, ShieldCheck,
    Search, Bolt, ArrowRight, LayoutGrid
} from 'lucide-react';
import { marketDataService } from '../../services/MarketDataService';
import { motion, AnimatePresence } from 'framer-motion';
import { useIsMobile } from '../../hooks/useIsMobile';

type Mode = 'RADAR' | 'BULK' | 'TAX' | 'GRID';

const AlphaPredator: React.FC = () => {
    const isMobile = useIsMobile();
    const investments = usePortfolioStore(useShallow(s => s.investments));
    const [activeMode, setActiveMode] = useState<Mode>(isMobile ? 'RADAR' : 'GRID');
    const [insight, setInsight] = useState<{ ticker: string, insight: string } | null>(null);
    const [isScanning, setIsScanning] = useState(false);

    useEffect(() => {
        // AI fetch on mount is DISABLED per user safety rules
        setInsight({ 
            ticker: '-', 
            insight: 'Awaiting active live scan. Click Deep Scan to check for real-time institutional anomalies.' 
        });
    }, []);

    const handleAIGenerate = async () => {
        setIsScanning(true);
        try {
            // This is a MANUAL trigger, so we can allow it if the user clicks
            const data = await marketDataService.fetchAlphaInsight(true);
            setInsight(data);
        } catch (e) {
            console.error(e);
        } finally {
            setIsScanning(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-24 md:pb-6">
            {/* --- PREMIUM HEADER --- */}
            <header className="relative bg-slate-950 border border-slate-800 rounded-3xl p-6 overflow-hidden shadow-2xl">
                {/* Background Decor */}
                <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[120px] -mr-48 -mt-48 pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-[80px] -ml-32 -mb-32 pointer-events-none"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 shadow-lg shadow-indigo-500/5">
                            <Radar size={32} className="text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight uppercase">
                                ALPHA PREDATOR <span className="text-indigo-500">ENGINE</span>
                            </h2>
                            <p className="text-slate-400 text-sm mt-1 max-w-lg leading-relaxed">
                                Real-time surveillance of market anomalies. Tracking promoter activity, institutional bulk deals, and tax-loss harvesting targets.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex flex-col items-end">
                            <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-500/20 px-3 py-1.5 rounded-full shadow-inner shadow-emerald-500/5">
                                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]"></span>
                                <span className="text-[10px] font-black text-emerald-400 tracking-widest uppercase">Live Surveillance Online</span>
                            </div>
                            <span className="text-[9px] text-slate-500 mt-1 font-mono uppercase tracking-tighter">Connection: STABLE SECURE 256-BIT</span>
                        </div>
                    </div>
                </div>
            </header>

            {/* --- MOBILE SUB-NAV --- */}
            {isMobile && (
                <div className="flex items-center gap-2 p-1 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl sticky top-4 z-40 overflow-x-auto scrollbar-hide shadow-xl">
                    {[
                        { id: 'RADAR', label: 'Insider', icon: Radar, color: 'text-indigo-400' },
                        { id: 'BULK', label: 'Bulk', icon: BarChart3, color: 'text-amber-400' },
                        { id: 'TAX', label: 'Tax', icon: Calculator, color: 'text-rose-400' }
                    ].map(mode => (
                        <button
                            key={mode.id}
                            onClick={() => setActiveMode(mode.id as Mode)}
                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase transition-all whitespace-nowrap ${
                                activeMode === mode.id 
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' 
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                        >
                            <mode.icon size={14} className={activeMode === mode.id ? 'text-white' : mode.color} />
                            {mode.label}
                        </button>
                    ))}
                </div>
            )}

            {/* --- MAIN AREA --- */}
            <div className={`grid gap-6 ${activeMode === 'GRID' ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'}`}>
                <AnimatePresence mode="wait">
                    {(activeMode === 'GRID' || activeMode === 'RADAR') && (
                        <motion.div 
                            key="radar"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="h-full"
                        >
                            <InsiderRadar />
                        </motion.div>
                    )}

                    {(activeMode === 'GRID' || activeMode === 'BULK') && (
                        <motion.div 
                            key="bulk"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="h-full"
                        >
                            <BulkDealScanner />
                        </motion.div>
                    )}

                    {(activeMode === 'GRID' || activeMode === 'TAX') && (
                        <motion.div 
                            key="tax"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="h-full"
                        >
                            <TaxHarvester investments={investments} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* --- AI INSIGHT BANNER (ALIGNED WITH STITCH) --- */}
            <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/20 to-transparent rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
                    <div className="flex items-start gap-4">
                        <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 group-hover:rotate-12 transition-transform duration-500 hidden md:block">
                            <Bolt size={24} className="text-indigo-400" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-1 justify-center md:justify-start">
                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Oracle System Insight</span>
                                {insight && <span className="bg-white/10 text-white text-[9px] font-bold px-2 py-0.5 rounded-full border border-white/10">Ref: {insight.ticker}</span>}
                            </div>
                            <p className="text-slate-300 text-sm leading-relaxed max-w-3xl">
                                {insight ? insight.insight : 'Alpha Engine is analyzing recent market movements for anomalous correlations...'}
                            </p>
                        </div>
                    </div>

                    <button 
                        onClick={handleAIGenerate}
                        disabled={isScanning}
                        className={`flex items-center justify-center gap-3 px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all w-full md:w-auto ${
                            isScanning 
                            ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_10px_20px_-10px_rgba(79,70,229,0.4)] hover:shadow-[0_15px_25px_-5px_rgba(79,70,229,0.5)] active:scale-95'
                        }`}
                    >
                        {isScanning ? (
                            <>
                                <Activity size={16} className="animate-spin" />
                                Analyzing...
                            </>
                        ) : (
                            <>
                                <Search size={16} />
                                Run Alpha Scan
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlphaPredator;
