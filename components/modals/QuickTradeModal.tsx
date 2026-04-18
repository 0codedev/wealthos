import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown, DollarSign, Activity, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { dhanBrokerService, DhanOrderRequest } from '../../services/DhanBrokerService';
import { buildOrderPreviewFingerprint, dhanOrderService, isOrderPreviewFresh, OrderPreflightResult } from '../../services/DhanOrderService';
import { useToast } from '../shared/ToastProvider';
import { registerBrokerExecutionHandoff } from '../../services/BrokerExecutionHandoffService';
import { COPY } from '../../utils/appCopy';
import { triggerHapticImpact, triggerHapticNotification } from '../../utils/haptics';
import { PositionSizingEngine } from '../../services/PositionSizingEngine';

export interface QuickTradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticker: string;
    securityId?: string;
    exchange?: string;
    currentPrice: number;
}

export const QuickTradeModal: React.FC<QuickTradeModalProps> = ({
    isOpen, onClose, ticker, securityId, exchange = 'NSE_EQ', currentPrice
}) => {
    const { toast } = useToast();
    const [action, setAction] = useState<'BUY' | 'SELL'>('BUY');
    const [quantity, setQuantity] = useState<string>('1');
    const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET');
    const [price, setPrice] = useState<string>(currentPrice.toString());
    const [productType, setProductType] = useState<'INTRADAY' | 'CNC'>('INTRADAY');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [preview, setPreview] = useState<OrderPreflightResult | null>(null);
    const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
    const [previewedAt, setPreviewedAt] = useState<number | null>(null);
    const [executionSuccess, setExecutionSuccess] = useState<{
        estimatedPrice: number;
        orderValue: number;
        requiredMargin: number | null;
    } | null>(null);

    useEffect(() => {
        if (isOpen) {
            setExecutionSuccess(null);
        }
    }, [isOpen]);

    const mlSizingRecommendation = useMemo(() => {
        return PositionSizingEngine.computeRecommendedSize(
            { entryPrice: currentPrice, stopLoss: currentPrice * 0.97, target1: currentPrice * 1.05 } as any,
            100000,
            0.015,
            0.55,
            { mlHitProb: 0.68, anomalyScore: 0.2, regime: 'TRENDING_UP' }
        );
    }, [currentPrice]);

    const requestDraft = useMemo<DhanOrderRequest | null>(() => {
        const qtyNum = parseInt(quantity, 10);
        const priceNum = orderType === 'LIMIT' ? parseFloat(price) : 0;

        if (isNaN(qtyNum) || qtyNum <= 0) return null;
        if (orderType === 'LIMIT' && (isNaN(priceNum) || priceNum <= 0)) return null;

        return {
            transactionType: action,
            exchangeSegment: exchange as any,
            productType: productType,
            orderType: orderType,
            validity: 'DAY',
            tradingSymbol: ticker,
            securityId: securityId || '',
            quantity: qtyNum,
            price: priceNum,
        };
    }, [action, exchange, orderType, price, productType, quantity, securityId, ticker]);

    const currentPreviewFingerprint = useMemo(
        () => requestDraft ? buildOrderPreviewFingerprint(requestDraft, { currentPrice }) : null,
        [currentPrice, requestDraft],
    );

    const isPreviewCurrent = !!currentPreviewFingerprint && isOrderPreviewFresh(
        previewFingerprint,
        currentPreviewFingerprint,
        previewedAt,
    );
    const hasBlockingIssues = !!preview?.issues.some((issue) => issue.blocking);
    const readinessTone = !requestDraft
        ? 'slate'
        : !preview
            ? 'amber'
            : !isPreviewCurrent
                ? 'amber'
                : hasBlockingIssues
                    ? 'rose'
                    : 'emerald';
    const readinessTitle = !requestDraft
        ? 'Order details incomplete'
        : !preview
            ? 'Run pre-trade check'
            : !isPreviewCurrent
                ? 'Preview is stale'
                : hasBlockingIssues
                    ? 'Execution blocked by preflight'
                    : 'Ready to confirm';
    const readinessMessage = !requestDraft
        ? 'Enter a valid quantity and price to prepare this order.'
        : !preview
            ? 'Generate a fresh preview before you try to confirm the order.'
            : !isPreviewCurrent
                ? 'Something changed after the last preview. Run the check again so this order matches the current draft.'
                : hasBlockingIssues
                    ? 'Resolve the blocking issues shown below before attempting to place the order.'
                    : 'The current draft matches the latest preview and no blocking flags are active.';

    if (!isOpen) return null;

    const handlePreview = async () => {
        if (!requestDraft) {
            toast.error(COPY.toasts.validQtyPriceRequired);
            return;
        }

        setIsPreviewLoading(true);
        try {
            const nextPreview = await dhanOrderService.previewOrder(requestDraft, { currentPrice });
            setPreview(nextPreview);
            setPreviewFingerprint(buildOrderPreviewFingerprint(requestDraft, { currentPrice }));
            setPreviewedAt(Date.now());

            if (nextPreview.issues.some((issue) => issue.blocking)) {
                toast.warning(COPY.toasts.preflightBlocking);
            } else {
                toast.info("Order preview updated.");
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`Preview failed: ${message}`);
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleSubmit = async () => {
        const qtyNum = parseInt(quantity, 10);
        if (isNaN(qtyNum) || qtyNum <= 0) {
            toast.error(COPY.toasts.validQtyRequired);
            return;
        }

        const priceNum = orderType === 'LIMIT' ? parseFloat(price) : 0;
        if (orderType === 'LIMIT' && (isNaN(priceNum) || priceNum <= 0)) {
            toast.error(COPY.toasts.validLimitPriceRequired);
            return;
        }

        if (!dhanBrokerService.isConfigured()) {
            toast.error(COPY.toasts.dhanNotConfigured);
            return;
        }

        if (!requestDraft) {
            toast.error(COPY.toasts.validOrderDetailsRequired);
            return;
        }

        if (!currentPreviewFingerprint || !isPreviewCurrent || !preview) {
            toast.warning(COPY.toasts.freshPreflight);
            return;
        }

        setIsSubmitting(true);
        triggerHapticImpact('medium');
        try {
            const result = await dhanOrderService.executeGuardedOrder(requestDraft, { currentPrice });
            setPreview(result.preview);
            setPreviewFingerprint(currentPreviewFingerprint);
            setPreviewedAt(Date.now());
            setExecutionSuccess({
                estimatedPrice: result.preview.estimatedPrice,
                orderValue: result.preview.orderValue,
                requiredMargin: result.preview.requiredMargin,
            });
            registerBrokerExecutionHandoff(ticker, action, 'quick');
            toast.success(COPY.toasts.sniperOrderPlaced(action, qtyNum, ticker));
            triggerHapticNotification('success');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`Order Failed: ${message}`);
            triggerHapticNotification('error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    className="bg-slate-900/90 dark:bg-slate-950/95 backdrop-blur-2xl border border-slate-700/40 shadow-2xl rounded-2xl w-full max-w-sm overflow-hidden relative"
                >
                    {/* Header */}
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                        <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg ${action === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                <Activity size={16} />
                            </div>
                            <h3 className="text-white font-bold">{ticker}</h3>
                        </div>
                        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="p-5 space-y-5">
                        {executionSuccess ? (
                            <div className="space-y-4">
                                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-200">
                                    <div className="flex items-start gap-3">
                                        <CheckCircle2 size={20} className="mt-0.5 text-emerald-300" />
                                        <div>
                                            <p className="text-sm font-bold uppercase tracking-wider">Order sent to Dhan</p>
                                            <p className="mt-1 text-xs leading-relaxed text-emerald-100">
                                                The guarded order check passed and the current {action.toLowerCase()} order for {ticker} has been submitted.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                                    <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-widest text-slate-500">
                                        <div>
                                            <p>Est. Price</p>
                                            <p className="mt-1 font-mono text-sm text-white">{executionSuccess.estimatedPrice.toFixed(2)}</p>
                                        </div>
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
                                    </div>
                                </div>

                                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-xs text-indigo-100">
                                    <p className="font-bold uppercase tracking-wider text-indigo-200">What To Do Next</p>
                                    <ul className="mt-2 space-y-1.5 text-indigo-100/90">
                                        <li>Watch Dhan diagnostics or holdings refresh to confirm the broker state catches up cleanly.</li>
                                        <li>If this was part of a planned setup, log the context in the journal once the trade settles.</li>
                                        <li>Run a fresh pre-trade check before reusing this draft for another order.</li>
                                    </ul>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setExecutionSuccess(null)}
                                        className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-800"
                                    >
                                        Place Another
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
                        {/* Action Toggle */}
                        <div className="flex bg-slate-900 rounded-xl p-1 border border-slate-800">
                            <button
                                className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-2 rounded-lg transition-all ${action === 'BUY' ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'text-slate-400 hover:bg-slate-800'}`}
                                onClick={() => setAction('BUY')}
                            >
                                <TrendingUp size={16} /> BUY
                            </button>
                            <button
                                className={`flex-1 py-2 text-sm font-bold flex items-center justify-center gap-2 rounded-lg transition-all ${action === 'SELL' ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.3)]' : 'text-slate-400 hover:bg-slate-800'}`}
                                onClick={() => setAction('SELL')}
                            >
                                <TrendingDown size={16} /> SELL
                            </button>
                        </div>

                        {/* Order Details */}
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Product</label>
                                    <select
                                        value={productType}
                                        onChange={(e) => setProductType(e.target.value as any)}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500 transition-colors"
                                    >
                                        <option value="INTRADAY">MIS (Intraday)</option>
                                        <option value="CNC">CNC (Delivery)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Type</label>
                                    <select
                                        value={orderType}
                                        onChange={(e) => setOrderType(e.target.value as any)}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-indigo-500 transition-colors"
                                    >
                                        <option value="MARKET">Market</option>
                                        <option value="LIMIT">Limit</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Quantity</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-lg outline-none focus:border-indigo-500 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Price</label>
                                    <input
                                        type="number"
                                        step="0.05"
                                        disabled={orderType === 'MARKET'}
                                        value={orderType === 'MARKET' ? currentPrice : price}
                                        onChange={(e) => setPrice(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-lg outline-none focus:border-indigo-500 transition-colors disabled:opacity-50 disabled:bg-slate-900/50"
                                    />
                                </div>
                            </div>

                            {/* Domain 7: ML Adaptive Sizing Breakdown */}
                            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3 space-y-1 text-xs">
                                <div className="flex items-center justify-between font-bold text-indigo-200">
                                    <span className="flex items-center gap-1.5">
                                        <Activity size={14} className="text-indigo-400" />
                                        ML Lot Sizing Recommendation (Domain 7)
                                    </span>
                                    <span className="font-mono text-emerald-400">{mlSizingRecommendation.lots} Lots</span>
                                </div>
                                <p className="text-[10px] text-indigo-300/80 leading-snug">
                                    Kelly: {(mlSizingRecommendation.kellyFraction * 100).toFixed(1)}% · Risk: ₹{Math.round(mlSizingRecommendation.capitalAtRisk).toLocaleString('en-IN')} (SL: -₹{Math.round(mlSizingRecommendation.ifSLHit)})
                                </p>
                            </div>
                        </div>

                        {/* Swipe to Execute Base representation */}
                        <div className="space-y-3">
                            <div className={`rounded-xl border px-3 py-3 text-xs ${
                                readinessTone === 'emerald'
                                    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                    : readinessTone === 'rose'
                                        ? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
                                        : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                            }`}>
                                <p className="font-bold uppercase tracking-wider">{readinessTitle}</p>
                                <p className="mt-1 leading-relaxed">{readinessMessage}</p>
                            </div>

                            <button
                                onClick={handlePreview}
                                disabled={isPreviewLoading || !requestDraft}
                                className="w-full py-2.5 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 text-sm font-bold transition-all disabled:opacity-50"
                            >
                                {isPreviewLoading ? 'CHECKING RISK...' : 'RUN PRE-TRADE CHECK'}
                            </button>

                            {preview && (
                                <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 space-y-3">
                                    <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-widest text-slate-500">
                                        <div>
                                            <p>Est. Price</p>
                                            <p className="mt-1 font-mono text-sm text-white">{preview.estimatedPrice.toFixed(2)}</p>
                                        </div>
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
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-slate-400">Projected ticker exposure</span>
                                        <span className="font-bold text-white">{preview.projectedTickerExposurePercent.toFixed(1)}%</span>
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
                                            No blocking risk flags detected in the current preview.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                            <button
                                onClick={handleSubmit}
                            disabled={isSubmitting || !requestDraft || !isPreviewCurrent || hasBlockingIssues}
                            className={`w-full py-3 mt-4 rounded-xl font-black text-white uppercase tracking-wider transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${action === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
                        >
                            {isSubmitting ? (
                                <span className="animate-pulse">EXECUTING...</span>
                            ) : (
                                <>{isPreviewCurrent ? `CONFIRM ${action}` : `RUN CHECK TO ${action}`} <DollarSign size={16} /></>
                            )}
                        </button>
                        {isPreviewCurrent && !hasBlockingIssues && (
                            <p className="text-center text-[11px] text-slate-400">
                                This order is armed against the current preview and can be submitted safely.
                            </p>
                        )}
                        </>
                        )}
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};
