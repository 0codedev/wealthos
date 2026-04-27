
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import {
    TrendingUp, TrendingDown, Activity, RefreshCcw,
    Search, Zap, Clock, Maximize2,
    ArrowUpCircle, ArrowDownCircle, XCircle, Crosshair,
    Layers, Plus, Minus, Trash2, MousePointer2, MoveHorizontal, Briefcase, AlertTriangle
} from 'lucide-react';
import {
    ComposedChart, Bar, XAxis, YAxis,
    CartesianGrid, Tooltip, ReferenceLine, Line, Cell, Area,
    Brush, BarChart
} from 'recharts';
import { usePaperStore } from '../../../store/paperStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { formatCurrency } from '../../../utils/helpers';

// --- CONSTANTS ---
const SYMBOLS = [
    { symbol: 'NIFTY 50', fmpSymbol: '^NSEI', base: 22000, vol: 15 },
    { symbol: 'BANKNIFTY', fmpSymbol: '^NSEBANK', base: 46500, vol: 40 },
    { symbol: 'RELIANCE', fmpSymbol: 'RELIANCE.NS', base: 2900, vol: 5 },
    { symbol: 'HDFCBANK', fmpSymbol: 'HDFCBANK.NS', base: 1450, vol: 3 },
    { symbol: 'INFY', fmpSymbol: 'INFY.NS', base: 1600, vol: 4 },
    { symbol: 'ZOMATO', fmpSymbol: 'ZOMATO.NS', base: 160, vol: 1 }
];

const TIMEFRAMES = [
    { label: '1m', speed: 1000, volMult: 1 },
    { label: '5m', speed: 500, volMult: 2 },
    { label: '15m', speed: 200, volMult: 4 },
];

// --- HELPER: RSI Calculation ---
const calculateRSI = (data: any[], period = 14) => {
    if (data.length < period) return data;

    // Create deep copy to ensure immutability
    const result = data.map(d => ({ ...d }));

    let gains = 0;
    let losses = 0;

    // Initial SMA
    for (let i = 1; i <= period; i++) {
        const change = result[i].close - result[i - 1].close;
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Fill first period with 50
    for (let k = 0; k <= period; k++) result[k].rsi = 50;

    for (let i = period + 1; i < result.length; i++) {
        const change = result[i].close - result[i - 1].close;
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result[i].rsi = 100 - (100 / (1 + rs));
    }
    return result;
};

// --- DATA GENERATOR ---
const generateCandle = (prevClose: number, volatility: number) => {
    const dir = Math.random() > 0.5 ? 1 : -1;
    const move = Math.random() * volatility * dir;
    const close = prevClose + move;
    const open = prevClose;
    // Ensure High/Low encompass Open/Close
    let high = Math.max(open, close) + (Math.random() * volatility * 0.5);
    let low = Math.min(open, close) - (Math.random() * volatility * 0.5);
    const volume = Math.floor(Math.random() * 1000) + 500;

    return { open, high, low, close, volume, time: new Date().toLocaleTimeString() };
};

export const LiveSimulator: React.FC = () => {
    const { availableCash, positions, orders, placeOrder, resetAccount } = usePaperStore();
    const apiKeys = useSettingsStore(state => state.apiKeys);
    const dataMode = useSettingsStore(state => state.dataMode);
    const fmpKey = apiKeys?.fmp;

    // --- Market State ---
    const [selectedSymbol, setSelectedSymbol] = useState(SYMBOLS[0]);
    const [timeframe, setTimeframe] = useState(TIMEFRAMES[0]);
    const [data, setData] = useState<any[]>([]);
    const [lastPrice, setLastPrice] = useState(selectedSymbol.base);

    // --- Order State ---
    const [orderQty, setOrderQty] = useState<string>('50');
    const [stopLoss, setStopLoss] = useState<string>('');
    const [takeProfit, setTakeProfit] = useState<string>('');

    // --- Tool State ---
    const [indicators, setIndicators] = useState({ ema9: true, ema20: true, rsi: true });
    const [drawingMode, setDrawingMode] = useState<'NONE' | 'H_LINE'>('NONE');
    const [drawings, setDrawings] = useState<number[]>([]); // Y-levels for horizontal lines

    const [isLoading, setIsLoading] = useState(false);

    // --- Initialize Data ---
    useEffect(() => {
        const fetchRealData = async () => {
            if (!fmpKey || dataMode === 'SIMULATION') return false;
            setIsLoading(true);
            try {
                // FMP endpoint maps 1m to 1min, etc
                const interval = `${timeframe.label}in`;
                const url = `https://financialmodelingprep.com/api/v3/historical-chart/${interval}/${selectedSymbol.fmpSymbol}?apikey=${fmpKey}`;
                const res = await fetch(url);
                if (!res.ok) throw new Error('FMP API error');
                const raw = await res.json();

                if (!Array.isArray(raw) || raw.length === 0) return false;

                // FMP returns latest first, we need oldest first for charting
                const chronological = raw.reverse().slice(-100);

                const formattedData: any[] = [];
                for (let i = 0; i < chronological.length; i++) {
                    const d = chronological[i];
                    const close = d.close;
                    const ema9 = i > 0 ? (close * (2 / 10)) + (formattedData[i - 1].ema9 * (1 - 2 / 10)) : close;
                    const ema20 = i > 0 ? (close * (2 / 21)) + (formattedData[i - 1].ema20 * (1 - 2 / 21)) : close;

                    formattedData.push({
                        time: d.date.split(' ')[1] || d.date, // extract HH:MM:SS
                        open: d.open,
                        high: d.high,
                        low: d.low,
                        close: d.close,
                        volume: d.volume,
                        ema9,
                        ema20
                    });
                }
                const withRsi = calculateRSI(formattedData);
                setData(withRsi);
                setLastPrice(withRsi[withRsi.length - 1].close);
                setDrawings([]);
                return true;
            } catch (err) {
                console.error("Failed to fetch FMP data for simulator:", err);
                return false;
            } finally {
                setIsLoading(false);
            }
        };

        const loadInitData = async () => {
            const success = await fetchRealData();
            if (success) return; // We got real data, ignore simulation

            // Fallback to simulation
            const initialData: Array<{ open: number; high: number; low: number; close: number; ema9: number; ema20: number; volume: number; time: string }> = [];
            let price = selectedSymbol.base;
            for (let i = 0; i < 60; i++) {
                const candle = generateCandle(price, selectedSymbol.vol * timeframe.volMult);

                // EMAs
                const ema9: number = i > 0 ? (candle.close * (2 / 10)) + (initialData[i - 1].ema9 * (1 - 2 / 10)) : candle.close;
                const ema20: number = i > 0 ? (candle.close * (2 / 21)) + (initialData[i - 1].ema20 * (1 - 2 / 21)) : candle.close;

                initialData.push({ ...candle, ema9, ema20 });
                price = candle.close;
            }

            const withRsi = calculateRSI(initialData);
            setData(withRsi);
            setLastPrice(price);
            setDrawings([]); // Clear drawings on symbol change
        };

        loadInitData();
    }, [selectedSymbol, timeframe, fmpKey, dataMode]);

    // --- Live Feed Simulation / Polling ---
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (fmpKey && dataMode === 'LIVE') {
            // Poll real-time quote every 3 seconds
            interval = setInterval(async () => {
                try {
                    const res = await fetch(`https://financialmodelingprep.com/api/v3/quote-short/${selectedSymbol.fmpSymbol}?apikey=${fmpKey}`);
                    if (!res.ok) return;
                    const json = await res.json();
                    if (json && json[0]) {
                        const price = json[0].price;
                        setLastPrice(price);

                        // Update the current candle with the live price
                        setData(prev => {
                            if (prev.length === 0) return prev;
                            const newArr = [...prev];
                            const last = { ...newArr[newArr.length - 1] };
                            last.close = price;
                            last.high = Math.max(last.high, price);
                            last.low = Math.min(last.low, price);
                            newArr[newArr.length - 1] = last;
                            return calculateRSI(newArr);
                        });
                    }
                } catch (err) {
                    // silent ignore
                }
            }, 3000);
        } else {
            // Simulation Fast-forward Mode
            interval = setInterval(() => {
                setData(prev => {
                    if (prev.length === 0) return prev;
                    const lastCandle = prev[prev.length - 1];
                    const newCandle = generateCandle(lastCandle.close, selectedSymbol.vol * timeframe.volMult);

                    // EMA Calculation
                    const k9 = 2 / 10;
                    const ema9 = (newCandle.close * k9) + (lastCandle.ema9 * (1 - k9));
                    const k20 = 2 / 21;
                    const ema20 = (newCandle.close * k20) + (lastCandle.ema20 * (1 - k20));

                    const newData = [...prev.slice(1), { ...newCandle, ema9, ema20 }];

                    const withRsi = calculateRSI(newData);

                    setLastPrice(newCandle.close);
                    return withRsi;
                });
            }, timeframe.speed);
        }

        return () => clearInterval(interval);
    }, [selectedSymbol, timeframe, fmpKey, dataMode]);

    // --- Derived Metrics ---
    const currentCandle = data[data.length - 1] || {};
    const isGreen = (currentCandle.close || 0) > (currentCandle.open || 0);

    // Transform Data for Recharts Candles (Range Bars)
    const chartData = useMemo(() => {
        return data.map(d => ({
            ...d,
            // [min, max] for Body
            body: [Math.min(d.open, d.close), Math.max(d.open, d.close)],
            // [low, high] for Wick
            wick: [d.low, d.high],
            color: d.close >= d.open ? '#10b981' : '#f43f5e'
        }));
    }, [data]);

    const equity = availableCash + positions.reduce((acc, p) => {
        const price = p.symbol === selectedSymbol.symbol ? lastPrice : p.avgPrice;
        return acc + (price * p.qty);
    }, 0);

    // --- Handlers ---
    const handleOrder = (type: 'BUY' | 'SELL') => {
        const qty = parseInt(orderQty);
        if (qty > 0) {
            placeOrder(selectedSymbol.symbol, type, qty, lastPrice);
        }
    };

    const handleChartClick = (e: any) => {
        if (drawingMode === 'H_LINE' && e && e.activePayload) {
            const price = e.activePayload[0].payload.close;
            setDrawings(prev => [...prev, price]);
            setDrawingMode('NONE'); // Auto-exit mode after draw
        }
    };

    const removeDrawing = (index: number) => {
        setDrawings(prev => prev.filter((_, i) => i !== index));
    };

    const calculateProjectedPnL = (exitPrice: number, type: 'BUY' | 'SELL') => {
        const qty = parseInt(orderQty) || 0;
        if (qty === 0) return 0;
        const diff = exitPrice - lastPrice;
        return type === 'BUY' ? diff * qty : -diff * qty;
    };

    // Custom Tooltip
    const MarketTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload;
            return (
                <div className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-xl font-mono text-xs z-50 animate-in fade-in zoom-in-95 duration-200">
                    <p className="font-bold text-slate-200 mb-2 border-b border-slate-700/50 pb-1">{d.time}</p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        <span className="text-slate-500">Open</span> <span className={d.open > d.close ? 'text-rose-400' : 'text-emerald-400'}>{d.open?.toFixed(2)}</span>
                        <span className="text-slate-500">High</span> <span className="text-white">{d.high?.toFixed(2)}</span>
                        <span className="text-slate-500">Low</span> <span className="text-white">{d.low?.toFixed(2)}</span>
                        <span className="text-slate-500">Close</span> <span className={d.close > d.open ? 'text-emerald-400' : 'text-rose-400'}>{d.close?.toFixed(2)}</span>
                        <span className="text-slate-500">Vol</span> <span className="text-amber-400">{d.volume}</span>
                        <span className="text-slate-500">RSI</span> <span className="text-indigo-400">{d.rsi?.toFixed(1)}</span>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex flex-col h-[560px] md:h-[700px] bg-white dark:bg-slate-950 rounded-3xl border border-slate-200 dark:border-slate-900 overflow-hidden text-slate-800 dark:text-slate-200 font-sans shadow-2xl">

            {/* 1. PRO TOP BAR */}
            <div className="h-14 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 bg-slate-50 dark:bg-slate-900 shrink-0">
                <div className="flex items-center gap-3">
                    {/* Symbol Selector */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors group relative border border-slate-200 dark:border-slate-700">
                        <Search size={14} className="text-slate-400" />
                        <span className="font-black text-sm text-slate-900 dark:text-white tracking-wide">{selectedSymbol.symbol}</span>
                        <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl hidden group-hover:block z-50 overflow-hidden">
                            {SYMBOLS.map(s => (
                                <div key={s.symbol} onClick={() => setSelectedSymbol(s)} className="px-4 py-3 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer border-b border-slate-200 dark:border-slate-800/50 last:border-0 flex justify-between">
                                    <span>{s.symbol}</span>
                                    <span className="text-slate-500">Vol: {s.vol}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="h-6 w-px bg-slate-800 mx-1"></div>

                    {/* Timeframes */}
                    <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700">
                        {TIMEFRAMES.map(tf => (
                            <button
                                key={tf.label}
                                onClick={() => setTimeframe(tf)}
                                className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${timeframe.label === tf.label ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                                {tf.label}
                            </button>
                        ))}
                    </div>

                    <div className="h-6 w-px bg-slate-800 mx-1"></div>

                    {/* Simulated Data Badge */}
                    <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 px-3 py-1 rounded-lg flex items-center gap-2">
                        <AlertTriangle size={14} className="animate-pulse" />
                        <span className="text-[10px] font-black tracking-widest uppercase hidden md:inline">Paper Trading - Simulated Data</span>
                        <span className="text-[10px] font-black tracking-widest uppercase md:hidden">SIMULATED</span>
                    </div>

                    <div className="h-6 w-px bg-slate-800 mx-1"></div>

                    {/* Indicators Toggle */}
                    <div className="flex gap-1">
                        <button onClick={() => setIndicators(p => ({ ...p, ema9: !p.ema9 }))} className={`px-2 py-1 rounded text-[10px] font-bold border ${indicators.ema9 ? 'bg-indigo-900/30 text-indigo-400 border-indigo-500/30' : 'text-slate-500 border-transparent hover:bg-slate-800'}`}>EMA 9</button>
                        <button onClick={() => setIndicators(p => ({ ...p, ema20: !p.ema20 }))} className={`px-2 py-1 rounded text-[10px] font-bold border ${indicators.ema20 ? 'bg-amber-900/30 text-amber-500 border-amber-500/30' : 'text-slate-500 border-transparent hover:bg-slate-800'}`}>EMA 20</button>
                        <button onClick={() => setIndicators(p => ({ ...p, rsi: !p.rsi }))} className={`px-2 py-1 rounded text-[10px] font-bold border ${indicators.rsi ? 'bg-fuchsia-900/30 text-fuchsia-400 border-fuchsia-500/30' : 'text-slate-500 border-transparent hover:bg-slate-800'}`}>RSI</button>
                    </div>
                </div >

                <div className="flex items-center gap-4">
                    {/* Drawing Tool */}
                    <button
                        onClick={() => setDrawingMode(drawingMode === 'H_LINE' ? 'NONE' : 'H_LINE')}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${drawingMode === 'H_LINE' ? 'bg-emerald-900/30 text-emerald-400 border-emerald-500/50' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
                    >
                        <MoveHorizontal size={14} /> {drawingMode === 'H_LINE' ? 'Place Line' : 'Draw Level'}
                    </button>

                    <div className="text-right hidden md:block">
                        <p className="text-[10px] text-slate-500 font-bold uppercase">Equity</p>
                        <p className={`text-sm font-mono font-bold ${equity >= 1000000 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(equity)}</p>
                    </div>
                    <button onClick={resetAccount} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 hover:text-white transition-colors" title="Reset Paper Account">
                        <RefreshCcw size={16} />
                    </button>
                </div>
            </div >

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">

                {/* 2. CHARTING ENGINE */}
                <div className="flex-1 flex flex-col relative bg-[#0b0e14] cursor-crosshair group">

                    {/* OHLC Legend Overlay */}
                    <div className="absolute top-3 left-4 z-20 flex gap-4 font-mono text-xs pointer-events-none select-none bg-black/40 p-1 px-3 rounded-lg backdrop-blur-sm border border-white/5">
                        <span className={`font-bold text-base ${isGreen ? 'text-emerald-500' : 'text-rose-500'}`}>{lastPrice.toFixed(2)}</span>
                        <div className="flex gap-3 text-slate-400 items-center">
                            <span>O:<span className={isGreen ? 'text-emerald-400' : 'text-rose-400'}>{currentCandle.open?.toFixed(2)}</span></span>
                            <span>H:<span className="text-slate-200">{currentCandle.high?.toFixed(2)}</span></span>
                            <span>L:<span className="text-slate-200">{currentCandle.low?.toFixed(2)}</span></span>
                            <span>C:<span className={isGreen ? 'text-emerald-400' : 'text-rose-400'}>{currentCandle.close?.toFixed(2)}</span></span>
                        </div>
                    </div>

                    {/* Main Chart */}
                    <div className="flex-1 w-full h-full relative" style={{ cursor: drawingMode === 'H_LINE' ? 'copy' : 'crosshair' }}>
                        <SafeChartContainer>
                            <ComposedChart data={chartData} onClick={handleChartClick} margin={{ top: 10, right: 60, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#64748b" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#64748b" stopOpacity={0.1} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" opacity={0.4} />
                                <XAxis dataKey="time" hide />

                                {/* Price Axis */}
                                <YAxis
                                    domain={['auto', 'auto']}
                                    orientation="right"
                                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
                                    tickLine={false}
                                    axisLine={false}
                                    width={50}
                                    tickFormatter={(val) => val.toFixed(1)}
                                />

                                <Tooltip content={<MarketTooltip />} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }} isAnimationActive={false} />

                                {/* Indicators */}
                                {indicators.ema9 && <Line type="monotone" dataKey="ema9" stroke="#818cf8" strokeWidth={1} dot={false} isAnimationActive={false} />}
                                {indicators.ema20 && <Line type="monotone" dataKey="ema20" stroke="#fbbf24" strokeWidth={1} dot={false} isAnimationActive={false} />}

                                {/* --- THE COMPOSITE CANDLESTICK --- */}

                                {/* 1. Wicks (Shadows) - Rendered as thin Bar Range */}
                                <Bar dataKey="wick" barSize={1} isAnimationActive={false}>
                                    {chartData.map((entry, index) => (
                                        <Cell key={`wick-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>

                                {/* 2. Bodies - Rendered as thicker Bar Range */}
                                <Bar dataKey="body" barSize={8} isAnimationActive={false}>
                                    {chartData.map((entry, index) => (
                                        <Cell key={`body-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>

                                {/* Live Price Line */}
                                <ReferenceLine
                                    y={lastPrice}
                                    stroke={isGreen ? '#10b981' : '#f43f5e'}
                                    strokeDasharray="3 3"
                                    label={{ value: lastPrice.toFixed(2), fill: 'white', fontSize: 10, position: 'right', fillOpacity: 1, dx: 45, dy: 3 }}
                                />

                                {/* User Drawings */}
                                {drawings.map((y, idx) => (
                                    <ReferenceLine key={idx} y={y} stroke="#3b82f6" strokeWidth={1} strokeDasharray="5 5" label={{ value: 'SR', fill: '#3b82f6', fontSize: 9, position: 'insideLeft' }} />
                                ))}

                                {/* Position Lines */}
                                {positions.filter(p => p.symbol === selectedSymbol.symbol).map((p, idx) => (
                                    <ReferenceLine
                                        key={`pos-${idx}`}
                                        y={p.avgPrice}
                                        stroke={p.type === 'LONG' ? '#10b981' : '#f43f5e'}
                                        strokeWidth={1}
                                        label={{ value: `${p.type} ${p.qty}`, fill: p.type === 'LONG' ? '#10b981' : '#f43f5e', fontSize: 10, position: 'insideLeft' }}
                                    />
                                ))}

                            </ComposedChart>
                        </SafeChartContainer>

                        {/* Volume Overlay (Bottom 15%) */}
                        <div className="absolute bottom-0 left-0 right-[60px] h-[15%] opacity-30 pointer-events-none">
                            <SafeChartContainer>
                                <BarChart data={chartData}>
                                    <Bar dataKey="volume" fill="#64748b" />
                                </BarChart>
                            </SafeChartContainer>
                        </div>
                    </div>

                    {/* RSI Panel (Conditional) */}
                    {indicators.rsi && (
                        <div className="h-32 border-t border-slate-800 w-full relative">
                            <div className="absolute top-1 left-2 text-[10px] text-indigo-400 font-bold z-10">RSI (14)</div>
                            <SafeChartContainer>
                                <ComposedChart data={chartData} margin={{ top: 5, right: 60, left: 0, bottom: 0 }}>
                                    <YAxis domain={[0, 100]} orientation="right" tick={{ fill: '#64748b', fontSize: 9 }} width={50} tickCount={3} />
                                    <XAxis dataKey="time" hide />
                                    <ReferenceLine y={70} stroke="#475569" strokeDasharray="3 3" />
                                    <ReferenceLine y={30} stroke="#475569" strokeDasharray="3 3" />
                                    <Line type="monotone" dataKey="rsi" stroke="#c084fc" strokeWidth={1} dot={false} isAnimationActive={false} />
                                    <Area type="monotone" dataKey="rsi" fill="#c084fc" fillOpacity={0.05} stroke="none" baseValue={0} />
                                </ComposedChart>
                            </SafeChartContainer>
                        </div>
                    )}

                    {/* Drawing Manager (Overlay) */}
                    {drawings.length > 0 && (
                        <div className="absolute top-16 left-4 bg-slate-900/80 p-2 rounded-lg border border-slate-700 backdrop-blur-sm z-30">
                            <p className="text-[10px] text-slate-400 uppercase font-bold mb-1">Levels</p>
                            <div className="space-y-1">
                                {drawings.map((y, i) => (
                                    <div key={i} className="flex items-center justify-between gap-2 text-xs font-mono text-white bg-slate-800 px-2 py-1 rounded">
                                        <span>{y.toFixed(2)}</span>
                                        <button onClick={() => removeDrawing(i)} className="text-slate-500 hover:text-rose-500"><XCircle size={12} /></button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* 3. PRO ORDER PANEL */}
                <div className="w-full md:w-80 bg-slate-900 border-l border-slate-800 flex flex-col p-0 z-20">
                    <div className="p-4 border-b border-slate-800">
                        <div className="flex items-center gap-2 mb-4 text-indigo-400">
                            <Briefcase size={16} />
                            <span className="text-xs font-black uppercase tracking-widest">Order Terminal</span>
                        </div>

                        {/* Qty Selector */}
                        <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 mb-4 flex items-center">
                            <button onClick={() => setOrderQty(prev => String(Math.max(1, parseInt(prev) - 50)))} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:bg-slate-800 rounded-lg transition-colors"><Minus size={16} /></button>
                            <div className="flex-1 text-center border-x border-slate-800">
                                <input
                                    type="number"
                                    value={orderQty}
                                    onChange={(e) => setOrderQty(e.target.value)}
                                    className="w-full bg-transparent text-center text-white font-mono font-bold outline-none"
                                />
                                <p className="text-[9px] text-slate-500 uppercase font-bold">Quantity</p>
                            </div>
                            <button onClick={() => setOrderQty(prev => String(parseInt(prev) + 50))} aria-label="Increase order quantity by 50" className="w-10 h-10 flex items-center justify-center text-slate-400 hover:bg-slate-800 rounded-lg transition-colors"><Plus size={16} /></button>
                        </div>

                        {/* SL/TP Advanced */}
                        <div className="space-y-2 mb-6">
                            <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
                                <span className="text-[10px] font-bold text-rose-500 w-6">SL</span>
                                <input
                                    type="number"
                                    placeholder="Stop Loss"
                                    value={stopLoss}
                                    onChange={(e) => setStopLoss(e.target.value)}
                                    className="flex-1 bg-transparent text-xs text-white font-mono outline-none"
                                />
                                {stopLoss && <span className="text-[9px] text-rose-500 font-mono">-{formatCurrency(Math.abs(calculateProjectedPnL(parseFloat(stopLoss), 'BUY')))}</span>}
                            </div>
                            <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800">
                                <span className="text-[10px] font-bold text-emerald-500 w-6">TP</span>
                                <input
                                    type="number"
                                    placeholder="Take Profit"
                                    value={takeProfit}
                                    onChange={(e) => setTakeProfit(e.target.value)}
                                    className="flex-1 bg-transparent text-xs text-white font-mono outline-none"
                                />
                                {takeProfit && <span className="text-[9px] text-emerald-500 font-mono">+{formatCurrency(Math.abs(calculateProjectedPnL(parseFloat(takeProfit), 'BUY')))}</span>}
                            </div>
                        </div>

                        {/* Execution Buttons */}
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => handleOrder('BUY')}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-bold shadow-[0_4px_0_rgb(6,95,70)] active:translate-y-[4px] active:shadow-none transition-all flex flex-col items-center justify-center relative overflow-hidden group"
                            >
                                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                                <span className="text-xs opacity-80 mb-1">BUY MARKET</span>
                                <span className="text-lg leading-none">{lastPrice.toFixed(2)}</span>
                            </button>
                            <button
                                onClick={() => handleOrder('SELL')}
                                className="bg-rose-600 hover:bg-rose-500 text-white py-4 rounded-xl font-bold shadow-[0_4px_0_rgb(159,18,57)] active:translate-y-[4px] active:shadow-none transition-all flex flex-col items-center justify-center relative overflow-hidden group"
                            >
                                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                                <span className="text-xs opacity-80 mb-1">SELL MARKET</span>
                                <span className="text-lg leading-none">{lastPrice.toFixed(2)}</span>
                            </button>
                        </div>
                    </div>

                    {/* Positions List */}
                    <div className="flex-1 overflow-y-auto p-4 bg-slate-950/50">
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase mb-3 flex items-center justify-between">
                            <span>Open Positions ({positions.length})</span>
                            {positions.length > 0 && <span className={`text-${(equity - 1000000) >= 0 ? 'emerald' : 'rose'}-500`}>PnL: {formatCurrency(equity - 1000000)}</span>}
                        </h3>

                        <div className="space-y-2">
                            {positions.map(p => {
                                const marketPrice = p.symbol === selectedSymbol.symbol ? lastPrice : p.avgPrice;
                                const pnl = (marketPrice - p.avgPrice) * p.qty;
                                const finalPnL = p.type === 'LONG' ? pnl : -pnl;
                                const isWin = finalPnL >= 0;

                                return (
                                    <div key={p.symbol} className="bg-slate-900 border border-slate-800 p-3 rounded-xl flex flex-col gap-2 group hover:border-slate-700 transition-colors">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${p.type === 'LONG' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-rose-900/30 text-rose-400'}`}>{p.type}</span>
                                                <span className="font-bold text-xs text-white">{p.symbol}</span>
                                            </div>
                                            <span className={`font-mono text-sm font-bold ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                {isWin ? '+' : ''}{finalPnL.toFixed(1)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-end">
                                            <div className="text-[10px] text-slate-500 font-mono">
                                                {p.qty} @ {p.avgPrice.toFixed(1)} → {marketPrice.toFixed(1)}
                                            </div>
                                            <button
                                                onClick={() => placeOrder(p.symbol, p.type === 'LONG' ? 'SELL' : 'BUY', p.qty, marketPrice)}
                                                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] text-white rounded border border-slate-700 transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                Close
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            {positions.length === 0 && (
                                <div className="text-center py-10 text-slate-700 text-xs italic border-2 border-dashed border-slate-800 rounded-xl">
                                    No active positions.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div >
    );
};
