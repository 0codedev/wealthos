import React, { useState, useMemo } from 'react';
import { calculateBondPrice, calculateYTM, calculateMacaulayDuration, calculateModifiedDuration, BondInputs } from '../../../lib/quant/fixedIncome/bondPricing';
import { TrendingUp, Banknote, CalendarDays, Activity } from 'lucide-react';

export const BondCalculator: React.FC = () => {
    const [inputs, setInputs] = useState({
        faceValue: 1000,
        couponRate: 5, // %
        periods: 10,   // years
        freq: 2,       // Semi-annual
        yieldPerYear: 6, // %
        currentPrice: 950
    });
    
    // Toggle active analysis mode: price from yield OR yield from price
    const [solveMode, setSolveMode] = useState<'PRICE' | 'YIELD'>('PRICE');

    const results = useMemo(() => {
        const bondArgs: BondInputs = {
            faceValue: inputs.faceValue,
            couponRate: inputs.couponRate / 100,
            periods: inputs.periods * inputs.freq, // total discrete periods
            freq: inputs.freq,
            yieldPerYear: inputs.yieldPerYear / 100,
            currentPrice: inputs.currentPrice
        };

        if (solveMode === 'PRICE') {
            const price = calculateBondPrice(bondArgs);
            return {
                cleanPrice: price,
                ytm: inputs.yieldPerYear,
                macDuration: calculateMacaulayDuration({...bondArgs, yieldPerYear: inputs.yieldPerYear / 100}),
            };
        } else {
            // Newton Raphson YTM extraction
            if (inputs.currentPrice <= 0) return null;
            
            // Extract YTM (comes out annualized as a decimal)
            let solverYtm = inputs.yieldPerYear / 100; // default fallback
            try {
                // Newton Raphson is heavily iterative but converges in ms
                // Actually the function signature is different, let's just pass `currentPrice` through
                // wait, my `calculateYTM` requires bondArgs. let's write a wrapper
                let ytmOutput = inputs.yieldPerYear;
                let ytm = inputs.yieldPerYear / 100;
                
                // Let's copy the logic inline or use the external function if it works
                // The external function returns annual yield as decimal.
                const decimalYtm = calculateYTM(bondArgs);
                ytm = decimalYtm;
                ytmOutput = decimalYtm * 100;
                
                return {
                    cleanPrice: inputs.currentPrice,
                    ytm: ytmOutput,
                    macDuration: calculateMacaulayDuration({...bondArgs, yieldPerYear: ytm}),
                };
            } catch (e) {
                console.error(e);
                return null;
            }
        }
    }, [inputs, solveMode]);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                <Banknote size={20} className="text-emerald-500" /> Institutional Bond Analytics
            </h2>

            <div className="flex gap-4 mb-6">
                <button 
                    onClick={() => setSolveMode('PRICE')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${solveMode === 'PRICE' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                    Solve for Price (PV)
                </button>
                <button 
                    onClick={() => setSolveMode('YIELD')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${solveMode === 'YIELD' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                    Solve for Yield (YTM)
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-4 col-span-1 lg:col-span-2">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Face Value / Par</label>
                            <input type="number" value={inputs.faceValue} onChange={e => setInputs({...inputs, faceValue: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none font-mono" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Coupon Rate (%)</label>
                            <input type="number" step="0.1" value={inputs.couponRate} onChange={e => setInputs({...inputs, couponRate: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none font-mono" />
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Years to Maturity</label>
                            <input type="number" value={inputs.periods} onChange={e => setInputs({...inputs, periods: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none font-mono" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Payments per Year</label>
                            <select value={inputs.freq} onChange={e => setInputs({...inputs, freq: parseInt(e.target.value)||2})} className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 outline-none font-mono">
                                <option value={1}>Annual (1)</option>
                                <option value={2}>Semi-Annual (2)</option>
                                <option value={4}>Quarterly (4)</option>
                                <option value={12}>Monthly (12)</option>
                            </select>
                        </div>
                    </div>

                    <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl">
                        {solveMode === 'PRICE' ? (
                            <div>
                                <label className="block text-[10px] text-emerald-500 font-black uppercase mb-1">Market Yield (YTM %)</label>
                                <input type="number" step="0.01" value={inputs.yieldPerYear} onChange={e => setInputs({...inputs, yieldPerYear: parseFloat(e.target.value)||0})} className="w-full bg-slate-900 border border-emerald-500/30 rounded p-2 text-emerald-400 focus:border-emerald-500 outline-none font-mono text-lg" />
                                <p className="text-[10px] text-slate-500 mt-2">Enter the required market yield to compute the theoretical fair value price of the bond.</p>
                            </div>
                        ) : (
                            <div>
                                <label className="block text-[10px] text-blue-500 font-black uppercase mb-1">Current Trading Price</label>
                                <input type="number" step="0.1" value={inputs.currentPrice} onChange={e => setInputs({...inputs, currentPrice: parseFloat(e.target.value)||0})} className="w-full bg-slate-900 border border-blue-500/30 rounded p-2 text-blue-400 focus:border-blue-500 outline-none font-mono text-lg" />
                                <p className="text-[10px] text-slate-500 mt-2">Enter the secondary market trading price to extract the underlying Yield to Maturity via Newton-Raphson mapping.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* OUTPUT METRICS */}
                {results && (
                    <div className="space-y-4">
                        <div className={`p-5 rounded-2xl relative overflow-hidden border ${solveMode === 'PRICE' ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-slate-950 border-slate-800'}`}>
                            <div className="absolute top-0 right-0 p-3 opacity-10"><Banknote size={48} className={solveMode === 'PRICE' ? 'text-emerald-500' : 'text-slate-500'}/></div>
                            <span className="text-xs font-bold uppercase block mb-1 text-slate-400">Modeled Clean Price</span>
                            <span className={`text-3xl font-black font-mono ${solveMode === 'PRICE' ? 'text-emerald-400' : 'text-slate-300'}`}>
                                {results.cleanPrice.toFixed(2)}
                            </span>
                        </div>
                        
                        <div className={`p-5 rounded-2xl relative overflow-hidden border ${solveMode === 'YIELD' ? 'bg-blue-500/10 border-blue-500/20' : 'bg-slate-950 border-slate-800'}`}>
                            <div className="absolute top-0 right-0 p-3 opacity-10"><TrendingUp size={48} className={solveMode === 'YIELD' ? 'text-blue-500' : 'text-slate-500'}/></div>
                            <span className="text-xs font-bold uppercase block mb-1 text-slate-400">Yield to Maturity (YTM)</span>
                            <span className={`text-3xl font-black font-mono ${solveMode === 'YIELD' ? 'text-blue-400' : 'text-slate-300'}`}>
                                {results.ytm.toFixed(3)}%
                            </span>
                        </div>

                        <div className="p-5 bg-slate-950 border border-slate-800 rounded-2xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-3 opacity-10"><Activity size={48} className="text-indigo-500"/></div>
                            <span className="text-xs font-bold uppercase block mb-1 text-slate-400" title="Weighted average time to receive cash flows (in years)">Macaulay Duration</span>
                            <span className="text-2xl font-black font-mono text-indigo-400">
                                {results.macDuration.toFixed(2)} <span className="text-sm text-slate-500 font-normal">Years</span>
                            </span>
                            <div className="mt-2 text-[10px] text-slate-500 font-mono">
                                Mod. D: {calculateModifiedDuration(results.macDuration, results.ytm/100, inputs.freq).toFixed(2)}% (price drop per 1% yield jump)
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
