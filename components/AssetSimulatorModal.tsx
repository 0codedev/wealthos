
import React, { useState, useMemo } from 'react';
import { SafeChartContainer } from './shared/SafeChartContainer';
import { createPortal } from 'react-dom';
import { X, TrendingUp, DollarSign, Calendar, Calculator } from 'lucide-react';
import { Investment } from '../types';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { formatCurrency } from '../utils/helpers';
import { CustomTooltip } from './shared/CustomTooltip';

interface AssetSimulatorModalProps {
    investment: Investment;
    onClose: () => void;
}

const AssetSimulatorModal: React.FC<AssetSimulatorModalProps> = ({ investment, onClose }) => {
    const [rate, setRate] = useState(12); // Default 12% annual return
    const [years, setYears] = useState(10); // Default 10 years

    const simulationData = useMemo(() => {
        const monthlyRate = rate / 100 / 12;
        const months = years * 12;
        const data = [];

        let currentBalance = investment.currentValue;
        let totalInvested = investment.investedAmount;
        const monthlyContribution = investment.recurring?.isEnabled ? investment.recurring.amount : 0;
        // Adjust contribution to monthly if frequency is daily
        const effectiveMonthlyContribution = investment.recurring?.isEnabled && investment.recurring.frequency === 'Daily'
            ? monthlyContribution * 30
            : monthlyContribution;

        for (let i = 0; i <= months; i++) {
            if (i % 12 === 0) { // Push data points yearly for graph cleanliness
                data.push({
                    year: `Year ${i / 12}`,
                    balance: Math.round(currentBalance),
                    invested: Math.round(totalInvested)
                });
            }

            // Compound
            currentBalance = currentBalance * (1 + monthlyRate) + effectiveMonthlyContribution;
            totalInvested += effectiveMonthlyContribution;
        }

        return data;
    }, [investment, rate, years]);

    const finalValue = simulationData[simulationData.length - 1].balance;
    const totalInvestedFinal = simulationData[simulationData.length - 1].invested;
    const gains = finalValue - totalInvestedFinal;

    const modalContent = (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
                            <Calculator size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                {investment.name}
                            </h2>
                            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Compound Simulator</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close asset simulator" className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <X size={20} className="text-slate-500" />
                    </button>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Controls */}
                    <div className="md:col-span-1 space-y-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Expected Return (%)</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range" min="1" max="30" value={rate} onChange={(e) => setRate(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 w-8">{rate}%</span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Time Period (Years)</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range" min="1" max="40" value={years} onChange={(e) => setYears(parseInt(e.target.value))}
                                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 w-8">{years}</span>
                            </div>
                        </div>

                        <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Current Value</span>
                                <span className="font-mono font-bold dark:text-white">{formatCurrency(investment.currentValue)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Monthly SIP</span>
                                <span className="font-mono font-bold text-emerald-500">
                                    +₹{investment.recurring?.isEnabled ? investment.recurring.amount : 0}
                                </span>
                            </div>
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                                <p className="text-xs text-slate-400 uppercase font-bold mb-1">Projected Value</p>
                                <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                                    ₹{(finalValue / 100000).toFixed(2)}L
                                </p>
                                <p className="text-xs text-emerald-500 font-bold mt-1">
                                    Gain: ₹{(gains / 100000).toFixed(2)}L
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Chart */}
                    <div className="md:col-span-2 h-80 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 shadow-inner">
                        <SafeChartContainer>
                            <AreaChart data={simulationData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorInvested" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                                <XAxis dataKey="year" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                                <YAxis tickFormatter={(val) => `₹${(val / 100000).toFixed(1)}L`} tick={{ fontSize: 10 }} stroke="#94a3b8" />
                                <Tooltip
                                    content={<CustomTooltip />}
                                    cursor={{ strokeDasharray: '3 3' }}
                                />
                                <Area type="monotone" dataKey="invested" stackId="1" stroke="#94a3b8" fill="url(#colorInvested)" name="Invested" />
                                <Area type="monotone" dataKey="balance" stackId="2" stroke="#6366f1" fill="url(#colorBalance)" name="Total Value" />
                            </AreaChart>
                        </SafeChartContainer>
                    </div>
                </div>
            </div>
        </div>
    );

    return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};

export default AssetSimulatorModal;
