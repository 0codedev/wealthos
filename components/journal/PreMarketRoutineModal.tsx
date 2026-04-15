import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sun, TrendingUp, TrendingDown, Minus, Shield, Zap, Target, AlertTriangle, CheckSquare, SaveAll } from 'lucide-react';
import { db } from '../../database';

interface PreMarketRoutineModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type MarketBias = 'Bullish' | 'Bearish' | 'Neutral' | 'Mixed';
type ReadinessLevel = 1 | 2 | 3 | 4 | 5;

interface PreMarketData {
    date: string;
    bias: MarketBias;
    biasConfidence: number; // 0-100
    readiness: ReadinessLevel;
    keyLevels: { label: string; price: string }[];
    watchlist: string[];
    notes: string;
    checklist: { label: string; checked: boolean }[];
    globalSentiment: 'Risk On' | 'Risk Off' | 'Cautious';
}

const DEFAULT_CHECKLIST = [
    { label: 'Reviewed overnight price action', checked: false },
    { label: 'Checked economic calendar', checked: false },
    { label: 'Identified key levels on charts', checked: false },
    { label: 'Set alerts on watchlist', checked: false },
    { label: 'Reviewed open positions', checked: false },
    { label: 'Mental state assessment done', checked: false },
    { label: 'Risk parameters locked in', checked: false },
];

const BIAS_OPTIONS: { label: MarketBias; icon: any; color: string; bg: string }[] = [
    { label: 'Bullish', icon: TrendingUp, color: 'border-emerald-500 text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Bearish', icon: TrendingDown, color: 'border-rose-500 text-rose-400', bg: 'bg-rose-500/10' },
    { label: 'Neutral', icon: Minus, color: 'border-slate-500 text-slate-400', bg: 'bg-slate-500/10' },
    { label: 'Mixed', icon: AlertTriangle, color: 'border-amber-500 text-amber-400', bg: 'bg-amber-500/10' },
];

export const PreMarketRoutineModal: React.FC<PreMarketRoutineModalProps> = ({ isOpen, onClose }) => {
    const [data, setData] = useState<PreMarketData>({
        date: new Date().toISOString().split('T')[0],
        bias: 'Neutral',
        biasConfidence: 50,
        readiness: 3,
        keyLevels: [{ label: 'Support', price: '' }, { label: 'Resistance', price: '' }, { label: 'VWAP', price: '' }],
        watchlist: [],
        notes: '',
        checklist: [...DEFAULT_CHECKLIST],
        globalSentiment: 'Cautious',
    });

    const [watchlistInput, setWatchlistInput] = useState('');

    const checkedCount = data.checklist.filter(c => c.checked).length;
    const readinessPercent = (checkedCount / data.checklist.length) * 100;

    const addWatchlistItem = () => {
        if (!watchlistInput.trim()) return;
        setData(prev => ({ ...prev, watchlist: [...prev.watchlist, watchlistInput.trim().toUpperCase()] }));
        setWatchlistInput('');
    };

    const removeWatchlistItem = (idx: number) => {
        setData(prev => ({ ...prev, watchlist: prev.watchlist.filter((_, i) => i !== idx) }));
    };

    const toggleChecklist = (idx: number) => {
        setData(prev => ({
            ...prev,
            checklist: prev.checklist.map((item, i) => i === idx ? { ...item, checked: !item.checked } : item)
        }));
    };

    const updateKeyLevel = (idx: number, field: 'label' | 'price', value: string) => {
        setData(prev => ({
            ...prev,
            keyLevels: prev.keyLevels.map((kl, i) => i === idx ? { ...kl, [field]: value } : kl)
        }));
    };

    const addKeyLevel = () => {
        setData(prev => ({ ...prev, keyLevels: [...prev.keyLevels, { label: '', price: '' }] }));
    };

    const handleSave = () => {
        // Store in localStorage for now (could be extended to Dexie)
        const key = `premarket_${data.date}`;
        localStorage.setItem(key, JSON.stringify(data));
        onClose();
    };

    // Load existing data for today
    useEffect(() => {
        if (isOpen) {
            const today = new Date().toISOString().split('T')[0];
            const saved = localStorage.getItem(`premarket_${today}`);
            if (saved) {
                try {
                    setData(JSON.parse(saved));
                } catch (e) {
                    // ignore parse errors
                }
            } else {
                setData(prev => ({ ...prev, date: today, checklist: [...DEFAULT_CHECKLIST] }));
            }
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div role="dialog" aria-modal="true" aria-labelledby="pre-market-routine-title" className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-xl p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -20 }}
                className="w-full max-w-5xl max-h-[92vh] bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-white/10 bg-slate-950/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-600/20 text-amber-500 border border-amber-500/20">
                            <Sun size={20} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-wide text-white">Pre-Market Routine</h2>
                            <p className="text-xs text-slate-500 font-mono tracking-wider">{data.date} • DAILY BRIEFING</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Readiness Badge */}
                        <div className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${readinessPercent >= 80 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : readinessPercent >= 50 ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
                            <Shield size={14} />
                            Readiness: {Math.round(readinessPercent)}%
                        </div>
                        <button onClick={onClose} aria-label="Close pre-market routine" className="text-slate-500 hover:text-white transition-colors">
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                        {/* Column 1: Bias & Sentiment */}
                        <div className="space-y-5">
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-4">
                                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2">Market Bias</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    {BIAS_OPTIONS.map(opt => (
                                        <button
                                            type="button"
                                            key={opt.label}
                                            onClick={() => setData(prev => ({ ...prev, bias: opt.label }))}
                                            className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${data.bias === opt.label ? `${opt.color} ${opt.bg} shadow-sm` : 'border-slate-800 text-slate-500 hover:border-slate-700'}`}
                                        >
                                            <opt.icon size={20} />
                                            <span className="text-xs font-bold">{opt.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Bias Confidence Slider */}
                                <div className="pt-2">
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Conviction Level</label>
                                        <span className="text-xs font-mono font-bold text-indigo-400">{data.biasConfidence}%</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={data.biasConfidence}
                                        onChange={e => setData(prev => ({ ...prev, biasConfidence: parseInt(e.target.value) }))}
                                        className="w-full accent-indigo-500"
                                    />
                                </div>
                            </div>

                            {/* Global Sentiment */}
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-3">
                                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2">Global Sentiment</h4>
                                <div className="flex gap-2">
                                    {(['Risk On', 'Risk Off', 'Cautious'] as const).map(s => (
                                        <button
                                            type="button"
                                            key={s}
                                            onClick={() => setData(prev => ({ ...prev, globalSentiment: s }))}
                                            className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${data.globalSentiment === s ? (s === 'Risk On' ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400' : s === 'Risk Off' ? 'bg-rose-600/20 border-rose-500 text-rose-400' : 'bg-amber-600/20 border-amber-500 text-amber-400') : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600'}`}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Notes */}
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-3">
                                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2">Session Notes</h4>
                                <textarea
                                    value={data.notes}
                                    onChange={e => setData(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Key observations, catalysts, overnight news..."
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none resize-none h-24 custom-scrollbar text-sm"
                                />
                            </div>
                        </div>

                        {/* Column 2: Key Levels & Watchlist */}
                        <div className="space-y-5">
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-4">
                                <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                                    <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                        <Target size={14} className="text-indigo-400" /> Key Levels
                                    </h4>
                                    <button onClick={addKeyLevel} className="text-[10px] text-indigo-400 font-bold hover:text-indigo-300 transition-colors">+ ADD</button>
                                </div>
                                <div className="space-y-3 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                                    {data.keyLevels.map((kl, idx) => (
                                        <div key={idx} className="flex gap-2">
                                            <input
                                                type="text"
                                                value={kl.label}
                                                onChange={e => updateKeyLevel(idx, 'label', e.target.value)}
                                                placeholder="Label"
                                                className="w-1/3 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-indigo-500 outline-none"
                                            />
                                            <input
                                                type="text"
                                                value={kl.price}
                                                onChange={e => updateKeyLevel(idx, 'price', e.target.value)}
                                                placeholder="Price"
                                                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-indigo-500 outline-none font-mono"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Watchlist */}
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-4">
                                <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-700/50 pb-2 flex items-center gap-1.5">
                                    <Zap size={14} className="text-amber-400" /> Today's Watchlist
                                </h4>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={watchlistInput}
                                        onChange={e => setWatchlistInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && addWatchlistItem()}
                                        placeholder="Add ticker..."
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-indigo-500 outline-none font-mono uppercase"
                                    />
                                    <button type="button" onClick={addWatchlistItem} aria-label="Add ticker to watchlist" className="px-3 bg-slate-800 border border-slate-700 rounded-lg hover:bg-indigo-600 hover:border-indigo-500 hover:text-white text-slate-400 transition-all text-xs font-bold">
                                        ADD
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2 min-h-[60px]">
                                    {data.watchlist.length === 0 ? (
                                        <p className="text-xs text-slate-500 italic w-full text-center py-4">No tickers added yet</p>
                                    ) : (
                                        data.watchlist.map((ticker, idx) => (
                                            <span
                                                key={idx}
                                                className="px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-bold font-mono flex items-center gap-2 group cursor-pointer hover:border-rose-500/50 hover:bg-rose-500/10 transition-all"
                                                onClick={() => removeWatchlistItem(idx)}
                                            >
                                                {ticker}
                                                <X size={10} className="text-slate-500 group-hover:text-rose-400" />
                                            </span>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Column 3: Readiness Checklist */}
                        <div className="space-y-5">
                            <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-700/50 space-y-4 h-full flex flex-col">
                                <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                                    <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                        <CheckSquare size={14} className="text-emerald-400" /> Flight Check
                                    </h4>
                                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${checkedCount === data.checklist.length ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-400 bg-slate-800'}`}>
                                        {checkedCount}/{data.checklist.length}
                                    </span>
                                </div>

                                {/* Progress Bar */}
                                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${readinessPercent >= 80 ? 'bg-emerald-500' : readinessPercent >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                                        style={{ width: `${readinessPercent}%` }}
                                    />
                                </div>

                                <div className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
                                    {data.checklist.map((item, idx) => (
                                        <label key={idx} className="flex items-start gap-3 cursor-pointer group transition-all p-2 rounded-lg hover:bg-slate-900/50">
                                            <div className={`w-4.5 h-4.5 rounded border flex items-center justify-center transition-all shrink-0 mt-0.5 ${item.checked ? 'bg-emerald-500 border-emerald-500 shadow-sm' : 'bg-slate-900 border-slate-600 group-hover:border-emerald-400'}`}>
                                                {item.checked && <CheckSquare size={12} className="text-white" />}
                                            </div>
                                            <input type="checkbox" className="hidden" checked={item.checked} onChange={() => toggleChecklist(idx)} />
                                            <span className={`text-xs font-medium leading-relaxed transition-colors ${item.checked ? 'text-slate-300 line-through decoration-emerald-500/50' : 'text-slate-500 group-hover:text-slate-300'}`}>{item.label}</span>
                                        </label>
                                    ))}
                                </div>

                                {/* Readiness Score */}
                                <div className="mt-auto pt-4 border-t border-slate-700/50">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider block mb-2">Self-Assessed Readiness (1-5)</label>
                                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700/50">
                                        {([1, 2, 3, 4, 5] as ReadinessLevel[]).map(level => (
                                            <button
                                                type="button"
                                                key={level}
                                                onClick={() => setData(prev => ({ ...prev, readiness: level }))}
                                                aria-label={`Readiness level ${level} of 5`}
                                                aria-pressed={data.readiness === level}
                                                className={`flex-1 py-2 rounded-md text-sm font-bold transition-all ${data.readiness === level ? (level >= 4 ? 'bg-emerald-600 text-white' : level >= 3 ? 'bg-amber-600 text-white' : 'bg-rose-600 text-white') : 'text-slate-500 hover:text-slate-300'}`}
                                            >
                                                {level}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/10 bg-slate-950/80 flex justify-end z-20">
                    <button
                        type="button"
                        onClick={handleSave}
                        className="px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white shadow-lg shadow-amber-500/20"
                    >
                        <SaveAll size={18} /> Save Routine
                    </button>
                </div>
            </motion.div>
        </div>,
        document.body
    );
};
