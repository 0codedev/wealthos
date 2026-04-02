import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { Calculator, BarChart3, List, Info, TrendingUp, RefreshCw, CalendarDays } from 'lucide-react';

const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);
const formatNumber = (val: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(val);

export const CompoundInterestCalculator: React.FC = () => {
    // Inputs
    const [principal, setPrincipal] = useState<string>('5000');
    const [rate, setRate] = useState<string>('5');
    const [rateType, setRateType] = useState<'annual' | 'monthly'>('annual');
    const [compoundFreq, setCompoundFreq] = useState<number>(12); // times per year: 12=monthly, 1=yearly, 365=daily
    
    const [years, setYears] = useState<string>('5');
    const [months, setMonths] = useState<string>('0');
    
    const [contributionType, setContributionType] = useState<'none' | 'deposit' | 'withdrawal'>('none');
    const [contributionAmount, setContributionAmount] = useState<string>('0');
    const [contributionFreq, setContributionFreq] = useState<number>(12); // times per year

    // Display toggles
    const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
    const [breakdown, setBreakdown] = useState<'yearly' | 'monthly'>('yearly');

    // Engine
    const results = useMemo(() => {
        const p = parseFloat(principal) || 0;
        const r = parseFloat(rate) || 0;
        const y = parseInt(years) || 0;
        const m = parseInt(months) || 0;
        const cAmt = parseFloat(contributionAmount) || 0;
        
        const totalMonths = (y * 12) + m;
        // Adjust annual rate if user entered monthly rate
        const annualRate = rateType === 'annual' ? r / 100 : (r * 12) / 100;
        
        let currentBalance = p;
        let totalPrincipal = p;
        let totalInterest = 0;
        
        const data = [];
        
        // Initial state
        data.push({
            month: 0,
            year: 0,
            label: 'Start',
            principal: totalPrincipal,
            totalInterest: 0,
            balance: currentBalance,
            accruedInterestThisPeriod: 0,
        });

        // We will step month by month for charting
        let uncompoundedInterest = 0;

        for (let i = 1; i <= totalMonths; i++) {
            // 1. Calculate Interest for this month
            // Effective monthly rate depends on compounding freq.
            // If compounded daily: annualRate / 365, applied 30.416 times.
            let monthlyInterest = 0;
            if (compoundFreq === 12) {
                monthlyInterest = currentBalance * (annualRate / 12);
            } else if (compoundFreq === 365) {
                // Compound daily for ~30.416 days
                monthlyInterest = currentBalance * (Math.pow(1 + annualRate / 365, 365 / 12) - 1);
            } else if (compoundFreq === 1) {
                // Compounded yearly
                uncompoundedInterest += currentBalance * (annualRate / 12);
                if (i % 12 === 0) {
                    monthlyInterest = uncompoundedInterest;
                    uncompoundedInterest = 0;
                }
            } else if (compoundFreq === 4) {
                 // Quarterly
                 uncompoundedInterest += currentBalance * (annualRate / 12);
                 if (i % 3 === 0) {
                     monthlyInterest = uncompoundedInterest;
                     uncompoundedInterest = 0;
                 }
            }

            currentBalance += monthlyInterest;
            totalInterest += monthlyInterest;

            // 2. Add Contributions (end of month)
            let pmnt = 0;
            if (contributionType !== 'none' && cAmt > 0) {
                if (contributionFreq === 12) { // Monthly
                    pmnt = contributionType === 'deposit' ? cAmt : -cAmt;
                } else if (contributionFreq === 1 && i % 12 === 0) { // Yearly
                    pmnt = contributionType === 'deposit' ? cAmt : -cAmt;
                }
            }
            
            totalPrincipal += pmnt;
            currentBalance += pmnt;

            // Store data points
            if (breakdown === 'monthly' || (breakdown === 'yearly' && i % 12 === 0) || i === totalMonths) {
                data.push({
                    month: i,
                    year: Math.floor(i / 12),
                    label: breakdown === 'yearly' ? `Year ${Math.floor(i/12)}` : `Month ${i}`,
                    principal: totalPrincipal,
                    totalInterest: totalInterest,
                    balance: currentBalance,
                    accruedInterestThisPeriod: monthlyInterest
                });
            }
        }

        const finalBalance = currentBalance;
        const allTimeRoR = totalPrincipal > 0 ? (totalInterest / totalPrincipal) * 100 : 0;
        
        // Calculate APY (Compounded rate)
        const apy = (Math.pow(1 + annualRate / compoundFreq, compoundFreq) - 1) * 100;

        return { data, finalBalance, totalPrincipal, totalInterest, allTimeRoR, apy };
    }, [principal, rate, rateType, compoundFreq, years, months, contributionType, contributionAmount, contributionFreq, breakdown]);

    return (
        <div className="flex flex-col xl:flex-row gap-8">
            {/* LEFT PANEL: Inputs */}
            <div className="w-full xl:w-[400px] flex-shrink-0 space-y-6">
                
                {/* Initial Investment */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Initial Investment (Principal)</label>
                    <div className="relative">
                        <span className="absolute left-4 top-3 text-slate-400 font-bold">₹</span>
                        <input
                            type="number"
                            value={principal}
                            onChange={(e) => setPrincipal(e.target.value)}
                            className="w-full pl-8 pr-4 py-3 bg-slate-900 border border-slate-700/50 rounded-xl font-mono text-lg text-white outline-none focus:border-indigo-500 transition-colors"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    {/* Interest Rate */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Interest Rate</label>
                        <div className="flex bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden focus-within:border-indigo-500 transition-colors">
                            <input
                                type="number"
                                value={rate}
                                onChange={(e) => setRate(e.target.value)}
                                className="w-full pl-4 pr-2 py-3 bg-transparent font-mono text-lg text-white outline-none"
                            />
                            <div className="flex items-center px-2 border-l border-slate-700/50 bg-slate-800/50">
                                <span className="text-slate-400 font-bold">%</span>
                            </div>
                            <select
                                value={rateType}
                                onChange={(e) => setRateType(e.target.value as any)}
                                className="bg-slate-800/50 text-xs font-bold text-slate-300 outline-none px-2 cursor-pointer border-l border-slate-700/50"
                            >
                                <option value="annual">Y</option>
                                <option value="monthly">M</option>
                            </select>
                        </div>
                    </div>

                    {/* Compound Frequency */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Compounding</label>
                        <select
                            value={compoundFreq}
                            onChange={(e) => setCompoundFreq(Number(e.target.value))}
                            className="w-full px-4 py-3.5 bg-slate-900 border border-slate-700/50 rounded-xl text-sm font-bold text-white outline-none focus:border-indigo-500 cursor-pointer appearance-none"
                        >
                            <option value={1}>Annually (1/yr)</option>
                            <option value={4}>Quarterly (4/yr)</option>
                            <option value={12}>Monthly (12/yr)</option>
                            <option value={365}>Daily (365/yr)</option>
                        </select>
                    </div>
                </div>

                {/* Duration */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Duration</label>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="relative">
                            <input
                                type="number"
                                value={years}
                                onChange={(e) => setYears(e.target.value)}
                                className="w-full pl-4 pr-12 py-3 bg-slate-900 border border-slate-700/50 rounded-xl font-mono text-lg text-white outline-none focus:border-indigo-500"
                            />
                            <span className="absolute right-4 top-3.5 text-xs font-bold text-slate-500">YRS</span>
                        </div>
                        <div className="relative">
                            <input
                                type="number"
                                value={months}
                                onChange={(e) => setMonths(e.target.value)}
                                className="w-full pl-4 pr-12 py-3 bg-slate-900 border border-slate-700/50 rounded-xl font-mono text-lg text-white outline-none focus:border-indigo-500"
                            />
                            <span className="absolute right-4 top-3.5 text-xs font-bold text-slate-500">MOS</span>
                        </div>
                    </div>
                </div>

                {/* Additional Contributions */}
                <div className="p-4 bg-slate-800/20 border border-slate-700/30 rounded-xl space-y-4">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Regular Contributions (Optional)</label>
                    
                    <div className="flex bg-slate-900 p-1 rounded-lg">
                        <button onClick={() => setContributionType('none')} className={`flex-1 py-1.5 text-xs font-bold rounded ${contributionType === 'none' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>None</button>
                        <button onClick={() => setContributionType('deposit')} className={`flex-1 py-1.5 text-xs font-bold rounded ${contributionType === 'deposit' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Deposits</button>
                        <button onClick={() => setContributionType('withdrawal')} className={`flex-1 py-1.5 text-xs font-bold rounded ${contributionType === 'withdrawal' ? 'bg-rose-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Withdrawals</button>
                    </div>

                    {contributionType !== 'none' && (
                        <div className="flex bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden focus-within:border-indigo-500 transition-colors">
                            <div className="flex items-center pl-3 text-slate-400 font-bold">₹</div>
                            <input
                                type="number"
                                value={contributionAmount}
                                onChange={(e) => setContributionAmount(e.target.value)}
                                className="w-full pl-2 pr-2 py-3 bg-transparent font-mono text-base text-white outline-none"
                                placeholder="Amount"
                            />
                            <select
                                value={contributionFreq}
                                onChange={(e) => setContributionFreq(Number(e.target.value))}
                                className="bg-slate-800/80 text-xs font-bold text-slate-300 outline-none px-3 cursor-pointer border-l border-slate-700/50"
                            >
                                <option value={12}>monthly</option>
                                <option value={1}>yearly</option>
                            </select>
                        </div>
                    )}
                </div>

            </div>

            {/* RIGHT PANEL: Results & Charts */}
            <div className="flex-1 space-y-6">
                
                {/* Hero Results */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-5 bg-gradient-to-br from-indigo-900/40 to-slate-900 border border-indigo-500/20 rounded-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-indigo-500/20 transition-all"></div>
                        <p className="text-sm text-indigo-300/70 font-medium mb-1 relative z-10">Future Investment Value</p>
                        <h3 className="text-4xl font-black text-indigo-400 tracking-tight font-mono relative z-10">
                            {formatCurrency(results.finalBalance)}
                        </h3>
                        <div className="mt-4 flex flex-col gap-1 relative z-10">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">Total Interest Earned</span>
                                <span className="font-bold text-emerald-400 font-mono">+{formatCurrency(results.totalInterest)}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">Initial Balance</span>
                                <span className="font-bold text-slate-300 font-mono">{formatCurrency(results.totalPrincipal)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-rows-2 gap-4">
                        <div className="p-4 bg-slate-800/30 border border-slate-700/30 rounded-2xl flex flex-col justify-center items-start">
                            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Effective APY</p>
                            <div className="flex items-baseline gap-2">
                                <span className="text-xl font-bold text-white font-mono">{results.apy.toFixed(2)}%</span>
                                <span className="text-xs text-slate-500 flex items-center gap-1 bg-slate-800 px-1.5 py-0.5 rounded"><RefreshCw size={10}/> from {rate}%</span>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-800/30 border border-slate-700/30 rounded-2xl flex flex-col justify-center items-start">
                            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">All-Time Return (RoR)</p>
                            <div className="flex items-baseline gap-2">
                                <TrendingUp className="text-emerald-500" size={20} />
                                <span className="text-2xl font-black text-emerald-400 font-mono">{results.allTimeRoR.toFixed(2)}%</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Toggles */}
                <div className="flex justify-between items-center bg-slate-900 border border-slate-800 rounded-xl p-1 mt-4">
                    <div className="flex">
                        <button onClick={() => setBreakdown('yearly')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${breakdown === 'yearly' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>Yearly</button>
                        <button onClick={() => setBreakdown('monthly')} className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${breakdown === 'monthly' ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>Monthly</button>
                    </div>
                    <div className="flex">
                        <button onClick={() => setViewMode('chart')} className={`p-2 rounded-lg transition-all ${viewMode === 'chart' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}><BarChart3 size={16} /></button>
                        <button onClick={() => setViewMode('table')} className={`p-2 rounded-lg transition-all ${viewMode === 'table' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}><List size={16} /></button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 min-h-[350px]">
                    {viewMode === 'chart' ? (
                        <div className="h-[320px] w-full">
                            <SafeChartContainer>
                                <AreaChart data={results.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorPrincipal" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                        </linearGradient>
                                        <linearGradient id="colorInterest" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.2}/>
                                        </linearGradient>
                                    </defs>
                                    <XAxis dataKey="label" stroke="#475569" fontSize={11} tickMargin={10} minTickGap={20} />
                                    <YAxis stroke="#475569" fontSize={11} tickFormatter={(val) => `₹${(val/1000).toFixed(0)}k`} width={60} />
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} opacity={0.5} />
                                    <RechartsTooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '12px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)' }}
                                        itemStyle={{ fontSize: '13px', fontWeight: 'bold' }}
                                        labelStyle={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}
                                        formatter={(value) => [formatCurrency(Number(value ?? 0)), '']}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }} />
                                    <Area type="monotone" dataKey="principal" stackId="1" name="Principal" stroke="#6366f1" fill="url(#colorPrincipal)" strokeWidth={2} />
                                    <Area type="monotone" dataKey="totalInterest" stackId="1" name="Accrued Interest" stroke="#10b981" fill="url(#colorInterest)" strokeWidth={2} />
                                </AreaChart>
                            </SafeChartContainer>
                        </div>
                    ) : (
                        <div className="overflow-x-auto max-h-[320px] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900">
                            <table className="w-full text-left text-sm">
                                <thead className="sticky top-0 bg-slate-900 border-b border-slate-800 z-10">
                                    <tr>
                                        <th className="py-3 px-4 text-slate-400 font-semibold">{breakdown === 'yearly' ? 'Year' : 'Month'}</th>
                                        <th className="py-3 px-4 text-slate-400 font-semibold">Interest</th>
                                        <th className="py-3 px-4 text-slate-400 font-semibold">Total Accrued</th>
                                        <th className="py-3 px-4 text-slate-400 font-semibold text-right">Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.data.map((row, idx) => (
                                        <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                            <td className="py-3 px-4 text-slate-300 font-medium">{row.label}</td>
                                            <td className="py-3 px-4 text-emerald-400/80 font-mono text-xs">+{formatCurrency(row.accruedInterestThisPeriod)}</td>
                                            <td className="py-3 px-4 text-emerald-500 font-mono text-xs font-bold">{formatCurrency(row.totalInterest)}</td>
                                            <td className="py-3 px-4 text-indigo-300 font-mono text-sm font-bold text-right">{formatCurrency(row.balance)}</td>
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
