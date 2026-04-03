import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { simulateGBM } from '../../../lib/quant/probability/monteCarlo';
import { probabilityOfStreakApprox } from '../../../lib/quant/probability/tradingStreaks';
import { normalCdf, binomialPMF } from '../../../lib/quant/probability/distributions';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, AreaChart, Area, BarChart, Bar } from 'recharts';
import { Activity, Dice5, Focus, Dices } from 'lucide-react';

export const ProbabilityDashboard: React.FC = () => {

    // --- Monte Carlo State ---
    const [mcInputs, setMcInputs] = useState({
        price: 150,
        returns: 0.08,  // 8%
        vol: 0.20,      // 20%
        years: 1
    });

    const mcData = useMemo(() => {
        // We simulate 10 paths to draw on the visualizer. (Fast display)
        const paths = simulateGBM(mcInputs.price, mcInputs.returns, mcInputs.vol, 10, mcInputs.years, 252);
        
        // Transform for Recharts: [{ day: 0, path0: 150, path1: 150... }, { day: 1, path0: 151.2... }]
        const data = [];
        const totalSteps = Math.floor(mcInputs.years * 252);
        for (let i = 0; i <= totalSteps; i++) {
            const dataPoint: any = { day: i };
            for (let p = 0; p < paths.length; p++) {
                dataPoint[`path${p}`] = paths[p][i];
            }
            data.push(dataPoint);
        }
        return { data, numPaths: paths.length };
    }, [mcInputs]);

    // --- Normal Distribution State ---
    const [zScore, setZScore] = useState(1.0);
    const normalData = useMemo(() => {
        const data = [];
        // Generate a standard bell curve between z = -4 and z = +4
        for (let z = -4; z <= 4; z += 0.1) {
            const y = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); // PDF
            data.push({
                z: parseFloat(z.toFixed(2)),
                pdf: y,
                shaded: z <= zScore ? y : null  // For the shaded area chart feature
            });
        }
        const prob = normalCdf(zScore);
        return { data, prob };
    }, [zScore]);

    // --- Trading Streaks & Binomial State ---
    const [streakInputs, setStreakInputs] = useState({
        winRate: 0.50,
        totalTrades: 100,
        streakLen: 5
    });

    const binomialData = useMemo(() => {
        const data = [];
        const { winRate, totalTrades } = streakInputs;
        // Optimization: only render the most relevant part of the binomial curve to save CPU
        const mean = Math.round(totalTrades * winRate);
        const std = Math.sqrt(totalTrades * winRate * (1 - winRate));
        const start = Math.max(0, Math.floor(mean - 4 * std));
        const end = Math.min(totalTrades, Math.ceil(mean + 4 * std));

        for (let k = start; k <= end; k++) {
            data.push({
                successes: k,
                prob: binomialPMF(totalTrades, k, winRate)
            });
        }

        const lossRate = 1 - winRate;
        const riskOfRuin = probabilityOfStreakApprox(totalTrades, streakInputs.streakLen, lossRate);

        return { data, riskOfRuin };
    }, [streakInputs]);


    return (
        <div className="space-y-6">
            <h2 className="text-xl font-bold text-slate-200">Probability & Risk Engine</h2>

            {/* MONTE CARLO GBM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h3 className="font-bold text-white flex items-center gap-2"><Activity size={18} className="text-pink-500"/> Monte Carlo Simulator (GBM)</h3>
                        <p className="text-xs text-slate-400">Simulates Geometric Brownian Motion future price paths given drift and volatility.</p>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-6">
                    <div className="w-full lg:w-1/4 space-y-4">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Initial Price (S₀)</label>
                            <input type="number" value={mcInputs.price} onChange={e => setMcInputs({...mcInputs, price: parseFloat(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none focus:border-pink-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Annual Drift (μ)</label>
                            <input type="number" step="0.01" value={mcInputs.returns} onChange={e => setMcInputs({...mcInputs, returns: parseFloat(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none focus:border-pink-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Annual Volatility (σ)</label>
                            <input type="number" step="0.01" value={mcInputs.vol} onChange={e => setMcInputs({...mcInputs, vol: parseFloat(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none focus:border-pink-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Time Horizon (Years)</label>
                            <input type="number" step="0.5" value={mcInputs.years} onChange={e => setMcInputs({...mcInputs, years: parseFloat(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white font-mono text-sm outline-none focus:border-pink-500" />
                        </div>
                    </div>

                    <div className="w-full lg:w-3/4 flex flex-col">
                        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex-1 min-h-[300px]">
                            <SafeChartContainer>
                                <LineChart data={mcData.data} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                    <XAxis dataKey="day" tick={{fill: '#64748b', fontSize: 10}} minTickGap={30} />
                                    <YAxis domain={['auto', 'auto']} tick={{fill: '#64748b', fontSize: 10}} />
                                    <RechartsTooltip 
                                        labelFormatter={(val) => `Day: ${val}`}
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px', fontFamily: 'monospace' }}
                                    />
                                    {Array.from({ length: mcData.numPaths }).map((_, i) => (
                                        <Line 
                                            key={i} 
                                            type="monotone" 
                                            dataKey={`path${i}`} 
                                            stroke={`hsl(${(i * 137.5) % 360}, 70%, 50%)`} 
                                            strokeWidth={1.5} 
                                            dot={false}
                                            isAnimationActive={false} // Performance critical for large data
                                            opacity={0.8}
                                        />
                                    ))}
                                </LineChart>
                            </SafeChartContainer>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* Z-TABLE & NORMAL CDF */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col">
                    <h3 className="font-bold text-white flex items-center gap-2 mb-2"><Focus size={18} className="text-indigo-500"/> Standard Normal Distribution</h3>
                    <p className="text-xs text-slate-400 mb-4">Cumulative Distribution Function (Area under Bell Curve).</p>
                    
                    <div className="mb-4">
                        <label className="block text-xs text-slate-400 mb-1 font-bold">Input Z-Score</label>
                        <div className="flex gap-4">
                            <input type="range" min="-4" max="4" step="0.05" value={zScore} onChange={e => setZScore(parseFloat(e.target.value))} className="w-full accent-indigo-500" />
                            <span className="text-white font-mono font-bold bg-slate-950 px-3 py-1 rounded border border-slate-800 w-20 text-center">{zScore.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className="bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-xl mb-4 text-center">
                        <span className="text-xs text-indigo-300 font-bold uppercase block mb-1">Probability P(Z &lt; {zScore.toFixed(2)})</span>
                        <span className="text-2xl font-black text-indigo-400 font-mono">{(normalData.prob * 100).toFixed(2)}%</span>
                    </div>

                    <div className="flex-1 min-h-[200px]">
                        <SafeChartContainer>
                            <AreaChart data={normalData.data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                                <XAxis dataKey="z" tick={{fill: '#64748b', fontSize: 10}} minTickGap={20} />
                                <YAxis tick={false} axisLine={false} />
                                <Area type="monotone" dataKey="pdf" stroke="#6366f1" fill="transparent" strokeWidth={2} isAnimationActive={false} />
                                <Area type="monotone" dataKey="shaded" stroke="none" fill="#6366f1" opacity={0.3} isAnimationActive={false} />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>

                {/* BINOMIAL & STREAKS */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col">
                    <h3 className="font-bold text-white flex items-center gap-2 mb-2"><Dice5 size={18} className="text-emerald-500"/> Trade Streak Probabilities</h3>
                    <p className="text-xs text-slate-400 mb-4">Risk of ruining account via losing streaks + Expected total wins (Binomial).</p>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Win Rate</label>
                            <input type="number" step="0.05" max="1" min="0" value={streakInputs.winRate} onChange={e => setStreakInputs({...streakInputs, winRate: parseFloat(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-emerald-400 font-mono text-sm max-h-24 focus:outline-none focus:border-emerald-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Total Trades</label>
                            <input type="number" value={streakInputs.totalTrades} onChange={e => setStreakInputs({...streakInputs, totalTrades: parseInt(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-emerald-400 font-mono text-sm max-h-24 focus:outline-none focus:border-emerald-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-bold">Streak Size (L)</label>
                            <input type="number" value={streakInputs.streakLen} onChange={e => setStreakInputs({...streakInputs, streakLen: parseInt(e.target.value)||0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-rose-400 font-mono text-sm max-h-24 focus:outline-none focus:border-rose-500" />
                        </div>
                    </div>

                    <div className="bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl mb-4 text-center">
                        <span className="text-xs text-rose-300 font-bold uppercase block mb-1">Risk of ≥ 1 Losing Streak of Length {streakInputs.streakLen}</span>
                        <span className="text-2xl font-black text-rose-400 font-mono">{(binomialData.riskOfRuin * 100).toFixed(2)}%</span>
                    </div>

                    <div className="flex-1 min-h-[200px]">
                        <SafeChartContainer>
                            <BarChart data={binomialData.data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                                <XAxis dataKey="successes" tick={{fill: '#64748b', fontSize: 10}} minTickGap={10} />
                                <YAxis tick={false} axisLine={false} />
                                <RechartsTooltip 
                                    cursor={{fill: '#1e293b'}}
                                    formatter={(value: any) => [`${(Number(value) * 100).toFixed(2)}%`, 'Probability']}
                                    labelFormatter={(val) => `Total Wins: ${val}`}
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', fontSize: '12px' }}
                                />
                                <Bar dataKey="prob" fill="#10b981" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                            </BarChart>
                        </SafeChartContainer>
                    </div>
                </div>

            </div>

        </div>
    );
};
