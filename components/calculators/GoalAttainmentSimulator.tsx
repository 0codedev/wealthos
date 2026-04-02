import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { EditableValue } from '../shared/EditableValue';
import { Target, TrendingUp } from 'lucide-react';

export const GoalAttainmentSimulator: React.FC = () => {
    const [goalAmount, setGoalAmount] = useState(10000000); // 1 Cr
    const [yearsToGoal, setYearsToGoal] = useState(10);
    const [expectedReturn, setExpectedReturn] = useState(12); // 12% p.a.
    const [currentSavings, setCurrentSavings] = useState(500000); // 5 L

    const result = useMemo(() => {
        // Calculate Future Value of current savings at the end of the period
        const fvCurrentSavings = currentSavings * Math.pow(1 + expectedReturn / 100, yearsToGoal);

        // Shortfall = The part of the goal that isn't covered by current savings
        const shortfall = Math.max(0, goalAmount - fvCurrentSavings);

        // Required monthly investment to bridge the shortfall
        const monthlyRate = expectedReturn / 12 / 100;
        const months = yearsToGoal * 12;

        let requiredMonthly = 0;
        if (shortfall > 0) {
            requiredMonthly = (shortfall * monthlyRate) / (Math.pow(1 + monthlyRate, months) - 1) * (1 + monthlyRate);
        }

        // Delay cost (if they wait 1 year)
        const delayYears = yearsToGoal - 1;
        let delayRequiredMonthly = 0;
        if (delayYears > 0 && shortfall > 0) {
            const delayMonths = delayYears * 12;
            const delayFvSavings = currentSavings * Math.pow(1 + expectedReturn / 100, delayYears);
            const delayShortfall = Math.max(0, goalAmount - delayFvSavings);
            delayRequiredMonthly = (delayShortfall * monthlyRate) / (Math.pow(1 + monthlyRate, delayMonths) - 1) * (1 + monthlyRate);
        }

        const costOfDelay = delayRequiredMonthly - requiredMonthly;

        return {
            fvCurrentSavings,
            shortfall,
            requiredMonthly,
            delayRequiredMonthly,
            costOfDelay
        };
    }, [goalAmount, yearsToGoal, expectedReturn, currentSavings]);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Target className="text-indigo-500" size={24} /> Goal Attainment Simulator
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Inputs */}
                <div className="lg:col-span-5 space-y-6">
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Target Goal Amount</label>
                        <input
                            type="number"
                            value={goalAmount}
                            onChange={(e) => setGoalAmount(Number(e.target.value))}
                            className="w-full bg-slate-800 border-none rounded-lg px-4 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none step-100000"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Target Timeframe (Years)</label>
                            <EditableValue
                                value={yearsToGoal}
                                onChange={setYearsToGoal}
                                suffix=" Yr"
                                className="text-sm font-bold text-amber-400"
                                min={1}
                                max={40}
                                step={1}
                            />
                        </div>
                        <input
                            type="range" min="1" max="40" step="1"
                            value={yearsToGoal}
                            onChange={(e) => setYearsToGoal(Number(e.target.value))}
                            className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Expected CAGR (%)</label>
                            <EditableValue
                                value={expectedReturn}
                                onChange={setExpectedReturn}
                                suffix="%"
                                className="text-sm font-bold text-emerald-400"
                                min={1}
                                max={30}
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
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Current Saved / Allocated Amount</label>
                        <input
                            type="number"
                            value={currentSavings}
                            onChange={(e) => setCurrentSavings(Number(e.target.value))}
                            className="w-full bg-slate-800 border-none rounded-lg px-4 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                    </div>
                </div>

                {/* Outputs */}
                <div className="lg:col-span-7 flex flex-col justify-center">
                    <div className="bg-gradient-to-br from-indigo-900/40 to-slate-900 rounded-2xl p-4 sm:p-5 md:p-6 border border-indigo-500/20 mb-6">
                        <p className="text-sm font-bold text-indigo-400 uppercase tracking-widest mb-1">Required Monthly SIP</p>
                        <p className="text-5xl font-black text-white">{formatCurrency(result.requiredMonthly)}</p>

                        {result.fvCurrentSavings > goalAmount && (
                            <p className="mt-2 text-emerald-400 text-sm font-bold">Goal already met by existing corpus! 🎉</p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-slate-800/50 p-4 rounded-xl">
                            <p className="text-xs text-slate-400 mb-1">FV of Current Savings</p>
                            <p className="text-lg font-bold text-slate-300">{formatCurrency(result.fvCurrentSavings)}</p>
                        </div>
                        <div className="bg-slate-800/50 p-4 rounded-xl">
                            <p className="text-xs text-slate-400 mb-1">Shortfall Amount</p>
                            <p className="text-lg font-bold text-rose-300">{formatCurrency(result.shortfall)}</p>
                        </div>
                    </div>

                    {result.costOfDelay > 0 && (
                        <div className="bg-rose-950/30 p-4 rounded-xl border border-rose-500/20 flex items-start gap-4">
                            <TrendingUp className="text-rose-500 shrink-0 mt-0.5" size={20} />
                            <div>
                                <h4 className="text-sm font-bold text-rose-400 mb-1">Cost of Delaying by 1 Year</h4>
                                <p className="text-xs text-slate-300 leading-relaxed">
                                    If you delay starting this goal by 1 year, your required monthly SIP will jump to <span className="font-bold text-rose-300">{formatCurrency(result.delayRequiredMonthly)}</span>.
                                    That's an extra payload of <span className="font-bold text-rose-400">{formatCurrency(result.costOfDelay)}</span> per month.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
