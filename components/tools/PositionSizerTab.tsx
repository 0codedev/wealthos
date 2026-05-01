import React, { useState, useEffect } from 'react';
import { Target, ShieldAlert, Star, Sliders, RefreshCw } from 'lucide-react';

export const PositionSizerTab: React.FC = () => {
    const [positionType, setPositionType] = useState<'long' | 'short'>('long');
    const [accountSize, setAccountSize] = useState<number>(10000);
    const [riskPercentage, setRiskPercentage] = useState<number>(2);
    const [entryPrice, setEntryPrice] = useState<number>(50);
    const [stopLoss, setStopLoss] = useState<number>(48);
    const [takeProfit, setTakeProfit] = useState<number>(55);
    const [leverage, setLeverage] = useState<number>(1);

    // Results state
    const [riskAmount, setRiskAmount] = useState<number>(0);
    const [stopDistance, setStopDistance] = useState<number>(0);
    const [profitDistance, setProfitDistance] = useState<number>(0);
    const [positionSize, setPositionSize] = useState<number>(0);
    const [riskRewardRatio, setRiskRewardRatio] = useState<number>(0);
    const [rewardAmount, setRewardAmount] = useState<number>(0);
    const [riskLevel, setRiskLevel] = useState<string>('Low');
    const [riskColor, setRiskColor] = useState<string>('text-emerald-400');
    const [riskGaugeWidth, setRiskGaugeWidth] = useState<number>(20);
    const [rrRating, setRrRating] = useState<string>('Excellent');
    const [rrColor, setRrColor] = useState<string>('text-emerald-400');
    const [starCount, setStarCount] = useState<number>(5);

    useEffect(() => {
        calculate();
    }, [positionType, accountSize, riskPercentage, entryPrice, stopLoss, takeProfit, leverage]);

    const calculate = () => {
        // Core calculation matching calculator.js
        const calculatedRiskAmount = (accountSize * (riskPercentage / 100)) * leverage;
        
        let calculatedStopDistance = 0;
        let calculatedProfitDistance = 0;

        if (positionType === 'long') {
            calculatedStopDistance = entryPrice - stopLoss;
            calculatedProfitDistance = takeProfit - entryPrice;
        } else {
            calculatedStopDistance = stopLoss - entryPrice;
            calculatedProfitDistance = entryPrice - takeProfit;
        }

        // Avoid divide-by-zero
        const finalStopDistance = calculatedStopDistance > 0 ? calculatedStopDistance : 0.01;
        const calculatedPositionSize = calculatedRiskAmount / finalStopDistance;
        const calculatedRiskRewardRatio = calculatedStopDistance > 0 ? calculatedProfitDistance / calculatedStopDistance : 0;
        const calculatedRewardAmount = calculatedProfitDistance * calculatedPositionSize;

        setRiskAmount(calculatedRiskAmount);
        setStopDistance(calculatedStopDistance);
        setProfitDistance(calculatedProfitDistance);
        setPositionSize(calculatedPositionSize);
        setRiskRewardRatio(calculatedRiskRewardRatio);
        setRewardAmount(calculatedRewardAmount);

        // Risk Level classification (for gauge)
        let gaugeWidth = 20;
        let level = 'Low';
        let levelColor = 'text-emerald-400';

        if (calculatedRiskRewardRatio >= 3) {
            gaugeWidth = 20;
            level = 'Low';
            levelColor = 'text-emerald-400';
        } else if (calculatedRiskRewardRatio >= 2) {
            gaugeWidth = 40;
            level = 'Moderate';
            levelColor = 'text-blue-400';
        } else if (calculatedRiskRewardRatio >= 1) {
            gaugeWidth = 60;
            level = 'Medium';
            levelColor = 'text-yellow-400';
        } else if (calculatedRiskRewardRatio > 0) {
            gaugeWidth = 80;
            level = 'High';
            levelColor = 'text-orange-400';
        } else {
            gaugeWidth = 95;
            level = 'Extreme';
            levelColor = 'text-red-400';
        }

        setRiskGaugeWidth(gaugeWidth);
        setRiskLevel(level);
        setRiskColor(levelColor);

        // RR rating classification
        let rating = 'Poor';
        let ratingColor = 'text-rose-400';
        let stars = 1;

        if (calculatedRiskRewardRatio >= 3) {
            rating = 'Excellent';
            ratingColor = 'text-emerald-400';
            stars = 5;
        } else if (calculatedRiskRewardRatio >= 2) {
            rating = 'Good';
            ratingColor = 'text-blue-400';
            stars = 4;
        } else if (calculatedRiskRewardRatio >= 1) {
            rating = 'Fair';
            ratingColor = 'text-yellow-400';
            stars = 3;
        } else {
            rating = 'Poor';
            ratingColor = 'text-rose-450';
            stars = 1;
        }

        setRrRating(rating);
        setRrColor(ratingColor);
        setStarCount(stars);
    };

    const handleReset = () => {
        setPositionType('long');
        setAccountSize(10000);
        setRiskPercentage(2);
        setEntryPrice(50);
        setStopLoss(48);
        setTakeProfit(55);
        setLeverage(1);
    };

    return (
        <div className="space-y-6 tab-fade-in pb-12 text-slate-100 max-w-[100vw] overflow-x-hidden">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/40 p-6 rounded-2xl border border-slate-800/80 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
                        <Target size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-white">Precision Position Sizer</h1>
                        <p className="text-xs text-slate-400 mt-0.5">Calculate target shares, contracts, leverage and risk-reward ratio parameters</p>
                    </div>
                </div>
                <button 
                    onClick={handleReset}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700/60 flex items-center gap-1.5 transition-all shrink-0"
                >
                    <RefreshCw size={14} /> Reset Form
                </button>
            </div>

            {/* Main Interactive Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Side: Parameters Form (2/3 width) */}
                <div className="lg:col-span-2 bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 space-y-5">
                    <h2 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider mb-2">Position Parameters</h2>
                    
                    {/* Position Type Selector */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Position Type</label>
                        <div className="flex gap-2.5 mt-2">
                            <button
                                onClick={() => { setPositionType('long'); setStopLoss(entryPrice - 2); setTakeProfit(entryPrice + 5); }}
                                className={`flex-1 py-3 rounded-xl border font-bold text-xs transition-all ${positionType === 'long' ? 'bg-emerald-600/15 border-emerald-500 text-emerald-400' : 'bg-slate-950/20 border-slate-800 text-slate-450 hover:text-slate-350 hover:bg-slate-850/25'}`}
                            >
                                Long Position
                            </button>
                            <button
                                onClick={() => { setPositionType('short'); setStopLoss(entryPrice + 2); setTakeProfit(entryPrice - 5); }}
                                className={`flex-1 py-3 rounded-xl border font-bold text-xs transition-all ${positionType === 'short' ? 'bg-rose-600/15 border-rose-500 text-rose-450' : 'bg-slate-950/20 border-slate-800 text-slate-450 hover:text-slate-350 hover:bg-slate-850/25'}`}
                            >
                                Short Position
                            </button>
                        </div>
                    </div>

                    {/* Numeric Inputs Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="accountSize" className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Account Capital (₹)</label>
                            <input 
                                id="accountSize"
                                type="number" 
                                value={accountSize} 
                                onChange={(e) => setAccountSize(parseFloat(e.target.value) || 0)}
                                className="w-full mt-2 bg-slate-950/30 border border-slate-800 rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="riskPercentage" className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Target Risk (%)</label>
                            <input 
                                id="riskPercentage"
                                type="number" 
                                value={riskPercentage} 
                                onChange={(e) => setRiskPercentage(parseFloat(e.target.value) || 0)}
                                className="w-full mt-2 bg-slate-950/30 border border-slate-800 rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="entryPrice" className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Entry Price (₹)</label>
                            <input 
                                id="entryPrice"
                                type="number" 
                                value={entryPrice} 
                                onChange={(e) => setEntryPrice(parseFloat(e.target.value) || 0)}
                                className="w-full mt-2 bg-slate-950/30 border border-slate-800 rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="stopLoss" className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Stop Loss (₹)</label>
                            <input 
                                id="stopLoss"
                                type="number" 
                                value={stopLoss} 
                                onChange={(e) => setStopLoss(parseFloat(e.target.value) || 0)}
                                className="w-full mt-2 bg-slate-950/30 border border-slate-800 rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label htmlFor="takeProfit" className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Take Profit (Target) (₹)</label>
                            <input 
                                id="takeProfit"
                                type="number" 
                                value={takeProfit} 
                                onChange={(e) => setTakeProfit(parseFloat(e.target.value) || 0)}
                                className="w-full mt-2 bg-slate-950/30 border border-slate-800 rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                    </div>

                    {/* Leverage Slider */}
                    <div>
                        <div className="flex justify-between items-center">
                            <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Margin Leverage</label>
                            <span className="text-xs font-black text-indigo-400 font-mono">{leverage}x</span>
                        </div>
                        <div className="flex items-center gap-4 mt-2 bg-slate-950/20 px-4 py-2.5 rounded-xl border border-slate-800/80">
                            <button 
                                onClick={() => setLeverage(prev => Math.max(1, prev - 1))}
                                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center transition-all select-none"
                            >
                                -
                            </button>
                            <input 
                                type="range" 
                                min="1" 
                                max="10" 
                                value={leverage}
                                onChange={(e) => setLeverage(parseInt(e.target.value))}
                                className="flex-1 accent-indigo-500 h-1 rounded-full cursor-pointer bg-slate-800"
                            />
                            <button 
                                onClick={() => setLeverage(prev => Math.min(10, prev + 1))}
                                className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center transition-all select-none"
                            >
                                +
                            </button>
                        </div>
                    </div>
                </div>

                {/* Right Side: Risk Analysis & Result Cards (1/3 width) */}
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 flex flex-col justify-between space-y-6">
                    <div className="space-y-5">
                        <h2 className="text-sm sm:text-base font-bold text-white uppercase tracking-wider">Risk Analysis</h2>

                        {/* Star Rating Badge */}
                        <div className="p-4 bg-slate-950/30 rounded-2xl border border-slate-850 flex items-center justify-between">
                            <div>
                                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">R:R Evaluation</div>
                                <div className={`text-base font-black uppercase mt-1 ${rrColor}`}>{rrRating} Rating</div>
                            </div>
                            <div className="flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((s) => (
                                    <Star 
                                        key={s} 
                                        size={14} 
                                        className={s <= starCount ? "text-amber-400 fill-amber-400" : "text-slate-700"} 
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Risk Level Gauge */}
                        <div className="p-4 bg-slate-950/30 rounded-2xl border border-slate-850 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Overall Risk Level</span>
                                <span className={`text-xs font-black uppercase ${riskColor}`}>{riskLevel}</span>
                            </div>
                            <div className="w-full bg-slate-850 h-2 rounded-full overflow-hidden">
                                <div 
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{ width: `${riskGaugeWidth}%`, backgroundColor: riskGaugeWidth > 75 ? '#f43f5e' : riskGaugeWidth > 50 ? '#fbbf24' : '#10b981' }}
                                />
                            </div>
                        </div>

                        {/* Detail metrics list */}
                        <div className="space-y-3 pt-2">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400 font-medium">Risk Amount:</span>
                                <span className="font-mono font-bold text-white">₹{riskAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400 font-medium">Reward Potential:</span>
                                <span className="font-mono font-bold text-white">₹{rewardAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400 font-medium">Risk-to-Reward Ratio:</span>
                                <span className="font-mono font-bold text-indigo-400">1 : {riskRewardRatio.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-slate-400 font-medium">Stop-Loss Distance:</span>
                                <span className="font-mono font-bold text-slate-200">₹{stopDistance.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Elite Output Result Box */}
                    <div className="p-5 bg-gradient-to-br from-indigo-900/30 to-purple-900/10 rounded-2xl border border-indigo-500/20 text-center relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/10 blur-xl rounded-full" />
                        <span className="text-[9px] uppercase tracking-wider text-indigo-300 font-black">Target Allocation Size</span>
                        <div className="text-2xl font-mono font-black text-white mt-1">
                            {positionSize > 0 && positionSize !== Infinity ? positionSize.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 0}
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-1 uppercase font-bold tracking-wider">Units / Shares</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PositionSizerTab;
