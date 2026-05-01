import React, { useState, useEffect } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { TrendingUp, RefreshCw, BarChart2, DollarSign, ShieldAlert, Sparkles, Scale, Info } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';

type ComparisonType = 'fd_mf' | 'fd_gold' | 'gold_silver' | 'realestate_stocks';

export const ReturnsCalculatorTab: React.FC = () => {
    const [comparison, setComparison] = useState<ComparisonType>('fd_mf');
    const [principal, setPrincipal] = useState<number>(100000);
    const [years, setYears] = useState<number>(5);

    // Rates based on selection
    const [fdRate, setFdRate] = useState<number>(6.5);
    const [mfRate, setMfRate] = useState<number>(12);
    const [goldRate, setGoldRate] = useState<number>(8);
    const [silverRate, setSilverRate] = useState<number>(10);
    const [realestateRate, setRealestateRate] = useState<number>(7.5);
    const [stocksRate, setStocksRate] = useState<number>(15);

    const [option1Name, setOption1Name] = useState<string>('FD');
    const [option2Name, setOption2Name] = useState<string>('Mutual Fund');
    const [option1Rate, setOption1Rate] = useState<number>(6.5);
    const [option2Rate, setOption2Rate] = useState<number>(12);

    useEffect(() => {
        updateRatesAndNames();
    }, [comparison, fdRate, mfRate, goldRate, silverRate, realestateRate, stocksRate]);

    const updateRatesAndNames = () => {
        if (comparison === 'fd_mf') {
            setOption1Name('FD');
            setOption2Name('Mutual Fund');
            setOption1Rate(fdRate);
            setOption2Rate(mfRate);
        } else if (comparison === 'fd_gold') {
            setOption1Name('FD');
            setOption2Name('Gold');
            setOption1Rate(fdRate);
            setOption2Rate(goldRate);
        } else if (comparison === 'gold_silver') {
            setOption1Name('Gold');
            setOption2Name('Silver');
            setOption1Rate(goldRate);
            setOption2Rate(silverRate);
        } else if (comparison === 'realestate_stocks') {
            setOption1Name('Real Estate');
            setOption2Name('Stocks');
            setOption1Rate(realestateRate);
            setOption2Rate(stocksRate);
        }
    };

    const compoundReturns = (p: number, r: number, y: number) => {
        return p * Math.pow(1 + r / 100, y);
    };

    const getChartData = () => {
        const data = [];
        for (let i = 0; i <= years; i++) {
            const val1 = compoundReturns(principal, option1Rate, i);
            const val2 = compoundReturns(principal, option2Rate, i);
            data.push({
                year: `Year ${i}`,
                [option1Name]: Math.round(val1),
                [option2Name]: Math.round(val2)
            });
        }
        return data;
    };

    const getProjectionRows = () => {
        const rows = [];
        for (let i = 1; i <= years; i++) {
            const val1 = compoundReturns(principal, option1Rate, i);
            const val2 = compoundReturns(principal, option2Rate, i);
            rows.push({
                year: i,
                val1,
                val2,
                diff: Math.abs(val1 - val2)
            });
        }
        return rows;
    };

    const val1Final = compoundReturns(principal, option1Rate, years);
    const val2Final = compoundReturns(principal, option2Rate, years);
    const difference = Math.abs(val1Final - val2Final);
    const betterOption = val1Final > val2Final ? option1Name : option2Name;

    const formatCurrency = (num: number) => {
        return "₹" + Math.round(num).toLocaleString('en-IN');
    };

    const chartData = getChartData();
    const projectionRows = getProjectionRows();

    return (
        <div className="space-y-6 tab-fade-in pb-12 text-slate-100 max-w-[100vw] overflow-x-hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/40 p-6 rounded-2xl border border-slate-800/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
                        <TrendingUp size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-white">Rupee Returns Analyzer</h1>
                        <p className="text-xs text-slate-400 mt-0.5">Compare compound compounding curves across various personal wealth assets</p>
                    </div>
                </div>
                <select 
                    value={comparison}
                    onChange={(e) => setComparison(e.target.value as ComparisonType)}
                    className="bg-slate-800 border border-slate-700/60 text-slate-200 text-xs px-3.5 py-2.5 rounded-xl font-semibold outline-none focus:ring-1 focus:ring-indigo-500 shadow-sm"
                >
                    <option value="fd_mf">FD vs Mutual Funds</option>
                    <option value="fd_gold">FD vs Gold</option>
                    <option value="gold_silver">Gold vs Silver</option>
                    <option value="realestate_stocks">Real Estate vs Stocks</option>
                </select>
            </div>

            {/* Results Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between min-h-[110px]">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{option1Name} Value</span>
                    <div>
                        <div className="text-xl font-mono font-black text-white mt-1">{formatCurrency(val1Final)}</div>
                        <div className="text-xs text-slate-400 mt-0.5">At {option1Rate}% p.a.</div>
                    </div>
                </div>
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between min-h-[110px]">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{option2Name} Value</span>
                    <div>
                        <div className="text-xl font-mono font-black text-white mt-1">{formatCurrency(val2Final)}</div>
                        <div className="text-xs text-slate-400 mt-0.5">At {option2Rate}% p.a.</div>
                    </div>
                </div>
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between min-h-[110px]">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Total Difference</span>
                    <div>
                        <div className="text-xl font-mono font-black text-amber-400 mt-1">{formatCurrency(difference)}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Net return differential</div>
                    </div>
                </div>
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between min-h-[110px]">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Better Performer</span>
                    <div>
                        <div className="text-lg font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                            <Sparkles size={16} />
                            {betterOption}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">Highest compounding value</div>
                    </div>
                </div>
            </div>

            {/* Inputs vs Chart Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Inputs Sliders (1/3 width) */}
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 space-y-6">
                    <h2 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider">Parameters</h2>

                    {/* Principal Slider */}
                    <div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 font-medium">Principal Investment</span>
                            <span className="font-mono font-bold text-white">{formatCurrency(principal)}</span>
                        </div>
                        <input 
                            type="range"
                            min="10000"
                            max="10000000"
                            step="10000"
                            value={principal}
                            onChange={(e) => setPrincipal(parseInt(e.target.value))}
                            className="w-full mt-2 accent-indigo-500 bg-slate-850 h-1.5 rounded-lg cursor-pointer"
                        />
                    </div>

                    {/* Horizon Slider */}
                    <div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 font-medium">Horizon Timeframe</span>
                            <span className="font-mono font-bold text-white">{years} Years</span>
                        </div>
                        <input 
                            type="range"
                            min="1"
                            max="30"
                            step="1"
                            value={years}
                            onChange={(e) => setYears(parseInt(e.target.value))}
                            className="w-full mt-2 accent-indigo-500 bg-slate-850 h-1.5 rounded-lg cursor-pointer"
                        />
                    </div>

                    {/* Return Rate 1 Slider */}
                    <div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 font-medium">{option1Name} Return Rate</span>
                            <span className="font-mono font-bold text-indigo-400">{option1Rate}% p.a.</span>
                        </div>
                        <input 
                            type="range"
                            min="1"
                            max="25"
                            step="0.1"
                            value={option1Rate}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (comparison === 'fd_mf' || comparison === 'fd_gold') setFdRate(val);
                                else if (comparison === 'gold_silver') setGoldRate(val);
                                else if (comparison === 'realestate_stocks') setRealestateRate(val);
                            }}
                            className="w-full mt-2 accent-indigo-500 bg-slate-850 h-1.5 rounded-lg cursor-pointer"
                        />
                    </div>

                    {/* Return Rate 2 Slider */}
                    <div>
                        <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 font-medium">{option2Name} Return Rate</span>
                            <span className="font-mono font-bold text-indigo-400">{option2Rate}% p.a.</span>
                        </div>
                        <input 
                            type="range"
                            min="1"
                            max="25"
                            step="0.1"
                            value={option2Rate}
                            onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (comparison === 'fd_mf') setMfRate(val);
                                else if (comparison === 'fd_gold') setGoldRate(val);
                                else if (comparison === 'gold_silver') setSilverRate(val);
                                else if (comparison === 'realestate_stocks') setStocksRate(val);
                            }}
                            className="w-full mt-2 accent-indigo-500 bg-slate-850 h-1.5 rounded-lg cursor-pointer"
                        />
                    </div>
                </div>

                {/* Area Compounding Chart (2/3 width) */}
                <div className="lg:col-span-2 bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 h-[380px] flex flex-col">
                    <h2 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider mb-4">Growth Comparison</h2>
                    <div className="flex-1 w-full relative min-h-[220px]">
                        <SafeChartContainer>
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="opt1Color" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                    </linearGradient>
                                    <linearGradient id="opt2Color" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                <XAxis dataKey="year" stroke="#64748b" fontSize={10} tickLine={false} />
                                <YAxis stroke="#64748b" fontSize={10} tickLine={false} tickFormatter={(val) => '₹' + (val/1000) + 'k'} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px' }}
                                    labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                                    formatter={(value: any) => [formatCurrency(value), 'Value']}
                                />
                                <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }} />
                                <Area type="monotone" dataKey={option1Name} stroke="#3b82f6" fillOpacity={1} fill="url(#opt1Color)" strokeWidth={2} />
                                <Area type="monotone" dataKey={option2Name} stroke="#8b5cf6" fillOpacity={1} fill="url(#opt2Color)" strokeWidth={2} />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>

            {/* Compounding Projections Table */}
            <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 flex flex-col h-[350px]">
                <h2 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider mb-4">Projected Growth Ledger</h2>
                
                <div className="flex-1 overflow-y-auto overflow-x-auto rounded-xl border border-slate-800/80 custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead>
                            <tr className="border-b border-slate-800 bg-slate-950/60 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                <th className="py-2.5 px-4">Timeline</th>
                                <th className="py-2.5 px-4">{option1Name} Value</th>
                                <th className="py-2.5 px-4">{option2Name} Value</th>
                                <th className="py-2.5 px-4 text-right">Accumulated Difference</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                            {projectionRows.map((row) => (
                                <tr key={row.year} className="hover:bg-slate-850/40 transition-colors">
                                    <td className="py-2.5 px-4 font-semibold text-white text-xs">Year {row.year}</td>
                                    <td className="py-2.5 px-4 font-mono text-slate-300 text-xs">{formatCurrency(row.val1)}</td>
                                    <td className="py-2.5 px-4 font-mono text-slate-300 text-xs">{formatCurrency(row.val2)}</td>
                                    <td className="py-2.5 px-4 font-mono text-xs text-right font-black text-amber-400">
                                        {formatCurrency(row.diff)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Financial Insights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center gap-2 text-indigo-400">
                        <Scale size={16} />
                        <h3 className="text-xs uppercase font-black tracking-wider">Tax Implications</h3>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                        Fixed Deposits are taxed at your income slab rate. Mutual Funds qualify for Equity Capital Gains (12.5% LTCG, 20% STCG) which can yield significantly higher net returns for higher tax brackets.
                    </p>
                </div>
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center gap-2 text-indigo-400">
                        <ShieldAlert size={16} />
                        <h3 className="text-xs uppercase font-black tracking-wider">Volatility Risk</h3>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                        FD guarantees returns with zero market exposure. Equity and Mutual Funds fluctuate daily but compound higher over longer durations (10+ years), mitigating short-term capital risks.
                    </p>
                </div>
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 space-y-2">
                    <div className="flex items-center gap-2 text-indigo-400">
                        <Info size={16} />
                        <h3 className="text-xs uppercase font-black tracking-wider">Inflation Hedge</h3>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                        If average inflation runs at 6% p.a., a 6.5% FD yields only 0.5% real returns. Stocks and gold typically expand above inflation, preserving your purchasing power over time.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ReturnsCalculatorTab;
