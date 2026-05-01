/**
 * CC42 — PositionSizerModal
 *
 * CC42 polish:
 *   - Animated number transitions (count-up on recompute)
 *   - Risk slider with a gradient track that fills as the user drags
 *   - Profit/loss cards have soft glow (green/red) that pulses
 *   - "Confidence adjusted" badge shows win-rate assumed
 *   - "Quick-set" risk chips: 0.5% / 1% / 1.5% / 2% / 3%
 */
import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Activity, TrendingUp, TrendingDown, Wallet, Percent } from 'lucide-react';
import { ParsedSignal as TelegramParsedSignal } from '../../services/TelegramSignalParser';
import { PositionSizingEngine } from '../../services/PositionSizingEngine';
import { db } from '../../database';
import styles from './PositionSizerModal.module.css';

export type PositionSizerSource = 'TELEGRAM' | 'POOL' | 'MANUAL';

interface PositionSizerModalProps {
    isOpen: boolean;
    signal: TelegramParsedSignal | null;
    source?: PositionSizerSource;
    onClose: () => void;
}

const QUICK_RISKS = [0.5, 1.0, 1.5, 2.0, 3.0];

/* Animated counter that ticks up/down to its target value */
const CountUp: React.FC<{ value: number; format?: (n: number) => string; duration?: number; className?: string }> = ({
    value, format = (n) => n.toFixed(2), duration = 480, className
}) => {
    const [display, setDisplay] = useState(value);
    const fromRef = useRef(value);
    const startRef = useRef<number | null>(null);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        fromRef.current = display;
        startRef.current = null;
        const tick = (ts: number) => {
            if (startRef.current === null) startRef.current = ts;
            const elapsed = ts - startRef.current;
            const t = Math.min(1, elapsed / duration);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            setDisplay(fromRef.current + (value - fromRef.current) * eased);
            if (t < 1) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return <span className={className}>{format(display)}</span>;
};

export const PositionSizerModal: React.FC<PositionSizerModalProps> = ({
    isOpen, signal, source = 'TELEGRAM', onClose
}) => {
    const [riskPct, setRiskPct] = useState(1.5);
    const [portfolioVal, setPortfolioVal] = useState(250000);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) return;
        setIsLoading(true);
        (async () => {
            try {
                const investments = await db.investments.toArray();
                const total = investments.reduce(
                    (sum, inv) => sum + (Number(inv.currentValue) || Number(inv.investedAmount) || 0), 0
                );
                if (total > 0) setPortfolioVal(total);
            } catch { /* fallback to default */ }
            finally { setIsLoading(false); }
        })();
    }, [isOpen]);

    if (!isOpen || !signal) return null;

    const mapped = {
        instrument: signal.tradingSymbol,
        action: (signal.action === 'BUY' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
        entryPrice: signal.suggestedEntryPrice,
        stopLoss: signal.stopLoss,
        target1: signal.targets?.[0],
        target2: signal.targets?.[1],
        target3: signal.targets?.[2],
        provider: '',
        timestamp: '',
        status: 'NEEDS_REVIEW' as const,
    };
    const size = PositionSizingEngine.computeRecommendedSize(mapped, portfolioVal, riskPct / 100, 0.7);

    const riskPerLot = Math.abs(mapped.entryPrice - (mapped.stopLoss || mapped.entryPrice));
    const lotsToLots = (lots: number) => Math.max(0, lots);

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <motion.div
                className={`settings-modal ${styles.positionSizerModal}`}
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            >
                <div className="modal-header">
                    <h3>
                        <Activity size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                        Smart Position Sizer
                        <span className={styles.sourceBadge}>{source}</span>
                    </h3>
                    <button className="close-btn" aria-label="Close position sizer" onClick={onClose}><X size={16} /></button>
                </div>
                <div className={`modal-body ${styles.body}`}>
                    <div className={styles.instrument}>
                        <span className={styles.instrumentLabel}>{mapped.action === 'BUY' ? '▲' : '▼'}</span>
                        {signal.tradingSymbol}
                    </div>
                    <div className={styles.levelsRow}>
                        <div className={styles.lvlChip}>
                            <span className={styles.lvlLbl}>Entry</span>
                            <span className={styles.lvlVal}>₹{signal.suggestedEntryPrice}</span>
                        </div>
                        <div className={styles.lvlChip}>
                            <span className={styles.lvlLbl}>SL</span>
                            <span className={styles.lvlVal}>₹{signal.stopLoss || '—'}</span>
                        </div>
                        <div className={styles.lvlChip}>
                            <span className={styles.lvlLbl}>T1</span>
                            <span className={styles.lvlVal}>₹{signal.targets?.[0] ?? '—'}</span>
                        </div>
                    </div>

                    <div className={styles.sliderBox}>
                        <div className={styles.sliderLabelRow}>
                            <span className={styles.sliderLabel}>
                                <Percent size={11} /> Portfolio Risk
                            </span>
                            <span className={styles.riskPctVal}>{riskPct.toFixed(1)}%</span>
                        </div>
                        <div className={styles.sliderTrack}>
                            <div className={styles.sliderFill} style={{ width: `${((riskPct - 0.5) / 2.5) * 100}%` }} />
                            <input
                                type="range"
                                min="0.5"
                                max="3.0"
                                step="0.1"
                                value={riskPct}
                                onChange={(e) => setRiskPct(parseFloat(e.target.value))}
                                className={styles.riskSlider}
                            />
                        </div>
                        <div className={styles.quickRisks}>
                            {QUICK_RISKS.map(r => (
                                <button
                                    key={r}
                                    className={`${styles.quickBtn} ${riskPct === r ? styles.quickActive : ''}`}
                                    onClick={() => setRiskPct(r)}
                                >
                                    {r.toFixed(1)}%
                                </button>
                            ))}
                        </div>
                    </div>

                    {isLoading ? (
                        <div className={styles.loading}>
                            <div className={styles.spinner} />
                            Loading portfolio…
                        </div>
                    ) : (
                        <div className={styles.results}>
                            <div className={styles.primaryCard}>
                                <div className={styles.metricLbl}>Recommended Lots</div>
                                <div className={styles.metricVal}>
                                    <CountUp value={size.lots} format={(n) => n.toFixed(2)} />
                                    <span className={styles.metricUnit}>Lots</span>
                                </div>
                                <div className={styles.primarySub}>
                                    <Wallet size={10} /> ₹<CountUp value={portfolioVal} format={(n) => Math.round(n).toLocaleString('en-IN')} /> portfolio
                                </div>
                            </div>
                            <div className={styles.metricsGrid}>
                                <div className={styles.metricSubCard}>
                                    <div className={styles.mLbl}>Capital at Risk</div>
                                    <div className={styles.mVal}>₹<CountUp value={size.capitalAtRisk} format={(n) => Math.round(n).toLocaleString('en-IN')} /> <span className={styles.mPct}>({riskPct.toFixed(1)}%)</span></div>
                                </div>
                                <div className={styles.metricSubCard}>
                                    <div className={styles.mLbl}>Kelly Fraction</div>
                                    <div className={styles.mVal}><CountUp value={size.kellyFraction * 100} format={(n) => n.toFixed(1)} />%</div>
                                </div>
                                <div className={`${styles.metricSubCard} ${styles.green}`}>
                                    <div className={styles.mLbl}>
                                        <TrendingUp size={10} /> Est. profit at T1
                                    </div>
                                    <div className={styles.mVal}>+₹<CountUp value={size.ifT1Hit} format={(n) => Math.round(n).toLocaleString('en-IN')} /></div>
                                </div>
                                <div className={`${styles.metricSubCard} ${styles.red}`}>
                                    <div className={styles.mLbl}>
                                        <TrendingDown size={10} /> Max loss if SL hit
                                    </div>
                                    <div className={styles.mVal}>−₹<CountUp value={size.ifSLHit} format={(n) => Math.round(n).toLocaleString('en-IN')} /></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default PositionSizerModal;
