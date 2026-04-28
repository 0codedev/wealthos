
import React, { useState, useEffect, useRef } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { Play, Pause, FastForward, RotateCcw, TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { CustomTooltip } from '../../shared/CustomTooltip';

// --- Types ---
interface Candle {
    time: number;
    price: number;
}

interface Trade {
    type: 'BUY' | 'SELL';
    price: number;
    time: number;
    pnl?: number;
}

interface MarketReplaySimulatorProps {
    isOpen: boolean; // Kept for API compatibility, though likely always rendered
    onClose?: () => void;
    onComplete?: (score: number) => void;
}

// --- Mock Data Generator ---
const generateMarketData = (points: number = 100): Candle[] => {
    // Awaiting live historical tick data synchronization
    return [];
};

export const MarketReplay: React.FC<MarketReplaySimulatorProps> = ({ isOpen, onClose, onComplete }) => {
    const [fullData, setFullData] = useState<Candle[]>([]);
    const [visibleData, setVisibleData] = useState<Candle[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeed] = useState(1000); // ms per tick

    // Trading State
    const [position, setPosition] = useState<'LONG' | 'SHORT' | null>(null);
    const [entryPrice, setEntryPrice] = useState<number | null>(null);
    const [balance, setBalance] = useState(100000); // Virtual Capital
    const [trades, setTrades] = useState<Trade[]>([]);
    const [pnl, setPnl] = useState(0);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Init
    useEffect(() => {
        if (isOpen) {
            const data = generateMarketData(200);
            setFullData(data);
            setVisibleData(data.slice(0, 50)); // Start with 50 candles
            setCurrentIndex(50);
            setBalance(100000);
            setTrades([]);
            setPosition(null);
            setPnl(0);
            setIsPlaying(false);
        }
    }, [isOpen]);

    // Game Loop
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isPlaying && currentIndex < fullData.length - 1) {
            interval = setInterval(() => {
                setCurrentIndex(prev => {
                    const next = prev + 1;
                    setVisibleData(fullData.slice(0, next));
                    return next;
                });
            }, speed);
        } else if (currentIndex >= fullData.length - 1) {
            setIsPlaying(false);
            // Auto-close position at end
            if (position) closePosition(fullData[fullData.length - 1].price);
        }
        return () => clearInterval(interval);
    }, [isPlaying, currentIndex, fullData, speed, position]);

    // Real-time PnL Calc
    useEffect(() => {
        if (position && entryPrice) {
            const currentPrice = visibleData[visibleData.length - 1]?.price || entryPrice;
            const diff = currentPrice - entryPrice;
            setPnl(position === 'LONG' ? diff * 50 : -diff * 50); // 50 Qty Lot
        } else {
            setPnl(0);
        }
    }, [visibleData, position, entryPrice]);

    const handleBuy = () => {
        const currentPrice = visibleData[visibleData.length - 1].price;
        if (position === 'SHORT') closePosition(currentPrice);
        if (!position) {
            setPosition('LONG');
            setEntryPrice(currentPrice);
            playSound('buy');
        }
    };

    const handleSell = () => {
        const currentPrice = visibleData[visibleData.length - 1].price;
        if (position === 'LONG') closePosition(currentPrice);
        if (!position) {
            setPosition('SHORT');
            setEntryPrice(currentPrice);
            playSound('sell');
        }
    };

    const closePosition = (price: number) => {
        if (!position || !entryPrice) return;
        const diff = price - entryPrice;
        const realizedPnl = position === 'LONG' ? diff * 50 : -diff * 50;

        setBalance(prev => prev + realizedPnl);
        setTrades(prev => [...prev, {
            type: position === 'LONG' ? 'SELL' : 'BUY',
            price,
            time: currentIndex,
            pnl: realizedPnl
        }]);

        setPosition(null);
        setEntryPrice(null);
        setPnl(0);
        playSound('close');
    };

    const playSound = (type: 'buy' | 'sell' | 'close') => {
        // Simple beep synthesis
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'buy') {
            osc.frequency.value = 600;
            osc.type = 'triangle';
        } else if (type === 'sell') {
            osc.frequency.value = 400;
            osc.type = 'sawtooth';
        } else {
            osc.frequency.value = 800;
            osc.type = 'sine';
        }

        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
        osc.stop(ctx.currentTime + 0.1);
    };

    const finishSession = () => {
        const totalReturn = ((balance - 100000) / 100000) * 100;
        const score = Math.max(0, Math.round(totalReturn * 100)); // XP based on return
        if (onComplete) onComplete(score);
        if (onClose) onClose();
    };

    // Removed the !isOpen check to allow embedding
    // if (!isOpen) return null;

    return (
        <div className="h-[460px] md:h-[600px] w-full bg-slate-900 flex flex-col animate-in fade-in duration-300 rounded-2xl overflow-hidden border border-slate-800">
            {/* Header */}
            <div className="bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700">
                <div className="flex items-center gap-4">
                    <div className="bg-cyan-500/20 p-2 rounded-lg">
                        <Activity className="text-cyan-400" size={24} />
                    </div>
                    <div>
                        <h2 className="text-slate-900 dark:text-white font-bold text-lg">Market Replay Simulator</h2>
                        <p className="text-slate-400 text-xs">NIFTY 50 • 1 Lot (50 Qty)</p>
                    </div>
                </div>
                <div className="flex items-center gap-6">
                    <div className="text-right">
                        <p className="text-xs text-slate-400 uppercase">Balance</p>
                        <p className="text-xl font-mono font-bold text-slate-900 dark:text-white">₹{balance.toFixed(0)}</p>
                    </div>
                    <div className={`text-right ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        <p className="text-xs opacity-70 uppercase">Unrealized P&L</p>
                        <p className="text-xl font-mono font-bold">{pnl >= 0 ? '+' : ''}₹{pnl.toFixed(0)}</p>
                    </div>
                    {onClose && (
                        <button onClick={finishSession} className="bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 dark:border-transparent">
                            End Session
                        </button>
                    )}
                </div>
            </div>

            {/* Chart Area */}
            <div className="flex-1 bg-white dark:bg-slate-950 relative p-4">
                <SafeChartContainer>
                    <AreaChart data={visibleData}>
                        <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="time" hide />
                        <YAxis domain={['auto', 'auto']} orientation="right" tick={{ fill: '#64748b' }} />
                        <Tooltip
                            content={<CustomTooltip formatter={(val: number) => `₹${val.toFixed(2)}`} />}
                            cursor={{ strokeDasharray: '3 3' }}
                        />
                        <Area name="Price" type="monotone" dataKey="price" stroke="#06b6d4" fillOpacity={1} fill="url(#colorPrice)" strokeWidth={2} isAnimationActive={false} />
                        {entryPrice && (
                            <ReferenceLine y={entryPrice} stroke={position === 'LONG' ? '#10b981' : '#ef4444'} strokeDasharray="3 3" />
                        )}
                    </AreaChart>
                </SafeChartContainer>

                {/* Position Badge */}
                {position && (
                    <div className={`absolute top-4 left-4 px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${position === 'LONG' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                        {position} @ {entryPrice?.toFixed(2)}
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="bg-slate-50 dark:bg-slate-800 p-6 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="w-12 h-12 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white transition-colors border border-slate-300 dark:border-transparent"
                    >
                        {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-1" />}
                    </button>
                    <button
                        onClick={() => {
                            setIsPlaying(false);
                            setCurrentIndex(50);
                            setVisibleData(fullData.slice(0, 50));
                            setBalance(100000);
                            setPosition(null);
                        }}
                        className="p-3 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                    >
                        <RotateCcw size={20} />
                    </button>
                    <div className="flex bg-slate-700 rounded-lg p-1 ml-2">
                        {[1000, 500, 100].map(s => (
                            <button
                                key={s}
                                onClick={() => setSpeed(s)}
                                className={`px-3 py-1 rounded text-xs font-bold ${speed === s ? 'bg-cyan-500 text-white' : 'text-slate-400 hover:text-white'}`}
                            >
                                {s === 1000 ? '1x' : s === 500 ? '2x' : '5x'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={handleBuy}
                        disabled={position === 'LONG'}
                        className="flex flex-col items-center justify-center w-32 h-16 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
                    >
                        <span className="text-emerald-100 text-[10px] font-bold uppercase">Enter Long</span>
                        <span className="text-white font-black text-xl flex items-center gap-1"><TrendingUp size={18} /> BUY</span>
                    </button>

                    <button
                        onClick={handleSell}
                        disabled={position === 'SHORT'}
                        className="flex flex-col items-center justify-center w-32 h-16 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95 shadow-lg shadow-rose-900/20"
                    >
                        <span className="text-rose-100 text-[10px] font-bold uppercase">Enter Short</span>
                        <span className="text-white font-black text-xl flex items-center gap-1"><TrendingDown size={18} /> SELL</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
