import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { portfolioVarianceFromMatrix, portfolioStdDevFromMatrix, sharpeRatio, calculateAlpha } from '../../../lib/quant/portfolio/mpt';
import { Settings, PieChart, Activity, ShieldAlert, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ScatterChart, Scatter, ZAxis } from 'recharts';
import { CorrelationHeatmap } from './CorrelationHeatmap';

export const PortfolioTheoryCalculator: React.FC = () => {
    // 2-Asset Portfolio Model
    const [inputs, setInputs] = useState({
        riskFreeRate: 5,
        marketReturn: 10,
        asset1Name: 'Stock A',
        asset1Return: 12,
        asset1Vol: 20,
        asset1Weight: 60,
        asset2Name: 'Bond B',
        asset2Return: 6,
        asset2Vol: 8,
        correlation: 0.2 // Correlation between A and B
    });

    const [results, setResults] = useState<{ portReturn: number, portVol: number, sharpe: number } | null>(null);
    const [frontierData, setFrontierData] = useState<{ volatility: number; expectedReturn: number; sharpe: number; wA: number; isCurrent: boolean }[]>([]);

    useEffect(() => {
        calculate();
    }, [inputs]);

    const calculate = () => {
        const w1 = inputs.asset1Weight / 100;
        const w2 = 1 - w1;
        
        const r1 = inputs.asset1Return / 100;
        const r2 = inputs.asset2Return / 100;
        
        const v1 = inputs.asset1Vol / 100;
        const v2 = inputs.asset2Vol / 100;
        
        const rf = inputs.riskFreeRate / 100;

        // Calculate single point
        const portReturn = (w1 * r1) + (w2 * r2);
        
        // Variance formula for 2 assets: w1^2*s1^2 + w2^2*s2^2 + 2*w1*w2*s1*s2*p
        const portVar = (w1*w1 * v1*v1) + (w2*w2 * v2*v2) + (2 * w1 * w2 * v1 * v2 * inputs.correlation);
        const portVol = Math.sqrt(portVar);
        
        const sharpe = sharpeRatio(portReturn, rf, portVol);

        setResults({
            portReturn: portReturn * 100,
            portVol: portVol * 100,
            sharpe
        });

        // Generate Efficient Frontier curve (vary w1 from 0 to 1)
        const curve = [];
        for(let w = 0; w <= 1.05; w += 0.05) {
            const weightA = w;
            const weightB = 1 - w;
            const ret = (weightA * r1) + (weightB * r2);
            const variance = (weightA*weightA * v1*v1) + (weightB*weightB * v2*v2) + (2 * weightA * weightB * v1 * v2 * inputs.correlation);
            const vol = Math.sqrt(variance);
            
            curve.push({
                volatility: vol * 100,
                expectedReturn: ret * 100,
                sharpe: (ret - rf) / vol,
                wA: Math.round(weightA * 100),
                isCurrent: Math.abs(weightA - w1) < 0.01
            });
        }
        setFrontierData(curve);
    };

    const handleInput = (field: string, value: string) => {
        let num = parseFloat(value);
        if (isNaN(num)) num = 0;
        if (field === 'asset1Weight') {
            num = Math.max(0, Math.min(100, num));
        }
        if (field === 'correlation') {
            num = Math.max(-1, Math.min(1, num));
        }
        setInputs(prev => ({ ...prev, [field]: num }));
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* INPUT PANEL */}
                <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                        <Settings size={20} className="text-blue-500" /> Portfolio Parameters
                    </h2>

                    <div className="space-y-6">
                        {/* Global Params */}
                        <div className="grid grid-cols-2 gap-4 pb-4 border-b border-slate-800">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Risk Free Rate (%)</label>
                                <input type="number" step="0.1" value={inputs.riskFreeRate} onChange={e => handleInput('riskFreeRate', e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-blue-500 focus:outline-none transition-all font-mono" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1">Correlation (A, B)</label>
                                <input type="number" step="0.1" min="-1" max="1" value={inputs.correlation} onChange={e => handleInput('correlation', e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-blue-500 focus:outline-none transition-all font-mono" />
                            </div>
                        </div>

                        {/* Asset 1 */}
                        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-blue-400">Asset A</h3>
                                <div className="text-sm font-bold text-white">{inputs.asset1Weight}%</div>
                            </div>
                            <input type="range" min="0" max="100" value={inputs.asset1Weight} onChange={e => handleInput('asset1Weight', e.target.value)} className="w-full accent-blue-500" />
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Return (%)</label>
                                    <input type="number" value={inputs.asset1Return} onChange={e => handleInput('asset1Return', e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white font-mono" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Volatility (%)</label>
                                    <input type="number" value={inputs.asset1Vol} onChange={e => handleInput('asset1Vol', e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white font-mono" />
                                </div>
                            </div>
                        </div>

                        {/* Asset 2 */}
                        <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="font-bold text-emerald-400">Asset B</h3>
                                <div className="text-sm font-bold text-white">{100 - inputs.asset1Weight}%</div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Return (%)</label>
                                    <input type="number" value={inputs.asset2Return} onChange={e => handleInput('asset2Return', e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white font-mono" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1">Volatility (%)</label>
                                    <input type="number" value={inputs.asset2Vol} onChange={e => handleInput('asset2Vol', e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-white font-mono" />
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* OUTPUT PANEL */}
                <div className="lg:col-span-8 space-y-6 flex flex-col">
                    {/* STATS */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5"><TrendingUp size={64} className="text-blue-500"/></div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Expected Return</h3>
                            <div className="text-3xl font-black text-white font-mono">{results?.portReturn.toFixed(2)}%</div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5"><Activity size={64} className="text-rose-500"/></div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Portfolio Risk (Vol)</h3>
                            <div className="text-3xl font-black text-white font-mono">{results?.portVol.toFixed(2)}%</div>
                        </div>
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5"><ShieldAlert size={64} className="text-amber-500"/></div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Sharpe Ratio</h3>
                            <div className={`text-3xl font-black font-mono ${results && results.sharpe > 1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {results?.sharpe.toFixed(2)}
                            </div>
                        </div>
                    </div>

                    {/* CHART */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex-1 min-h-[400px] flex flex-col">
                        <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                            <PieChart size={20} className="text-indigo-500" /> Efficient Frontier (2-Asset)
                        </h2>
                        <div className="flex-1 relative">
                            <SafeChartContainer>
                                <LineChart data={frontierData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                                    <XAxis 
                                        dataKey="volatility" 
                                        type="number" 
                                        domain={['dataMin - 1', 'dataMax + 1']} 
                                        tick={{fill: '#64748b', fontSize: 12}} 
                                        tickFormatter={(val) => `${val.toFixed(1)}%`}
                                        label={{ value: 'Risk (Volatility %)', position: 'insideBottom', offset: -15, fill: '#64748b', fontSize: 12 }}
                                    />
                                    <YAxis 
                                        dataKey="expectedReturn" 
                                        type="number" 
                                        domain={['dataMin - 1', 'dataMax + 1']}
                                        tick={{fill: '#64748b', fontSize: 12}}
                                        tickFormatter={(val) => `${val.toFixed(1)}%`}
                                    />
                                    <RechartsTooltip 
                                        cursor={{ strokeDasharray: '3 3' }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const data = payload[0].payload;
                                                return (
                                                    <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl shadow-xl">
                                                        <p className="font-bold text-white mb-2">Mix: {data.wA}% A, {100-data.wA}% B</p>
                                                        <p className="text-slate-400 text-sm">Return: <span className="text-emerald-400">{data.expectedReturn.toFixed(2)}%</span></p>
                                                        <p className="text-slate-400 text-sm">Risk: <span className="text-rose-400">{data.volatility.toFixed(2)}%</span></p>
                                                        <p className="text-slate-400 text-sm">Sharpe: <span className="text-amber-400">{data.sharpe.toFixed(2)}</span></p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Line 
                                        type="monotone" 
                                        dataKey="expectedReturn" 
                                        stroke="#6366f1" 
                                        strokeWidth={3}
                                        dot={(props) => {
                                            const { cx, cy, payload } = props;
                                            if (payload.isCurrent) {
                                                return <circle cx={cx} cy={cy} r={6} fill="#10b981" stroke="#ffffff" strokeWidth={2} />;
                                            }
                                            return <circle cx={cx} cy={cy} r={0} />;
                                        }}
                                        activeDot={{ r: 6, fill: '#6366f1' }}
                                    />
                                    {/* Plot Current Portfolio Point explicitly to assure it's always visible */}
                                </LineChart>
                            </SafeChartContainer>
                        </div>
                    </div>
                </div>
            </div>
            
            <CorrelationHeatmap />
        </div>
    );
};
