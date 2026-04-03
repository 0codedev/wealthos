import React, { useState, useEffect } from 'react';
import { calculateBSM, BSMInputs, BSMOutputs } from '../../../lib/quant/options/blackScholes';
import { calculateBinomialOption } from '../../../lib/quant/options/binomialModel';
import { calculateMonteCarloEuropean, MonteCarloOutputs } from '../../../lib/quant/options/monteCarlo';
import { useMonteCarloWorker } from '../../../hooks/useMonteCarloWorker';
import { Settings, Info, TrendingUp, TrendingDown, Activity, Box } from 'lucide-react';

export const BSMCalculator: React.FC = () => {
    const [inputs, setInputs] = useState<BSMInputs>({
        S: 22000,
        K: 22500,
        T: 30 / 365, // 30 days
        r: 0.07,     // 7% risk free
        v: 0.15,     // 15% IV
        q: 0.00      // 0% dividend
    });

    const [outputs, setOutputs] = useState<BSMOutputs | null>(null);
    const [binOutputs, setBinOutputs] = useState<{call: number, put: number} | null>(null);
    const [mcOutputs, setMcOutputs] = useState<MonteCarloOutputs | null>(null);
    const mcWorker = useMonteCarloWorker<MonteCarloOutputs>('OPTION_EUROPEAN_MC');

    useEffect(() => {
        // 1. Analytic BSM (instant)
        const res = calculateBSM(inputs);
        setOutputs(res);

        // 2. Binomial Tree (100 steps, American)
        const bc = calculateBinomialOption({ ...inputs, n: 100, isCall: true, isAmerican: true });
        const bp = calculateBinomialOption({ ...inputs, n: 100, isCall: false, isAmerican: true });
        setBinOutputs({ call: bc.price, put: bp.price });

        // 3. Monte Carlo (10,000 paths) - offloaded to dedicated Web Worker to prevent UI lockup
        const timer = setTimeout(() => {
            mcWorker.run({ ...inputs, paths: 10000 });
        }, 120);

        return () => clearTimeout(timer);
    }, [inputs]);

    useEffect(() => {
        if (mcWorker.data) {
            setMcOutputs(mcWorker.data);
        }
    }, [mcWorker.data]);

    const handleInputChange = (field: keyof BSMInputs, value: string) => {
        const num = parseFloat(value) || 0;
        setInputs(prev => ({ ...prev, [field]: num }));
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* INPUT PANEL */}
                <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                        <Settings size={20} className="text-emerald-500" /> Model Parameters
                    </h2>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Spot Price (S)</label>
                            <input 
                                type="number" 
                                value={inputs.S} 
                                onChange={e => handleInputChange('S', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Strike Price (K)</label>
                            <input 
                                type="number" 
                                value={inputs.K} 
                                onChange={e => handleInputChange('K', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">DTE <span className="font-normal">(Days)</span></label>
                                <input 
                                    type="number" 
                                    value={Math.round(inputs.T * 365)} 
                                    onChange={e => handleInputChange('T', (parseFloat(e.target.value)/365).toString())}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">IV <span className="font-normal">(%)</span></label>
                                <input 
                                    type="number" 
                                    value={(inputs.v * 100).toFixed(2)} 
                                    onChange={e => handleInputChange('v', (parseFloat(e.target.value)/100).toString())}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Risk-Free <span className="font-normal">(%)</span></label>
                                <input 
                                    type="number" 
                                    value={(inputs.r * 100).toFixed(2)} 
                                    onChange={e => handleInputChange('r', (parseFloat(e.target.value)/100).toString())}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Dividend <span className="font-normal">(%)</span></label>
                                <input 
                                    type="number" 
                                    value={((inputs.q || 0) * 100).toFixed(2)} 
                                    onChange={e => handleInputChange('q', (parseFloat(e.target.value)/100).toString())}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* OUTPUT PANEL */}
                <div className="lg:col-span-8 space-y-6">
                    {/* MULTI-MODEL PRICING */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                            <Box size={20} className="text-amber-500" /> Multi-Model Pricing Matrix
                        </h2>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Black Scholes Analytic */}
                            <div className="bg-gradient-to-br from-indigo-500/10 to-indigo-900/10 border border-indigo-500/20 rounded-xl p-5 relative overflow-hidden">
                                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4">Black-Scholes (Euro)</h3>
                                <div className="space-y-4">
                                    <div>
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Call Price</span>
                                        <div className="text-2xl font-black text-white font-mono">₹{outputs?.callPrice.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Put Price</span>
                                        <div className="text-2xl font-black text-white font-mono">₹{outputs?.putPrice.toFixed(2)}</div>
                                    </div>
                                </div>
                                <div className="text-[10px] text-indigo-500/50 absolute bottom-3 right-3 font-mono">Analytic Exact</div>
                            </div>

                            {/* Binomial Tree CRR */}
                            <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-900/10 border border-emerald-500/20 rounded-xl p-5 relative overflow-hidden">
                                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest mb-4">Binomial CRR (Amer)</h3>
                                <div className="space-y-4">
                                    <div>
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Call Price</span>
                                        <div className="text-2xl font-black text-white font-mono">₹{binOutputs?.call.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block">Put Price</span>
                                        <div className="text-2xl font-black text-white font-mono">₹{binOutputs?.put.toFixed(2)}</div>
                                    </div>
                                </div>
                                <div className="text-[10px] text-emerald-500/50 absolute bottom-3 right-3 font-mono">100 Steps</div>
                            </div>

                            {/* Monte Carlo GBM */}
                            <div className="bg-gradient-to-br from-pink-500/10 to-pink-900/10 border border-pink-500/20 rounded-xl p-5 relative overflow-hidden">
                                <h3 className="text-xs font-bold text-pink-400 uppercase tracking-widest mb-4" title="Geometric Brownian Motion simulation">Monte Carlo (GBM)</h3>
                                <div className="space-y-4">
                                    <div>
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block flex items-center justify-between">Call <span className="text-pink-500/70 font-normal">±{mcOutputs?.callStdError.toFixed(2)}</span></span>
                                        <div className="text-2xl font-black text-white font-mono">₹{mcOutputs?.callPrice.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <span className="text-[10px] text-slate-500 uppercase font-bold block flex items-center justify-between">Put <span className="text-pink-500/70 font-normal">±{mcOutputs?.putStdError.toFixed(2)}</span></span>
                                        <div className="text-2xl font-black text-white font-mono">₹{mcOutputs?.putPrice.toFixed(2)}</div>
                                    </div>
                                </div>
                                <div className="text-[10px] text-pink-500/50 absolute bottom-3 right-3 font-mono">10K Paths</div>
                            </div>
                        </div>
                        
                        {/* Probability Extra */}
                        <div className="mt-4 pt-4 border-t border-slate-800 flex justify-end gap-6">
                            <div className="text-right">
                                <div className="text-xs text-slate-500 uppercase font-bold">Moneyness</div>
                                <div className="text-sm font-bold text-slate-300">{inputs.S === inputs.K ? 'ATM' : inputs.S > inputs.K ? 'Call ITM' : 'Put ITM'}</div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-slate-500 uppercase font-bold">Prob(Call ITM)</div>
                                <div className="text-sm font-bold text-emerald-400">{(outputs?.d2 ? (calculateProb(outputs.d2) * 100) : 0).toFixed(1)}%</div>
                            </div>
                            <div className="text-right">
                                <div className="text-xs text-slate-500 uppercase font-bold">Prob(Put ITM)</div>
                                <div className="text-sm font-bold text-rose-400">{(outputs?.d2 ? (calculateProb(-outputs.d2) * 100) : 0).toFixed(1)}%</div>
                            </div>
                        </div>
                    </div>

                    {/* GREEKS */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                            <Activity size={20} className="text-indigo-500" /> The Greeks
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <GreekCard name="Delta (Call)" value={outputs?.callDelta} color="emerald" tooltip="Sensitivity to underlying price" />
                            <GreekCard name="Delta (Put)" value={outputs?.putDelta} color="rose" tooltip="Sensitivity to underlying price" />
                            <GreekCard name="Gamma" value={outputs?.gamma} precision={4} tooltip="Rate of change of Delta" />
                            <GreekCard name="Theta (Call)" value={outputs?.callTheta} tooltip="Daily time decay (1 day)" />
                            <GreekCard name="Vega" value={outputs?.vega} tooltip="Sensitivity to 1% IV change" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const GreekCard = ({ name, value, precision = 3, color = "indigo", tooltip }: any) => {
    return (
        <div className={`bg-slate-950 border border-${color}-500/20 rounded-xl p-4 text-center group relative`}>
            <div className={`text-xs font-bold text-${color}-400 mb-1 uppercase`}>{name}</div>
            <div className="text-xl font-mono text-white">{value !== undefined ? value.toFixed(precision) : '-'}</div>
            <div className="absolute opacity-0 group-hover:opacity-100 transition-opacity -bottom-10 left-1/2 -translate-x-1/2 bg-slate-800 text-slate-200 text-[10px] p-2 rounded w-max z-10 pointer-events-none shadow-xl border border-slate-700">
                {tooltip}
            </div>
        </div>
    );
};

// Hacky prob for display purposes, exact CDF should be imported from the lib
const calculateProb = (z: number) => {
    const p = 0.2316419;
    const b1 = 0.319381530;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;
    const t = 1 / (1 + p * Math.abs(z));
    const z2 = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const prob = 1 - z2 * (b1 * t + b2 * t * t + b3 * Math.pow(t, 3) + b4 * Math.pow(t, 4) + b5 * Math.pow(t, 5));
    return z > 0 ? prob : 1 - prob;
};
