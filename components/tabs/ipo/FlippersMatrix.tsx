import React, { useMemo } from 'react';
import { ArrowRightLeft, Timer } from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';

interface FlippersMatrixProps {
    capital: number;
    lockInDays: number;
    gmpPct: number;
    swingReturnPct: number;
    setSwingReturnPct: (val: number) => void;
    marketTrend: number;
    setMarketTrend: (val: number) => void;
    issuePrice: number;
    lotValue: number;
}

const FlippersMatrix: React.FC<FlippersMatrixProps> = ({
    capital,
    lockInDays,
    gmpPct,
    swingReturnPct,
    setSwingReturnPct,
    marketTrend,
    setMarketTrend,
    issuePrice,
    lotValue
}) => {
    // Flipper's Matrix Logic
    const flipperStats = useMemo(() => {
        // Calculate Effective GMP %
        const effectiveGmp = gmpPct * (1 + marketTrend / 100);

        // 1. IPO Return
        // Absolute return = capital * (effectiveGmp / 100)
        const ipoAbsReturn = Math.round(capital * (effectiveGmp / 100));
        const ipoAnnualized = effectiveGmp * (365 / Math.max(1, lockInDays));

        // 2. Swing Trade
        // Absolute return = capital * (swingReturnPct / 100)
        const swingAbsReturn = Math.round(capital * (swingReturnPct / 100));
        const swingAnnualized = swingReturnPct * (365 / Math.max(1, lockInDays));

        const isIPOBetter = ipoAbsReturn > swingAbsReturn;

        return { ipoAbsReturn, ipoAnnualized, swingAbsReturn, swingAnnualized, isIPOBetter, effectiveGmp };
    }, [capital, lockInDays, gmpPct, swingReturnPct, marketTrend]);

    return (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <ArrowRightLeft size={20} className="text-indigo-500" /> The Flipper's Matrix
                </h3>
            </div>

            <div className="flex-1 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Capital Size</label>
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400">
                            <span className="text-xs">₹</span>
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                {formatCurrency(capital)}
                            </span>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Lock-in Days</label>
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400">
                            <Timer size={12} />
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                {lockInDays} Days
                            </span>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Base GMP</label>
                        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400">
                            <span className="text-xs text-emerald-500 font-bold">%</span>
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                {gmpPct}%
                            </span>
                        </div>
                    </div>
                </div>

                {/* GMP TREND SLIDER */}
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between items-center mb-1.5">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase block">Listing Sentiment</label>
                            <span className="text-[10px] text-slate-400 font-bold block">
                                Effective GMP: <span className="text-emerald-400 font-black">+{flipperStats.effectiveGmp.toFixed(1)}%</span>
                            </span>
                        </div>
                        <span className={`text-xs font-black ${marketTrend > 0 ? 'text-emerald-500' : marketTrend < 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                            {marketTrend > 0 ? '+' : ''}{marketTrend}% Impact
                        </span>
                    </div>
                    <input
                        type="range"
                        min="-100"
                        max="100"
                        step="10"
                        value={marketTrend}
                        onChange={(e) => setMarketTrend(parseInt(e.target.value))}
                        className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                    <div className="flex justify-between mt-1 text-[9px] text-slate-400 font-bold uppercase">
                        <span>Panic (-100%)</span>
                        <span>Neutral</span>
                        <span>Hype (+100%)</span>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                    {/* IPO Side */}
                    <div className={`p-4 rounded-xl border-2 flex flex-col justify-between ${flipperStats.isIPOBetter ? 'bg-emerald-50/10 dark:bg-emerald-950/20 border-emerald-500/50' : 'bg-slate-50/50 dark:bg-slate-950/50 border-slate-800/40'}`}>
                        <p className="text-xs font-bold text-slate-500 uppercase mb-2">IPO Strategy</p>
                        <div>
                            <p className="text-2xl font-black text-slate-800 dark:text-white">+{flipperStats.effectiveGmp.toFixed(1)}%</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Return on Inv (ROI)</p>
                            <span className="text-[10px] text-slate-500 block mt-0.5">Annualized: {flipperStats.ipoAnnualized.toFixed(0)}%</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                            <p className="text-xs text-slate-500">Net Profit: <span className="font-mono font-bold text-emerald-500">+₹{formatCurrency(flipperStats.ipoAbsReturn)}</span></p>
                        </div>
                    </div>

                    {/* Swing Side */}
                    <div className={`p-4 rounded-xl border-2 flex flex-col justify-between ${!flipperStats.isIPOBetter ? 'bg-indigo-50/10 dark:bg-indigo-950/20 border-indigo-500/50' : 'bg-slate-50/50 dark:bg-slate-950/50 border-slate-800/40'}`}>
                        <div className="flex justify-between items-start mb-2">
                            <p className="text-xs font-bold text-slate-500 uppercase">Swing Alt.</p>
                            <div className="flex items-center gap-0.5">
                                <input
                                    type="number"
                                    value={swingReturnPct}
                                    onChange={(e) => setSwingReturnPct(parseFloat(e.target.value) || 0)}
                                    className="w-8 bg-transparent text-right text-xs font-bold text-indigo-500 outline-none border-b border-indigo-300"
                                />
                                <span className="text-xs text-indigo-500 font-bold">%</span>
                            </div>
                        </div>
                        <div>
                            <p className="text-2xl font-black text-slate-800 dark:text-white">+{swingReturnPct.toFixed(1)}%</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Return on Inv (ROI)</p>
                            <span className="text-[10px] text-slate-500 block mt-0.5">Annualized: {flipperStats.swingAnnualized.toFixed(0)}%</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                            <p className="text-xs text-slate-500">Net Profit: <span className="font-mono font-bold text-indigo-500">+₹{formatCurrency(flipperStats.swingAbsReturn)}</span></p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FlippersMatrix;
