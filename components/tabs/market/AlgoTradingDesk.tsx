import React, { useState, useEffect, useRef } from 'react';
import {
    Activity, Play, Square, AlertTriangle, ShieldCheck,
    TrendingUp, TrendingDown, RefreshCcw, DollarSign,
    Layers, Zap, Clock, Info, ShieldAlert
} from 'lucide-react';
import { formatCurrency } from '../../../utils/helpers';
import { useToast } from '../../shared/ToastProvider';

interface AlgoTrade {
    id: number;
    timestamp: string;
    algo_id: string;
    strategy: string;
    direction: string;
    instrument: string;
    quantity: number;
    price: number;
    stop_loss: number;
    target: number;
    mode: string;
    status: string;
    pnl: number;
}

export const AlgoTradingDesk: React.FC = () => {
    const { toast } = useToast();
    
    // Status State
    const [engineStatus, setEngineStatus] = useState<'idle' | 'running'>('idle');
    const [engineMode, setEngineMode] = useState<'sandbox' | 'simulate'>('simulate');
    const [isHalted, setIsHalted] = useState(false);
    const [uptime, setUptime] = useState(0);
    const [loading, setLoading] = useState(false);
    
    // Data State
    const [trades, setTrades] = useState<AlgoTrade[]>([]);
    const [livePrice, setLivePrice] = useState(2450.0);
    const [priceHistory, setPriceHistory] = useState<number[]>([]);
    
    // Timer ref
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // 1. Fetch Engine Status & Trade Log
    const fetchStatusAndTrades = async () => {
        try {
            // Fetch Status
            const statusRes = await fetch('/api/python-nse/algo/status');
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                setEngineStatus(statusData.status);
                setIsHalted(statusData.is_halted);
                if (statusData.status === 'running') {
                    setEngineMode(statusData.mode || 'simulate');
                    const elapsed = Math.floor(Date.now() / 1000) - (statusData.startTime || 0);
                    setUptime(elapsed > 0 ? elapsed : 0);
                } else {
                    setUptime(0);
                }
            }

            // Fetch Trade Logs
            const tradesRes = await fetch('/api/python-nse/algo/trades');
            if (tradesRes.ok) {
                const tradesData = await tradesRes.json();
                setTrades(tradesData.trades || []);
            }
        } catch (err) {
            console.error("[ALGO DESK] Failed to fetch server stats:", err);
        }
    };

    // Initial load and periodic polling
    useEffect(() => {
        fetchStatusAndTrades();
        
        // Poll backend stats every 3 seconds
        pollingIntervalRef.current = setInterval(fetchStatusAndTrades, 3000);
        
        return () => {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    // 2. Manage Uptime Counter & Mock Ticking Price
    useEffect(() => {
        if (engineStatus === 'running') {
            // Uptime incrementer
            timerRef.current = setInterval(() => {
                setUptime(prev => prev + 1);
                
                // Tick generator for visual effect
                setLivePrice(prev => {
                    const change = (Math.random() - 0.5) * 1.5;
                    const nextPrice = Math.max(100.0, parseFloat((prev + change).toFixed(2)));
                    
                    setPriceHistory(hist => {
                        const newHist = [...hist, nextPrice];
                        if (newHist.length > 30) newHist.shift();
                        return newHist;
                    });
                    
                    return nextPrice;
                });
            }, 1000);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            setUptime(0);
        }
        
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [engineStatus]);

    // 3. Start Engine
    const startEngine = async (mode: 'sandbox' | 'simulate') => {
        setLoading(true);
        try {
            const res = await fetch('/api/python-nse/algo/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });

            const data = await res.json();
            if (res.ok) {
                setEngineStatus('running');
                setEngineMode(mode);
                setUptime(0);
                toast.success(`Algo Engine started successfully in ${mode.toUpperCase()} mode.`);
                fetchStatusAndTrades();
            } else {
                toast.error(`Start Failed: ${data.detail || 'Unknown error'}`);
            }
        } catch (err) {
            toast.error('Failed to connect to Python Bridge API.');
        } finally {
            setLoading(false);
        }
    };

    // 4. Stop Engine
    const stopEngine = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/python-nse/algo/stop', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setEngineStatus('idle');
                toast.success('Algo Engine stopped successfully.');
                fetchStatusAndTrades();
            } else {
                toast.error(`Stop Failed: ${data.detail || 'Unknown error'}`);
            }
        } catch (err) {
            toast.error('Failed to communicate with API server.');
        } finally {
            setLoading(false);
        }
    };

    // 5. Emergency Kill Switch / Resume
    const toggleKillSwitch = async (action: 'halt' | 'resume') => {
        setLoading(true);
        try {
            const res = await fetch('/api/python-nse/algo/kill-switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action })
            });

            const data = await res.json();
            if (res.ok) {
                setIsHalted(action === 'halt');
                if (action === 'halt') {
                    setEngineStatus('idle');
                    toast.error('EMERGENCY HALT ACTIVE. Algo engine execution halted. Verify open positions on broker terminal.');
                } else {
                    toast.success('Halt cleared. Engine ready for activation.');
                }
                fetchStatusAndTrades();
            } else {
                toast.error(`Action Failed: ${data.detail || 'Unknown error'}`);
            }
        } catch (err) {
            toast.error('Failed to transmit Kill Switch signal.');
        } finally {
            setLoading(false);
        }
    };

    // Format Uptime (hh:mm:ss)
    const formatUptime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [
            h > 0 ? String(h).padStart(2, '0') : null,
            String(m).padStart(2, '0'),
            String(s).padStart(2, '0')
        ].filter(Boolean).join(':');
    };

    // Calculate live position summary
    const activePositions = trades.filter(t => t.status === 'PLACED' || t.status === 'FILLED');
    
    return (
        <div className="space-y-6">
            
            {/* Kill Switch Warning banner */}
            {isHalted && (
                <div className="flex items-center justify-between p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 animate-pulse">
                    <div className="flex items-center gap-3">
                        <ShieldAlert size={20} />
                        <div>
                            <p className="font-bold text-sm">EMERGENCY KILL SWITCH ENGAGED</p>
                            <p className="text-xs opacity-80">All automated orders are disabled and active targets have been cleared.</p>
                        </div>
                    </div>
                    <button 
                        disabled={loading}
                        onClick={() => toggleKillSwitch('resume')}
                        className="px-4 py-1.5 rounded-lg bg-red-500 text-white font-bold text-xs hover:bg-red-600 transition"
                    >
                        Resume Operations
                    </button>
                </div>
            )}

            {/* Grid Panels */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Panel 1: Master Controller */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-md">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase tracking-wider">Engine Controller</h3>
                        <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${engineStatus === 'running' ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`}></span>
                            <span className="text-[10px] font-bold uppercase text-slate-500">{engineStatus}</span>
                        </div>
                    </div>
                    
                    <div className="space-y-4">
                        {/* Status Stats */}
                        <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-xl space-y-2.5">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 font-medium">Uptime</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">{formatUptime(uptime)}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 font-medium">Selected Strategy</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">ORB Breakout v1</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500 font-medium">Active Mode</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200 uppercase">{engineMode}</span>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="flex flex-col gap-2">
                            {engineStatus === 'idle' ? (
                                <>
                                    <button
                                        disabled={loading || isHalted}
                                        onClick={() => startEngine('simulate')}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition disabled:opacity-50"
                                    >
                                        <Zap size={15} /> Start Simulation Mode
                                    </button>
                                    <button
                                        disabled={loading || isHalted}
                                        onClick={() => startEngine('sandbox')}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold text-xs transition disabled:opacity-50"
                                    >
                                        <Play size={15} /> Start Sandbox (Live Price)
                                    </button>
                                </>
                            ) : (
                                <button
                                    disabled={loading}
                                    onClick={stopEngine}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-xs transition"
                                >
                                    <Square size={15} /> Stop Engine Process
                                </button>
                            )}

                            <button
                                disabled={loading || isHalted}
                                onClick={() => toggleKillSwitch('halt')}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600/10 hover:bg-red-600 text-red-600 hover:text-white font-bold text-xs transition mt-2 border border-red-600/30"
                            >
                                <AlertTriangle size={15} /> Emergency Kill Switch
                            </button>
                        </div>
                    </div>
                </div>

                {/* Panel 2: Account Balances */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-md">
                    <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4">Sandbox Margins</h3>
                    
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-emerald-500/10 p-3 rounded-xl">
                                <DollarSign className="text-emerald-500" size={24} />
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Virtual Balance</p>
                                <p className="text-2xl font-black text-slate-800 dark:text-white">Rs. 1,000,000.00</p>
                            </div>
                        </div>

                        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Target Asset</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">RELIANCE (2885)</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Allocated Capital Limit</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">Rs. 50,000.00</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Leverage Multiplier</span>
                                <span className="font-bold text-slate-800 dark:text-slate-200">1.0x (No Leverage)</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Panel 3: Live Price Ticker */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-md flex flex-col justify-between">
                    <div>
                        <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-2">Live Price Monitor</h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">RELIANCE (NSE_EQ)</p>
                    </div>

                    <div className="my-4">
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black text-slate-800 dark:text-white">Rs. {livePrice.toFixed(2)}</span>
                            <span className="text-xs font-bold text-emerald-500 flex items-center gap-0.5">
                                <TrendingUp size={12} /> +0.45%
                            </span>
                        </div>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">Updates every second during simulation</p>
                    </div>

                    {/* Sparkline visualization */}
                    <div className="h-12 w-full flex items-end gap-1 overflow-hidden pt-2">
                        {priceHistory.map((val, idx) => {
                            const minVal = Math.min(...priceHistory);
                            const maxVal = Math.max(...priceHistory);
                            const range = maxVal - minVal || 1.0;
                            const heightPct = ((val - minVal) / range) * 100;
                            return (
                                <div 
                                    key={idx} 
                                    style={{ height: `${Math.max(5, heightPct)}%` }} 
                                    className="flex-1 bg-indigo-500/20 dark:bg-indigo-400/30 rounded-t border-t border-indigo-500"
                                ></div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Panel 4: Active Positions */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-md">
                <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4">Active Positions</h3>
                
                {activePositions.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 text-xs">
                        <Info className="mx-auto mb-2 text-slate-400" size={20} />
                        No active open positions. The algo engine is looking for breakouts.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 font-bold">
                                    <th className="py-3">Symbol</th>
                                    <th className="py-3">Direction</th>
                                    <th className="py-3">Quantity</th>
                                    <th className="py-3">Avg Price</th>
                                    <th className="py-3">Current Price</th>
                                    <th className="py-3">Target</th>
                                    <th className="py-3">Stop Loss</th>
                                    <th className="py-3 text-right">P&L</th>
                                </tr>
                            </thead>
                            <tbody>
                                {activePositions.map((pos) => {
                                    const pnlVal = (livePrice - pos.price) * pos.quantity * (pos.direction === 'BUY' ? 1 : -1);
                                    return (
                                        <tr key={pos.id} className="border-b border-slate-100 dark:border-slate-800 font-medium">
                                            <td className="py-3 font-bold text-slate-800 dark:text-white">{pos.instrument === '2885' ? 'RELIANCE' : pos.instrument}</td>
                                            <td className="py-3">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pos.direction === 'BUY' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                                                    {pos.direction}
                                                </span>
                                            </td>
                                            <td className="py-3">{pos.quantity}</td>
                                            <td className="py-3">Rs. {pos.price.toFixed(2)}</td>
                                            <td className="py-3">Rs. {livePrice.toFixed(2)}</td>
                                            <td className="py-3 text-emerald-500">Rs. {pos.target.toFixed(2)}</td>
                                            <td className="py-3 text-red-500">Rs. {pos.stop_loss.toFixed(2)}</td>
                                            <td className={`py-3 text-right font-black ${pnlVal >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                                {pnlVal >= 0 ? '+' : ''}Rs. {pnlVal.toFixed(2)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Panel 5: Audit Log / Order History */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-md">
                <h3 className="font-black text-sm text-slate-800 dark:text-white uppercase tracking-wider mb-4">Algo Execution Log</h3>
                
                {trades.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 text-xs">
                        No transactions logged yet. Start the engine to run trade execution loops.
                    </div>
                ) : (
                    <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 font-bold sticky top-0 bg-white dark:bg-slate-900 py-2">
                                    <th className="py-3">Timestamp</th>
                                    <th className="py-3">Strategy</th>
                                    <th className="py-3">Type</th>
                                    <th className="py-3">Price</th>
                                    <th className="py-3">Target</th>
                                    <th className="py-3">Stop-Loss</th>
                                    <th className="py-3">Environment</th>
                                    <th className="py-3 text-right">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {trades.map((t) => (
                                    <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                                        <td className="py-3 font-mono text-[10px]">{t.timestamp.replace('T', ' ').split('.')[0]}</td>
                                        <td className="py-3 font-semibold">{t.strategy}</td>
                                        <td className="py-3">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.direction === 'BUY' ? 'text-emerald-500' : 'text-red-500'}`}>
                                                {t.direction}
                                            </span>
                                        </td>
                                        <td className="py-3">Rs. {t.price.toFixed(2)}</td>
                                        <td className="py-3 text-emerald-500/80">Rs. {t.target.toFixed(2)}</td>
                                        <td className="py-3 text-red-500/80">Rs. {t.stop_loss.toFixed(2)}</td>
                                        <td className="py-3 font-bold uppercase text-[10px]">{t.mode}</td>
                                        <td className="py-3 text-right">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                                t.status === 'FILLED' ? 'bg-emerald-500/15 text-emerald-500' :
                                                t.status.startsWith('FAILED') ? 'bg-red-500/15 text-red-500' :
                                                'bg-amber-500/15 text-amber-500'
                                            }`}>
                                                {t.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};
