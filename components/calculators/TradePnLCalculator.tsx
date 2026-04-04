import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { Activity, Target, ShieldAlert } from 'lucide-react';

export const TradePnLCalculator: React.FC = () => {
    const [tradeType, setTradeType] = useState<'LONG' | 'SHORT'>('LONG');
    const [entryPrice, setEntryPrice] = useState(100);
    const [exitPrice, setExitPrice] = useState(110);
    const [quantity, setQuantity] = useState(100);
    const [stopLoss, setStopLoss] = useState(90);

    const result = useMemo(() => {
        let pnl = 0;
        let riskAmount = 0;
        let pnlPercentage = 0;
        let rrRatio = 0;

        const investment = entryPrice * quantity;

        if (tradeType === 'LONG') {
            pnl = (exitPrice - entryPrice) * quantity;
            riskAmount = (entryPrice - stopLoss) * quantity;
        } else {
            pnl = (entryPrice - exitPrice) * quantity;
            riskAmount = (stopLoss - entryPrice) * quantity;
        }

        if (investment > 0) {
            pnlPercentage = (pnl / investment) * 100;
        }

        if (riskAmount > 0) {
            rrRatio = Math.abs(pnl) / riskAmount;
        } else if (riskAmount < 0) {
            rrRatio = 0; // stop loss is on wrong side for some reason
        }

        return {
            pnl,
            pnlPercentage,
            investment,
            riskAmount,
            rrRatio
        };
    }, [tradeType, entryPrice, exitPrice, quantity, stopLoss]);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 relative overflow-hidden">
            <h3 className="text-xl font-bold text-white mb-6">Trade P&L / Risk-Reward Engine</h3>

            <div className="flex bg-slate-800 p-1 rounded-lg w-fit mb-6">
                <button
                    onClick={() => setTradeType('LONG')}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${tradeType === 'LONG' ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Long
                </button>
                <button
                    onClick={() => setTradeType('SHORT')}
                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${tradeType === 'SHORT' ? 'bg-rose-500 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    Short
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                {/* Inputs */}
                <div className="md:col-span-5 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Entry Price</label>
                            <input
                                type="number"
                                value={entryPrice}
                                onChange={(e) => setEntryPrice(Number(e.target.value))}
                                className="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Quantity</label>
                            <input
                                type="number"
                                value={quantity}
                                onChange={(e) => setQuantity(Number(e.target.value))}
                                className="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Target/Exit Price</label>
                            <input
                                type="number"
                                value={exitPrice}
                                onChange={(e) => setExitPrice(Number(e.target.value))}
                                className={`w-full bg-slate-800 border-none rounded-lg px-3 py-2 font-mono outline-none focus:ring-2 ${tradeType === 'LONG' ? (exitPrice > entryPrice ? 'text-emerald-400 focus:ring-emerald-500' : 'text-rose-400 focus:ring-rose-500') : (exitPrice < entryPrice ? 'text-emerald-400 focus:ring-emerald-500' : 'text-rose-400 focus:ring-rose-500')} `}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Stop Loss</label>
                            <input
                                type="number"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(Number(e.target.value))}
                                className="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-rose-400 font-mono focus:ring-2 focus:ring-rose-500 outline-none"
                            />
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800 flex justify-between items-center text-sm">
                        <span className="text-slate-400">Total Investment Value</span>
                        <span className="font-mono text-white tracking-widest">{formatCurrency(result.investment)}</span>
                    </div>
                </div>

                {/* Outputs */}
                <div className="md:col-span-7 bg-slate-950 rounded-2xl p-4 sm:p-5 md:p-6 border border-slate-800 flex flex-col justify-center">

                    <div className="grid grid-cols-2 gap-6 mb-6">
                        <div>
                            <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-2 flex items-center gap-2"><Activity size={14} /> Projected P&L</p>
                            <p className={`text-4xl font-black ${result.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {result.pnl >= 0 ? '+' : ''}{formatCurrency(result.pnl)}
                            </p>
                            <p className={`text-sm font-bold mt-1 ${result.pnl >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                                {result.pnlPercentage >= 0 ? '+' : ''}{result.pnlPercentage.toFixed(2)}%
                            </p>
                        </div>

                        <div className="flex flex-col items-end">
                            <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-2 flex items-center gap-2"><ShieldAlert size={14} /> Risk Amount</p>
                            <p className="text-2xl font-black text-rose-500">
                                {formatCurrency(Math.max(0, result.riskAmount))}
                            </p>
                            {result.riskAmount < 0 && (
                                <p className="text-xs text-rose-400 mt-1">Warning: Invalid Stop Loss</p>
                            )}
                        </div>
                    </div>

                    <div className="h-px bg-slate-800 w-full my-4"></div>

                    <div className="flex justify-between items-center">
                        <p className="text-xs uppercase font-bold tracking-widest text-slate-400 flex items-center gap-2">
                            <Target size={14} className="text-indigo-500" /> Risk/Reward Ratio
                        </p>
                        <div className="text-right">
                            {result.riskAmount > 0 ? (
                                <p className="text-xl font-bold font-mono">
                                    <span className="text-slate-500">1 : </span>
                                    <span className={result.rrRatio >= 2 ? 'text-emerald-400' : result.rrRatio >= 1 ? 'text-amber-400' : 'text-rose-400'}>
                                        {result.rrRatio.toFixed(2)}
                                    </span>
                                </p>
                            ) : (
                                <span className="text-slate-500 text-sm">N/A</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
