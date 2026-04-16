import React, { useState, useMemo } from 'react';
import { Calculator, TrendingUp, TrendingDown, Target, AlertTriangle, DollarSign, Percent, RefreshCw, Zap } from 'lucide-react';
import { formatCurrency } from '../../utils/helpers';

interface WhatIfScenarioBuilderProps {
    portfolioValue?: number;
}

interface TradeScenario {
    ticker: string;
    action: 'BUY' | 'SELL';
    quantity: number;
    entryPrice: number;
    targetPrice: number;
    stopLoss: number;
    positionSize: number;
}

export const WhatIfScenarioBuilder: React.FC<WhatIfScenarioBuilderProps> = ({ portfolioValue = 1000000 }) => {
    const [scenario, setScenario] = useState<TradeScenario>({
        ticker: '',
        action: 'BUY',
        quantity: 100,
        entryPrice: 0,
        targetPrice: 0,
        stopLoss: 0,
        positionSize: 50000,
    });

    const [riskPercent, setRiskPercent] = useState(2); // 2% of portfolio

    // Calculate trade metrics
    const analysis = useMemo(() => {
        const { quantity, entryPrice, targetPrice, stopLoss, action, positionSize } = scenario;

        if (!entryPrice || entryPrice <= 0) {
            return null;
        }

        const calculatedQuantity = positionSize > 0 ? Math.floor(positionSize / entryPrice) : quantity;
        const investmentAmount = calculatedQuantity * entryPrice;

        // P&L calculations
        const potentialProfit = action === 'BUY'
            ? (targetPrice - entryPrice) * calculatedQuantity
            : (entryPrice - targetPrice) * calculatedQuantity;

        const potentialLoss = action === 'BUY'
            ? (entryPrice - stopLoss) * calculatedQuantity
            : (stopLoss - entryPrice) * calculatedQuantity;

        // Risk/Reward ratio
        const riskRewardRatio = potentialLoss > 0 ? potentialProfit / potentialLoss : 0;

        // Percentages
        const targetPercent = entryPrice > 0 ? ((targetPrice - entryPrice) / entryPrice) * 100 : 0;
        const stopPercent = entryPrice > 0 ? ((entryPrice - stopLoss) / entryPrice) * 100 : 0;

        // Portfolio impact
        const portfolioRiskPercent = (potentialLoss / portfolioValue) * 100;
        const portfolioRewardPercent = (potentialProfit / portfolioValue) * 100;

        // Max risk based on 2% rule
        const maxRiskAmount = (portfolioValue * riskPercent) / 100;
        const optimalQuantity = stopLoss > 0 && stopLoss !== entryPrice
            ? Math.floor(maxRiskAmount / Math.abs(entryPrice - stopLoss))
            : 0;

        // Break-even with fees (0.1% assumed)
        const fees = investmentAmount * 0.001;
        const breakEvenPrice = action === 'BUY'
            ? entryPrice * (1 + 0.001)
            : entryPrice * (1 - 0.001);

        return {
            calculatedQuantity,
            investmentAmount,
            potentialProfit,
            potentialLoss,
            riskRewardRatio,
            targetPercent,
            stopPercent,
            portfolioRiskPercent,
            portfolioRewardPercent,
            maxRiskAmount,
            optimalQuantity,
            fees,
            breakEvenPrice,
            isRiskExceeded: potentialLoss > maxRiskAmount,
            isGoodRR: riskRewardRatio >= 2,
        };
    }, [scenario, portfolioValue, riskPercent]);

    const resetScenario = () => {
        setScenario({
            ticker: '',
            action: 'BUY',
            quantity: 100,
            entryPrice: 0,
            targetPrice: 0,
            stopLoss: 0,
            positionSize: 50000,
        });
    };

    return (
        <div className="bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900 dark:to-indigo-950/30 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/20 rounded-xl">
                        <Calculator className="text-indigo-600 dark:text-indigo-400" size={22} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">What-If Scenario Builder</h3>
                        <p className="text-xs text-slate-500">Simulate trades before execution</p>
                    </div>
                </div>
                <button
                    onClick={resetScenario}
                    className="p-2 text-slate-400 hover:text-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    title="Reset"
                >
                    <RefreshCw size={16} />
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Input Panel */}
                <div className="space-y-4">
                    {/* Ticker & Action */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ticker</label>
                            <input
                                type="text"
                                value={scenario.ticker}
                                onChange={(e) => setScenario({ ...scenario, ticker: e.target.value.toUpperCase() })}
                                placeholder="RELIANCE"
                                className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500/50"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Action</label>
                            <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                                {(['BUY', 'SELL'] as const).map(action => (
                                    <button
                                        key={action}
                                        onClick={() => setScenario({ ...scenario, action })}
                                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${scenario.action === action
                                                ? action === 'BUY'
                                                    ? 'bg-emerald-500 text-white'
                                                    : 'bg-rose-500 text-white'
                                                : 'text-slate-500 hover:text-slate-700'
                                            }`}
                                    >
                                        {action}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Price Inputs */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Entry ₹</label>
                            <input
                                type="number"
                                value={scenario.entryPrice || ''}
                                onChange={(e) => setScenario({ ...scenario, entryPrice: parseFloat(e.target.value) || 0 })}
                                placeholder="2500"
                                className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500/50"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-emerald-500 uppercase mb-1">Target ₹</label>
                            <input
                                type="number"
                                value={scenario.targetPrice || ''}
                                onChange={(e) => setScenario({ ...scenario, targetPrice: parseFloat(e.target.value) || 0 })}
                                placeholder="2650"
                                className="w-full px-3 py-2.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-sm font-mono focus:ring-2 focus:ring-emerald-500/50"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-rose-500 uppercase mb-1">Stop Loss ₹</label>
                            <input
                                type="number"
                                value={scenario.stopLoss || ''}
                                onChange={(e) => setScenario({ ...scenario, stopLoss: parseFloat(e.target.value) || 0 })}
                                placeholder="2420"
                                className="w-full px-3 py-2.5 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl text-sm font-mono focus:ring-2 focus:ring-rose-500/50"
                            />
                        </div>
                    </div>

                    {/* Position Size */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Position Size ₹</label>
                        <input
                            type="number"
                            value={scenario.positionSize || ''}
                            onChange={(e) => setScenario({ ...scenario, positionSize: parseFloat(e.target.value) || 0 })}
                            placeholder="50000"
                            className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500/50"
                        />
                    </div>

                    {/* Risk Tolerance */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Max Risk Per Trade</label>
                            <span className="text-xs font-bold text-indigo-600">{riskPercent}% of portfolio</span>
                        </div>
                        <input
                            type="range"
                            min="0.5"
                            max="5"
                            step="0.5"
                            value={riskPercent}
                            onChange={(e) => setRiskPercent(parseFloat(e.target.value))}
                            className="w-full accent-indigo-600"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400">
                            <span>0.5%</span>
                            <span>5%</span>
                        </div>
                    </div>
                </div>

                {/* Analysis Panel */}
                <div className="space-y-3">
                    {analysis ? (
                        <>
                            {/* R:R Ratio */}
                            <div className={`p-4 rounded-xl border ${analysis.isGoodRR
                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                                }`}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-500 uppercase">Risk : Reward</p>
                                        <p className={`text-3xl font-black ${analysis.isGoodRR ? 'text-emerald-600' : 'text-amber-600'}`}>
                                            1 : {analysis.riskRewardRatio.toFixed(2)}
                                        </p>
                                    </div>
                                    <div className={`p-3 rounded-xl ${analysis.isGoodRR ? 'bg-emerald-500/20' : 'bg-amber-500/20'}`}>
                                        {analysis.isGoodRR ? <TrendingUp size={28} className="text-emerald-500" /> : <AlertTriangle size={28} className="text-amber-500" />}
                                    </div>
                                </div>
                                <p className={`text-xs mt-2 ${analysis.isGoodRR ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {analysis.isGoodRR ? '✓ Good setup (R:R ≥ 2:1)' : '⚠️ Consider improving entry or stop'}
                                </p>
                            </div>

                            {/* P&L Breakdown */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
                                    <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Potential Profit</p>
                                    <p className="text-lg font-black text-emerald-600">{formatCurrency(analysis.potentialProfit)}</p>
                                    <p className="text-[10px] text-slate-500">+{analysis.targetPercent.toFixed(2)}%</p>
                                </div>
                                <div className="p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-200 dark:border-rose-800">
                                    <p className="text-[10px] font-bold text-rose-600 uppercase mb-1">Max Loss</p>
                                    <p className="text-lg font-black text-rose-600">-{formatCurrency(analysis.potentialLoss)}</p>
                                    <p className="text-[10px] text-slate-500">-{analysis.stopPercent.toFixed(2)}%</p>
                                </div>
                            </div>

                            {/* Trade Details */}
                            <div className="p-3 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Quantity</span>
                                    <span className="font-bold text-slate-800 dark:text-white">{analysis.calculatedQuantity} shares</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Investment</span>
                                    <span className="font-bold text-slate-800 dark:text-white">{formatCurrency(analysis.investmentAmount)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Break-even</span>
                                    <span className="font-bold text-slate-800 dark:text-white">₹{analysis.breakEvenPrice.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-500">Est. Fees</span>
                                    <span className="font-bold text-slate-800 dark:text-white">~{formatCurrency(analysis.fees)}</span>
                                </div>
                            </div>

                            {/* Risk Warning */}
                            {analysis.isRiskExceeded && (
                                <div className="p-3 bg-rose-100 dark:bg-rose-900/30 border border-rose-300 dark:border-rose-800 rounded-xl flex items-start gap-2">
                                    <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-xs font-bold text-rose-700 dark:text-rose-400">Risk Exceeds Limit!</p>
                                        <p className="text-[10px] text-rose-600">
                                            Max risk at {riskPercent}% = {formatCurrency(analysis.maxRiskAmount)}.
                                            Optimal qty: {analysis.optimalQuantity} shares.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                            <Calculator size={48} className="text-slate-300 dark:text-slate-700 mb-4" />
                            <p className="text-sm text-slate-500 font-bold">Enter trade details</p>
                            <p className="text-xs text-slate-400">Analysis will appear here</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WhatIfScenarioBuilder;
