import React, { useEffect, useMemo, useState } from 'react';
import { Crosshair, AlertCircle, X, ShieldAlert, Target, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { dhanBrokerService, DhanOrderRequest } from '../../services/DhanBrokerService';
import { buildOrderPreviewFingerprint, dhanOrderService, isOrderPreviewFresh, OrderPreflightResult } from '../../services/DhanOrderService';
import { useToast } from '../shared/ToastProvider';
import { motion, AnimatePresence } from 'framer-motion';
import { registerBrokerExecutionHandoff } from '../../services/BrokerExecutionHandoffService';
import { COPY } from '../../utils/appCopy';
import { triggerHapticImpact, triggerHapticNotification } from '../../utils/haptics';
import { PositionSizingEngine } from '../../services/PositionSizingEngine';
import { monteCarloService, TradeProbabilityResult } from '../../services/MonteCarloService';
import { liquidityService, PreTradeCostResult } from '../../services/LiquidityService';
import { UnifiedButton } from '../ui/UnifiedButton';


interface SniperOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticker: string;
    currentPrice: number;
}

export const SniperOrderModal: React.FC<SniperOrderModalProps> = ({ isOpen, onClose, ticker: initialTicker, currentPrice }) => {
    const { toast } = useToast();

    // Form state
    const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
    const [ticker, setTicker] = useState(initialTicker || '');
    const [quantity, setQuantity] = useState('1');
    const [price, setPrice] = useState(currentPrice?.toString() || '');
    const [targetPoints, setTargetPoints] = useState('5');
    const [stopLossPoints, setStopLossPoints] = useState('2');
    const [isLoading, setIsLoading] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [preview, setPreview] = useState<OrderPreflightResult | null>(null);
    const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
    const [previewedAt, setPreviewedAt] = useState<number | null>(null);
    const [executionSuccess, setExecutionSuccess] = useState<{
        orderValue: number;
        requiredMargin: number | null;
        riskRewardRatio?: number | null;
    } | null>(null);

    const [mcProb, setMcProb] = useState<TradeProbabilityResult | null>(null);
    const [tradeCost, setTradeCost] = useState<PreTradeCostResult | null>(null);

    useEffect(() => {
        if (isOpen) {
            setExecutionSuccess(null);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const p = parseFloat(price) || currentPrice;
        const tgt = parseFloat(targetPoints);
        const sl = parseFloat(stopLossPoints);
        const qty = parseInt(quantity, 10) || 1;

        if (p > 0 && tgt > 0 && sl > 0) {
            const timer = setTimeout(() => {
                const targetPrice = action === 'BUY' ? p + tgt : p - tgt;
                const stopLossPrice = action === 'BUY' ? p - sl : p + sl;

                monteCarloService.tradeProbability({
                    symbol: ticker || 'NIFTY',
                    current_price: p,
                    target_price: targetPrice,
                    stop_loss_price: stopLossPrice,
                    daily_volatility: 0.0141,
                    horizon_days: 10,
                    n_simulations: 3000,
                }).then(setMcProb).catch(console.error);

                liquidityService.getPreTradeCost({
                    symbol: ticker || 'NIFTY',
                    trade_size_shares: qty,
                    current_price: p,
                    current_adv: 5000000,
                    ann_volatility: 0.20,
                }).then(setTradeCost).catch(console.error);
            }, 500);

            return () => clearTimeout(timer);
        }
    }, [isOpen, price, targetPoints, stopLossPoints, quantity, action, ticker, currentPrice]);


    const requestDraft = useMemo<DhanOrderRequest | null>(() => {
        const lPrice = parseFloat(price);
        const qty = parseInt(quantity, 10);
        const tgt = parseFloat(targetPoints);
        const sl = parseFloat(stopLossPoints);

        if (isNaN(lPrice) || isNaN(qty) || isNaN(tgt) || isNaN(sl) || qty <= 0 || tgt <= 0 || sl <= 0) {
            return null;
        }

        return {
            transactionType: action,
            exchangeSegment: 'NSE_EQ',
            productType: 'BO',
            orderType: 'LIMIT',
            validity: 'DAY',
            tradingSymbol: ticker,
            securityId: '',
            quantity: qty,
            price: lPrice,
            boProfitValue: tgt,
            boStopLossValue: sl,
        };
    }, [action, price, quantity, stopLossPoints, targetPoints, ticker]);

    const currentPreviewFingerprint = useMemo(
        () => requestDraft ? buildOrderPreviewFingerprint(requestDraft, {
            currentPrice,
            targetPoints: parseFloat(targetPoints),
            stopLossPoints: parseFloat(stopLossPoints),
        }) : null,
        [currentPrice, requestDraft, stopLossPoints, targetPoints],
    );

    const isPreviewCurrent = !!currentPreviewFingerprint && isOrderPreviewFresh(
        previewFingerprint,
        currentPreviewFingerprint,
        previewedAt,
    );

    const handlePreview = async () => {
        if (!requestDraft) {
            toast.error(COPY.toasts.validQtyPriceRequired);
            return;
        }

        setIsPreviewLoading(true);
        try {
            const nextPreview = await dhanOrderService.previewOrder(requestDraft, {
                currentPrice,
                targetPoints: parseFloat(targetPoints),
                stopLossPoints: parseFloat(stopLossPoints),
            });
            setPreview(nextPreview);
            setPreviewFingerprint(buildOrderPreviewFingerprint(requestDraft, {
                currentPrice,
                targetPoints: parseFloat(targetPoints),
                stopLossPoints: parseFloat(stopLossPoints),
            }));
            setPreviewedAt(Date.now());
            if (nextPreview.issues.some((issue) => issue.blocking)) {
                toast.warning(COPY.toasts.sniperPreflightBlocking);
            } else {
                toast.info("Sniper preflight updated.");
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`Sniper preview failed: ${message}`);
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleFire = async () => {
        if (!dhanBrokerService.isConfigured()) {
            toast.error(COPY.toasts.dhanNotConfiguredShort);
            return;
        }

        const lPrice = parseFloat(price);
        const qty = parseInt(quantity, 10);
        const tgt = parseFloat(targetPoints);
        const sl = parseFloat(stopLossPoints);

        if (isNaN(lPrice) || isNaN(qty) || isNaN(tgt) || isNaN(sl) || qty <= 0 || tgt <= 0 || sl <= 0) {
            toast.error(COPY.toasts.validQtyPriceRequired);
            return;
        }

        if (!requestDraft || !currentPreviewFingerprint || !isPreviewCurrent || !preview) {
            toast.warning(COPY.toasts.freshSniperPreflight);
            return;
        }

        setIsLoading(true);
        triggerHapticImpact('medium');
        try {
            const result = await dhanOrderService.executeGuardedOrder(requestDraft, {
                currentPrice,
                targetPoints: tgt,
                stopLossPoints: sl,
            });
            setPreview(result.preview);
            setPreviewFingerprint(currentPreviewFingerprint);
            setPreviewedAt(Date.now());
            setExecutionSuccess({
                orderValue: result.preview.orderValue,
                requiredMargin: result.preview.requiredMargin,
                riskRewardRatio: result.preview.riskRewardRatio,
            });
            registerBrokerExecutionHandoff(ticker, action, 'sniper');
            toast.success(COPY.toasts.sniperFired);
            triggerHapticNotification('success');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`Sniper Order Failed: ${message}`);
            triggerHapticNotification('error');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    // Calculations
    const p = parseFloat(price) || currentPrice;
    const t = parseFloat(targetPoints) || 0;
    const s = parseFloat(stopLossPoints) || 0;
    const q = parseInt(quantity) || 1;

    const profitRs = t * q;
    const lossRs = s * q;
    const isReady = p > 0 && t > 0 && s > 0 && q > 0;
    const hasBlockingIssues = !!preview?.issues.some((issue) => issue.blocking);
    const readinessTitle = !isReady
        ? 'Setup incomplete'
        : !preview
            ? 'Run sniper preflight'
            : !isPreviewCurrent
                ? 'Preflight is stale'
                : hasBlockingIssues
                    ? 'Sniper blocked by risk checks'
                    : 'Sniper setup is armed';
    const readinessMessage = !isReady
        ? 'Fill quantity, entry, target, and stop values before this bracket can be checked.'
        : !preview
            ? 'Run the sniper preflight to validate margin, risk-reward, and current execution conditions.'
            : !isPreviewCurrent
                ? 'The setup changed after the last check. Refresh preflight before firing the bracket order.'
                : hasBlockingIssues
                    ? 'The current bracket has blocking issues. Resolve them before attempting to fire.'
                    : 'The current bracket matches the latest preflight and is ready to submit.';

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    <motion.div
                        initial={{ scale: 0.95, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0, y: 20 }}
                        className="relative w-full max-w-sm bg-slate-900/90 dark:bg-slate-950/95 backdrop-blur-2xl border border-slate-700/40 rounded-3xl overflow-hidden shadow-2xl"
                    >
                        {/* Header */}
                        <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                                    <Crosshair size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Sniper Order</h3>
                                    <p className="text-[10px] text-slate-400 font-mono">BRACKET (ENTRY + TGT + SL)</p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-5 space-y-5">
                            {executionSuccess ? (
                                <div className="space-y-4">
                                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-200">
                                        <div className="flex items-start gap-3">
                                            <CheckCircle2 size={20} className="mt-0.5 text-emerald-300" />
                                            <div>
                                                <p className="text-sm font-bold uppercase tracking-wider">Bracket order armed</p>
                                                <p className="mt-1 text-xs leading-relaxed text-emerald-100">
                                                    The sniper setup for {ticker} has been sent with entry, target, and stop-loss protection.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                                        <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-widest text-slate-500">
                                            <div>
                                                <p>Order Value</p>
                                                <p className="mt-1 font-mono text-sm text-white">{Math.round(executionSuccess.orderValue).toLocaleString('en-IN')}</p>
                                            </div>
                                            <div>
                                                <p>Margin</p>
                                                <p className="mt-1 font-mono text-sm text-white">
                                                    {executionSuccess.requiredMargin !== null ? Math.round(executionSuccess.requiredMargin).toLocaleString('en-IN') : 'N/A'}
                                                </p>
                                            </div>
                                            <div>
                                                <p>R:R</p>
                                                <p className="mt-1 font-mono text-sm text-white">
                                                    {executionSuccess.riskRewardRatio ? executionSuccess.riskRewardRatio.toFixed(2) : 'N/A'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-100">
                                        <p className="font-bold uppercase tracking-wider text-indigo-200">What To Do Next</p>
                                        <ul className="mt-2 space-y-1.5 text-indigo-100/90">
                                            <li>Watch the broker diagnostics panel to confirm the bracket reaches Dhan cleanly.</li>
                                            <li>If the setup triggers, capture execution notes and screenshots in the journal while context is fresh.</li>
                                            <li>Re-run sniper preflight before changing this draft for a new setup.</li>
                                        </ul>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => setExecutionSuccess(null)}
                                            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-800"
                                        >
                                            Set Up Another
                                        </button>
                                        <button
                                            onClick={onClose}
                                            className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500"
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            ) : (
                            <>
                            {/* Ticker & Action */}
                            <div className="flex justify-between items-center pb-4 border-b border-slate-800">
                                <div className="flex-1 mr-4">
                                    <input
                                        type="text"
                                        value={ticker}
                                        onChange={e => setTicker(e.target.value.toUpperCase())}
                                        placeholder="TICKER"
                                        className="w-full bg-transparent text-xl font-black text-white outline-none placeholder:text-slate-700"
                                    />
                                    <div className="text-xs text-slate-400">LTP: ₹{currentPrice || p || '0.00'}</div>
                                </div>
                                <div className="flex bg-slate-950 rounded-lg p-1 border border-slate-800">
                                    <button
                                        onClick={() => setAction('BUY')}
                                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-white'}`}
                                    >
                                        BUY
                                    </button>
                                    <button
                                        onClick={() => setAction('SELL')}
                                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${action === 'SELL' ? 'bg-rose-500/20 text-rose-400' : 'text-slate-500 hover:text-white'}`}
                                    >
                                        SELL
                                    </button>
                                </div>
                            </div>

                            {/* Inputs */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex justify-between">
                                        Quantity
                                    </label>
                                    <input
                                        type="number" min="1"
                                        value={quantity} onChange={e => setQuantity(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-mono text-center outline-none focus:border-indigo-500/50 transition-colors"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex justify-between">
                                        Entry Price (Limit)
                                    </label>
                                    <input
                                        type="number" step="0.05"
                                        value={price} onChange={e => setPrice(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white font-mono text-center outline-none focus:border-indigo-500/50 transition-colors"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-[10px] uppercase font-bold tracking-wider text-emerald-500/70 flex justify-between items-center">
                                        <span>Target (Pts)</span>
                                        <Target size={12} />
                                    </label>
                                    <input
                                        type="number" step="0.05" min="0.05"
                                        value={targetPoints} onChange={e => setTargetPoints(e.target.value)}
                                        className="w-full bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-emerald-400 font-mono text-center outline-none focus:border-emerald-500/50 transition-colors"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-[10px] uppercase font-bold tracking-wider text-rose-500/70 flex justify-between items-center">
                                        <span>Stop Loss (Pts)</span>
                                        <ShieldAlert size={12} />
                                    </label>
                                    <input
                                        type="number" step="0.05" min="0.05"
                                        value={stopLossPoints} onChange={e => setStopLossPoints(e.target.value)}
                                        className="w-full bg-rose-500/5 border border-rose-500/20 rounded-xl p-3 text-rose-400 font-mono text-center outline-none focus:border-rose-500/50 transition-colors"
                                    />
                                </div>
                            </div>

                            {/* Reward/Risk Analysis */}
                            <div className="bg-slate-950 rounded-xl p-3 border border-slate-800 flex justify-between items-center">
                                <div>
                                    <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Risk / Reward</div>
                                    <div className="text-xs font-bold text-white">
                                        1 : {s > 0 ? (t / s).toFixed(2) : '-'}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Max Loss / Max Profit</div>
                                    <div className="text-xs font-bold text-white">
                                        <span className="text-rose-400">-₹{lossRs.toFixed(2)}</span>
                                        <span className="text-slate-600 mx-1">/</span>
                                        <span className="text-emerald-400">+₹{profitRs.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Monte Carlo & Liquidity Impact Display */}
                            {mcProb && (
                                <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2">
                                    <div className="flex justify-between items-center text-[10px] uppercase tracking-wider font-bold text-slate-400">
                                        <span>Monte Carlo Odds (3,000 Paths)</span>
                                        <span className="text-emerald-400 font-mono">P(Target): {Math.round(mcProb.p_target_hit_first * 100)}%</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                                            <div className="text-[9px] text-slate-500 uppercase">P(Stop Hit First)</div>
                                            <div className="font-bold text-rose-400 mt-0.5">{Math.round(mcProb.p_stop_hit_first * 100)}%</div>
                                        </div>
                                        <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                                            <div className="text-[9px] text-slate-500 uppercase">Expected Value (EV)</div>
                                            <div className={`font-bold mt-0.5 ${mcProb.trade_metrics.expected_value_pct > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                                +{mcProb.trade_metrics.expected_value_pct}%
                                            </div>
                                        </div>
                                    </div>
                                    {tradeCost && (
                                        <>
                                            <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1 border-t border-slate-800/50">
                                                <span>Impact Cost: <strong className="text-cyan-400">{tradeCost.impact.blended_bps.toFixed(1)} bps</strong> (₹{Math.round(tradeCost.impact.cost_inr)})</span>
                                                {tradeCost.risk_flag === 'HIGH IMPACT' && (
                                                    <span className="text-rose-400 font-bold flex items-center gap-1">
                                                        <AlertTriangle size={10} /> HIGH IMPACT
                                                    </span>
                                                )}
                                            </div>
                                            {tradeCost.impact.blended_bps > 50 && (
                                                <div className="bg-cyan-500/10 border border-cyan-500/20 p-2 rounded-lg text-[10px] text-cyan-200">
                                                    <strong className="block text-cyan-300 font-bold uppercase tracking-wide">TWAP Slice Execution Recommended</strong>
                                                    Slice order into 3 child orders of ~{Math.ceil(tradeCost.trade.shares / 3)} shares every 15 mins to reduce slippage.
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}



                            <div className="space-y-3">
                                <div className={`rounded-xl border px-3 py-3 text-xs ${
                                    !isReady || !preview || !isPreviewCurrent
                                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                                        : hasBlockingIssues
                                            ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                                            : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                }`}>
                                    <p className="font-bold uppercase tracking-wider">{readinessTitle}</p>
                                    <p className="mt-1 leading-relaxed">{readinessMessage}</p>
                                </div>

                                <UnifiedButton
                                    variant="secondary"
                                    size="default"
                                    onClick={handlePreview}
                                    disabled={isPreviewLoading || !isReady}
                                    className="w-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-slate-200 transition-all disabled:opacity-50"
                                >
                                    {isPreviewLoading ? 'CHECKING SNIPER RISK...' : 'RUN SNIPER PREFLIGHT'}
                                </UnifiedButton>

                                {preview && (
                                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-3">
                                        <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-widest text-slate-500">
                                            <div>
                                                <p>Order Value</p>
                                                <p className="mt-1 font-mono text-sm text-white">{Math.round(preview.orderValue).toLocaleString('en-IN')}</p>
                                            </div>
                                            <div>
                                                <p>Margin</p>
                                                <p className="mt-1 font-mono text-sm text-white">
                                                    {preview.requiredMargin !== null ? Math.round(preview.requiredMargin).toLocaleString('en-IN') : 'N/A'}
                                                </p>
                                            </div>
                                            <div>
                                                <p>R:R</p>
                                                <p className="mt-1 font-mono text-sm text-white">
                                                    {preview.riskRewardRatio ? preview.riskRewardRatio.toFixed(2) : 'N/A'}
                                                </p>
                                            </div>
                                        </div>
                                        {preview.issues.length > 0 ? (
                                            <div className="space-y-2">
                                                {preview.issues.slice(0, 3).map((issue) => (
                                                    <div key={issue.code} className={`rounded-lg px-3 py-2 text-xs ${issue.severity === 'high' ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20' : issue.severity === 'medium' ? 'bg-amber-500/10 text-amber-200 border border-amber-500/20' : 'bg-indigo-500/10 text-indigo-200 border border-indigo-500/20'}`}>
                                                        <div className="flex items-center gap-2 font-bold">
                                                             <AlertTriangle size={12} />
                                                            {issue.title}
                                                        </div>
                                                        <p className="mt-1 leading-relaxed">{issue.message}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                                                <ShieldCheck size={14} />
                                                Preflight is clear for the current sniper setup.
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Submit Button */}
                            <UnifiedButton
                                variant={action === 'BUY' ? 'primary' : 'destructive'}
                                size="lg"
                                onClick={handleFire}
                                disabled={isLoading || !isReady || !requestDraft || !isPreviewCurrent || hasBlockingIssues}
                                className={`w-full py-4 text-sm font-black uppercase tracking-widest transition-all shadow-lg flex justify-center items-center gap-2 ${isReady
                                    ? action === 'BUY'
                                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20 font-black'
                                        : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/20 font-black'
                                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    }`}
                            >
                                {isLoading ? (
                                    <span className="animate-pulse">Arming...</span>
                                ) : (
                                    <>
                                        <Crosshair size={18} />
                                        {isPreviewCurrent ? `Confirm ${action} Sniper` : `Run Check To ${action}`}
                                    </>
                                )}
                            </UnifiedButton>

                            {!dhanBrokerService.isConfigured() && (
                                <div className="text-center">
                                    <p className="inline-flex items-center gap-1.5 text-[10px] text-rose-400 font-medium bg-rose-500/10 px-3 py-1.5 rounded-lg border border-rose-500/20">
                                        <AlertCircle size={12} /> API Credentials Not Configured
                                    </p>
                                </div>
                            )}
                            {isPreviewCurrent && !hasBlockingIssues && (
                                <p className="text-center text-[11px] text-slate-400">
                                    Bracket order is armed against the current preflight and ready to fire.
                                </p>
                            )}
                            </>
                            )}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
