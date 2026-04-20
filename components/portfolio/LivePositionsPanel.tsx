import React, { useState, useEffect } from 'react';
import { dhanBrokerService, DhanPositionResponse } from '../../services/DhanBrokerService';
import { Activity, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Skull, Shuffle, XCircle, Compass, Shield } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import { useDhanStore } from '../../store/dhanStore';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { portfolioGreeksService, PortfolioGreeks } from '../../services/PortfolioGreeksService';
import { EmptyState } from '../shared/EmptyState';
import { formatINR } from '../../utils/indianFormatter';
import { optionChainService } from '../../services/OptionChainService';
import { quantGreeksService } from '../../services/QuantGreeksService';
import { triggerHapticImpact, triggerHapticNotification } from '../../utils/haptics';
import { PortfolioVaRPanel } from '../alpha/widgets/PortfolioVaRPanel';


interface LivePositionsPanelProps {
    formatCurrency: (val: number) => string;
    isPrivacyMode: boolean;
}

export const LivePositionsPanel: React.FC<LivePositionsPanelProps> = ({ isPrivacyMode }) => {
    const { toast } = useToast();
    const { positions, isLoadingPositions: loading, error, fetchPositions } = useDhanStore(
        useShallow(state => ({
            positions: state.positions,
            isLoadingPositions: state.isLoadingPositions,
            error: state.error,
            fetchPositions: state.fetchPositions
        }))
    );
    const [actionLoading, setActionLoading] = useState(false);
    const [tiltCountdown, setTiltCountdown] = useState<number | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [greeks, setGreeks] = useState<PortfolioGreeks | null>(null);
    const [loadingGreeks, setLoadingGreeks] = useState(false);
    const [signals, setSignals] = useState<Record<string, { holdSignal: boolean; exitTriggers: string[]; exitUrgency: 'NORMAL' | 'URGENT' }>>({});

    const getUnderlyingSymbol = (tradingSymbol: string): string => {
        const match = tradingSymbol.match(/^([A-Z]+)/);
        return match ? match[1] : tradingSymbol;
    };

    useEffect(() => {
        const evaluateSignals = async () => {
            const newSignals: typeof signals = {};
            for (const p of positions) {
                if (p.netQty === 0) continue;
                const underlying = getUnderlyingSymbol(p.tradingSymbol);
                try {
                    const snapshot = await optionChainService.fetchOptionChain(underlying);
                    if (snapshot) {
                        const currentQCS = await quantGreeksService.computeQCS(underlying, 5.0, snapshot, 50);
                        const mockEntryQCS = {
                            qcs: 5.0,
                            grade: 'NEUTRAL' as const,
                            components: { gFactor: 5.0, convictionIndex: 5.0, greekFlowImbalance: 5.0, maxPainGravity: 5.0, vrpFactor: 5.0, ivSkewFactor: 5.0 },
                            entryChecks: { gexCheck: true },
                            holdSignal: true,
                            exitTriggers: [],
                            isPartial: false
                        };
                        const sig = quantGreeksService.monitorPositionSignal(
                            p.netQty > 0 ? 'LONG' : 'SHORT',
                            mockEntryQCS,
                            currentQCS
                        );
                        newSignals[p.tradingSymbol] = sig;
                    }
                } catch (err) {
                    console.error(`Failed to evaluate position signal for ${p.tradingSymbol}:`, err);
                }
            }
            setSignals(newSignals);
        };

        if (positions.length > 0) {
            evaluateSignals();
            const interval = setInterval(evaluateSignals, 60000);
            return () => clearInterval(interval);
        }
    }, [positions]);

    useEffect(() => {
        const loadGreeks = async () => {
            if (positions.length > 0 && !isCollapsed) {
                setLoadingGreeks(true);
                try {
                    const res = await portfolioGreeksService.calculatePortfolioGreeks();
                    setGreeks(res);
                } catch (err) {
                    console.error("Error loading portfolio Greeks inside panel:", err);
                } finally {
                    setLoadingGreeks(false);
                }
            } else {
                setGreeks(null);
            }
        };
        loadGreeks();
    }, [positions, isCollapsed]);

    const isConfigured = dhanBrokerService.isConfigured();

    useEffect(() => {
        if (isConfigured) {
            fetchPositions();
        }
    }, [isConfigured, fetchPositions]);

    // Cleanup timer on unmount
    useEffect(() => {
        let timer: NodeJS.Timeout;
        if (tiltCountdown !== null && tiltCountdown > 0) {
            timer = setTimeout(() => setTiltCountdown(tiltCountdown - 1), 1000);
        } else if (tiltCountdown === 0) {
            executeExitAll();
        }
        return () => clearTimeout(timer);
    }, [tiltCountdown]);

    const handleTiltClick = () => {
        triggerHapticImpact('heavy');
        if (tiltCountdown === null) {
            setTiltCountdown(3);
        } else {
            setTiltCountdown(null); // Cancel
        }
    };

    const executeExitAll = async () => {
        setTiltCountdown(null);

        setActionLoading(true);
        triggerHapticImpact('heavy');
        try {
            await dhanBrokerService.exitAllPositions();
            toast.success("Tilt Breaker Triggered! All positions squared off.");
            triggerHapticNotification('warning');
            await fetchPositions(true);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`Kill Switch Failed: ${message}`);
            triggerHapticNotification('error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleConvert = async (p: DhanPositionResponse) => {
        setActionLoading(true);
        try {
            const toType = p.productType === 'INTRADAY' ? 'CNC' : 'INTRADAY';
            await dhanBrokerService.convertPosition({
                fromProductType: p.productType as any,
                exchangeSegment: p.exchangeSegment as any,
                positionType: p.positionType as any,
                securityId: p.securityId,
                tradingSymbol: p.tradingSymbol,
                convertQty: Math.abs(p.netQty),
                toProductType: toType as any
            });
            toast.success(`Position converted to ${toType}!`);
            await fetchPositions(true);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`Conversion Failed: ${message}`);
        } finally {
            setActionLoading(false);
        }
    };

    // If there's an error from the backend saying credentials aren't configured or are expired
    const showConfigError = error?.includes("not configured") || error?.includes("login failed") || error?.includes("expired") || !isConfigured;

    const showFullError = error && positions.length === 0 && !showConfigError;

    const isEmpty = !loading && positions.length === 0 && !error && isConfigured;

    const totalMtm = positions.reduce((sum, p) => {
        // Dhan uses `mtm` or sometimes `realizedProfit + unrealizedProfit`. Fallback to cost basics.
        const pl = (p as any).mtm ?? (p.realizedProfit + p.unrealizedProfit);
        return sum + (pl || 0);
    }, 0);
    const isOverallProfit = totalMtm >= 0;

    return (
        <div className={`mb-6 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg relative transition-all duration-300 ${isCollapsed ? 'p-1' : ''}`}>
            <AnimatePresence>
                {!isCollapsed && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.05 }}
                        className="absolute top-0 right-0 p-12 pointer-events-none"
                    >
                        <Activity size={100} className="text-indigo-500" />
                    </motion.div>
                )}
            </AnimatePresence>

            <div className={`p-4 border-b border-slate-800 flex justify-between items-center transition-all ${isCollapsed ? 'bg-transparent border-none py-2' : 'bg-slate-950/50'}`}>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIsCollapsed(!isCollapsed)}>
                    <motion.div 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        className={`p-2 rounded-lg transition-colors ${isCollapsed ? 'bg-indigo-500/5 text-indigo-400/60' : 'bg-indigo-500/10 text-indigo-400'}`}
                    >
                        <Activity size={16} />
                    </motion.div>
                    <div>
                        <h3 className="text-white font-bold text-sm">Live Intraday Positions</h3>
                        <p className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">
                            {isCollapsed ? (
                                <span className={totalMtm >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}>
                                    {positions.length} OPEN • {isPrivacyMode ? '••••' : formatINR(totalMtm, { showSign: true })}
                                </span>
                            ) : (
                                `${positions.length} Open Position${positions.length !== 1 ? 's' : ''}`
                            )}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {!isCollapsed && (
                        <div className="flex items-center gap-4 border border-slate-800 bg-slate-900 rounded-lg px-3 py-1 animate-in fade-in slide-in-from-right-2">
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider hidden sm:block">Total P&L</div>
                            <div className={`font-mono text-base font-black financial-value ${isOverallProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isPrivacyMode ? '••••••' : formatINR(totalMtm, { showSign: true })}
                            </div>
                        </div>
                    )}
                    
                    <div className="flex items-center gap-2">
                        {error && !showFullError && !showConfigError && (
                            <span 
                                title={error} 
                                className="text-[10px] text-rose-400 font-mono flex items-center gap-1 uppercase tracking-wider cursor-help mr-2 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded animate-in fade-in shrink-0"
                            >
                                <AlertTriangle size={10} className="shrink-0" /> Sync Error
                            </span>
                        )}
                        <button
                            onClick={() => fetchPositions(true)}
                            disabled={loading || actionLoading}
                            className={`p-1.5 text-slate-400 hover:text-white transition-colors disabled:opacity-50 ${!isCollapsed ? 'border-l border-slate-800 pl-3 ml-2' : ''}`}
                        >
                            <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-400' : ''} />
                        </button>
                        
                        {!isCollapsed && (
                            <div className="flex items-center animate-in fade-in shrink-0">
                                {(tiltCountdown !== null) && tiltCountdown > 0 ? (
                                    <div className="ml-2 flex items-center gap-2 bg-rose-500/20 px-2 py-1 rounded border border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)] animate-pulse">
                                        <span className="text-rose-400 font-mono font-bold text-xs uppercase tracking-widest">
                                            BLAST IN {tiltCountdown}...
                                        </span>
                                        <button onClick={handleTiltClick} className="text-slate-400 hover:text-white ml-2">
                                            <XCircle size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={handleTiltClick}
                                        disabled={loading || actionLoading}
                                        title="Tilt Breaker (Exit All)"
                                        className="p-1.5 text-rose-500 hover:text-white hover:bg-rose-600 transition-colors disabled:opacity-50 ml-2 rounded border border-rose-500/30 bg-rose-500/10"
                                    >
                                        <Skull size={14} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {!isCollapsed && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: 'easeInOut' }}
                        className="overflow-hidden p-4 space-y-4"
                    >
                        {/* Multi-Asset Portfolio VaR & CVaR Panel */}
                        <PortfolioVaRPanel portfolioValue={totalMtm > 0 ? totalMtm * 10 : 500000} />

                        {showConfigError ? (
                            <div className="p-8 text-center text-rose-400 flex flex-col items-center justify-center bg-slate-950/30">
                                <AlertTriangle size={32} className="mb-3 opacity-80" />
                                <p className="text-sm font-medium">
                                    {error?.includes("expired") ? "DhanHQ Access Token Expired" : "DhanHQ Credentials Not Configured"}
                                </p>
                                <p className="text-xs text-slate-500 mt-2 max-w-sm">
                                    {error?.includes("expired")
                                        ? "Please generate a new token from web.dhan.co or configure Auto-Login (PIN+TOTP) in Settings to never see this again."
                                        : "Update your API details in Settings to view live positions."}
                                </p>
                            </div>
                        ) : isEmpty ? (
                            <EmptyState
                                variant="minimal"
                                type="no-data"
                                message="No active intraday positions"
                                icon={Activity}
                            />
                        ) : showFullError ? (
                            <div className="p-6 text-center text-rose-400 flex flex-col items-center">
                                <AlertTriangle size={24} className="mb-2" />
                                <p className="text-sm">{error}</p>
                            </div>
                        ) : (
                            <>
                                {/* Portfolio Greeks Panel */}
                                {positions.some(p => p.exchangeSegment === 'NSE_FNO' && p.netQty !== 0) && (
                                    <div className="mb-4 mx-4 p-4 bg-slate-950/40 rounded-xl border border-slate-800/85 flex flex-col gap-3 z-10 relative">
                                        <div className="flex justify-between items-center">
                                            <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                                                <Compass size={14} className="text-emerald-400" />
                                                Active Options Greeks Risk Exposure
                                            </h4>
                                            <span className="text-[9px] font-bold text-slate-500 uppercase">
                                                {greeks?.positionCount || 0} Options Contract(s) Active
                                            </span>
                                        </div>
                                        
                                        {loadingGreeks ? (
                                            <div className="flex justify-center items-center py-4">
                                                <RefreshCw className="animate-spin text-indigo-400" size={16} />
                                            </div>
                                        ) : greeks ? (
                                            <>
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800/60">
                                                        <div className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Net Delta (Δ)</div>
                                                        <div className={`font-mono text-sm font-black ${greeks.totalDelta > 0 ? 'text-emerald-400' : greeks.totalDelta < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                                                            {greeks.totalDelta >= 0 ? '+' : ''}{greeks.totalDelta.toFixed(1)}
                                                        </div>
                                                    </div>
                                                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800/60">
                                                        <div className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Net Gamma (Γ)</div>
                                                        <div className="font-mono text-sm font-black text-indigo-400">
                                                            {greeks.totalGamma.toFixed(3)}
                                                        </div>
                                                    </div>
                                                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800/60">
                                                        <div className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Net Theta (θ)</div>
                                                        <div className={`font-mono text-sm font-black ${greeks.totalTheta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                            {greeks.totalTheta >= 0 ? '+' : ''}{greeks.totalTheta.toFixed(1)}
                                                        </div>
                                                    </div>
                                                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800/60">
                                                        <div className="text-[9px] font-bold text-slate-500 uppercase mb-0.5">Net Vega (ν)</div>
                                                        <div className="font-mono text-sm font-black text-sky-400">
                                                            {greeks.totalVega.toFixed(1)}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Greeks Warnings & Alerts */}
                                                <div className="p-2.5 bg-slate-900/30 rounded-lg border border-slate-800/40 flex items-start gap-2">
                                                    <Shield size={12} className="text-indigo-400 shrink-0 mt-0.5" />
                                                    <div className="text-[9px] text-slate-400 leading-normal">
                                                        {greeks.totalTheta < 0 ? (
                                                            <span>Time decay is burning <span className="font-bold text-rose-400">₹{Math.abs(greeks.totalTheta).toFixed(0)}</span> per day. </span>
                                                        ) : (
                                                            <span>Time decay is yielding <span className="font-bold text-emerald-400">₹{greeks.totalTheta.toFixed(0)}</span> per day. </span>
                                                        )}
                                                        {Math.abs(greeks.totalGamma) > 50 && (
                                                            <span className="text-rose-400 font-bold block mt-0.5">
                                                                ⚠️ High Gamma risk detected. Be cautious of sharp price movements near expiry!
                                                            </span>
                                                        )}
                                                        {new Date().getDay() === 5 && (
                                                            <span className="text-amber-400 font-bold block mt-0.5">
                                                                📅 Weekend decay active. Option values will decay over Saturday & Sunday.
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-[10px] text-slate-500 text-center py-2">Failed to load risk Greeks details.</div>
                                        )}
                                    </div>
                                )}
                                <div className="overflow-x-auto relative z-10 p-0.5">
                                <table className="w-full text-left border-collapse min-w-[500px]">
                                    <thead className="bg-slate-950/30">
                                        <tr>
                                            <th className="py-2 px-4 text-[10px] font-bold text-slate-500 uppercase">Symbol</th>
                                            <th className="py-2 px-4 text-[10px] font-bold text-slate-500 uppercase">Type</th>
                                            <th className="py-2 px-4 text-[10px] font-bold text-slate-500 uppercase text-right">Qty</th>
                                            <th className="py-2 px-4 text-[10px] font-bold text-slate-500 uppercase text-right">Avg Price</th>
                                            <th className="py-2 px-4 text-[10px] font-bold text-slate-500 uppercase text-right">P&L</th>
                                            <th className="py-2 px-4 text-[10px] font-bold text-slate-500 uppercase text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {positions.map((p, idx) => {
                                            const isLong = p.netQty > 0 || p.positionType === 'LONG';
                                            const pl = (p as any).mtm ?? (p.realizedProfit + p.unrealizedProfit);
                                            const isProfit = pl >= 0;
            
                                            return (
                                                <tr key={`${p.tradingSymbol}-${idx}`} className="table-row-hover border-b border-slate-800/50 transition-colors">
                                                    <td className="py-3 px-4">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-bold text-white text-sm">{p.tradingSymbol}</p>
                                                            {signals[p.tradingSymbol] && (
                                                                <span 
                                                                    title={signals[p.tradingSymbol].exitTriggers.join(', ') || 'All systems clear'}
                                                                    className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase cursor-help flex items-center gap-1 shrink-0 ${
                                                                        signals[p.tradingSymbol].holdSignal ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                                                        signals[p.tradingSymbol].exitUrgency === 'URGENT' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse' :
                                                                        'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                                                    }`}
                                                                >
                                                                    <span className={`w-1 h-1 rounded-full ${
                                                                        signals[p.tradingSymbol].holdSignal ? 'bg-emerald-400' :
                                                                        signals[p.tradingSymbol].exitUrgency === 'URGENT' ? 'bg-rose-400' :
                                                                        'bg-amber-400'
                                                                    }`} />
                                                                    {signals[p.tradingSymbol].holdSignal ? 'HOLD' :
                                                                     signals[p.tradingSymbol].exitUrgency === 'URGENT' ? 'EXIT' : 'CAUTION'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-slate-500">{p.productType} • {p.exchangeSegment}</p>
                                                    </td>
                                                    <td className="py-3 px-4">
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex w-min items-center gap-1 ${isLong ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                                                            {isLong ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                                            {isLong ? 'LONG' : 'SHORT'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        <p className="font-mono text-slate-300 text-sm">{isPrivacyMode ? '••' : p.netQty}</p>
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        <p className="font-mono text-slate-400 text-sm financial-value">{isPrivacyMode ? '•••' : formatINR(p.costPrice || p.buyAvg || p.sellAvg)}</p>
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        <p className={`font-mono text-sm font-bold financial-value ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                            {isPrivacyMode ? '••••' : formatINR(pl, { showSign: true })}
                                                        </p>
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        <button
                                                            onClick={() => handleConvert(p)}
                                                            disabled={actionLoading}
                                                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                                                            title="Convert Intraday <-> Delivery"
                                                        >
                                                            <Shuffle size={12} /> Convert
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
