import React, { useEffect, useState, useMemo } from 'react';
import { db, ParsedSignal } from '../../database';
import { GreeksCalculatorService, OptionGreeks } from '../../services/GreeksCalculatorService';
import { Activity, RefreshCw, AlertTriangle, ShieldCheck, HelpCircle } from 'lucide-react';
import { useToast } from '../../components/shared/ToastProvider';
import { logger } from '../../utils/logger';
import { formatCurrency } from '../../utils/helpers';
import { MacroRegimePanel } from './widgets/MacroRegimePanel';
import { StrategyHealthPanel } from './widgets/StrategyHealthPanel';
import { LiquidityMonitorPanel } from './widgets/LiquidityMonitorPanel';
import { MonteCarloProbabilityPanel } from './widgets/MonteCarloProbabilityPanel';
import { OptionsLensHub } from './OptionsLens/OptionsLensHub';




interface GreekRow {
    signal: ParsedSignal;
    greeks: OptionGreeks | null;
    isLoading: boolean;
}

export const OptionsGreeksDashboard: React.FC = () => {
    const { toast } = useToast();
    const [rows, setRows] = useState<GreekRow[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const loadGreeks = async () => {
        setIsRefreshing(true);
        try {
            // Fetch active option signals
            const activeSignals = await db.parsed_signals
                .where('status')
                .anyOf('ACTIVE', 'NEEDS_REVIEW')
                .toArray();

            // Filter for option contracts
            const optionSignals = activeSignals.filter(sig => 
                /(?:CE|PE)/i.test(sig.instrument)
            );

            if (optionSignals.length === 0) {
                setRows([]);
                setIsRefreshing(false);
                setLastUpdated(new Date());
                return;
            }

            // Create initial rows with loading state
            const initialRows = optionSignals.map(sig => ({
                signal: sig,
                greeks: null,
                isLoading: true
            }));
            setRows(initialRows);

            // Compute Greeks in parallel
            const computed = await Promise.all(
                optionSignals.map(async (sig) => {
                    const g = await GreeksCalculatorService.computeAllGreeks(sig);
                    return {
                        signal: sig,
                        greeks: g,
                        isLoading: false
                    };
                })
            );

            setRows(computed);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('Error loading options greeks', err);
            toast.error('Failed to calculate option Greeks');
        } finally {
            setIsRefreshing(false);
        }
    };

    // Auto-refresh every 5 minutes during market hours
    useEffect(() => {
        loadGreeks();

        const interval = setInterval(() => {
            const now = new Date();
            const day = now.getDay();
            const hour = now.getHours();
            const min = now.getMinutes();
            const timeVal = hour * 100 + min;

            // Indian Market Hours: Mon-Fri, 9:15 to 15:30 IST
            const isWeekday = day >= 1 && day <= 5;
            const isMarketHours = timeVal >= 915 && timeVal <= 1530;

            if (isWeekday && isMarketHours) {
                logger.log('OptionsGreeks', 'Auto-refreshing option greeks...');
                loadGreeks();
            }
        }, 5 * 60 * 1000); // 5 minutes

        return () => clearInterval(interval);
    }, []);

    // Summary Calculations
    const portfolioTotals = useMemo(() => {
        let totalThetaDecay = 0;
        let deltaWeightedExposure = 0;
        let thetaAlertsCount = 0;

        rows.forEach(r => {
            if (r.greeks) {
                totalThetaDecay += r.greeks.thetaRupees;
                deltaWeightedExposure += r.greeks.delta;
                if (r.greeks.thetaAlert) thetaAlertsCount++;
            }
        });

        return {
            totalThetaDecay: parseFloat(totalThetaDecay.toFixed(2)),
            avgDelta: rows.length > 0 ? parseFloat((deltaWeightedExposure / rows.length).toFixed(3)) : 0,
            thetaAlertsCount
        };
    }, [rows]);

    return (
        <div className="p-6 bg-slate-950 text-slate-100 rounded-[28px] border border-slate-800 h-full flex flex-col gap-6">
            {/* Macro Regime Panel */}
            <MacroRegimePanel />

            {/* Options Lens Hub - Dealer Net GEX, Gamma Walls & IV Crush Defense */}
            <OptionsLensHub defaultSymbol="NIFTY" />

            {/* Strategy Health Panel (Loop Validator) */}
            <StrategyHealthPanel />

            {/* Liquidity Monitor Panel */}
            <LiquidityMonitorPanel />

            {/* Monte Carlo Probability Panel */}
            <MonteCarloProbabilityPanel />




            {/* Header */}

            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-500/10 text-purple-400 rounded-2xl border border-purple-500/20">
                        <Activity size={24} />
                    </div>
                    <div>
                        <h2 className="text-base sm:text-xl font-bold tracking-wide">Options Greeks Command Center</h2>
                        <p className="hidden md:block text-xs text-slate-400 line-clamp-1" title="Real-time Black-Scholes Greeks for active signals. Auto-refreshes every 5 mins during trading hours.">
                            Real-time Black-Scholes Greeks for active signals. Auto-refreshes every 5 mins during trading hours.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 sm:gap-4">
                    {lastUpdated && (
                        <span className="hidden sm:inline text-xs text-slate-500">
                            Last Updated: {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                    <button 
                        className="flex items-center justify-center gap-2 p-2 sm:px-4 sm:py-2 aspect-square sm:aspect-auto bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0"
                        onClick={loadGreeks}
                        disabled={isRefreshing}
                        title="Refresh Option Greeks"
                        aria-label="Refresh Option Greeks"
                    >
                        <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </div>
            </div>

            {/* Quick Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex justify-between items-center">
                    <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Options Signals</span>
                        <div className="text-2xl font-black mt-1 text-white">{rows.length}</div>
                    </div>
                    <div className="p-2.5 bg-slate-800/80 rounded-xl text-indigo-400">
                        <Activity size={18} />
                    </div>
                </div>
                <div className={`bg-slate-900/40 border rounded-2xl p-4 flex justify-between items-center transition-all ${portfolioTotals.totalThetaDecay > 1000 ? 'border-rose-500/20 bg-rose-500/5' : 'border-slate-800/80'}`}>
                    <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Est. Daily Theta Decay</span>
                        <div className={`text-2xl font-black mt-1 ${portfolioTotals.totalThetaDecay > 1000 ? 'text-rose-400' : 'text-amber-400'}`}>
                            ₹{formatCurrency(portfolioTotals.totalThetaDecay)}
                        </div>
                    </div>
                    <div className={`p-2.5 rounded-xl ${portfolioTotals.totalThetaDecay > 1000 ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-800/80 text-amber-400'}`}>
                        <AlertTriangle size={18} />
                    </div>
                </div>
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex justify-between items-center">
                    <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Theta Alerts Active</span>
                        <div className="text-2xl font-black mt-1 text-emerald-400">
                            {portfolioTotals.thetaAlertsCount} / {rows.length}
                        </div>
                    </div>
                    <div className="p-2.5 bg-slate-800/80 rounded-xl text-emerald-400">
                        <ShieldCheck size={18} />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                            <th className="py-3 px-4">Instrument</th>
                            <th className="py-3 px-4">Spot Price</th>
                            <th className="py-3 px-4">Strike</th>
                            <th className="py-3 px-4">Type</th>
                            <th className="py-3 px-4 text-center">DTE</th>
                            <th className="py-3 px-4 text-right">Delta</th>
                            <th className="py-3 px-4 text-right">Gamma</th>
                            <th className="py-3 px-4 text-right">Theta Decay/Day</th>
                            <th className="py-3 px-4 text-right">Vega</th>
                            <th className="py-3 px-4 text-center">Risk Alert</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/50 text-sm">
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="py-8 text-center text-slate-500">
                                    No active option trade signals requiring Greek calculations.
                                </td>
                            </tr>
                        ) : (
                            rows.map(({ signal, greeks, isLoading }, idx) => {
                                if (isLoading) {
                                    return (
                                        <tr key={signal.id || idx} className="animate-pulse">
                                            <td className="py-4 px-4 font-semibold text-slate-400">{signal.instrument}</td>
                                            <td colSpan={9} className="py-4 px-4 text-right text-xs text-slate-600">Calculating Black-Scholes metrics...</td>
                                        </tr>
                                    );
                                }

                                if (!greeks) {
                                    return (
                                        <tr key={signal.id || idx} className="text-slate-500">
                                            <td className="py-4 px-4 font-semibold">{signal.instrument}</td>
                                            <td colSpan={9} className="py-4 px-4 text-center text-xs text-slate-600">Could not resolve scrip codes.</td>
                                        </tr>
                                    );
                                }

                                const isHighDecay = greeks.thetaRupees > 1000;
                                const isMediumDecay = greeks.thetaRupees > 500 && greeks.thetaRupees <= 1000;

                                return (
                                    <tr 
                                        key={signal.id || idx} 
                                        className={`transition-colors hover:bg-slate-900/20 ${isHighDecay ? 'bg-rose-500/5 hover:bg-rose-500/10' : isMediumDecay ? 'bg-amber-500/5 hover:bg-amber-500/10' : ''}`}
                                    >
                                        <td className="py-4 px-4 font-semibold text-white">{signal.instrument}</td>
                                        <td className="py-4 px-4">₹{formatCurrency(greeks.spotPrice)}</td>
                                        <td className="py-4 px-4 font-mono">₹{greeks.strike}</td>
                                        <td className="py-4 px-4">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${greeks.optionType === 'CE' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                                                {greeks.optionType}
                                            </span>
                                        </td>
                                        <td className="py-4 px-4 text-center font-semibold">
                                            {greeks.dte} days
                                        </td>
                                        <td className={`py-4 px-4 text-right font-mono font-medium ${greeks.delta > 0.6 ? 'text-emerald-400' : greeks.delta < -0.6 ? 'text-rose-400' : 'text-slate-300'}`}>
                                            {greeks.delta}
                                        </td>
                                        <td className="py-4 px-4 text-right font-mono text-slate-300">{greeks.gamma}</td>
                                        <td className={`py-4 px-4 text-right font-mono font-bold ${isHighDecay ? 'text-rose-400' : isMediumDecay ? 'text-amber-400' : 'text-slate-300'}`}>
                                            -₹{greeks.thetaRupees}
                                        </td>
                                        <td className="py-4 px-4 text-right font-mono text-slate-300">{greeks.vega}</td>
                                        <td className="py-4 px-4 text-center">
                                            {greeks.thetaAlert ? (
                                                <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-rose-400">
                                                    <AlertTriangle size={14} />
                                                    <span>Theta Burn</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 font-semibold">
                                                    <ShieldCheck size={14} />
                                                    <span>Stable</span>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer / Educational Section */}
            <div className="flex items-start gap-3 bg-slate-900/20 border border-slate-900 rounded-2xl p-4 text-xs text-slate-400">
                <HelpCircle size={16} className="text-purple-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p className="font-semibold text-slate-300">Understanding Options Greeks</p>
                    <p>
                        <strong>Delta</strong> measures expected price change per ₹1 stock move. 
                        <strong>Gamma</strong> shows rate of change in Delta (acceleration). 
                        <strong>Theta</strong> represents the daily time decay (burn rate) of option value. 
                        <strong>Vega</strong> indicates sensitivity to a 1% shift in Implied Volatility.
                    </p>
                </div>
            </div>
        </div>
    );
};
export default OptionsGreeksDashboard;
