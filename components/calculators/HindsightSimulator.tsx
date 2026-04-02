import React, { useState, useMemo } from 'react';
import { formatCurrency } from '../../utils/helpers';
import { EditableValue } from '../shared/EditableValue';
import { History, Search, TrendingUp, Sparkles } from 'lucide-react';

// Mock historical assets
const HISTORICAL_ASSETS: any[] = [
    // Awaiting live historical indices sync
];

export const HindsightSimulator: React.FC = () => {
    const [selectedAssetId, setSelectedAssetId] = useState('btc');
    const [pastInvestment, setPastInvestment] = useState(100000); // 1L default
    const [yearsAgo, setYearsAgo] = useState(5);

    const activeAsset = useMemo(() => HISTORICAL_ASSETS.find(a => a.id === selectedAssetId) || null, [selectedAssetId]);

    const result = useMemo(() => {
        // Awaiting live data, return 0
        if (!activeAsset) {
            return { fv: pastInvestment, profit: 0, roi: 0 };
        }
        
        const fv = pastInvestment * Math.pow(1 + activeAsset.cagr / 100, yearsAgo);
        const profit = fv - pastInvestment;
        const roi = (profit / pastInvestment) * 100;

        return {
            fv,
            profit,
            roi
        };
    }, [activeAsset, pastInvestment, yearsAgo]);

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 md:p-6 relative overflow-hidden">
            {/* Background elements */}
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex items-center justify-between mb-8 relative z-10">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <History className="text-fuchsia-500" size={24} /> The Hindsight Simulator
                </h3>
                <span className="text-xs font-bold uppercase tracking-widest text-fuchsia-400 bg-fuchsia-500/10 px-3 py-1 rounded-full flex items-center gap-1 border border-fuchsia-500/20">
                    <Sparkles size={12} /> FOMO Engine
                </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 relative z-10">
                {/* Inputs */}
                <div className="md:col-span-5 space-y-6">
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-2 block">Choose an Asset</label>
                        <div className="grid grid-cols-2 gap-2">
                            {HISTORICAL_ASSETS.map(asset => (
                                <button
                                    key={asset.id}
                                    onClick={() => setSelectedAssetId(asset.id)}
                                    className={`px-3 py-2 rounded-lg text-sm font-semibold transition-all border text-left flex flex-col ${selectedAssetId === asset.id ? 'bg-fuchsia-600/20 border-fuchsia-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-500'}`}
                                >
                                    <span className="truncate">{asset.name}</span>
                                    <span className="text-[10px] opacity-70 uppercase tracking-widest">{asset.ticker}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-800">
                        <label className="text-xs font-medium text-slate-400 mb-1 block">If I had invested...</label>
                        <input
                            type="number"
                            step="10000"
                            value={pastInvestment}
                            onChange={(e) => setPastInvestment(Number(e.target.value))}
                            className="w-full bg-slate-800 border-none rounded-lg px-4 py-3 text-fuchsia-100 font-mono focus:ring-2 focus:ring-fuchsia-500 outline-none text-xl"
                        />
                    </div>

                    <div>
                        <div className="flex justify-between mb-2">
                            <label className="text-sm font-medium text-slate-300">Exactly...</label>
                            <EditableValue
                                value={yearsAgo}
                                onChange={setYearsAgo}
                                suffix={yearsAgo === 1 ? ' Year Ago' : ' Years Ago'}
                                className="text-sm font-bold text-slate-300"
                                min={1}
                                max={15}
                                step={1}
                            />
                        </div>
                        <input
                            type="range" min="1" max="15" step="1"
                            value={yearsAgo}
                            onChange={(e) => setYearsAgo(Number(e.target.value))}
                            className="w-full accent-slate-400 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                </div>

                {/* Outputs */}
                <div className="md:col-span-7 flex flex-col justify-center">
                    <div className="text-center mb-6">
                        <p className="text-slate-400 text-lg mb-2">Today, your investment would be worth</p>
                        <div className="inline-block relative">
                            <p className="text-6xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 to-indigo-400 drop-shadow-xl">
                                {formatCurrency(result.fv)}
                            </p>
                            <div className="absolute -inset-x-8 -inset-y-4 bg-gradient-to-r from-fuchsia-500/0 via-fuchsia-500/10 to-indigo-500/0 blur-xl -z-10 rounded-[100%] pointer-events-none"></div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800 text-center flex flex-col justify-center items-center group hover:border-emerald-500/30 transition-colors">
                            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Missed Profits</p>
                            <p className="text-2xl font-black text-emerald-400 group-hover:scale-110 transition-transform">{formatCurrency(result.profit)}</p>
                        </div>
                        <div className="bg-slate-950/50 rounded-2xl p-4 border border-slate-800 text-center flex flex-col justify-center items-center group hover:border-amber-500/30 transition-colors">
                            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Total ROI</p>
                            <p className="text-2xl font-black text-amber-400 group-hover:scale-110 transition-transform">{result.roi.toLocaleString(undefined, { maximumFractionDigits: 0 })}%</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
