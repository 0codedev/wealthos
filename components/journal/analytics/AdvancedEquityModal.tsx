import React, { useMemo, useState } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { createPortal } from 'react-dom';
import { 
    X, TrendingUp, TrendingDown, Receipt, Target, 
    AlertTriangle, Activity, Zap, Info, BarChart3,
    ArrowRight, Ghost, Scale
} from 'lucide-react';
import { 
    AreaChart, Area, LineChart, Line, XAxis, YAxis, 
    CartesianGrid, Tooltip, ReferenceLine,
    ComposedChart, Legend, Bar
} from 'recharts';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { CustomTooltip } from '../../shared/CustomTooltip';

interface AdvancedEquityModalProps {
    isOpen: boolean;
    onClose: () => void;
    trades: Trade[];
    isVisible?: boolean;
}

type AnalyticsView = 'CORE_EQUITY' | 'MAE_MFE' | 'MISTAKE_IMPACT' | 'GHOST_LOST' | 'FEE_DRAIN' | 'FEE_VELOCITY' | 'PROFIT_FACTOR' | 'RECOVERY_DEPTH' | 'FORECAST' | 'SHARPE_SORTINO' | 'RECOVERY_MATRIX' | 'TRADE_VOLUMETRICS';

export const AdvancedEquityModal: React.FC<AdvancedEquityModalProps> = ({ isOpen, onClose, trades, isVisible = true }) => {
    const [activeView, setActiveView] = useState<AnalyticsView>('CORE_EQUITY');

    const analyticsData = useMemo(() => {
        if (!trades.length) return [];
        const sorted = [...trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        const dailyMap: Record<string, { gross: number; net: number; fees: number; ghostLoss: number; tradesCount: number; mistakeLoss: number; sumMAE: number; sumMFE: number; sumPnL: number }> = {};
        
        sorted.forEach(t => {
            const date = new Date(t.date).toLocaleDateString('en-CA'); // Robust YYYY-MM-DD grouping
            if (!dailyMap[date]) dailyMap[date] = { gross: 0, net: 0, fees: 0, ghostLoss: 0, tradesCount: 0, mistakeLoss: 0, sumMAE: 0, sumMFE: 0, sumPnL: 0 };
            
            const net = t.pnl || 0;
            const fees = t.fees || 0;
            const gross = net + fees;
            
            dailyMap[date].gross += gross;
            dailyMap[date].net += net;
            dailyMap[date].fees += fees;
            // Fallback check for multiple possible property names
            const legs = (t as any).legsCount || (t as any).legs || (t as any).totalLegs || 1;
            dailyMap[date].tradesCount += Number(legs);
            dailyMap[date].sumMAE += Math.abs(t.mae || 0);
            dailyMap[date].sumMFE += Math.abs(t.mfe || 0);
            dailyMap[date].sumPnL += Math.abs(net);

            if (t.mistakes && t.mistakes.length > 0 && net < 0) dailyMap[date].mistakeLoss += Math.abs(net);
            if (gross > 0 && net < 0) dailyMap[date].ghostLoss += Math.abs(net);
        });

        const history = Object.entries(dailyMap).sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());
        let peakNet = 0;
        const winners = trades.filter(t => (t.pnl || 0) > 0);
        const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + (t.pnl || 0), 0) / winners.length : 1;
        
        let rGross = 0, rNet = 0, rFees = 0, rGhost = 0, totalTrades = 0, rMistake = 0;
        let rMAE = 0, rMFE = 0, rAbsPnL = 0;

        const data = history.map(([date, daily], idx) => {
            rGross += daily.gross;
            rNet += daily.net;
            rFees += daily.fees;
            rGhost += daily.ghostLoss;
            rMistake += daily.mistakeLoss;
            totalTrades += daily.tradesCount;
            rMAE += daily.sumMAE;
            rMFE += daily.sumMFE;
            rAbsPnL += daily.sumPnL;

            if (rNet > peakNet) peakNet = rNet;
            const drawdown = peakNet - rNet;
            const recoveryRequired = drawdown / avgWin;

            // Simple Sharpe: Mean Daily Net / StdDev Daily Net
            const dailyReturns = history.slice(0, idx + 1).map(h => h[1].net);
            const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
            const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / dailyReturns.length;
            const stdDev = Math.sqrt(variance) || 1;
            const sharpe = (mean / stdDev) * Math.sqrt(252);

            return {
                date,
                gross: rGross,
                net: rNet,
                fees: rFees,
                ghost: rGhost,
                mistake: rMistake,
                sharpe: Number(sharpe.toFixed(2)),
                recoveryRequired: Number(recoveryRequired.toFixed(1)),
                ddNet: drawdown,
                ddNetInv: -drawdown,
                velocity: rFees / totalTrades,
                feeRatio: rGross > 0 ? (rFees / rGross) * 100 : 0,
                capture: rMFE > 0 ? (rAbsPnL / rMFE) * 100 : 0,
                heat: rMFE > 0 ? (rMAE / rMFE) * 100 : 0,
                tradesCount: daily.tradesCount,
                dailyNet: daily.net,
                dailyGross: daily.gross,
                dailyFees: daily.fees,
                dailyFrictionDrag: daily.gross !== 0 ? (daily.fees / Math.abs(daily.gross)) * 100 : 0,
                dailyEfficiency: daily.gross !== 0 ? (daily.net / Math.abs(daily.gross)) * 100 : 100,
                isForecast: false
            };
        });

        // Generate Forecast
        if (data.length > 0) {
            const last = data[data.length - 1];
            const avgDailyNet = last.net / data.length;
            const lastDate = new Date(last.date);
            // Parabolic Acceleration: Momentum factor (mild 0.5% daily acceleration on top of linear)
            const acceleration = avgDailyNet * 0.05; 

            for (let i = 1; i <= 30; i++) {
                const forecastDate = new Date(lastDate);
                forecastDate.setDate(lastDate.getDate() + i);
                data.push({
                    date: forecastDate.toISOString().split('T')[0],
                    net: last.net + (avgDailyNet * i),
                    forecast: last.net + (avgDailyNet * i),
                    compounding: last.net + (avgDailyNet * i) + (acceleration * Math.pow(i, 1.5)),
                    isForecast: true
                } as any);
            }
        }

        return data;
    }, [trades]);

    const stats = useMemo(() => {
        if (!analyticsData.length) return null;
        
        const ghostCount = trades.filter(t => (t.pnl || 0) < 0 && ((t.pnl || 0) + (t.fees || 0)) > 0).length;
        const mistakeCost = trades.filter(t => t.mistakes && t.mistakes.length > 0 && (t.pnl || 0) < 0).reduce((s, t) => s + Math.abs(t.pnl || 0), 0);
        const totalGross = trades.reduce((s, t) => s + (t.pnl || 0) + (t.fees || 0), 0);
        const totalFees = trades.reduce((s, t) => s + (t.fees || 0), 0);
        const efficiency = totalGross > 0 ? ((totalGross - totalFees) / totalGross) * 100 : 0;
        const avgFeePerTrade = totalFees / trades.length;

        const winners = trades.filter(t => (t.pnl || 0) > 0);
        const avgWinner = winners.length > 0 ? winners.reduce((s, t) => s + (t.pnl || 0), 0) / winners.length : 0;
        const recoveryCount = avgWinner > 0 ? Math.ceil(totalFees / avgWinner) : '∞';

        return { ghostCount, efficiency, avgFeePerTrade, recoveryCount, totalFees, totalGross, mistakeCost };
    }, [trades, analyticsData]);

    if (!isOpen) return null;

    const views: { id: AnalyticsView; label: string; icon: any; color: string }[] = [
        { id: 'CORE_EQUITY', label: 'Alpha vs Leakage', icon: Activity, color: 'emerald' },
        { id: 'RECOVERY_MATRIX', label: 'Recovery Matrix', icon: Target, color: 'rose' },
        { id: 'SHARPE_SORTINO', label: 'Risk-Adjusted Alpha', icon: Scale, color: 'violet' },
        { id: 'FORECAST', label: 'Growth Forecast', icon: TrendingUp, color: 'indigo' },
        { id: 'MAE_MFE', label: 'Capture Efficiency', icon: Target, color: 'sky' },
        { id: 'MISTAKE_IMPACT', label: 'Mistake Impact', icon: AlertTriangle, color: 'rose' },
        { id: 'GHOST_LOST', label: 'Ghost Losses', icon: Ghost, color: 'indigo' },
        { id: 'FEE_DRAIN', label: 'Fee Drain Intensity', icon: Receipt, color: 'amber' },
        { id: 'FEE_VELOCITY', label: 'Trade Velocity', icon: Zap, color: 'rose' },
        { id: 'PROFIT_FACTOR', label: 'Cost-to-Win Ratio', icon: Scale, color: 'sky' },
        { id: 'RECOVERY_DEPTH', label: 'Recovery Debt', icon: Target, color: 'violet' },
        { id: 'TRADE_VOLUMETRICS', label: 'Trade Volumetrics', icon: Activity, color: 'indigo' },
    ];

    return createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 md:p-6 lg:p-12">
                {/* Backdrop */}
                <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl" onClick={onClose} />

                {/* Modal Content */}
                <div className="relative w-full h-full bg-slate-900/80 border border-white/10 rounded-none md:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
                                <BarChart3 className="text-indigo-400" size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-black text-white tracking-tight uppercase italic">Advanced Alpha Intelligence</h2>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Deep Mechanical Cost Analysis</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
                            <X size={24} />
                        </button>
                    </div>

                    {/* Quick Stats Pulse Bar */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/5 border-b border-white/5">
                        <div className="p-4 bg-slate-900/50">
                            <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Ghost Losses Killed</p>
                            <p className="text-xl font-black text-white font-mono">{stats?.ghostCount} <span className="text-xs text-rose-500 tracking-tighter">TRADES</span></p>
                        </div>
                        <div className="p-4 bg-slate-900/50">
                            <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Fee Recovery Debt</p>
                            <p className="text-xl font-black text-white font-mono">{stats?.recoveryCount} <span className="text-xs text-amber-500 tracking-tighter">WINNERS</span></p>
                        </div>
                        <div className="p-4 bg-slate-900/50">
                            <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Alpha Efficiency</p>
                            <p className="text-xl font-black text-emerald-400 font-mono">{stats?.efficiency.toFixed(1)}%</p>
                        </div>
                        <div className="p-4 bg-slate-900/50">
                            <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Total Fee Leakage</p>
                            <p className="text-xl font-black text-rose-400 font-mono">-{formatCurrency(stats?.totalFees || 0)}</p>
                        </div>
                    </div>

                    {/* Main Analytics Container */}
                    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                        {/* Sidebar: Insights */}
                        <div className="w-full lg:w-[357.5px] border-r border-white/5 p-10 bg-slate-900/40 flex flex-col gap-8 overflow-y-auto no-scrollbar">
                            <div className="space-y-8">
                                <h3 className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.2em] flex items-center gap-3">
                                    <Info size={16} /> AI Analysis Depth
                                </h3>
                                
                                <div className="space-y-4">
                                    {activeView === 'TRADE_VOLUMETRICS' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                <span className="text-indigo-400 font-bold uppercase">Trade Volumetrics</span> correlates your activity levels with your outcomes.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-indigo-500/30 rounded-sm" />
                                                    <span className="text-[10px] text-indigo-400">TRADES TRIGGERED (Legs)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-amber-500 rounded-full" />
                                                    <span className="text-[10px] text-amber-500">MECHANICAL FRICTION (Fees)</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed border-l-2 border-indigo-500/30 pl-3">
                                                Look for the "Sweet Spot"—the number of trades where your PnL is highest. The <span className="text-amber-500 font-bold">Amber Line</span> shows your "Mechanical Drag"—if this line is rising faster than your PnL, you're overtrading.
                                            </p>
                                        </div>
                                    )}

                                    {activeView === 'RECOVERY_MATRIX' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                The <span className="text-rose-400 font-bold uppercase tracking-tighter">Recovery Matrix</span> calculates the "Mental Load" to reach a new ATH.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-rose-500/50 rounded-sm" />
                                                    <span className="text-[10px] text-rose-300 font-bold">WINNING TRADES REQUIRED</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-500 rounded-full" />
                                                    <span className="text-[10px] text-emerald-500/50">EQUITY BASELINE</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed italic border-l-2 border-rose-500/30 pl-3">
                                                Based on your <span className="text-white font-bold italic tracking-tighter">Avg Win Size</span>, this is the mountain you must climb to recover the current drawdown.
                                            </p>
                                        </div>
                                    )}

                                    {activeView === 'SHARPE_SORTINO' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                <span className="text-violet-400 font-bold uppercase">Risk-Adjusted Alpha</span> measures the "quality" of your returns.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-violet-400 rounded-full shadow-[0_0_8px_rgba(167,139,250,0.5)]" />
                                                    <span className="text-[10px] text-violet-300 font-bold">SHARPE RATIO (Efficiency)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-500 rounded-full" />
                                                    <span className="text-[10px] text-emerald-500/50">NET EQUITY (Past)</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                A <span className="text-white font-bold">Sharpe {">"} 1.0</span> is good. <span className="text-violet-400 font-bold italic underline">Sharpe {">"} 2.0</span> is institutional grade. It tells you if your profits are worth the psychological stress.
                                            </p>
                                        </div>
                                    )}

                                    {activeView === 'FORECAST' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                The <span className="text-indigo-400 font-bold uppercase tracking-tighter">Compounding Forecast</span> uses your historical daily edge to project future wealth.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-400 rounded-full" />
                                                    <span className="text-[10px] text-emerald-400 font-bold">ACTUAL EQUITY (Past)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-indigo-400 border-t border-dashed border-indigo-400" />
                                                    <span className="text-[10px] text-indigo-400 font-bold italic">LINEAR REFERENCE</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
                                                    <span className="text-[10px] text-sky-400 font-bold tracking-tighter uppercase italic">Natural Growth (Compounding)</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed italic border-l-2 border-indigo-500/30 pl-3">
                                                Linear assumes fixed profit. <span className="text-sky-400 font-bold">Natural Growth</span> assumes you compound gains, creating that characteristic momentum curve seen in top-tier portfolios.
                                            </p>
                                        </div>
                                    )}

                                    {activeView === 'MAE_MFE' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                <span className="text-sky-400 font-bold uppercase">Capture Efficiency</span> tracks how much profit you "leave on the table."
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-400 rounded-full" />
                                                    <span className="text-[10px] text-emerald-400 font-bold">ALPHA CAPTURE %</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-rose-500 rounded-full" />
                                                    <span className="text-[10px] text-rose-500 font-bold">RISK HEAT (MAE)</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                A <span className="text-white">High Capture Rate</span> means you exit near the peak. <span className="text-rose-400">High Risk Heat</span> means you let trades go too deep into red before they turn around.
                                            </p>
                                        </div>
                                    )}

                                    {activeView === 'CORE_EQUITY' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                The <span className="text-emerald-400 font-bold uppercase">Alpha vs Leakage</span> dashboard is your primary health check. 
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-400 rounded-full" />
                                                    <span className="text-[10px] text-slate-300 font-bold">NET EQUITY (Actual Wealth)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-slate-500 border-t border-dashed border-slate-400" />
                                                    <span className="text-[10px] text-slate-500">GROSS POTENTIAL (No Costs)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-amber-500 rounded-full" />
                                                    <span className="text-[10px] text-amber-500 font-bold">CUMULATIVE FEES</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 mt-3 leading-relaxed italic">
                                                The gap between the dashed line and the emerald area is the "Opportunity Gap"—capital that could have been used for compounding.
                                            </p>
                                        </div>
                                    )}
                                    {activeView === 'FEE_DRAIN' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                The <span className="text-rose-500 font-bold uppercase">Fee Drain Intensity</span> view exposes how much of your daily work is being consumed by overhead.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-amber-500/50 rounded-sm" />
                                                    <span className="text-[10px] text-slate-300">DAILY FEE BARS</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-rose-500 rounded-full" />
                                                    <span className="text-[10px] text-rose-500 font-bold">LEAKAGE RATIO %</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                If the red line stays above 50%, you are essentially a "Non-Profit Trader"—working exclusively to pay the clearing house.
                                            </p>
                                        </div>
                                    )}
                                    {activeView === 'MISTAKE_IMPACT' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                The <span className="text-rose-500 font-bold uppercase">Mistake Impact</span> chart is a brutal mirror of your discipline.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-rose-500 rounded-full shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                                                    <span className="text-[10px] text-rose-400 font-bold">CUMULATIVE MISTAKE LOSS</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-500/30 rounded-full" />
                                                    <span className="text-[10px] text-slate-500">NET EQUITY (Reference)</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                Isolates damage from <span className="text-white font-bold uppercase italic tracking-tighter">tagged errors</span>. This is your "Self-Inflicted Tax".
                                            </p>
                                        </div>
                                    )}
                                    {activeView === 'GHOST_LOST' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                <span className="text-indigo-400 font-bold uppercase italic">Ghost Losses</span> are the most psychologically damaging events in trading.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-indigo-500 rounded-full" />
                                                    <span className="text-[10px] text-indigo-400 font-bold">CUMULATIVE GHOST LOSS</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-500 rounded-full" />
                                                    <span className="text-[10px] text-emerald-500/50">CURRENT NET (Reference)</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                These occur when your <span className="text-white">Price Action Thesis</span> was correct (Gross was positive), but the <span className="text-indigo-400">Mechanical Load</span> (Fees + Slippage) turned it into a red trade.
                                            </p>
                                        </div>
                                    )}
                                    {activeView === 'FEE_VELOCITY' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                <span className="text-rose-500 font-bold uppercase">Trade Velocity</span> monitors the speed of accumulation.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-rose-500 rounded-full" />
                                                    <span className="text-[10px] text-rose-500 font-bold">FEE PER TRADE (Velocity)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-slate-500" />
                                                    <span className="text-[10px] text-slate-500">SYSTEM AVERAGE BASELINE</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                If the <span className="text-rose-400">Velocity Curve</span> is accelerating, you are likely over-trading in a choppy environment.
                                            </p>
                                        </div>
                                    )}
                                    {activeView === 'PROFIT_FACTOR' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                The <span className="text-sky-400 font-bold uppercase">Cost-to-Win Ratio</span> calculates your "Alpha Retention Rate."
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-emerald-500/30 rounded-sm" />
                                                    <span className="text-[10px] text-emerald-400">GROSS ALPHA (Theoretical)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-indigo-500 rounded-sm" />
                                                    <span className="text-[10px] text-white">NET RETAINED (Realized)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-amber-500 rounded-full" />
                                                    <span className="text-[10px] text-amber-500 font-bold">COST RATIO %</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                A low retention rate means you are highly skilled but inefficiently structured. You are "Churning" capital instead of growing it.
                                            </p>
                                        </div>
                                    )}
                                    {activeView === 'RECOVERY_DEPTH' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                <span className="text-violet-400 font-bold uppercase">Recovery Debt</span> measures the true psychological burden.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-rose-500/30 rounded-full" />
                                                    <span className="text-[10px] text-rose-400">STATISTICAL DRAWDOWN</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-amber-500 rounded-full" />
                                                    <span className="text-[10px] text-amber-500 font-bold">CUMULATIVE FEE DEBT</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                To reach a new ATH, you need to make back the loss PLUS the cost of the trades used to recover. This is the "Shadow Drawdown."
                                            </p>
                                        </div>
                                    )}
                                    {activeView === 'TRADE_VOLUMETRICS' && (
                                        <div>
                                            <p className="text-xs text-slate-400 leading-relaxed mb-3">
                                                The <span className="text-amber-500 font-bold uppercase">Mechanical Drag Index</span> identifies execution efficiency.
                                            </p>
                                            <div className="space-y-3 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-indigo-500/30 rounded-sm" />
                                                    <span className="text-[10px] text-indigo-400">LEGS TRIGGERED (Volume)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-amber-500 rounded-full" />
                                                    <span className="text-[10px] text-amber-500 font-bold">MECHANICAL DRAG %</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-yellow-400 border-t border-dotted border-yellow-400" />
                                                    <span className="text-[10px] text-yellow-400 font-bold italic">RAW FRICTION (Fees)</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-1 bg-emerald-500 rounded-full" />
                                                    <span className="text-[10px] text-emerald-400">DAILY NET PNL</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-slate-500 leading-relaxed">
                                                The amber line tracks friction relative to Gross, while the **Yellow Dotted Line** shows absolute daily fees. If drag stays above **20%**, you are overtrading.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                                    <p className="text-[10px] font-bold text-indigo-400 uppercase mb-2">Strategy Verdict</p>
                                    <p className="text-xs text-slate-300">
                                        {stats && stats.efficiency < 40 
                                            ? "Critical: Your fee-load is too high. Consider swinging longer or consolidating orders." 
                                            : "Healthy: Cost impact is within institutional norms."}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-auto hidden lg:block">
                                <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                                    <div className="flex items-center gap-2 text-emerald-400 mb-2">
                                        <Zap size={14} />
                                        <span className="text-[10px] font-bold uppercase tracking-widest">Growth Path</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 leading-normal">
                                        Reducing fee-load by just 20% would add <span className="text-emerald-400 font-bold">{formatCurrency((stats?.totalFees || 0) * 0.2)}</span> to your current equity.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Main Chart Section */}
                        <div className="flex-1 p-6 flex flex-col gap-6 relative min-w-0">
                            {/* View Selector Pills */}
                            <div className="flex items-center gap-2 overflow-x-auto pb-4 no-scrollbar flex-nowrap scroll-smooth">
                                <div className="flex items-center gap-2 flex-nowrap">
                                    {views.map(view => (
                                        <button
                                            key={view.id}
                                            onClick={() => setActiveView(view.id)}
                                            className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all whitespace-nowrap flex-shrink-0
                                                ${activeView === view.id 
                                                    ? `bg-${view.color}-500 text-white shadow-lg shadow-${view.color}-500/20 ring-2 ring-${view.color}-500/50` 
                                                    : 'bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300'}`}
                                        >
                                            <view.icon size={14} />
                                            {view.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Chart Area */}
                            <div className="flex-1 w-full bg-slate-950/40 border border-white/5 rounded-2xl p-6 shadow-inner relative overflow-hidden">
                                <SafeChartContainer>
                                    <ComposedChart data={activeView === 'FORECAST' ? analyticsData : analyticsData.filter(d => !d.isForecast)} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                                        <defs>
                                            <linearGradient id="mainCurve" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="ghostCurve" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                        {activeView !== 'TRADE_VOLUMETRICS' && (
                                            <YAxis 
                                                tick={{ fontSize: 10, fill: '#64748b' }} 
                                                axisLine={false} 
                                                tickLine={false} 
                                                tickFormatter={(val) => `₹${val / 1000}k`} 
                                            />
                                        )}
                                        <Tooltip content={<CustomTooltip />} />
                                        <ReferenceLine y={0} stroke="#475569" strokeWidth={1} />
                                        
                                        {activeView === 'RECOVERY_MATRIX' && (
                                            <>
                                                <Area type="monotone" dataKey="net" stroke="#10b981" strokeWidth={4} fill="url(#mainCurve)" name="Net Equity" isAnimationActive={isVisible} />
                                                <Bar 
                                                    yAxisId="right"
                                                    dataKey="recoveryRequired" 
                                                    fill="#f43f5e" 
                                                    radius={[4, 4, 0, 0]} 
                                                    opacity={0.6}
                                                    name="Trades to Recovery" 
                                                    isAnimationActive={isVisible}
                                                />
                                                <YAxis 
                                                    yAxisId="right" 
                                                    orientation="right" 
                                                    tick={{ fontSize: 10, fill: '#f43f5e' }} 
                                                    axisLine={false}
                                                    tickLine={false}
                                                />
                                            </>
                                        )}

                                        {activeView === 'SHARPE_SORTINO' && (
                                            <>
                                                <Area type="monotone" dataKey="net" stroke="#10b981" strokeWidth={2} fill="url(#mainCurve)" name="Net Equity" isAnimationActive={isVisible} />
                                                <Line 
                                                    yAxisId="right"
                                                    type="monotone" 
                                                    dataKey="sharpe" 
                                                    stroke="#a78bfa" 
                                                    strokeWidth={2} 
                                                    name="Sharpe Ratio (Rolling)" 
                                                    dot={false} 
                                                    isAnimationActive={isVisible}
                                                />
                                                <YAxis 
                                                    yAxisId="right" 
                                                    orientation="right" 
                                                    domain={[-1, 5]}
                                                    tick={{ fontSize: 10, fill: '#a78bfa' }} 
                                                    axisLine={false}
                                                    tickLine={false}
                                                />
                                            </>
                                        )}

                                        {activeView === 'FORECAST' && (
                                            <>
                                                <Area type="monotone" dataKey="net" stroke="#10b981" strokeWidth={2} fill="url(#mainCurve)" name="Historical Equity" isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="forecast" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" name="Linear Reference" dot={false} opacity={0.5} isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="compounding" stroke="#38bdf8" strokeWidth={2} name="Natural Compounding" dot={false} animationDuration={2000} isAnimationActive={isVisible} />
                                            </>
                                        )}

                                        {activeView === 'MAE_MFE' && (
                                            <>
                                                <Area type="monotone" dataKey="capture" stroke="#10b981" strokeWidth={2} fill="rgba(16, 185, 129, 0.1)" name="Alpha Capture Rate (%)" isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="heat" stroke="#f43f5e" strokeWidth={2} name="Risk Heat (MAE) %" dot={false} isAnimationActive={isVisible} />
                                                <YAxis 
                                                    yAxisId="right" 
                                                    orientation="right" 
                                                    domain={[0, 100]}
                                                    tick={{ fontSize: 10, fill: '#64748b' }} 
                                                    tickFormatter={(v) => `${v}%`} 
                                                    axisLine={false}
                                                    tickLine={false}
                                                />
                                            </>
                                        )}

                                        {activeView === 'MISTAKE_IMPACT' && (
                                            <>
                                                <Area type="monotone" dataKey="mistake" stroke="#f43f5e" strokeWidth={2} fill="rgba(244, 63, 94, 0.1)" name="Discipline Leakage" isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="net" stroke="#10b981" strokeWidth={2} strokeDasharray="3 3" name="Actual Net" dot={false} opacity={0.5} isAnimationActive={isVisible} />
                                            </>
                                        )}

                                        {activeView === 'CORE_EQUITY' && (
                                            <>
                                                <Area type="monotone" dataKey="net" stroke="#10b981" strokeWidth={2} fill="url(#mainCurve)" name="Net Equity" isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="gross" stroke="#94a3b8" strokeWidth={1} strokeDasharray="5 5" name="Gross Potential" dot={false} isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="fees" stroke="#f59e0b" strokeWidth={2} name="Fee Load" dot={false} isAnimationActive={isVisible} />
                                            </>
                                        )}

                                        {activeView === 'FEE_DRAIN' && (
                                            <>
                                                <Bar dataKey="fees" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Daily Fee Drain" opacity={0.3} isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="feeRatio" stroke="#f43f5e" strokeWidth={2} yAxisId="right" name="Leakage Ratio (%)" isAnimationActive={isVisible} />
                                                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#f43f5e' }} tickFormatter={(v) => `${v}%`} />
                                            </>
                                        )}

                                        {activeView === 'GHOST_LOST' && (
                                            <>
                                                <Area type="monotone" dataKey="ghost" stroke="#6366f1" strokeWidth={4} fill="url(#ghostCurve)" name="Ghost Losses" isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="net" stroke="#10b981" strokeWidth={2} name="Current Net" dot={false} isAnimationActive={isVisible} />
                                            </>
                                        )}

                                        {activeView === 'PROFIT_FACTOR' && (
                                            <>
                                                <Bar dataKey="gross" fill="#10b981" radius={[4, 4, 0, 0]} name="Gross Alpha" opacity={0.2} isAnimationActive={isVisible} />
                                                <Bar dataKey="net" fill="#6366f1" radius={[4, 4, 0, 0]} name="Net Retained" opacity={0.8} isAnimationActive={isVisible} />
                                                <Line 
                                                    yAxisId="right"
                                                    type="monotone" 
                                                    dataKey="feeRatio" 
                                                    stroke="#f59e0b" 
                                                    strokeWidth={2} 
                                                    name="Cost-to-Alpha Ratio (%)" 
                                                    dot={false} 
                                                    isAnimationActive={isVisible}
                                                />
                                                <YAxis 
                                                    yAxisId="right" 
                                                    orientation="right" 
                                                    domain={[0, 100]}
                                                    tick={{ fontSize: 10, fill: '#f59e0b' }} 
                                                    tickFormatter={(v) => `${v}%`} 
                                                    axisLine={false}
                                                    tickLine={false}
                                                />
                                            </>
                                        )}

                                        {activeView === 'FEE_VELOCITY' && (
                                            <>
                                                <Area type="monotone" dataKey="velocity" stroke="#f43f5e" strokeWidth={2} fill="rgba(244, 63, 94, 0.1)" name="Fee Velocity (per Trade)" isAnimationActive={isVisible} />
                                                <ReferenceLine y={stats?.avgFeePerTrade} stroke="#94a3b8" label="Avg Fee Target" />
                                            </>
                                        )}

                                        {activeView === 'TRADE_VOLUMETRICS' && (
                                            <>
                                                <YAxis 
                                                    yAxisId="left"
                                                    orientation="left"
                                                    tick={{ fontSize: 10, fill: '#6366f1' }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    width={30}
                                                    label={{ value: 'Legs', angle: -90, position: 'insideLeft', fill: '#6366f1', fontSize: 10, fontWeight: 'bold' }}
                                                />
                                                <YAxis 
                                                    yAxisId="percentage"
                                                    orientation="right"
                                                    tick={{ fontSize: 10, fill: '#f59e0b' }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    domain={[0, 'auto']}
                                                    tickFormatter={(v) => `${Math.round(v)}%`}
                                                    width={50}
                                                />
                                                <Bar 
                                                    yAxisId="left"
                                                    dataKey="tradesCount" 
                                                    fill="#6366f1" 
                                                    radius={[4, 4, 0, 0]} 
                                                    name="Legs Triggered" 
                                                    opacity={0.25} 
                                                    isAnimationActive={isVisible}
                                                />
                                                <Line 
                                                    yAxisId="right"
                                                    type="monotone" 
                                                    dataKey="dailyNet" 
                                                    stroke="#10b981" 
                                                    strokeWidth={1} 
                                                    name="Daily Net PnL" 
                                                    dot={{ fill: '#10b981', r: 2 }} 
                                                    isAnimationActive={isVisible}
                                                />
                                                <ReferenceLine yAxisId="right" y={0} stroke="#94a3b8" strokeDasharray="3 3" opacity={0.5} />
                                                <Line 
                                                    yAxisId="right"
                                                    type="monotone" 
                                                    dataKey="dailyGross" 
                                                    stroke="#94a3b8" 
                                                    strokeWidth={1.25} 
                                                    strokeDasharray="5 5"
                                                    name="Daily Gross Potential" 
                                                    dot={false} 
                                                    opacity={0.5}
                                                    isAnimationActive={isVisible}
                                                />
                                                <Line 
                                                    yAxisId="percentage"
                                                    type="monotone" 
                                                    dataKey="dailyFrictionDrag" 
                                                    stroke="#f59e0b" 
                                                    strokeWidth={1} 
                                                    name="Alpha Retention Impact (%)" 
                                                    dot={{ fill: '#f59e0b', r: 2 }} 
                                                    isAnimationActive={isVisible}
                                                />
                                                <ReferenceLine yAxisId="percentage" y={20} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'DRAG CAP', position: 'insideTopRight', fill: '#f59e0b', fontSize: 9 }} opacity={0.3} />
                                                <Line 
                                                    yAxisId="right"
                                                    type="monotone" 
                                                    dataKey="dailyFees" 
                                                    stroke="#fbbf24" 
                                                    strokeWidth={1.5} 
                                                    strokeDasharray="3 3"
                                                    name="Raw Friction (Fees)" 
                                                    dot={false} 
                                                    isAnimationActive={isVisible}
                                                />
                                                <YAxis 
                                                    yAxisId="right" 
                                                    orientation="right" 
                                                    tick={{ fontSize: 10, fill: '#10b981' }} 
                                                    tickFormatter={(v) => `₹${Math.round(v/100)/10}k`} 
                                                    axisLine={false}
                                                    tickLine={false}
                                                    width={50}
                                                />
                                            </>
                                        )}

                                        {activeView === 'RECOVERY_DEPTH' && (
                                            <>
                                                <Area type="monotone" dataKey="ddNetInv" stroke="#f43f5e" strokeWidth={2} fill="rgba(244, 63, 94, 0.4)" name="Statistical Drawdown" isAnimationActive={isVisible} />
                                                <Line type="monotone" dataKey="fees" stroke="#f59e0b" strokeWidth={2} name="Cumulative Fee Debt" dot={false} isAnimationActive={isVisible} />
                                                <YAxis 
                                                    tick={{ fontSize: 10, fill: '#64748b' }} 
                                                    axisLine={false} 
                                                    tickLine={false} 
                                                    tickFormatter={(val) => val === 0 ? '0' : `₹${Math.abs(val / 1000)}k`} 
                                                />
                                            </>
                                        )}
                                    </ComposedChart>
                                </SafeChartContainer>
                            </div>
                        </div>
                    </div>
                </div>
            </div>,
        document.body
    );
};
