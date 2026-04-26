import React, { useMemo } from 'react';
import { Thermometer, CheckCircle2 } from 'lucide-react';
import GreyMarketRadar from '../../GreyMarketRadar';

interface DemandHeatmapProps {
    qibSub: number | '';
    setQibSub: (val: number | '') => void;
    niiSub: number | '';
    setNiiSub: (val: number | '') => void;
    retailSub: number | '';
    setRetailSub: (val: number | '') => void;
    totalSub: number | '';
    setTotalSub: (val: number | '') => void;
    currentGmp: number | '';
    subscriptionX: number | '';
    issueSize?: number; // Size in Crores
}

const DemandHeatmap: React.FC<DemandHeatmapProps> = ({
    qibSub, setQibSub,
    niiSub, setNiiSub,
    retailSub, setRetailSub,
    totalSub, setTotalSub,
    currentGmp, subscriptionX,
    issueSize
}) => {

    // Dynamic scaling factor based on IPO size (base target scaled around 500 crores)
    const scale = useMemo(() => {
        if (!issueSize || issueSize <= 0) return 1.0;
        // Inverse square root scaling (max target range capped from 0.15 to 2.5)
        return Math.max(0.15, Math.min(2.5, Math.pow(500 / issueSize, 0.5)));
    }, [issueSize]);

    // Institutional Trust Score (0-100) - Weighted Average
    const trustScore = useMemo(() => {
        const getScore = (val: number | '', max: number, mid: number) => {
            const v = Number(val) || 0;
            if (v >= max) return 100;
            if (v >= mid) return 60 + ((v - mid) / (max - mid)) * 40;
            return (v / mid) * 60;
        };

        const qibScore = getScore(qibSub, 50 * scale, 10 * scale);   // QIB: High weight (Target 50x)
        const niiScore = getScore(niiSub, 60 * scale, 20 * scale);   // NII: Med weight (Target 60x)
        const retScore = getScore(retailSub, 30 * scale, 5 * scale); // Retail: Low weight (Target 30x)

        // Weighted Mix: QIB (50%) + NII (30%) + Retail (20%)
        const total = (qibScore * 0.5) + (niiScore * 0.3) + (retScore * 0.2);
        return Math.min(Math.round(total), 100);
    }, [qibSub, niiSub, retailSub, scale]);

    // Heatmap Color Logic
    const getHeatColor = (val: number | '', type: 'QIB' | 'NII' | 'RET' | 'TOTAL') => {
        if (val === '') return 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700';
        const v = Number(val);
        const limits = {
            QIB: { low: 1 * scale, mid: 10 * scale, high: 50 * scale },
            NII: { low: 5 * scale, mid: 20 * scale, high: 60 * scale },
            RET: { low: 2 * scale, mid: 10 * scale, high: 30 * scale },
            TOTAL: { low: 5 * scale, mid: 25 * scale, high: 75 * scale }
        }[type];
        if (v < limits.low) return 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 border-rose-200 dark:border-rose-800';
        if (v < limits.mid) return 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 border-amber-200 dark:border-amber-800';
        if (v < limits.high) return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 border-emerald-200 dark:border-emerald-800';
        return 'bg-emerald-500 text-white border-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.4)] animate-pulse';
    };

    return (
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 sm:p-5 md:p-6 shadow-sm relative overflow-hidden">
            <div className="flex flex-col md:flex-row gap-4 sm:gap-6">
                <div className="flex-1 space-y-4 sm:space-y-6">
                    <div>
                        <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Thermometer size={18} className="text-rose-500 shrink-0" />
                            <span>Demand Heatmap</span>
                            <span 
                                className="inline-flex sm:hidden items-center justify-center w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 text-[9px] font-bold cursor-help"
                                title="Subscription Multiples (x times)"
                                aria-label="Subscription Multiples (x times)"
                            >
                                ⓘ
                            </span>
                        </h3>
                        <p className="hidden sm:block text-xs sm:text-sm text-slate-500">Subscription Multiples (x times)</p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
                        <div className={`p-3 rounded-xl border transition-all ${getHeatColor(qibSub, 'QIB')}`}>
                            <label className="block text-xs font-bold uppercase mb-1 opacity-80 text-[10px] tracking-wider truncate">QIB (Inst)</label>
                            <input
                                type="number"
                                value={qibSub}
                                onChange={(e) => setQibSub(parseFloat(e.target.value) || '')}
                                placeholder="0.0"
                                className="w-full min-w-0 bg-transparent text-xl font-black outline-none placeholder:opacity-50"
                            />
                        </div>
                        <div className={`p-3 rounded-xl border transition-all ${getHeatColor(niiSub, 'NII')}`}>
                            <label className="block text-xs font-bold uppercase mb-1 opacity-80 text-[10px] tracking-wider truncate">NII (HNI)</label>
                            <input
                                type="number"
                                value={niiSub}
                                onChange={(e) => setNiiSub(parseFloat(e.target.value) || '')}
                                placeholder="0.0"
                                className="w-full min-w-0 bg-transparent text-xl font-black outline-none placeholder:opacity-50"
                            />
                        </div>
                        <div className={`p-3 rounded-xl border transition-all ${getHeatColor(retailSub, 'RET')}`}>
                            <label className="block text-xs font-bold uppercase mb-1 opacity-80 text-[10px] tracking-wider truncate">Retail</label>
                            <input
                                type="number"
                                value={retailSub}
                                onChange={(e) => setRetailSub(parseFloat(e.target.value) || '')}
                                placeholder="0.0"
                                className="w-full min-w-0 bg-transparent text-xl font-black outline-none placeholder:opacity-50"
                            />
                        </div>
                        <div className={`p-3 rounded-xl border transition-all ${getHeatColor(totalSub, 'TOTAL')}`}>
                            <label className="block text-xs font-bold uppercase mb-1 opacity-80 text-[10px] tracking-wider truncate">Total Sub</label>
                            <input
                                type="number"
                                value={totalSub}
                                onChange={(e) => setTotalSub(parseFloat(e.target.value) || '')}
                                placeholder="0.0"
                                className="w-full min-w-0 bg-transparent text-xl font-black outline-none placeholder:opacity-50"
                            />
                        </div>
                    </div>

                    {/* GREY MARKET RADAR */}
                    <GreyMarketRadar currentGmp={Number(currentGmp) || 0} subscription={Number(subscriptionX) || 0} />
                </div>

                <div className="flex-1 bg-slate-50 dark:bg-slate-950 rounded-xl p-3.5 sm:p-5 md:p-6 border border-slate-100 dark:border-slate-800 flex flex-col items-center text-center justify-between">
                    <div className="relative w-32 h-32 sm:w-40 sm:h-40 flex items-center justify-center shrink-0 mb-3 sm:mb-4">
                        <svg className="w-full h-full transform -rotate-90">
                            <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-200 dark:text-slate-800" />
                            <circle cx="80" cy="80" r="70" stroke="currentColor" strokeWidth="12" fill="transparent" strokeDasharray={439.8} strokeDashoffset={439.8 - (trustScore / 100 * 439.8)} className={`${trustScore > 75 ? 'text-emerald-500' : trustScore > 40 ? 'text-amber-500' : 'text-rose-500'} transition-all duration-1000`} strokeLinecap="round" />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-4xl font-black text-slate-800 dark:text-white">{trustScore}</span>
                            <span className="text-[10px] font-bold uppercase text-slate-400 mt-1">Trust Score</span>
                        </div>
                    </div>
                    <div className="w-full">
                        <h4 className="font-bold text-slate-800 dark:text-white mb-2 flex items-center justify-center gap-2 text-lg">
                            Smart Money Trust
                            {trustScore > 80 && <CheckCircle2 size={20} className="text-emerald-500" />}
                        </h4>
                        <p className="text-sm text-slate-500 leading-relaxed font-medium">
                            {trustScore > 75 ? "Institutions are aggressively buying. High probability of listing gains." :
                                trustScore > 40 ? "Moderate institutional interest. Watch NII figures closely." :
                                    "Institutions are avoiding this. Risky bet for retail."}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DemandHeatmap;
