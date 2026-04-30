/**
 * CC42 — MessageCard
 *
 * Renders a single Telegram message. CC42 polish:
 *   - Staggered fade-up entry animation
 *   - Glowing left border that intensifies on hover
 *   - Hover-lift with floating action toolbar
 *   - Circular confidence ring (instead of linear bar)
 *   - Confidence color interpolates red→amber→emerald
 *   - Timeline becomes a vertical stepper with check-marks for updates
 *   - Skeleton shimmer for OCR
 *   - "Hot signal" pulse on arrival (driven by the `isFresh` prop)
 *   - News tag pills with category icons
 */
import React, { useState, useEffect } from 'react';
import { Star, Zap, Activity, ChevronDown, ChevronUp, ExternalLink, Pin, FileText, TrendingUp, BarChart3, Newspaper, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { db, TelegramMessage } from '../../database';
import { ParsedSignal as TelegramParsedSignal } from '../../services/TelegramSignalParser';
import { PoolTelegramPushButton } from '../pool/PoolTelegramPushButton';
import { triggerHapticImpact, triggerHapticNotification } from '../../utils/haptics';
import { MessageCardMenu } from './MessageCardMenu';
import { useToast } from '../shared/ToastProvider';
import styles from './MessageCard.module.css';
import anim from './animations.module.css';

export interface DteDetails {
    label: string;
    class: string;
}

interface MessageCardProps {
    msg: TelegramMessage;
    parsed: TelegramParsedSignal | null;
    isSignal: boolean;
    isNews: boolean;
    earColor: string | undefined;
    dteDetails: DteDetails | null;
    newsTags: string[];
    isThreadExpanded: boolean;
    threadMessages?: TelegramMessage[];
    isFresh?: boolean;
    onToggleStar: (msg: TelegramMessage) => void;
    onAutofill: (msg: TelegramMessage) => void;
    onOpenPositionSizer: (parsed: TelegramParsedSignal) => void;
    onToggleThread: (threadId: number) => void;
    onAddToJournal: (msg: TelegramMessage) => void;
    onOpenChart: (msg: TelegramMessage) => void;
    onCopyRaw: (msg: TelegramMessage) => void;
    onOpenDetail: (msg: TelegramMessage) => void;
}

/** Interpolate a colour from red (low) → amber (mid) → emerald (high). */
const confidenceColor = (pct: number) => {
    const p = Math.max(0, Math.min(1, pct));
    if (p < 0.5) {
        // red → amber
        const t = p / 0.5;
        const r = 244, g = Math.round(63 + (158 - 63) * t), b = Math.round(94 + (11 - 94) * t);
        return `rgb(${r}, ${g}, ${b})`;
    }
    // amber → emerald
    const t = (p - 0.5) / 0.5;
    const r = Math.round(251 - (251 - 16) * t), g = Math.round(191 + (185 - 191) * t), b = Math.round(36 + (129 - 36) * t);
    return `rgb(${r}, ${g}, ${b})`;
};

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtTimeFull = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const newsTagIcon: Record<string, React.ReactNode> = {
    rbi: <BarChart3 size={8} />,
    flows: <TrendingUp size={8} />,
    macro: <Activity size={8} />,
    earnings: <FileText size={8} />,
    general: <Newspaper size={8} />,
};

const relTime = (ts: number) => {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
    return `${Math.floor(sec / 86400)}d`;
};

export const MessageCard: React.FC<MessageCardProps> = ({
    msg, parsed, isSignal, isNews, earColor, dteDetails, newsTags,
    isThreadExpanded, threadMessages, isFresh,
    onToggleStar, onAutofill, onOpenPositionSizer, onToggleThread,
    onAddToJournal, onOpenChart, onCopyRaw, onOpenDetail,
}) => {
    const [popped, setPopped] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const { toast } = useToast();

    // Order execution states
    const [execTarget, setExecTarget] = useState<'DHAN' | 'OPENALGO'>('OPENALGO');
    const [symbol, setSymbol] = useState(parsed?.tradingSymbol || '');
    const [act, setAct] = useState<'BUY' | 'SELL'>(parsed?.action || 'BUY');
    const [entry, setEntry] = useState(parsed?.suggestedEntryPrice || 0);
    const [sl, setSl] = useState(parsed?.stopLoss || 0);
    const [qty, setQty] = useState(1); // Default to 1 lot
    const [selTarget, setSelTarget] = useState<number | null>(
        parsed?.targets && parsed.targets.length > 0 ? parsed.targets[0] : null
    );
    const [isExecuting, setIsExecuting] = useState(false);
    const [isExecuted, setIsExecuted] = useState(false);

    const [prodType, setProdType] = useState<'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF'>(
        parsed?.exchangeSegment === 'NSE_FNO' || parsed?.exchangeSegment === 'MCX_COMM' ? 'MARGIN' : 'CNC'
    );

    const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'SUPER'>(
        parsed?.suggestedEntryPrice && parsed.suggestedEntryPrice > 0 ? 'LIMIT' : 'MARKET'
    );
    const [triggerPrice, setTriggerPrice] = useState(parsed?.suggestedEntryPrice || 0);

    const parsedKey = typeof msg.parsedJson === 'object' ? JSON.stringify(msg.parsedJson) : msg.parsedJson;

    useEffect(() => {
        if (parsed) {
            setSymbol(parsed.tradingSymbol || '');
            setAct(parsed.action || 'BUY');
            setEntry(parsed.suggestedEntryPrice || 0);
            setSl(parsed.stopLoss || 0);
            setSelTarget(parsed.targets && parsed.targets.length > 0 ? parsed.targets[0] : null);
            setOrderType(parsed.suggestedEntryPrice && parsed.suggestedEntryPrice > 0 ? 'LIMIT' : 'MARKET');
            setTriggerPrice(parsed.suggestedEntryPrice || 0);
            const isFNO = parsed.exchangeSegment === 'NSE_FNO' || parsed.exchangeSegment === 'MCX_COMM';
            setProdType(isFNO ? 'MARGIN' : 'CNC');
        }
    }, [msg.id, parsedKey]);

    useEffect(() => {
        const checkExecutedStatus = async () => {
            if (!parsed?.tradingSymbol || !msg.receivedAt) return;
            try {
                const record = await db.parsed_signal_records
                    .where('timestamp')
                    .between(msg.receivedAt - 5000, msg.receivedAt + 5000)
                    .and((r) => r.parsed.tradingSymbol === parsed.tradingSymbol)
                    .first();
                if (record && record.status === 'EXECUTED') {
                    setIsExecuted(true);
                }
            } catch (err) {
                // Non-fatal
            }
        };
        checkExecutedStatus();
    }, [parsed, msg.receivedAt]);

    const handleExecuteOrder = async () => {
        if (!symbol) {
            toast.error('Scrip symbol is required.');
            triggerHapticNotification('error');
            return;
        }
        triggerHapticImpact('medium');
        setIsExecuting(true);
        try {
            // Normalize exchangeSegment and productType
            let finalExchangeSegment: any = parsed?.exchangeSegment || 'NSE_FNO';
            if (finalExchangeSegment === 'NSE') finalExchangeSegment = 'NSE_EQ';
            if (finalExchangeSegment !== 'NSE_EQ' && finalExchangeSegment !== 'NSE_FNO' && finalExchangeSegment !== 'BSE_EQ' && finalExchangeSegment !== 'MCX_COMM') {
                finalExchangeSegment = 'NSE_EQ';
            }

            let finalProductType: any = parsed?.productType || 'MARGIN';
            if (finalProductType === 'EQUITY' || finalProductType === 'CNC_DELIVERY') {
                finalProductType = 'CNC';
            }
            if (finalProductType !== 'CNC' && finalProductType !== 'INTRADAY' && finalProductType !== 'MARGIN' && finalProductType !== 'MTF' && finalProductType !== 'CO' && finalProductType !== 'BO') {
                finalProductType = (finalExchangeSegment === 'NSE_EQ' || finalExchangeSegment === 'BSE_EQ') ? 'CNC' : 'MARGIN';
            }

            const orderRequest: any = {
                transactionType: act,
                exchangeSegment: finalExchangeSegment as any,
                productType: (orderType === 'SUPER' ? 'BO' : prodType) as any,
                orderType: (orderType === 'SUPER' ? 'LIMIT' : (orderType === 'STOP_LOSS' ? 'STOP_LOSS' : orderType)) as any,
                validity: 'DAY',
                tradingSymbol: symbol,
                securityId: '0',
                quantity: qty,
                price: orderType === 'MARKET' ? 0 : entry,
                triggerPrice: orderType === 'STOP_LOSS' ? triggerPrice : 0,
                disclosedQuantity: 0,
                afterMarketOrder: false
            };

            if (orderType === 'SUPER') {
                // Calculate difference values for BO (Bracket Order)
                const targetDiff = selTarget ? Math.abs(selTarget - entry) : 2.0;
                const slDiff = sl ? Math.abs(entry - sl) : 1.0;
                orderRequest.boProfitValue = Number(targetDiff.toFixed(2));
                orderRequest.boStopLossValue = Number(slDiff.toFixed(2));
            }
            
            let response: any = null;

            if (execTarget === 'OPENALGO') {
                const oaPayload = {
                    apikey: localStorage.getItem('openalgo_api_key') || 'openalgo_mcp_api_key_2026',
                    strategy: 'TELEGRAM_PREMIUM_EAR',
                    symbol: symbol,
                    action: act,
                    exchange: finalExchangeSegment === 'NSE_FNO' ? 'NFO' : (finalExchangeSegment === 'BSE_EQ' ? 'BSE' : 'NSE'),
                    quantity: qty,
                    pricetype: orderType === 'STOP_LOSS' ? 'SL' : (orderType === 'LIMIT' ? 'LIMIT' : 'MARKET'),
                    product: prodType === 'CNC' ? 'CNC' : 'MIS',
                    price: orderType === 'MARKET' ? 0 : entry,
                    trigger_price: orderType === 'STOP_LOSS' ? triggerPrice : 0,
                    disclosed_quantity: 0
                };

                // Try placing order via Python Bridge Sandbox proxy first (canonicalizes symbols via symtoken)
                let oaRes = await fetch('/api/python-nse/api/openalgo/placeorder-sandbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(oaPayload)
                }).catch(() => null);

                // Fallback to direct OpenAlgo proxy if bridge endpoint unavailable
                if (!oaRes || !oaRes.ok) {
                    oaRes = await fetch('/openalgo/api/v1/placeorder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(oaPayload)
                    }).catch(() => null);
                }

                if (oaRes && oaRes.ok) {
                    const oaData = await oaRes.json().catch(() => ({}));
                    const placedId = oaData.orderid || oaData.data?.orderid || `OA-${Date.now().toString().slice(-6)}`;
                    response = { success: true, result: { orderId: placedId } };
                } else {
                    const errDetail = oaRes ? await oaRes.text().catch(() => '') : '';
                    response = { success: false, result: { error: errDetail || 'OpenAlgo execution failed' } };
                }
            } else {
                const { DhanScripResolver } = await import('../../services/DhanScripResolver');
                const resolvedId = DhanScripResolver.resolveSecurityId(symbol);
                if (resolvedId) {
                    orderRequest.securityId = resolvedId;
                }

                const { telegramEarManager } = await import('../../services/TelegramEarManager');
                response = await telegramEarManager.executeOrder(orderRequest);
            }
            
            if (response && response.success) {
                toast.success(`🚀 Order executed successfully! Order ID: ${response.result.orderId}`);
                triggerHapticNotification('success');
                setIsExecuted(true);
                
                const now = Date.now();
                const record = await db.parsed_signal_records
                    .where('timestamp')
                    .between(msg.receivedAt - 5000, msg.receivedAt + 5000)
                    .and((r) => r.parsed.tradingSymbol === parsed?.tradingSymbol)
                    .first();
                if (record && record.id) {
                    await db.parsed_signal_records.update(record.id, {
                        status: 'EXECUTED',
                        executedAt: now
                    });
                } else {
                    await db.parsed_signal_records.add({
                        rawText: msg.text,
                        parsed: {
                            action: act,
                            tradingSymbol: symbol,
                            entry: entry,
                            sl: sl,
                            targets: parsed?.targets || [],
                            productType: parsed?.productType || 'MARGIN',
                            exchangeSegment: parsed?.exchangeSegment || 'NSE_FNO'
                        },
                        confidence: msg.confidence || 0.9,
                        source: 'TEXT',
                        status: 'EXECUTED',
                        timestamp: msg.receivedAt || Date.now(),
                        executedAt: now,
                        ticker: symbol
                    });
                }

                const signal = await db.parsed_signals
                    .where('instrument')
                    .equals(parsed?.tradingSymbol || '')
                    .first();
                if (signal && signal.id) {
                    await db.parsed_signals.update(signal.id, {
                        status: 'ACTIVE'
                    });
                }
                
                window.dispatchEvent(new CustomEvent('signal-ledger-refresh'));
                
            } else {
                const errMsg = response?.result?.remarks || response?.result?.error || 'Execution failed';
                toast.error(`❌ Execution Failed: ${errMsg}`);
                triggerHapticNotification('error');
            }
        } catch (error: any) {
            console.error('Inline Execution Failed:', error);
            toast.error(`❌ Execution Failed: ${error.message || error}`);
            triggerHapticNotification('error');
        } finally {
            setIsExecuting(false);
        }
    };
    const confPct = (msg.confidence || 0.7) * 100;
    const confColor = confidenceColor((msg.confidence || 0.7));

    const handleStar = () => {
        setPopped(true);
        onToggleStar(msg);
        window.setTimeout(() => setPopped(false), 380);
    };

    return (
        <motion.article
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className={[
                styles.card,
                isSignal ? styles.signal : '',
                isNews ? styles.news : '',
                isFresh ? `${styles.fresh} ${anim.arrivalGlow}` : '',
                isMenuOpen ? styles.menuOpen : '',
            ].filter(Boolean).join(' ')}
            style={{ ['--ear-color' as any]: earColor || 'rgba(255,255,255,0.18)' }}
        >
            <span className={styles.leftGlow} aria-hidden />

            {/* Header */}
            <div className={styles.headerRow}>
                <div className={styles.senderInfo}>
                    <span className={styles.avatar} style={{ background: `linear-gradient(135deg, ${earColor || '#8b5cf6'} 0%, rgba(0,0,0,0.4) 130%)` }}>
                        {(msg.channelName || 'TG').charAt(0).toUpperCase()}
                    </span>
                    <div className={styles.senderMeta}>
                        <span className={styles.channelName}>{msg.channelName || 'Telegram'}</span>
                        <span className={styles.timestamp} title={fmtTimeFull(msg.receivedAt)}>
                            {fmtTime(msg.receivedAt)} · <span className={styles.relTime}>{relTime(msg.receivedAt)} ago</span>
                        </span>
                    </div>
                </div>
                <div className={styles.cardActions}>
                    {isSignal && parsed && (
                        <div className={styles.hoverToolbar}>
                            <button className={`${styles.toolBtn} ${styles.toolFill}`} onClick={() => onAutofill(msg)}>
                                <Zap size={12} /> Auto-fill
                            </button>
                            <button className={styles.toolBtn} onClick={() => onOpenPositionSizer(parsed)}>
                                <Activity size={12} /> Sizer
                            </button>
                            {parsed.tradingSymbol && (
                                <div className={styles.toolPool}>
                                    <PoolTelegramPushButton
                                        ticker={parsed.tradingSymbol}
                                        channelName={msg.channelName}
                                        messageId={msg.id}
                                        threadId={msg.threadId}
                                        caption={msg.text?.slice(0, 200)}
                                        compact
                                    />
                                </div>
                            )}
                            {msg.threadId && (
                                <button className={styles.toolBtn} onClick={() => onToggleThread(msg.threadId!)}>
                                    {isThreadExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                    {isThreadExpanded ? 'Hide' : 'Timeline'}
                                </button>
                            )}
                            <button className={styles.toolBtn} onClick={() => onOpenDetail(msg)} title="Open detail">
                                <ExternalLink size={12} />
                            </button>
                        </div>
                    )}
                    <button
                        className={`${styles.actionBtn} ${msg.isStarred === 1 ? styles.starred : ''} ${popped ? anim.starPop : ''}`}
                        onClick={handleStar}
                        title="Star"
                        aria-label="Star message"
                    >
                        <Star size={13} fill={msg.isStarred === 1 ? 'currentColor' : 'none'} />
                    </button>
                    <MessageCardMenu
                        msg={msg}
                        hasPoolButton={isSignal}
                        onAddToJournal={() => onAddToJournal(msg)}
                        onOpenChart={() => onOpenChart(msg)}
                        onCopyRaw={() => onCopyRaw(msg)}
                        onOpenDetail={() => onOpenDetail(msg)}
                        onOpenChange={setIsMenuOpen}
                    />
                </div>
            </div>

            {/* Body */}
            {isSignal && parsed ? (
                <div className={styles.signalContent}>
                    <div className={styles.badgeRow}>
                        <span className={`${styles.badgeAction} ${parsed.action === 'BUY' ? styles.buy : styles.sell}`}>
                            {parsed.action === 'BUY' ? <TrendingUp size={10} /> : <Activity size={10} />}
                            {parsed.action}
                        </span>
                        <span className={styles.signalSymbol}>
                            {parsed.tradingSymbol && parsed.tradingSymbol !== 'UNKNOWN' ? parsed.tradingSymbol : '—'}
                        </span>
                        {msg.parsedJson && (() => {
                            try {
                                const raw = typeof msg.parsedJson === 'object' ? msg.parsedJson : JSON.parse(msg.parsedJson) as any;
                                const strike = raw.strike;
                                const optType = raw.type;
                                if (strike && optType) {
                                    return (
                                        <span className={styles.strikeChip}>
                                            {strike} {optType}
                                        </span>
                                    );
                                }
                            } catch { /* ignore */ }
                            return null;
                        })()}
                        {dteDetails && (
                            <span className={`${styles.expiryBadge} ${styles[dteDetails.class] || ''}`}>
                                {dteDetails.label}
                            </span>
                        )}
                    </div>

                    <div className={styles.levelsBlock}>
                        <div className={`${styles.levelItem} ${styles.entry}`}>
                            <span className={styles.levelLbl}>ENTRY</span>
                            <span className={styles.levelVal}>
                                {parsed.suggestedEntryPrice && parsed.suggestedEntryPrice > 0 ? `₹${parsed.suggestedEntryPrice}` : '—'}
                            </span>
                        </div>
                        <div className={`${styles.levelItem} ${styles.sl}`}>
                            <span className={styles.levelLbl}>STOPLOSS</span>
                            <span className={styles.levelVal}>
                                {parsed.stopLoss && parsed.stopLoss > 0 ? `₹${parsed.stopLoss}` : '—'}
                            </span>
                        </div>
                        <div className={`${styles.levelItem} ${styles.targets}`}>
                            <span className={styles.levelLbl}>TARGETS</span>
                            <span className={styles.levelVal}>
                                {Array.isArray(parsed.targets) && parsed.targets.length > 0
                                    ? parsed.targets.join(' → ')
                                    : '—'}
                            </span>
                        </div>
                    </div>

                    <div className={styles.metaRow}>
                        <ConfidenceRing pct={confPct} color={confColor} />
                        <div className={styles.metaPills}>
                            {parsed.exchangeSegment && <span className={styles.metaPill}>{parsed.exchangeSegment}</span>}
                            {parsed.productType && <span className={styles.metaPill}>{parsed.productType}</span>}
                            {parsed.expiryDate && (
                                <span className={styles.metaPill}>
                                    <span className={styles.metaPillLbl}>EXP</span> {parsed.expiryDate}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Always-visible operations row (visible when not hovering) */}
                    <div className={styles.operationsRow}>
                        <button className={`${styles.opsBtn} ${styles.fill}`} onClick={() => onAutofill(msg)}>
                            <Zap size={11} /> Auto-fill Order
                        </button>
                        <button className={styles.opsBtn} onClick={() => onOpenPositionSizer(parsed)}>
                            <Activity size={11} /> Position Sizer
                        </button>
                        <PoolTelegramPushButton
                            ticker={parsed?.tradingSymbol || (parsed as any)?.symbol || (msg as any).ticker || ''}
                            channelName={msg.channelName}
                            messageId={(msg as any).messageId ?? msg.id}
                            caption={msg.text?.slice(0, 120)}
                            compact={false}
                        />
                        {msg.threadId && (
                            <button className={styles.opsBtn} onClick={() => onToggleThread(msg.threadId!)}>
                                {isThreadExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                {isThreadExpanded ? 'Hide Thread' : 'Show Timeline'}
                            </button>
                        )}
                    </div>

                    {/* Inline Order Execution Panel */}
                    <div className={styles.executionPanel}>
                        <div className={styles.executionHeader}>
                            <div className={styles.executionTitle}>
                                <Zap size={11} style={{ color: 'var(--tlh-violet)' }} />
                                <span>Order Execution Desk</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                    type="button"
                                    onClick={() => setExecTarget('OPENALGO')}
                                    disabled={isExecuting || isExecuted}
                                    style={{
                                        padding: '2px 8px',
                                        fontSize: '9px',
                                        fontWeight: 700,
                                        borderRadius: '6px',
                                        border: execTarget === 'OPENALGO' ? '1px solid #10b981' : '1px solid rgba(255,255,255,0.1)',
                                        background: execTarget === 'OPENALGO' ? 'rgba(16,185,129,0.18)' : 'transparent',
                                        color: execTarget === 'OPENALGO' ? '#34d399' : '#94a3b8',
                                        cursor: 'pointer'
                                    }}
                                >
                                    OpenAlgo Sandbox
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExecTarget('DHAN')}
                                    disabled={isExecuting || isExecuted}
                                    style={{
                                        padding: '2px 8px',
                                        fontSize: '9px',
                                        fontWeight: 700,
                                        borderRadius: '6px',
                                        border: execTarget === 'DHAN' ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.1)',
                                        background: execTarget === 'DHAN' ? 'rgba(99,102,241,0.18)' : 'transparent',
                                        color: execTarget === 'DHAN' ? '#818cf8' : '#94a3b8',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Dhan HQ
                                </button>
                                {isExecuted && (
                                    <span className={styles.executedBadge} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '9.5px', fontWeight: 800, color: 'var(--tlh-emerald)' }}>
                                        <Check size={10} />
                                        <span>Executed</span>
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Product Type Tabs */}
                        <div className={styles.productTabs}>
                            {(() => {
                                const isFNO = parsed?.exchangeSegment === 'NSE_FNO' || parsed?.exchangeSegment === 'MCX_COMM';
                                if (isFNO) {
                                    return (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isExecuting || isExecuted}
                                                onClick={() => setProdType('INTRADAY')}
                                                className={`${styles.productTab} ${prodType === 'INTRADAY' ? styles.active : ''}`}
                                            >
                                                Trading
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isExecuting || isExecuted}
                                                onClick={() => setProdType('MARGIN')}
                                                className={`${styles.productTab} ${prodType === 'MARGIN' ? styles.active : ''}`}
                                            >
                                                Margin
                                            </button>
                                        </>
                                    );
                                } else {
                                    return (
                                        <>
                                            <button
                                                type="button"
                                                disabled={isExecuting || isExecuted}
                                                onClick={() => setProdType('INTRADAY')}
                                                className={`${styles.productTab} ${prodType === 'INTRADAY' ? styles.active : ''}`}
                                            >
                                                Trading
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isExecuting || isExecuted}
                                                onClick={() => setProdType('MTF')}
                                                className={`${styles.productTab} ${prodType === 'MTF' ? styles.active : ''}`}
                                            >
                                                Pay Later <span className={styles.mtfLabel}>via MTF</span>
                                            </button>
                                            <button
                                                type="button"
                                                disabled={isExecuting || isExecuted}
                                                onClick={() => setProdType('CNC')}
                                                className={`${styles.productTab} ${prodType === 'CNC' ? styles.active : ''}`}
                                            >
                                                Investing
                                            </button>
                                        </>
                                    );
                                }
                            })()}
                        </div>

                        {/* Order Type Tabs */}
                        <div className={styles.orderTypeTabs}>
                            <button
                                type="button"
                                disabled={isExecuting || isExecuted}
                                onClick={() => {
                                    setOrderType('MARKET');
                                    setEntry(0);
                                }}
                                className={`${styles.orderTypeTab} ${orderType === 'MARKET' ? styles.active : ''}`}
                            >
                                Market
                            </button>
                            <button
                                type="button"
                                disabled={isExecuting || isExecuted}
                                onClick={() => {
                                    setOrderType('LIMIT');
                                    if (entry === 0) setEntry(parsed?.suggestedEntryPrice || 0);
                                }}
                                className={`${styles.orderTypeTab} ${orderType === 'LIMIT' ? styles.active : ''}`}
                            >
                                Limit
                            </button>
                            <button
                                type="button"
                                disabled={isExecuting || isExecuted}
                                onClick={() => {
                                    setOrderType('SUPER');
                                    if (entry === 0) setEntry(parsed?.suggestedEntryPrice || 0);
                                }}
                                className={`${styles.orderTypeTab} ${orderType === 'SUPER' ? styles.active : ''}`}
                            >
                                Super
                            </button>
                            <button
                                type="button"
                                disabled={isExecuting || isExecuted}
                                onClick={() => {
                                    setOrderType('STOP_LOSS');
                                    if (triggerPrice === 0) setTriggerPrice(entry || parsed?.suggestedEntryPrice || 0);
                                }}
                                className={`${styles.orderTypeTab} ${orderType === 'STOP_LOSS' ? styles.active : ''}`}
                            >
                                Trigger
                            </button>
                        </div>

                        <div className={styles.executionGrid}>
                            <div className={styles.inputGroup}>
                                <span className={styles.inputLabel}>Scrip / Symbol</span>
                                <input
                                    type="text"
                                    value={symbol}
                                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                    disabled={isExecuting || isExecuted}
                                    className={styles.inputField}
                                />
                            </div>

                            <div className={styles.inputGroup}>
                                <span className={styles.inputLabel}>Action</span>
                                <select
                                    value={act}
                                    onChange={(e) => setAct(e.target.value as 'BUY' | 'SELL')}
                                    disabled={isExecuting || isExecuted}
                                    className={styles.selectField}
                                >
                                    <option value="BUY">BUY</option>
                                    <option value="SELL">SELL</option>
                                </select>
                            </div>

                            <div className={styles.inputGroup}>
                                <span className={styles.inputLabel}>Price / Level</span>
                                {orderType === 'MARKET' ? (
                                    <input
                                        type="text"
                                        value="LTP (Market)"
                                        disabled
                                        className={styles.inputField}
                                        style={{ opacity: 0.6 }}
                                    />
                                ) : orderType === 'STOP_LOSS' ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
                                        <input
                                            type="number"
                                            value={triggerPrice || ''}
                                            onChange={(e) => {
                                                const v = Number(e.target.value);
                                                setTriggerPrice(v);
                                                setEntry(v); // Keep limit price aligned for safety
                                            }}
                                            placeholder="Trig"
                                            disabled={isExecuting || isExecuted}
                                            className={styles.inputField}
                                            title="Trigger Price"
                                            style={{ width: '50%', minWidth: '40px' }}
                                        />
                                        <span style={{ color: 'var(--tlh-text-faint)', fontSize: '8px' }}>Lmt</span>
                                        <input
                                            type="number"
                                            value={entry || ''}
                                            onChange={(e) => setEntry(Number(e.target.value))}
                                            placeholder="Limit"
                                            disabled={isExecuting || isExecuted}
                                            className={styles.inputField}
                                            title="Limit Price"
                                            style={{ width: '50%', minWidth: '40px' }}
                                        />
                                    </div>
                                ) : (
                                    <input
                                        type="number"
                                        value={entry || ''}
                                        onChange={(e) => setEntry(Number(e.target.value))}
                                        placeholder="Price"
                                        disabled={isExecuting || isExecuted}
                                        className={styles.inputField}
                                    />
                                )}
                            </div>

                            <div className={styles.inputGroup}>
                                <span className={styles.inputLabel}>Stop Loss</span>
                                <input
                                    type="number"
                                    value={sl || ''}
                                    onChange={(e) => setSl(Number(e.target.value))}
                                    placeholder="None"
                                    disabled={isExecuting || isExecuted}
                                    className={styles.inputField}
                                    style={{ color: 'var(--tlh-rose)' }}
                                />
                            </div>

                            <div className={styles.inputGroup}>
                                <span className={styles.inputLabel}>Lot / Quantity</span>
                                <input
                                    type="number"
                                    value={qty}
                                    onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
                                    min="1"
                                    disabled={isExecuting || isExecuted}
                                    className={styles.inputField}
                                    style={{ color: 'var(--tlh-blue)' }}
                                />
                            </div>
                        </div>

                        {parsed.targets && parsed.targets.length > 0 && (
                            <div className={styles.targetSelectBlock}>
                                <span className={styles.inputLabel}>Select Target Price</span>
                                <div className={styles.targetChips}>
                                    {parsed.targets.map((tgt, i) => (
                                        <button
                                            key={i}
                                            disabled={isExecuting || isExecuted}
                                            onClick={() => setSelTarget(tgt)}
                                            className={`${styles.targetChip} ${selTarget === tgt ? styles.active : ''}`}
                                        >
                                            T{i + 1}: ₹{tgt}
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        placeholder="Custom Target"
                                        value={parsed.targets.includes(selTarget || 0) || selTarget === null ? '' : selTarget}
                                        onChange={(e) => setSelTarget(Number(e.target.value))}
                                        disabled={isExecuting || isExecuted}
                                        className={styles.customTargetInput}
                                    />
                                </div>
                            </div>
                        )}

                        <button
                            onClick={handleExecuteOrder}
                            disabled={isExecuting || isExecuted}
                            className={`${styles.executeBtn} ${isExecuted ? styles.executed : ''}`}
                        >
                            {isExecuting ? (
                                <>
                                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    <span>Punching via {execTarget === 'OPENALGO' ? 'OpenAlgo Sandbox' : 'Dhan'}...</span>
                                </>
                            ) : isExecuted ? (
                                <>
                                    <Check size={12} />
                                    <span>Order Sent to {execTarget === 'OPENALGO' ? 'OpenAlgo Sandbox' : 'Dhan'}</span>
                                </>
                            ) : (
                                <>
                                    <Zap size={12} />
                                    <span>1-Click Punch ({act} via {execTarget === 'OPENALGO' ? 'OpenAlgo' : 'Dhan'})</span>
                                </>
                            )}
                        </button>
                    </div>

                    <AnimatePresence initial={false}>
                        {msg.threadId && isThreadExpanded && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                                style={{ overflow: 'hidden' }}
                            >
                                <div className={styles.threadContainer}>
                                    <div className={styles.timelineTitle}>
                                        <span className={styles.timelineDot} />
                                        Thread Timeline
                                    </div>
                                    <div className={styles.timelineLine}>
                                        {(threadMessages || []).map((tMsg, tIdx) => {
                                            const isUpdate = tMsg.isLifecycle === 1;
                                            return (
                                                <div key={tMsg.id || tIdx} className={`${styles.timelineNode} ${isUpdate ? styles.update : ''}`}>
                                                    <div className={styles.nodeMarker}>
                                                        {isUpdate ? <span className={styles.nodeCheck}>✓</span> : null}
                                                    </div>
                                                    <div className={styles.nodeContent}>
                                                        <span className={styles.nodeTime}>{fmtTime(tMsg.receivedAt)}</span>
                                                        <p className={styles.nodeText}>{tMsg.text}</p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {(!threadMessages || threadMessages.length === 0) && (
                                            <div className={styles.nodeText} style={{ color: 'var(--tlh-text-faint)', fontStyle: 'italic' }}>
                                                Loading thread…
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            ) : isNews ? (
                <div className={styles.newsContent}>
                    {newsTags.length > 0 && (
                        <div className={styles.newsTags}>
                            {newsTags.map((tag, idx) => (
                                <span key={idx} className={`${styles.newsTagPill} ${styles[`tag_${tag.toLowerCase()}`] || ''}`}>
                                    {newsTagIcon[tag.toLowerCase()] || <Newspaper size={8} />}
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                    <p className={styles.newsText}>{msg.text}</p>
                </div>
            ) : (
                <div className={styles.archiveContent}>
                    <p className={styles.archiveText}>{msg.text}</p>
                </div>
            )}
        </motion.article>
    );
};

/* Confidence ring — circular SVG meter that morphs color */
const ConfidenceRing: React.FC<{ pct: number; color: string }> = ({ pct, color }) => {
    const radius = 14;
    const circ = 2 * Math.PI * radius;
    const offset = circ - (pct / 100) * circ;
    return (
        <div className={styles.ringWrap} title={`Confidence ${pct.toFixed(0)}%`}>
            <svg width="36" height="36" viewBox="0 0 36 36" className={styles.ring}>
                <defs>
                    <linearGradient id={`conf-grad-${pct.toFixed(0)}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={color} stopOpacity="1" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.6" />
                    </linearGradient>
                </defs>
                <circle cx="18" cy="18" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                <circle
                    cx="18" cy="18" r={radius}
                    fill="none"
                    stroke={`url(#conf-grad-${pct.toFixed(0)})`}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={circ}
                    strokeDashoffset={offset}
                    transform="rotate(-90 18 18)"
                    style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                />
            </svg>
            <span className={styles.ringValue} style={{ color }}>{pct.toFixed(0)}</span>
        </div>
    );
};

export default MessageCard;
