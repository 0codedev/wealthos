import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { Crosshair, IndianRupee, Percent, TrendingUp } from 'lucide-react';

export const PositionSizingCalculator: React.FC = () => {
    const [accountSize, setAccountSize] = useState(100000);
    const [riskPercent, setRiskPercent] = useState(1);

    const [entryPrice, setEntryPrice] = useState(1000);
    const [stopLoss, setStopLoss] = useState(950);
    const [leverage, setLeverage] = useState(1); // 1x means no leverage
    const [tradeDir, setTradeDir] = useState<'LONG' | 'SHORT'>('LONG');
    const [targets, setTargets] = useState([
        { r: 1, pct: 25 },
        { r: 2, pct: 50 },
        { r: 3, pct: 25 },
    ]);

    const result = useMemo(() => {
        if (entryPrice <= 0 || stopLoss <= 0 || accountSize <= 0) {
            return {
                riskAmount: 0,
                riskPerShare: 0,
                maxQuantity: 0,
                requiredMargin: 0,
                actualLeverage: 0
            };
        }

        const riskAmount = (accountSize * riskPercent) / 100;
        const riskPerShare = Math.abs(entryPrice - stopLoss);

        let maxQuantity = 0;
        if (riskPerShare > 0) {
            maxQuantity = Math.floor(riskAmount / riskPerShare);
        }

        const positionSizeValue = maxQuantity * entryPrice;
        const requiredMargin = positionSizeValue / leverage;
        const actualLeverage = positionSizeValue / accountSize;

        return {
            riskAmount,
            riskPerShare,
            maxQuantity,
            positionSizeValue,
            requiredMargin,
            actualLeverage
        };
    }, [accountSize, riskPercent, entryPrice, stopLoss, leverage]);

    const bookingPlan = useMemo(() => {
        const riskPerShare = Math.abs(entryPrice - stopLoss);
        if (riskPerShare <= 0 || result.maxQuantity <= 0) {
            return { rows: targets.map(t => ({ ...t, targetPrice: 0, sharesToBook: 0, profitAtTarget: 0, cumPct: 0 })), totalProfit: 0 };
        }
        let cumPct = 0;
        let totalProfit = 0;
        const rows = targets.map(t => {
            const targetPrice = tradeDir === 'LONG'
                ? entryPrice + (t.r * riskPerShare)
                : entryPrice - (t.r * riskPerShare);
            const sharesToBook = Math.floor(result.maxQuantity * t.pct / 100);
            const profitAtTarget = sharesToBook * Math.abs(targetPrice - entryPrice);
            cumPct += t.pct;
            totalProfit += profitAtTarget;
            return { ...t, targetPrice, sharesToBook, profitAtTarget, cumPct };
        });
        return { rows, totalProfit };
    }, [result, entryPrice, stopLoss, targets, tradeDir]);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                <Crosshair size={150} />
            </div>

            <h3 className="text-xl font-bold text-white mb-6 relative z-10">Position Sizing & Risk Management</h3>

            {/* Trade Direction Toggle */}
            <div className="flex items-center gap-2 mb-6 relative z-10">
                <button
                    onClick={() => setTradeDir('LONG')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        tradeDir === 'LONG'
                            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                >
                    LONG
                </button>
                <button
                    onClick={() => setTradeDir('SHORT')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        tradeDir === 'SHORT'
                            ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25'
                            : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                >
                    SHORT
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Account Size</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                    <IndianRupee size={14} />
                                </div>
                                <input
                                    type="number"
                                    value={accountSize}
                                    onChange={(e) => setAccountSize(Number(e.target.value))}
                                    className="w-full bg-slate-800 border-none rounded-lg pl-8 pr-3 py-2 text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Risk per Trade (%)</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                    <Percent size={14} />
                                </div>
                                <input
                                    type="number" step="0.1" max="10" min="0.1"
                                    value={riskPercent}
                                    onChange={(e) => setRiskPercent(Number(e.target.value))}
                                    className="w-full bg-slate-800 border-none rounded-lg pl-8 pr-3 py-2 text-white font-mono focus:ring-2 focus:ring-rose-500 outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="h-px w-full bg-slate-800 my-4 border-dashed border-t border-slate-700"></div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Entry Price</label>
                            <input
                                type="number"
                                value={entryPrice}
                                onChange={(e) => setEntryPrice(Number(e.target.value))}
                                className="w-full bg-slate-800 border-none rounded-lg px-4 py-2 text-indigo-100 font-mono focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Stop Loss</label>
                            <input
                                type="number"
                                value={stopLoss}
                                onChange={(e) => setStopLoss(Number(e.target.value))}
                                className="w-full bg-slate-800 border-none rounded-lg px-4 py-2 text-rose-100 font-mono focus:ring-2 focus:ring-rose-500 outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between flex-wrap gap-2 mb-2">
                            <label className="text-xs font-medium text-slate-400">Leverage / Margin (x)</label>
                            <span className="text-xs font-semibold text-slate-300">{leverage}x</span>
                        </div>
                        <input
                            type="range" min="1" max="20" step="1"
                            value={leverage}
                            onChange={(e) => setLeverage(Number(e.target.value))}
                            className="w-full accent-slate-400 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </div>

                {/* Outputs */}
                <div className="bg-slate-800/60 p-6 rounded-2xl border border-indigo-500/20 flex flex-col justify-between">
                    <div className="mb-6">
                        <p className="text-xs text-slate-400 mb-1 uppercase tracking-wider font-bold">Max Allowed Quantity</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-5xl font-black text-white">{result.maxQuantity.toLocaleString()}</span>
                            <span className="text-slate-500 font-medium tracking-wide">shares/units</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-rose-500/10 rounded-xl p-3 border border-rose-500/20">
                            <p className="text-[10px] uppercase font-bold tracking-widest text-rose-400 mb-1">Max Risk Amount</p>
                            <p className="text-lg font-bold text-rose-300">{formatCurrency(result.riskAmount)}</p>
                        </div>
                        <div className="bg-slate-900/50 rounded-xl p-3 border border-slate-700">
                            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400 mb-1">Risk Per Share</p>
                            <p className="text-lg font-bold text-white">{formatCurrency(result.riskPerShare)}</p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-400">Total Position Value:</span>
                            <span className="font-mono text-white">{formatCurrency(result.positionSizeValue || 0)}</span>
                        </div>
                        <div className={`flex justify-between items-center text-sm ${result.requiredMargin > accountSize ? 'text-rose-400' : 'text-emerald-400'}`}>
                            <span className="font-bold">Required Margin:</span>
                            <span className="font-mono font-bold">{formatCurrency(result.requiredMargin || 0)}</span>
                        </div>
                        {result.requiredMargin > accountSize && (
                            <p className="text-[10px] text-rose-400 mt-1">⚠️ Margin exceeds account size. Increase leverage or deposit funds.</p>
                        )}
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-400">True Leverage:</span>
                            <span className="font-mono font-bold text-amber-400">{result.actualLeverage.toFixed(2)}x</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Partial Booking Plan */}
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-6 mb-3 relative z-10">
                Partial Booking Plan
            </p>
            <div className="bg-slate-800/30 rounded-xl border border-slate-700 overflow-hidden relative z-10">
                <div className="grid grid-cols-5 gap-2 px-3 py-2 bg-slate-800/60 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <span>R-Target</span>
                    <span>Target Price</span>
                    <span>Shares to Book</span>
                    <span>Profit at Target</span>
                    <span>Cumulative %</span>
                </div>
                {bookingPlan.rows.map((row, i) => (
                    <div key={i} className="grid grid-cols-5 gap-2 px-3 py-2.5 text-xs border-t border-slate-700/50">
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                max="10"
                                value={row.r}
                                onChange={(e) => {
                                    const updated = [...targets];
                                    updated[i] = { ...updated[i], r: Number(e.target.value) };
                                    setTargets(updated);
                                }}
                                className="w-12 bg-transparent border-b border-amber-500/30 text-amber-400 font-bold text-xs text-center outline-none focus:border-amber-500"
                            />
                            <span className="text-amber-400 font-bold">R</span>
                        </div>
                        <span className="text-white font-mono">{formatCurrency(row.targetPrice)}</span>
                        <span className="text-indigo-300 font-mono">{row.sharesToBook.toLocaleString()}</span>
                        <span className="text-emerald-400 font-mono">{formatCurrency(row.profitAtTarget)}</span>
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                step="5"
                                min="1"
                                max="100"
                                value={row.pct}
                                onChange={(e) => {
                                    const updated = [...targets];
                                    updated[i] = { ...updated[i], pct: Number(e.target.value) };
                                    setTargets(updated);
                                }}
                                className="w-10 bg-transparent border-b border-slate-700 text-slate-300 font-mono text-xs text-center outline-none focus:border-slate-500"
                            />
                            <span className="text-slate-400">%</span>
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-3 relative z-10">
                <p className="text-emerald-400 font-black text-sm">
                    If all targets hit: {formatCurrency(bookingPlan.totalProfit)}
                </p>
            </div>
        </div>
    );
};
