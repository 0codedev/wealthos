import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { Calculator, BarChart3, List, Info, TrendingUp, CalendarDays, RefreshCw } from 'lucide-react';

const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

export const DailyCompoundCalculator: React.FC = () => {
    // Inputs
    const [principal, setPrincipal] = useState<string>('1000');
    const [dailyRate, setDailyRate] = useState<string>('1'); // 1% daily
    const [duration, setDuration] = useState<string>('30'); // 30 days
    const [durationType, setDurationType] = useState<'days' | 'months' | 'years'>('days');
    
    // Advanced Trading specific toggles
    const [includeWeekends, setIncludeWeekends] = useState<boolean>(true); // false for Forex/Stocks, true for Crypto
    const [reinvestRate, setReinvestRate] = useState<number>(100); // 100% means full compounding
    
    const [contributionType, setContributionType] = useState<'none' | 'deposit' | 'withdrawal'>('none');
    const [contributionAmount, setContributionAmount] = useState<string>('0');

    // Display toggles
    const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

    // Engine
    const results = useMemo(() => {
        const p = parseFloat(principal) || 0;
        const r = parseFloat(dailyRate) || 0;
        const dur = parseInt(duration) || 0;
        const cAmt = parseFloat(contributionAmount) || 0;
        
        let totalDays = dur;
        if (durationType === 'months') totalDays = dur * 30; // Approximation
        if (durationType === 'years') totalDays = dur * 365;
        
        // Safety cap for browser performance (10 years max daily loops)
        if (totalDays > 3650) totalDays = 3650;

        let currentBalance = p;
        let totalPrincipal = p;
        let totalInterest = 0;
        let bankedCash = 0; // Cash taken out if reinvest < 100%
        
        const data = [];

        // Dates helper to determine weekends
        let currentDate = new Date();

        // Initial state
        data.push({
            day: 0,
            label: 'Start',
            principal: totalPrincipal,
            totalInterest: 0,
            balance: currentBalance,
            banked: 0,
            dailyGain: 0,
        });

        for (let i = 1; i <= totalDays; i++) {
            currentDate.setDate(currentDate.getDate() + 1);
            const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;

            let dailyGain = 0;
            let skipDay = false;

            if (!includeWeekends && isWeekend) {
                skipDay = true;
            }

            if (!skipDay) {
                // Calculate gain based on current invested balance
                const grossGain = currentBalance * (r / 100);
                
                // Reinvest logic
                const reinvestAmount = grossGain * (reinvestRate / 100);
                const cashOutAmount = grossGain - reinvestAmount;

                dailyGain = reinvestAmount;
                bankedCash += cashOutAmount;
                totalInterest += grossGain;

                currentBalance += reinvestAmount;
            }

            // Daily Contributions
            if (contributionType !== 'none' && cAmt > 0) {
                const pmnt = contributionType === 'deposit' ? cAmt : -cAmt;
                totalPrincipal += pmnt;
                currentBalance += pmnt;
            }

            // To avoid massive arrays, down-sample data if totalDays > 100
            const shouldStore = totalDays <= 60 || i % Math.ceil(totalDays / 50) === 0 || i === totalDays;

            if (shouldStore) {
                data.push({
                    day: i,
                    label: `Day ${i}`,
                    principal: totalPrincipal,
                    totalInterest: totalInterest,
                    balance: currentBalance,
                    banked: bankedCash,
                    dailyGain: dailyGain
                });
            }
        }

        const exactFinalBalance = currentBalance;
        const exactBanked = bankedCash;
        const totalNetReturn = totalPrincipal > 0 ? ((totalInterest) / totalPrincipal) * 100 : 0;

        return { data, finalBalance: exactFinalBalance, bankedCash: exactBanked, totalPrincipal, totalInterest, totalNetReturn };
    }, [principal, dailyRate, duration, durationType, includeWeekends, reinvestRate, contributionType, contributionAmount]);

    return (
        <div className="flex flex-col xl:flex-row gap-8">
            {/* LEFT PANEL: Inputs */}
            <div className="w-full xl:w-[400px] flex-shrink-0 space-y-6">
                
                {/* Principal */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Principal Amount</label>
                    <div className="relative">
                        <span className="absolute left-4 top-3 text-slate-400 font-bold">₹</span>
                        <input
                            type="number"
                            value={principal}
                            onChange={(e) => setPrincipal(e.target.value)}
                            className="w-full pl-8 pr-4 py-3 bg-slate-900 border border-slate-700/50 rounded-xl font-mono text-lg text-white outline-none focus:border-emerald-500 transition-colors"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    {/* Interest Rate */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Interest Rate</label>
                        <div className="flex bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden focus-within:border-emerald-500 transition-colors">
                            <input
                                type="number"
                                value={dailyRate}
                                onChange={(e) => setDailyRate(e.target.value)}
                                className="w-full pl-4 pr-2 py-3 bg-transparent font-mono text-lg text-white outline-none"
                            />
                            <div className="flex items-center px-4 bg-slate-800/50 border-l border-slate-700/50">
                                <span className="text-slate-400 text-xs font-bold whitespace-nowrap">% daily</span>
                            </div>
                        </div>
                    </div>

                    {/* Duration */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Duration</label>
                        <div className="flex bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden focus-within:border-emerald-500 transition-colors">
                            <input
                                type="number"
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                className="w-full pl-4 pr-2 py-3 bg-transparent font-mono text-lg text-white outline-none"
                            />
                            <select
                                value={durationType}
                                onChange={(e) => setDurationType(e.target.value as any)}
                                className="bg-slate-800/80 text-xs font-bold text-slate-300 outline-none px-2 cursor-pointer border-l border-slate-700/50"
                            >
                                <option value="days">days</option>
                                <option value="months">mos</option>
                                <option value="years">yrs</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Advanced Trading Rules */}
                <div className="p-5 bg-emerald-900/10 border border-emerald-500/20 rounded-xl space-y-5">
                    <h4 className="text-xs font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp size={14} /> Trading Mechanics
                    </h4>
                    
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-sm font-semibold text-slate-300">Include all days of week?</label>
                            <Info size={14} className="text-slate-500" />
                        </div>
                        <div className="flex bg-slate-900 p-1 rounded-lg">
                            <button onClick={() => setIncludeWeekends(true)} className={`flex-1 py-2 text-xs font-bold rounded ${includeWeekends ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Yes (Crypto)</button>
                            <button onClick={() => setIncludeWeekends(false)} className={`flex-1 py-2 text-xs font-bold rounded ${!includeWeekends ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>No (Stocks/FX)</button>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-sm font-semibold text-slate-300">Daily Reinvest Rate</label>
                            <span className="text-emerald-400 font-mono text-sm font-bold">{reinvestRate}%</span>
                        </div>
                        <input
                            type="range"
                            min="0" max="100" step="10"
                            value={reinvestRate}
                            onChange={(e) => setReinvestRate(Number(e.target.value))}
                            className="w-full accent-emerald-500"
                        />
                        <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                            At 100%, all profit is added to next day's trade size. At 50%, half is kept in the trading account, half is withdrawn to cash.
                        </p>
                    </div>
                </div>

                {/* Additional Contributions */}
                <div className="p-4 bg-slate-800/20 border border-slate-700/30 rounded-xl space-y-4">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Additional Daily Contributions</label>
                    <div className="flex bg-slate-900 p-1 rounded-lg">
                        <button onClick={() => setContributionType('none')} className={`flex-1 py-1 text-xs font-bold rounded ${contributionType === 'none' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>None</button>
                        <button onClick={() => setContributionType('deposit')} className={`flex-1 py-1 text-xs font-bold rounded ${contributionType === 'deposit' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Deposits</button>
                        <button onClick={() => setContributionType('withdrawal')} className={`flex-1 py-1 text-xs font-bold rounded ${contributionType === 'withdrawal' ? 'bg-rose-600 text-white' : 'text-slate-500'}`}>Withdrawals</button>
                    </div>
                    {contributionType !== 'none' && (
                        <div className="relative">
                            <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">₹</span>
                            <input
                                type="number"
                                value={contributionAmount}
                                onChange={(e) => setContributionAmount(e.target.value)}
                                className="w-full pl-7 pr-4 py-2 bg-slate-900 border border-slate-700/50 rounded-lg font-mono text-sm text-white outline-none focus:border-indigo-500"
                                placeholder="Daily Amount"
                            />
                        </div>
                    )}
                </div>

            </div>

            {/* RIGHT PANEL: Results & Charts */}
            <div className="flex-1 space-y-6">
                
                {/* Hero Results */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="col-span-1 md:col-span-2 p-5 bg-gradient-to-br from-emerald-900/40 to-slate-900 border border-emerald-500/20 rounded-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-emerald-500/20 transition-all"></div>
                        <p className="text-sm text-emerald-300/70 font-medium mb-1 relative z-10">Future Investment Value</p>
                        <h3 className="text-4xl font-black text-emerald-400 tracking-tight font-mono relative z-10">
                            {formatCurrency(results.finalBalance)}
                        </h3>
                        <p className="text-xs font-semibold text-emerald-500/70 mt-3 relative z-10 uppercase tracking-widest">+ {results.totalNetReturn.toFixed(2)}% TOTAL RETURN</p>
                    </div>

                    <div className="p-5 bg-slate-800/30 border border-slate-700/30 rounded-2xl flex flex-col justify-between">
                        <div>
                            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Total Profit</p>
                            <h4 className="text-xl font-bold text-white font-mono">{formatCurrency(results.totalInterest)}</h4>
                        </div>
                        {reinvestRate < 100 && (
                            <div className="mt-4 pt-4 border-t border-slate-700/50">
                                <p className="text-xs text-amber-500/70 uppercase tracking-widest font-bold mb-1">Banked Cash</p>
                                <h4 className="text-lg font-bold text-amber-400 font-mono">{formatCurrency(results.bankedCash)}</h4>
                            </div>
                        )}
                    </div>
                </div>

                {/* Toggles */}
                <div className="flex justify-end items-center bg-slate-900 border border-slate-800 rounded-xl p-1 mt-4">
                    <div className="flex">
                        <button onClick={() => setViewMode('chart')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'chart' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}><BarChart3 size={14} /> Chart</button>
                        <button onClick={() => setViewMode('table')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'table' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}><List size={14} /> Breakdown</button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 min-h-[350px]">
                    {viewMode === 'chart' ? (
                        <div className="h-[320px] w-full">
                            <SafeChartContainer>
                                <BarChart data={results.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <XAxis dataKey="label" stroke="#475569" fontSize={11} tickMargin={10} minTickGap={30} />
                                    <YAxis stroke="#475569" fontSize={11} tickFormatter={(val) => `₹${(val/1000).toFixed(0)}k`} width={60} />
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.5} />
                                    <RechartsTooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)' }}
                                        itemStyle={{ fontSize: '13px', fontWeight: 'bold' }}
                                        labelStyle={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}
                                        formatter={(value, name) => [formatCurrency(Number(value ?? 0)), name === 'balance' ? 'Live Balance' : name === 'banked' ? 'Banked Cash' : String(name)]}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                                    
                                    <Bar dataKey="principal" stackId="a" name="Base Principal" fill="#3b82f6" opacity={0.3} radius={[0,0,0,0]} />
                                    {reinvestRate < 100 && <Bar dataKey="banked" stackId="a" name="Banked Cash" fill="#f59e0b" radius={[0, 0, 0, 0]} />}
                                    <Bar dataKey="balance" stackId="a" name="Compounded Balance" fill="#10b981" radius={[4, 4, 0, 0]} />
                                    
                                </BarChart>
                            </SafeChartContainer>
                        </div>
                    ) : (
                        <div className="overflow-x-auto max-h-[320px] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
                            <table className="w-full text-left text-sm">
                                <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 z-10">
                                    <tr>
                                        <th className="py-3 px-4 text-slate-400 font-semibold">Day</th>
                                        <th className="py-3 px-4 text-slate-400 font-semibold">Daily Gain</th>
                                        {reinvestRate < 100 && <th className="py-3 px-4 text-slate-400 font-semibold text-amber-500">Banked</th>}
                                        <th className="py-3 px-4 text-slate-400 font-semibold text-right">Trading Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.data.map((row, idx) => (
                                        <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                            <td className="py-3 px-4 text-slate-300 font-medium">{row.label}</td>
                                            <td className="py-3 px-4 text-emerald-400/80 font-mono text-xs">+{formatCurrency(row.dailyGain)}</td>
                                            {reinvestRate < 100 && <td className="py-3 px-4 text-amber-500 font-mono text-xs">{formatCurrency(row.banked)}</td>}
                                            <td className="py-3 px-4 text-emerald-300 font-mono text-sm font-bold text-right">{formatCurrency(row.balance)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
