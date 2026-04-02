import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { formatCurrency } from '../../utils/helpers';
import { EditableValue } from '../shared/EditableValue';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip as RechartsTooltip } from 'recharts';

export const FIRECalculator: React.FC = () => {
    const [currentAge, setCurrentAge] = useState(30);
    const [retirementAge, setRetirementAge] = useState(50);
    const [lifeExpectancy, setLifeExpectancy] = useState(85);
    const [monthlyExpenses, setMonthlyExpenses] = useState(50000);
    const [inflationRate, setInflationRate] = useState(6);
    const [expectedReturnPostRetirement, setExpectedReturnPostRetirement] = useState(9);

    // Existing assets
    const [currentCorpus, setCurrentCorpus] = useState(1000000);

    // Pre-retirement return
    const [preRetirementReturn, setPreRetirementReturn] = useState(12);

    const result = useMemo(() => {
        const yearsToRetirement = retirementAge - currentAge;
        const yearsInRetirement = lifeExpectancy - retirementAge;

        // Calculate monthly expenses at retirement (adjusted for inflation)
        const expensesAtRetirement = monthlyExpenses * Math.pow(1 + inflationRate / 100, yearsToRetirement);
        const annualExpensesAtRetirement = expensesAtRetirement * 12;

        // Real return post-retirement
        const realReturn = ((1 + expectedReturnPostRetirement / 100) / (1 + inflationRate / 100)) - 1;

        // Calculate needed corpus at retirement (Present value of growing annuity)
        let corpusNeeded = 0;
        if (realReturn === 0) {
            corpusNeeded = annualExpensesAtRetirement * yearsInRetirement;
        } else {
            corpusNeeded = annualExpensesAtRetirement * ((1 - Math.pow(1 + realReturn, -yearsInRetirement)) / realReturn);
        }

        // Calculate Future Value of current corpus at retirement
        const fvCurrentCorpus = currentCorpus * Math.pow(1 + preRetirementReturn / 100, yearsToRetirement);

        // Shortfall
        const shortfall = Math.max(0, corpusNeeded - fvCurrentCorpus);

        // Required monthly SIP to bridge shortfall
        const monthlyRate = preRetirementReturn / 12 / 100;
        const months = yearsToRetirement * 12;
        const requiredSIP = shortfall > 0
            ? (shortfall * monthlyRate) / (Math.pow(1 + monthlyRate, months) - 1) * (1 + monthlyRate)
            : 0;

        return {
            expensesAtRetirement,
            corpusNeeded,
            fvCurrentCorpus,
            shortfall,
            requiredSIP
        };
    }, [currentAge, retirementAge, lifeExpectancy, monthlyExpenses, inflationRate, expectedReturnPostRetirement, currentCorpus, preRetirementReturn]);

    const growthData = useMemo(() => {
        const yearsToRetirement = retirementAge - currentAge;
        const currentYear = new Date().getFullYear();
        const annualRate = preRetirementReturn / 100;
        const monthlyRate = preRetirementReturn / 12 / 100;
        const data = [];

        for (let i = 0; i <= yearsToRetirement; i++) {
            const age = currentAge + i;
            const year = currentYear + i;
            const corpusGrowth = currentCorpus * Math.pow(1 + annualRate, i);
            let sipFV = 0;
            if (result.requiredSIP > 0 && i > 0) {
                const sipMonths = i * 12;
                sipFV = result.requiredSIP * ((Math.pow(1 + monthlyRate, sipMonths) - 1) / monthlyRate) * (1 + monthlyRate);
            }
            data.push({
                year,
                age,
                corpus: Math.round(corpusGrowth + sipFV),
                target: result.corpusNeeded,
            });
        }
        return data;
    }, [currentAge, retirementAge, currentCorpus, preRetirementReturn, result.requiredSIP, result.corpusNeeded]);

    const fireReadiness = result.shortfall === 0
        ? { label: 'FIRE READY', color: 'emerald' }
        : result.shortfall < result.corpusNeeded * 0.3
        ? { label: 'CLOSE', color: 'amber' }
        : { label: 'IN PROGRESS', color: 'rose' };

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6">
            <h3 className="text-xl font-bold text-white mb-6">F.I.R.E. Engine</h3>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Inputs */}
                <div className="lg:col-span-5 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Current Age</label>
                            <input
                                type="number"
                                value={currentAge}
                                onChange={(e) => setCurrentAge(Number(e.target.value))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Retirement Age</label>
                            <input
                                type="number"
                                value={retirementAge}
                                onChange={(e) => setRetirementAge(Number(e.target.value))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Life Expectancy</label>
                            <EditableValue
                                value={lifeExpectancy}
                                onChange={setLifeExpectancy}
                                suffix=" Yr"
                                className="text-sm font-bold text-slate-300"
                                min={retirementAge + 1}
                                max={100}
                                step={1}
                            />
                        </div>
                        <input
                            type="range" min={retirementAge + 1} max="100" step="1"
                            value={lifeExpectancy}
                            onChange={(e) => setLifeExpectancy(Number(e.target.value))}
                            className="w-full accent-slate-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Current Monthly Expenses</label>
                            <EditableValue
                                value={monthlyExpenses}
                                onChange={setMonthlyExpenses}
                                displayValue={formatCurrency(monthlyExpenses)}
                                className="text-sm font-bold text-rose-400"
                                min={5000}
                                step={5000}
                            />
                        </div>
                        <input
                            type="range" min="10000" max="1000000" step="5000"
                            value={monthlyExpenses}
                            onChange={(e) => setMonthlyExpenses(Number(e.target.value))}
                            className="w-full accent-rose-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Current Saved Corpus</label>
                            <EditableValue
                                value={currentCorpus}
                                onChange={setCurrentCorpus}
                                displayValue={formatCurrency(currentCorpus)}
                                className="text-sm font-bold text-indigo-400"
                                min={0}
                                step={100000}
                            />
                        </div>
                        <input
                            type="range" min="0" max="50000000" step="100000"
                            value={currentCorpus}
                            onChange={(e) => setCurrentCorpus(Number(e.target.value))}
                            className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Inflation (%)</label>
                            <input
                                type="number" step="0.5"
                                value={inflationRate}
                                onChange={(e) => setInflationRate(Number(e.target.value))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 block mb-1">Post-Ret Return (%)</label>
                            <input
                                type="number" step="0.5"
                                value={expectedReturnPostRetirement}
                                onChange={(e) => setExpectedReturnPostRetirement(Number(e.target.value))}
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Pre-Retirement Return</label>
                            <EditableValue
                                value={preRetirementReturn}
                                onChange={setPreRetirementReturn}
                                suffix="%"
                                className="text-sm font-bold text-emerald-400"
                                min={6}
                                max={20}
                                step={0.5}
                            />
                        </div>
                        <input
                            type="range" min="6" max="20" step="0.5"
                            value={preRetirementReturn}
                            onChange={(e) => setPreRetirementReturn(Number(e.target.value))}
                            className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </div>

                {/* Results & Chart */}
                <div className="lg:col-span-7 flex flex-col justify-center">
                    <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 mb-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                        <span className={`absolute top-4 right-4 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${
                            fireReadiness.color === 'emerald'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : fireReadiness.color === 'amber'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}>
                            {fireReadiness.label}
                        </span>
                        <p className="text-sm text-slate-400 mb-2">Target FIRE Corpus Needed</p>
                        <h4 className="text-4xl font-black text-white">{formatCurrency(result.corpusNeeded)}</h4>

                        <div className="mt-6 flex flex-col md:flex-row gap-6">
                            <div className="flex-1">
                                <p className="text-xs text-slate-400 mb-1">Monthly Exp. @ Retirement</p>
                                <p className="text-lg font-bold text-rose-400">{formatCurrency(result.expensesAtRetirement)}/mo</p>
                            </div>
                            <div className="w-px bg-slate-700 hidden md:block"></div>
                            <div className="flex-1">
                                <p className="text-xs text-slate-400 mb-1">Required monthly SIP now</p>
                                {result.requiredSIP > 0 ? (
                                    <p className="text-lg font-bold text-indigo-400">{formatCurrency(result.requiredSIP)}/mo</p>
                                ) : (
                                    <p className="text-lg font-bold text-emerald-400">Target Achieved 🎉</p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="h-[200px] w-full">
                        <SafeChartContainer>
                            <AreaChart data={growthData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="corpusGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid vertical={false} stroke="#1e293b" />
                                <XAxis
                                    dataKey="age"
                                    tick={{ fontSize: 10, fill: '#64748b' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tickFormatter={(val) => val >= 10000000 ? `₹${(val / 10000000).toFixed(1)}Cr` : `₹${(val / 100000).toFixed(0)}L`}
                                    tick={{ fontSize: 10, fill: '#64748b' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={55}
                                />
                                <RechartsTooltip
                                    content={({ active, payload }) => {
                                        if (active && payload && payload.length) {
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700/50 p-3 rounded-xl shadow-2xl">
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Age {d.age} • {d.year}</p>
                                                    <p className="text-xs font-bold text-white">Corpus: {formatCurrency(d.corpus)}</p>
                                                    {d.corpus < d.target && (
                                                        <p className="text-[10px] text-rose-400 mt-0.5">Gap: {formatCurrency(d.target - d.corpus)}</p>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <ReferenceLine
                                    y={result.corpusNeeded}
                                    stroke="#10b981"
                                    strokeDasharray="4 4"
                                    strokeWidth={1.5}
                                    label={{ value: 'FIRE Target', position: 'right', fill: '#10b981', fontSize: 10 }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="corpus"
                                    stroke="#6366f1"
                                    strokeWidth={2}
                                    fill="url(#corpusGrad)"
                                />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
