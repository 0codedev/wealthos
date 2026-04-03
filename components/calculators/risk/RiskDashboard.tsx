import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { parametricVaR, historicalVaR } from '../../../lib/quant/risk/var';
import { calculateDrawdowns } from '../../../lib/quant/risk/drawdown';
import { calculateKelly } from '../../../lib/quant/risk/kelly';
import { fixedRiskSizer } from '../../../lib/quant/risk/positionSizing';

import { ShieldAlert, TrendingDown, Target, Activity, AlertOctagon, CheckCircle2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ReferenceLine } from 'recharts';

export const RiskDashboard: React.FC = () => {
    // ----------------------------------------------------------------------
    // 1. VaR State
    // ----------------------------------------------------------------------
    const [varInputs, setVarInputs] = useState({
        portfolioValue: 100000,
        meanReturn: 0.05,
        stdDev: 2,
        confidenceLevel: 0.95,
        method: 'parametric' // or 'historical'
    });
    const [varResult, setVarResult] = useState({ varAmount: 0, varPercent: 0 });

    useEffect(() => {
        let res = { varLevel: 0, varAmount: 0 };
        if (varInputs.method === 'parametric') {
            res = parametricVaR(varInputs.portfolioValue, varInputs.meanReturn / 100, varInputs.stdDev / 100, varInputs.confidenceLevel);
        } else {
            // Simulated dummy historical returns for demo (roughly normal around 0)
            const dummyHistory = Array.from({length: 1000}, () => (Math.random() + Math.random() + Math.random() + Math.random() + Math.random() + Math.random() - 3) * varInputs.stdDev / 100);
            res = historicalVaR(varInputs.portfolioValue, dummyHistory, varInputs.confidenceLevel);
        }
        setVarResult({
            varAmount: res.varAmount,
            varPercent: res.varLevel * 100
        });
    }, [varInputs]);

    // ----------------------------------------------------------------------
    // 2. Position Sizer State
    // ----------------------------------------------------------------------
    const [sizerInputs, setSizerInputs] = useState({
        balance: 100000,
        riskPercent: 1.0,
        entry: 150,
        stopLevel: 145,
        target: 165,
        direction: 'long' as 'long'|'short'
    });
    
    // Derived Sizer
    const sizerResult = fixedRiskSizer(sizerInputs.balance, sizerInputs.riskPercent, sizerInputs.entry, sizerInputs.stopLevel, sizerInputs.target, sizerInputs.direction);

    // ----------------------------------------------------------------------
    // 3. Kelly Criterion State
    // ----------------------------------------------------------------------
    const [kellyInputs, setKellyInputs] = useState({
        winRate: 55, // percent
        avgWin: 200,
        avgLoss: 100
    });
    
    const winLossRatio = kellyInputs.avgLoss > 0 ? kellyInputs.avgWin / kellyInputs.avgLoss : 0;
    const kellyResult = calculateKelly(kellyInputs.winRate / 100, winLossRatio);

    // ----------------------------------------------------------------------
    // 4. Drawdown State (Simulated Equity Curve)
    // ----------------------------------------------------------------------
    const [equityCurveData, setEquityCurveData] = useState<{ day: number; equity: number; underwater: number }[]>([]);
    const [drawdownResult, setDrawdownResult] = useState({ maxDrawdown: 0, peak: 0, trough: 0 });

    // Generate random equity curve to show drawdown UI instantly
    useEffect(() => {
        generateCurve(55); // default 55% win rate drift
    }, []);

    const generateCurve = (winProb: number) => {
        let eq = 10000;
        const curve = [eq];
        for(let i=0; i < 100; i++) {
            const isWin = Math.random() * 100 < winProb;
            const fluctuation = (Math.random() * 0.05); // 0-5% 
            eq = eq * (1 + (isWin ? fluctuation : -fluctuation));
            curve.push(eq);
        }
        
        const res = calculateDrawdowns(curve);
        setDrawdownResult(res);

        // Map for charts
        const chartData = curve.map((val, idx) => ({
            day: idx,
            equity: val,
            underwater: res.underwaterCurve[idx]
        }));
        setEquityCurveData(chartData);
    };

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold text-slate-200">Risk & Margin Analytics</h2>

            {/* Row 1: VaR & Drawdown Simulator */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* VaR Panel */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-6 opacity-5"><ShieldAlert size={120} className="text-rose-500" /></div>
                    <div className="relative z-10 flex flex-col h-full">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-white flex items-center gap-2"><AlertOctagon size={18} className="text-rose-500"/> Value at Risk (VaR)</h3>
                            <select 
                                value={varInputs.confidenceLevel} 
                                onChange={e => setVarInputs({...varInputs, confidenceLevel: parseFloat(e.target.value)})}
                                className="bg-slate-950 border border-slate-800 text-xs text-white rounded-lg p-1 outline-none"
                            >
                                <option value={0.90}>90% Confidence</option>
                                <option value={0.95}>95% Confidence</option>
                                <option value={0.99}>99% Confidence</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Portfolio Value (₹)</label>
                                <input type="number" value={varInputs.portfolioValue} onChange={e => setVarInputs({...varInputs, portfolioValue: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Volatility (Daily %)</label>
                                <input type="number" step="0.1" value={varInputs.stdDev} onChange={e => setVarInputs({...varInputs, stdDev: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm" />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs text-slate-400 mb-1">Calculation Method</label>
                                <div className="flex rounded-lg overflow-hidden border border-slate-800">
                                    <button onClick={() => setVarInputs({...varInputs, method:'parametric'})} className={`flex-1 py-1 text-xs font-semibold ${varInputs.method === 'parametric' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-500'}`}>Parametric</button>
                                    <button onClick={() => setVarInputs({...varInputs, method:'historical'})} className={`flex-1 py-1 text-xs font-semibold ${varInputs.method === 'historical' ? 'bg-indigo-600 text-white' : 'bg-slate-950 text-slate-500'}`}>Historical Simulation</button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-auto bg-rose-500/10 border border-rose-500/30 rounded-xl p-4">
                            <p className="text-xs text-rose-300 font-semibold mb-1 uppercase tracking-wider">Maximum Expected Loss (1 Day)</p>
                            <div className="flex items-end gap-3">
                                <span className="text-3xl font-black text-rose-500 font-mono">₹{varResult.varAmount.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                                <span className="text-sm font-semibold text-rose-400 mb-1">({varResult.varPercent.toFixed(2)}%)</span>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                There is a <strong>{(varInputs.confidenceLevel * 100).toFixed(0)}%</strong> probability that your portfolio will not lose more than this amount in a single day.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Drawdown Analyzer */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col min-h-[350px]">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-white flex items-center gap-2"><TrendingDown size={18} className="text-amber-500"/> Underwater Drawdown Curve</h3>
                        <button onClick={() => generateCurve(52)} className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-2 py-1 rounded">Generate Random Curve</button>
                    </div>

                    <div className="flex gap-6 mb-4">
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Max Drawdown</p>
                            <p className="text-xl font-black text-rose-500">-{drawdownResult.maxDrawdown.toFixed(2)}%</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Peak</p>
                            <p className="text-xl font-bold text-emerald-500 font-mono">₹{drawdownResult.peak.toFixed(0)}</p>
                        </div>
                    </div>

                    <div className="flex-1 w-full relative">
                        <SafeChartContainer>
                            <AreaChart data={equityCurveData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
                                <YAxis dataKey="underwater" reversed domain={[0, 'dataMax']}  tick={{fill: '#64748b', fontSize: 10}} tickFormatter={(v)=>`-${v.toFixed(0)}%`} orientation="right" />
                                <RechartsTooltip 
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const v = payload[0].value as number;
                                            return (
                                                <div className="bg-slate-950 border border-slate-800 p-2 rounded-lg text-xs font-mono shadow-xl">
                                                    <span className="text-rose-400 font-bold whitespace-nowrap">DD: -{v.toFixed(2)}%</span>
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area type="monotone" dataKey="underwater" stroke="#f43f5e" strokeWidth={2} fill="#f43f5e" fillOpacity={0.2} />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>

            {/* Row 2: Position Sizer & Kelly */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Position Sizer */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                    <h3 className="font-bold text-white flex items-center gap-2 mb-6"><Target size={18} className="text-blue-500"/> Trade Position Sizer</h3>
                    
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Account Balance (₹)</label>
                            <input type="number" value={sizerInputs.balance} onChange={e => setSizerInputs({...sizerInputs, balance: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Risk per Trade (%)</label>
                            <input type="number" step="0.1" value={sizerInputs.riskPercent} onChange={e => setSizerInputs({...sizerInputs, riskPercent: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm" />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-6">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Entry Price</label>
                            <input type="number" value={sizerInputs.entry} onChange={e => setSizerInputs({...sizerInputs, entry: parseFloat(e.target.value)||0})} className="w-full bg-slate-900 border border-blue-500/50 rounded-lg p-2 text-blue-400 font-mono text-sm focus:outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Stop Loss</label>
                            <input type="number" value={sizerInputs.stopLevel} onChange={e => setSizerInputs({...sizerInputs, stopLevel: parseFloat(e.target.value)||0})} className="w-full bg-slate-900 border border-rose-500/50 rounded-lg p-2 text-rose-400 font-mono text-sm focus:outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Target</label>
                            <input type="number" value={sizerInputs.target} onChange={e => setSizerInputs({...sizerInputs, target: parseFloat(e.target.value)||0})} className="w-full bg-slate-900 border border-emerald-500/50 rounded-lg p-2 text-emerald-400 font-mono text-sm focus:outline-none" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 flex flex-col items-center justify-center">
                            <span className="text-xs text-slate-500 font-bold uppercase mb-1">Quantity to Buy/Short</span>
                            <span className="text-3xl font-black text-white font-mono">{sizerResult.shares} <span className="text-lg text-slate-500">units</span></span>
                            <span className="text-xs text-rose-400 mt-2 font-mono">Max Loss: ₹{Math.round(sizerResult.riskAmount)}</span>
                        </div>
                        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 flex flex-col items-center justify-center">
                            <span className="text-xs text-slate-500 font-bold uppercase mb-1">Risk : Reward</span>
                            <span className={`text-3xl font-black font-mono ${sizerResult.riskRewardRatio >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                1 : {sizerResult.riskRewardRatio.toFixed(2)}
                            </span>
                            <span className="text-xs text-emerald-400 mt-2 font-mono">Reward: ₹{Math.round(sizerResult.rewardAmount)}</span>
                        </div>
                    </div>
                </div>

                {/* Kelly Criterion */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                    <h3 className="font-bold text-white flex items-center gap-2 mb-6"><Activity size={18} className="text-indigo-500"/> Kelly Criterion Optimizer</h3>
                    
                    <div className="space-y-4 mb-8">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs text-slate-400 font-bold">Win Probability</label>
                                <span className="text-indigo-400 font-bold">{kellyInputs.winRate}%</span>
                            </div>
                            <input type="range" min="1" max="99" value={kellyInputs.winRate} onChange={e => setKellyInputs({...kellyInputs, winRate: parseInt(e.target.value)})} className="w-full accent-indigo-500" />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 pt-2">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Avg Win Size (₹)</label>
                                <input type="number" value={kellyInputs.avgWin} onChange={e => setKellyInputs({...kellyInputs, avgWin: parseFloat(e.target.value)||1})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Avg Loss Size (₹)</label>
                                <input type="number" value={kellyInputs.avgLoss} onChange={e => setKellyInputs({...kellyInputs, avgLoss: parseFloat(e.target.value)||1})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm" />
                            </div>
                        </div>
                    </div>

                    {kellyResult.isNegativeEV ? (
                        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-center">
                            <AlertOctagon size={32} className="text-rose-500 mx-auto mb-2" />
                            <h4 className="text-rose-400 font-bold">Negative Expectancy Model</h4>
                            <p className="text-xs text-rose-300/80 mt-1">This strategy mathematically loses money over time. Do not trade.</p>
                        </div>
                    ) : (
                        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4">
                            <div className="flex justify-between items-end mb-4 border-b border-indigo-500/20 pb-4">
                                <div>
                                    <p className="text-xs text-indigo-300 font-bold uppercase tracking-wider mb-1">Full Kelly (Aggressive)</p>
                                    <p className="text-3xl font-black text-indigo-400 font-mono">{kellyResult.fullKelly.toFixed(2)}%</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-emerald-400/80 font-bold uppercase tracking-wider mb-1">Half Kelly (Safe)</p>
                                    <p className="text-xl font-bold text-emerald-500 font-mono">{kellyResult.halfKelly.toFixed(2)}%</p>
                                </div>
                            </div>
                            <p className="text-xs text-indigo-200/60 leading-relaxed text-center">
                                Fraction of total capital to risk per trade to maximize geometric growth. Half-Kelly is recommended for 50% less volatility.
                            </p>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};
