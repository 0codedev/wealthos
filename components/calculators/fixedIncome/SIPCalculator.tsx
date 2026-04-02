import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { calculateSIP, calculateStepUpSIP } from '../../../lib/quant/fixedIncome/sip';
import { Settings, TrendingUp, DollarSign, Calendar, Info } from 'lucide-react';
import { formatCurrency, formatCurrencyPrecise } from '../../../utils/helpers';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';

export const SIPCalculator: React.FC = () => {
    const [mode, setMode] = useState<'STANDARD' | 'STEPUP'>('STANDARD');
    
    const [inputs, setInputs] = useState({
        monthlyInvestment: 10000,
        expectedReturn: 12,
        years: 10,
        stepUpPercent: 10
    });

    const [results, setResults] = useState<{ totalInvested: number, estimatedReturns: number, totalValue: number } | null>(null);
    const [chartData, setChartData] = useState<{ year: string; invested: number; returns: number; total: number }[]>([]);

    useEffect(() => {
        calculate();
    }, [inputs, mode]);

    const calculate = () => {
        const rate = inputs.expectedReturn / 100;
        let res;
        
        if (mode === 'STANDARD') {
            res = calculateSIP(inputs.monthlyInvestment, rate, inputs.years);
        } else {
            res = calculateStepUpSIP(inputs.monthlyInvestment, inputs.stepUpPercent / 100, rate, inputs.years);
        }
        
        setResults(res);
        generateChartData(rate);
    };

    const generateChartData = (rate: number) => {
        const data = [];
        let currentMonthly = inputs.monthlyInvestment;
        let totalInvested = 0;
        let totalValue = 0;

        for (let year = 1; year <= inputs.years; year++) {
            const monthlyRate = rate / 12;
            
            // For standard vs step-up tracking over time
            let yearInvested = currentMonthly * 12;
            let yearEndValue = currentMonthly * ((Math.pow(1 + monthlyRate, 12) - 1) / monthlyRate) * (1 + monthlyRate);
            
            totalValue = (totalValue * Math.pow(1 + rate, 1)) + yearEndValue;
            totalInvested += yearInvested;

            data.push({
                year: `Year ${year}`,
                invested: totalInvested,
                returns: totalValue - totalInvested,
                total: totalValue
            });

            if (mode === 'STEPUP') {
                currentMonthly = currentMonthly * (1 + (inputs.stepUpPercent / 100));
            }
        }
        setChartData(data);
    };

    const handleInput = (field: string, value: string) => {
        setInputs(prev => ({ ...prev, [field]: parseFloat(value) || 0 }));
    };

    const COLORS = ['#6366f1', '#10b981']; // Indigo for invested, Emerald for returns

    return (
        <div className="space-y-6">
            <div className="flex gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl w-max mb-4">
                <button 
                    onClick={() => setMode('STANDARD')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'STANDARD' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Standard SIP
                </button>
                <button 
                    onClick={() => setMode('STEPUP')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'STEPUP' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Step-Up SIP
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* INPUT PANEL */}
                <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-6">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                        <Settings size={20} className="text-emerald-500" /> Investment Plan
                    </h2>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Monthly Investment (₹)</label>
                            <input 
                                type="number" 
                                value={inputs.monthlyInvestment} 
                                onChange={e => handleInput('monthlyInvestment', e.target.value)}
                                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:border-emerald-500 focus:outline-none transition-all font-mono text-lg"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Expected Return (%)</label>
                            <div className="flex items-center gap-4">
                                <input 
                                    type="range" 
                                    min="1" max="30" step="0.5"
                                    value={inputs.expectedReturn} 
                                    onChange={e => handleInput('expectedReturn', e.target.value)}
                                    className="w-full accent-emerald-500"
                                />
                                <input 
                                    type="number" 
                                    value={inputs.expectedReturn} 
                                    onChange={e => handleInput('expectedReturn', e.target.value)}
                                    className="w-20 bg-slate-950 border border-slate-800 rounded-xl p-2 text-center text-white focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">Time Period (Years)</label>
                            <div className="flex items-center gap-4">
                                <input 
                                    type="range" 
                                    min="1" max="50" step="1"
                                    value={inputs.years} 
                                    onChange={e => handleInput('years', e.target.value)}
                                    className="w-full accent-emerald-500"
                                />
                                <input 
                                    type="number" 
                                    value={inputs.years} 
                                    onChange={e => handleInput('years', e.target.value)}
                                    className="w-20 bg-slate-950 border border-slate-800 rounded-xl p-2 text-center text-white focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                />
                            </div>
                        </div>

                        {mode === 'STEPUP' && (
                            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl mt-4">
                                <label className="block text-xs font-bold text-emerald-400 mb-1">Annual Step-Up (%)</label>
                                <p className="text-[10px] text-slate-400 mb-2">Increase your investment every year to beat inflation.</p>
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="range" 
                                        min="1" max="50" step="1"
                                        value={inputs.stepUpPercent} 
                                        onChange={e => handleInput('stepUpPercent', e.target.value)}
                                        className="w-full accent-emerald-500"
                                    />
                                    <input 
                                        type="number" 
                                        value={inputs.stepUpPercent} 
                                        onChange={e => handleInput('stepUpPercent', e.target.value)}
                                        className="w-20 bg-slate-950 border border-emerald-500/50 rounded-xl p-2 text-center text-white focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* OUTPUT PANEL */}
                <div className="lg:col-span-8 flex flex-col gap-6">
                    {/* TOP STATS */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div>
                            <p className="text-sm font-bold text-slate-500 mb-1 uppercase tracking-wider">Invested Amount</p>
                            <p className="text-2xl font-mono text-white">{formatCurrency(results?.totalInvested || 0)}</p>
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-500 mb-1 uppercase tracking-wider">Wealth Gained</p>
                            <p className="text-2xl font-mono text-emerald-400">+{formatCurrency(results?.estimatedReturns || 0)}</p>
                        </div>
                        <div className="bg-slate-950 -m-6 p-6 border-l border-slate-800 flex flex-col justify-center rounded-r-2xl">
                            <p className="text-sm font-bold text-indigo-400 mb-1 uppercase tracking-wider flex items-center gap-2"><TrendingUp size={16}/> Total Value</p>
                            <p className="text-3xl font-black font-mono text-white">{formatCurrencyPrecise(results?.totalValue || 0)}</p>
                        </div>
                    </div>

                    {/* CHARTS */}
                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex-1 flex flex-col lg:flex-row gap-8">
                        
                        {/* PIE CHART */}
                        <div className="w-full lg:w-1/3 flex flex-col items-center justify-center">
                            <h3 className="text-xs font-bold text-slate-500 uppercase self-start mb-4">Corpus Split</h3>
                            <div className="h-48 w-full relative">
                                <SafeChartContainer>
                                    <PieChart>
                                        <Pie
                                            data={[
                                                { name: 'Invested', value: results?.totalInvested || 0 },
                                                { name: 'Gains', value: results?.estimatedReturns || 0 }
                                            ]}
                                            cx="50%" cy="50%" innerRadius={60} outerRadius={80}
                                            paddingAngle={5} dataKey="value" stroke="none"
                                        >
                                            <Cell fill={COLORS[0]} />
                                            <Cell fill={COLORS[1]} />
                                        </Pie>
                                        <RechartsTooltip 
                                            formatter={(value) => formatCurrency(Number(value ?? 0))}
                                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', color: '#fff' }}
                                        />
                                    </PieChart>
                                </SafeChartContainer>
                                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                    <span className="text-xs text-slate-500 font-bold uppercase">ROI</span>
                                    <span className="text-xl font-bold text-white font-mono">
                                        {results?.totalInvested ? ((results.estimatedReturns / results.totalInvested) * 100).toFixed(0) : 0}%
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* WEALTH MOAT AREA CHART */}
                        <div className="w-full lg:w-2/3 flex flex-col">
                            <h3 className="text-xs font-bold text-slate-500 uppercase mb-4">Wealth Accumulation Timeline</h3>
                            <div className="flex-1 min-h-[200px]">
                                <SafeChartContainer>
                                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                            </linearGradient>
                                            <linearGradient id="colorReturns" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                                        <XAxis dataKey="year" tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} minTickGap={30} />
                                        <YAxis tickFormatter={(val) => `₹${(val/100000).toFixed(1)}L`} tick={{fill: '#64748b', fontSize: 10}} axisLine={false} tickLine={false} width={50} />
                                        <RechartsTooltip 
                                            formatter={(value) => formatCurrency(Number(value ?? 0))}
                                            labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', color: '#fff' }}
                                        />
                                        <Area type="monotone" dataKey="total" name="Total Value" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorReturns)" />
                                        <Area type="monotone" dataKey="invested" name="Amount Invested" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorInvested)" />
                                    </AreaChart>
                                </SafeChartContainer>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
