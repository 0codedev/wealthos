import React, { useMemo, useState } from 'react';
import { RiskVerdict, RiskEngine, inferMarketContext } from '../../../services/RiskEngine';
import { Investment } from '../../../types';
import { AlertTriangle, ShieldCheck, ShieldAlert, Skull, TrendingDown, Info, Zap, Activity, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMarketSentiment } from '../../../hooks/useMarketSentiment';

interface RiskIntelligenceProps {
    investments: Investment[];
    totalNetWorth: number;
    riskEngine: RiskEngine;
}

export const RiskIntelligence: React.FC<RiskIntelligenceProps> = ({ investments, totalNetWorth, riskEngine }) => {
    const { vix, fiiDiiNet } = useMarketSentiment();

    // Generate Verdict on the fly
    const verdict = useMemo(() => {
        riskEngine.setContext(inferMarketContext(investments, vix, 82, fiiDiiNet));
        return riskEngine.generateVerdict(investments, totalNetWorth);
    }, [investments, totalNetWorth, riskEngine, vix, fiiDiiNet]);

    const context = riskEngine.getContext();

    const getStatusColor = (level: RiskVerdict['level']) => {
        switch (level) {
            case 'SAFE': return 'bg-emerald-500';
            case 'CAUTION': return 'bg-amber-500';
            case 'CRITICAL': return 'bg-rose-500';
            case 'KILL_SWITCH': return 'bg-red-600'; // Darker red
            default: return 'bg-slate-500';
        }
    };

    const getIcon = (level: RiskVerdict['level']) => {
        switch (level) {
            case 'SAFE': return <ShieldCheck size={32} className="text-emerald-600 dark:text-emerald-500" />;
            case 'CAUTION': return <AlertTriangle size={32} className="text-amber-600 dark:text-amber-500" />;
            case 'CRITICAL': return <ShieldAlert size={32} className="text-rose-600 dark:text-rose-500" />;
            case 'KILL_SWITCH': return <Skull size={32} className="text-slate-900 dark:text-white animate-pulse" />;
        }
    };

    // Compute Sector Allocations for Risk Engine
    const sectorAllocations = useMemo(() => {
        const total = totalNetWorth || 1;
        const sectors: Record<string, number> = {};
        investments.forEach(inv => {
            const s = inv.sector || 'Unclassified';
            sectors[s] = (sectors[s] || 0) + inv.currentValue;
        });
        // Convert to percentage
        Object.keys(sectors).forEach(k => {
            sectors[k] = (sectors[k] / total) * 100;
        });
        return sectors;
    }, [investments, totalNetWorth]);

    // Deep Scan State
    const [isScanning, setIsScanning] = useState(false);
    const [scanResults, setScanResults] = useState<any[] | null>(null);

    const runDeepScan = () => {
        setIsScanning(true);
        // Simulate AI Processing time
        setTimeout(() => {
            const results = investments.map(inv => riskEngine.evaluateAsset(inv, totalNetWorth, sectorAllocations));
            // Sort: Critical first, then Warning, then Safe
            results.sort((a, b) => {
                const score = (status: string) => status === 'CRITICAL' ? 3 : status === 'WARNING' ? 2 : 1;
                return score(b.status) - score(a.status);
            });
            setScanResults(results);
            setIsScanning(false);
        }, 1500);
    };

    return (
        <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl overflow-hidden shadow-sm dark:shadow-xl border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-4 transition-all">
            {/* Header / Context Banner */}
            <div className="bg-slate-50 dark:bg-gradient-to-r dark:from-slate-900 dark:to-slate-800 p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${verdict.level === 'KILL_SWITCH' ? 'bg-rose-500/10 dark:bg-red-900/50' : 'bg-slate-100 dark:bg-slate-800'}`}>
                        <Zap size={20} className={verdict.level === 'KILL_SWITCH' ? 'text-rose-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-400 uppercase tracking-wider">Risk Intelligence Center</h3>
                        <p className="text-xs text-slate-500 flex items-center gap-2">
                            Context: <span className="text-indigo-600 dark:text-white font-mono">{context.scenario.replace('_', ' ')}</span>
                            <span className="w-1 h-1 bg-slate-300 dark:bg-slate-500 rounded-full"></span>
                            VIX: {context.vix}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={runDeepScan}
                        disabled={isScanning}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${isScanning ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-wait' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20'}`}
                    >
                        {isScanning ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                        {isScanning ? 'Running AI Scan...' : 'Deep Scan Holdings'}
                    </button>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold border ${context.scenario === 'SILVER_CRASH' || context.scenario === 'HIGH_VOLATILITY' ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/30' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-600'}`}>
                        <TrendingDown size={12} className="inline mr-1" />
                        {context.scenario === 'NORMAL' ? 'Normal Regime' : 'Market Alert Active'}
                    </div>
                </div>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* 1. The Verdict Score */}
                <div className="col-span-1 flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-100 dark:border-slate-800 relative overflow-hidden shadow-inner">
                    <div className={`absolute inset-0 opacity-5 dark:opacity-10 ${getStatusColor(verdict.level)} blur-2xl`}></div>
                    <div className="relative z-10 flex flex-col items-center">
                        <div className="mb-3 p-4 bg-white dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-lg">
                            {getIcon(verdict.level)}
                        </div>
                        <h2 className={`text-4xl font-black ${verdict.level === 'KILL_SWITCH' ? 'text-red-600' : verdict.level === 'CRITICAL' ? 'text-rose-600 dark:text-rose-400' : verdict.level === 'CAUTION' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                            {verdict.score}/100
                        </h2>
                        <p className={`text-sm font-bold uppercase tracking-widest mt-1 ${verdict.level === 'KILL_SWITCH' ? 'text-red-600' : 'text-slate-500 dark:text-slate-400'}`}>
                            {verdict.level.replace('_', ' ')}
                        </p>
                    </div>
                </div>

                {/* 2. Narrative & Analysis */}
                <div className="col-span-1 md:col-span-2 space-y-4">
                    <div>
                        <h4 className={`text-lg font-bold flex items-center gap-2 ${verdict.level === 'KILL_SWITCH' ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
                            {verdict.title}
                        </h4>
                        <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed mt-1 font-medium">
                            {verdict.narrative}
                        </p>
                    </div>

                    {/* Action Plan */}
                    {(verdict.actionPlan.length > 0) && (
                        <div className="bg-slate-50 dark:bg-slate-950/30 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-inner">
                            <h5 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-3 flex items-center gap-2 tracking-wider">
                                <Info size={12} className="text-indigo-600 dark:text-indigo-400" /> Recommended Actions
                            </h5>
                            <div className="space-y-2">
                                {verdict.actionPlan.map((action, idx) => (
                                    <div key={idx} className="flex items-start gap-3 text-sm">
                                        <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${action.includes('SELL') || action.includes('Halt') ? 'bg-rose-500' : 'bg-indigo-500'}`}></div>
                                        <span className={action.includes('IMMEDIATE') ? 'text-rose-600 dark:text-red-300 font-bold' : 'text-slate-700 dark:text-slate-300 font-medium'}>
                                            {action}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 3. Deep Scan Results (Collapsible/Dynamic) */}
            {scanResults && (
                <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/30 animate-in slide-in-from-top-2">
                    <div className="p-4 bg-slate-100/50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-300 flex items-center gap-2">
                            <Zap size={14} className="text-indigo-600 dark:text-indigo-400" /> AI Deep Scan Report
                            <span className="bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold">{scanResults.length} Assets Analyzed</span>
                        </h4>
                        <button onClick={() => setScanResults(null)} className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">Close Report</button>
                    </div>
                    <div className="max-h-60 overflow-y-auto p-2 space-y-1">
                        {scanResults.map((res: any) => (
                            <div key={res.assetId} className="flex items-center justify-between p-3 rounded-lg hover:bg-white dark:hover:bg-slate-800/50 transition-colors group">
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${res.status === 'CRITICAL' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]' : res.status === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-900 dark:text-slate-200">{res.assetName}</p>
                                        <p className={`text-[10px] font-medium ${res.status === 'SAFE' ? 'text-emerald-600 dark:text-emerald-500/70' : res.status === 'CRITICAL' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                            {res.status} • {res.issue}
                                        </p>
                                    </div>
                                </div>
                                <div className={`text-[10px] font-bold px-2 py-1 rounded border ${res.status === 'SAFE' ? 'border-slate-200 dark:border-slate-700 text-slate-500' : 'border-indigo-500/30 text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/10'}`}>
                                    {res.action}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
