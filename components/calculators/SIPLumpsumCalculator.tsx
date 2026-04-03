import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from '../shared/SafeChartContainer';
import { formatCurrency } from '../../utils/helpers';
import { EditableValue } from '../shared/EditableValue';
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

export const SIPLumpsumCalculator: React.FC = () => {
    const [calcType, setCalcType] = useState<'SIP' | 'LUMPSUM'>('SIP');
    const [monthlyInvestment, setMonthlyInvestment] = useState(10000);
    const [lumpsumInvestment, setLumpsumInvestment] = useState(100000);
    const [expectedReturn, setExpectedReturn] = useState(12);
    const [timePeriod, setTimePeriod] = useState(10);
    const [stepUpPerc, setStepUpPerc] = useState(0);
    const [inflationAdj, setInflationAdj] = useState(6);
    const [showReal, setShowReal] = useState(false);

    const result = useMemo(() => {
        let totalInvested = 0;
        let futureValue = 0;
        const chartData = [];

        const monthlyRate = expectedReturn / 12 / 100;
        const months = timePeriod * 12;

        if (calcType === 'SIP') {
            let currentMonthly = monthlyInvestment;
            let currentFV = 0;

            for (let year = 1; year <= timePeriod; year++) {
                // For each year, we have 12 months of contributions at currentMonthly
                for (let month = 1; month <= 12; month++) {
                    totalInvested += currentMonthly;
                    currentFV = (currentFV + currentMonthly) * (1 + monthlyRate);
                }

                chartData.push({
                    year,
                    invested: Math.round(totalInvested),
                    value: Math.round(currentFV)
                });

                // Apply step up at end of year
                if (stepUpPerc > 0) {
                    currentMonthly = currentMonthly * (1 + stepUpPerc / 100);
                }
            }
            futureValue = currentFV;

        } else {
            // Lumpsum
            totalInvested = lumpsumInvestment;
            for (let year = 1; year <= timePeriod; year++) {
                const yearValue = totalInvested * Math.pow(1 + expectedReturn / 100, year);
                chartData.push({
                    year,
                    invested: totalInvested,
                    value: Math.round(yearValue)
                });
            }
            futureValue = chartData[chartData.length - 1].value;
        }

        const estReturns = futureValue - totalInvested;
        const realFutureValue = futureValue / Math.pow(1 + inflationAdj / 100, timePeriod);
        const realReturns = realFutureValue - totalInvested;

        return { totalInvested, futureValue, estReturns, realFutureValue, realReturns, chartData };
    }, [calcType, monthlyInvestment, lumpsumInvestment, expectedReturn, timePeriod, stepUpPerc, inflationAdj]);

    return (
        <div className="bg-transparent md:bg-slate-900 md:border md:border-slate-800 rounded-2xl p-0 md:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <h3 className="text-xl font-bold text-white px-1">Investment Calculator</h3>
                <div className="flex bg-slate-800 p-1 rounded-lg">
                    <button
                        onClick={() => setCalcType('SIP')}
                        className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${calcType === 'SIP' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        SIP
                    </button>
                    <button
                        onClick={() => setCalcType('LUMPSUM')}
                        className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors ${calcType === 'LUMPSUM' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                        Lumpsum
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Inputs */}
                <div className="lg:col-span-5 space-y-6">
                    {calcType === 'SIP' ? (
                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Monthly Investment</label>
                                <EditableValue
                                    value={monthlyInvestment}
                                    onChange={setMonthlyInvestment}
                                    displayValue={formatCurrency(monthlyInvestment)}
                                    className="text-sm font-bold text-indigo-400"
                                    min={500}
                                    step={500}
                                />
                            </div>
                            <input
                                type="range" min="500" max="1000000" step="500"
                                value={monthlyInvestment}
                                onChange={(e) => setMonthlyInvestment(Number(e.target.value))}
                                className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    ) : (
                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Total Investment</label>
                                <EditableValue
                                    value={lumpsumInvestment}
                                    onChange={setLumpsumInvestment}
                                    displayValue={formatCurrency(lumpsumInvestment)}
                                    className="text-sm font-bold text-indigo-400"
                                    min={1000}
                                    step={1000}
                                />
                            </div>
                            <input
                                type="range" min="10000" max="10000000" step="10000"
                                value={lumpsumInvestment}
                                onChange={(e) => setLumpsumInvestment(Number(e.target.value))}
                                className="w-full accent-indigo-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Expected Return Rate (p.a)</label>
                            <EditableValue
                                value={expectedReturn}
                                onChange={setExpectedReturn}
                                suffix="%"
                                className="text-sm font-bold text-emerald-400"
                                min={1}
                                max={50}
                                step={0.5}
                            />
                        </div>
                        <input
                            type="range" min="1" max="30" step="0.5"
                            value={expectedReturn}
                            onChange={(e) => setExpectedReturn(Number(e.target.value))}
                            className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Time Period (Years)</label>
                            <EditableValue
                                value={timePeriod}
                                onChange={setTimePeriod}
                                suffix=" Yr"
                                className="text-sm font-bold text-amber-400"
                                min={1}
                                max={50}
                                step={1}
                            />
                        </div>
                        <input
                            type="range" min="1" max="40" step="1"
                            value={timePeriod}
                            onChange={(e) => setTimePeriod(Number(e.target.value))}
                            className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    {calcType === 'SIP' && (
                        <div>
                            <div className="flex justify-between mb-2">
                                <label className="text-sm font-medium text-slate-300">Annual Step-Up (Optional)</label>
                                <EditableValue
                                    value={stepUpPerc}
                                    onChange={setStepUpPerc}
                                    suffix="%"
                                    className="text-sm font-bold text-rose-400"
                                    min={0}
                                    max={50}
                                    step={1}
                                />
                            </div>
                            <input
                                type="range" min="0" max="25" step="1"
                                value={stepUpPerc}
                                onChange={(e) => setStepUpPerc(Number(e.target.value))}
                                className="w-full accent-rose-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}
                </div>

                {/* Results & Chart */}
                <div className="lg:col-span-7 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-800/50 p-4 rounded-xl">
                            <p className="text-xs text-slate-400 mb-1">Invested Amount</p>
                            <p className="text-lg font-bold text-white">{formatCurrency(result.totalInvested)}</p>
                        </div>
                        <div className="bg-slate-800/50 p-4 rounded-xl">
                            <p className="text-xs text-slate-400 mb-1">Est. Returns</p>
                            <p className="text-lg font-bold text-emerald-400">+{formatCurrency(result.estReturns)}</p>
                        </div>
                    </div>

                    {/* CAGR & Wealth Multiplier */}
                    {result.totalInvested > 0 && (
                        <div className="flex items-center gap-3 px-1">
                            <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full px-3 py-1">
                                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">CAGR</span>
                                <span className="text-sm font-black text-indigo-300 font-mono">
                                    {((Math.pow(result.futureValue / result.totalInvested, 1 / timePeriod) - 1) * 100).toFixed(1)}%
                                </span>
                            </div>
                            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">
                                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">Wealth Multiplier</span>
                                <span className="text-sm font-black text-emerald-300 font-mono">
                                    {(result.futureValue / result.totalInvested).toFixed(1)}x
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Total Value with Real/Nominal Toggle */}
                    <div className="bg-indigo-900/40 p-4 rounded-xl border border-indigo-500/20">
                        <div className="flex items-center justify-between mb-1">
                            <p className="text-sm text-indigo-300 font-medium">Total Value</p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setInflationAdj(Number(inflationAdj) || 6)}
                                    className="hidden"
                                />
                                <button
                                    onClick={() => setShowReal(!showReal)}
                                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border transition-all ${
                                        showReal
                                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                            : 'bg-slate-800 text-slate-500 border-slate-700'
                                    }`}
                                >
                                    {showReal ? '📉 Real Value' : '📈 Nominal'}
                                </button>
                            </div>
                        </div>
                        <p className="text-3xl font-black text-white">
                            {showReal ? formatCurrency(result.realFutureValue) : formatCurrency(result.futureValue)}
                        </p>
                        {showReal && (
                            <p className="text-[10px] text-amber-400/70 mt-1">
                                Adjusted for {inflationAdj}% inflation over {timePeriod} yrs
                            </p>
                        )}
                    </div>

                    {/* Inflation Slider (shown when Real Value active) */}
                    {showReal && (
                        <div className="px-1">
                            <div className="flex justify-between mb-2">
                                <label className="text-xs font-medium text-slate-400">Inflation Rate</label>
                                <EditableValue
                                    value={inflationAdj}
                                    onChange={setInflationAdj}
                                    suffix="%"
                                    className="text-xs font-bold text-amber-400"
                                    min={1}
                                    max={20}
                                    step={0.5}
                                />
                            </div>
                            <input
                                type="range" min="1" max="20" step="0.5"
                                value={inflationAdj}
                                onChange={(e) => setInflationAdj(Number(e.target.value))}
                                className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    )}

                    <div className="h-64 w-full mt-4">
                        <SafeChartContainer>
                            <AreaChart data={result.chartData}>
                                <defs>
                                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="year" stroke="#475569" fontSize={12} tickFormatter={(val) => `${val}Y`} />
                                <YAxis stroke="#475569" fontSize={12} tickFormatter={(val) => `₹${(val / 100000).toFixed(0)}L`} />
                                <Tooltip
                                    content={({ active, payload, label }) => {
                                        if (active && payload && payload.length) {
                                            return (
                                                <div className="bg-slate-950/95 backdrop-blur-md border border-slate-700/50 p-3 rounded-xl shadow-2xl ring-1 ring-white/10">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                                        Year {label}
                                                    </p>
                                                    {payload.map((entry: any, i: number) => (
                                                        <div key={i} className="flex items-center justify-between gap-6 text-xs">
                                                            <span className="flex items-center gap-1.5">
                                                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                                <span className="text-slate-400">{entry.name}</span>
                                                            </span>
                                                            <span className="font-mono font-bold text-white">
                                                                {formatCurrency(entry.value)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                    {showReal && payload[1] && (
                                                        <div className="mt-2 pt-2 border-t border-slate-800 text-[10px] text-amber-400">
                                                            Real: {formatCurrency(payload[1].value / Math.pow(1 + inflationAdj / 100, Number(label)))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                                <Area type="monotone" dataKey="invested" stroke="#94a3b8" fillOpacity={1} fill="url(#colorInvested)" name="Invested" />
                                <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" name="Total Value" />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>
        </div>
    );
};
