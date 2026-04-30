/**
 * CC42 — ParsedSignalEditor
 *
 * Editable preview card that pops after OCR. CC42 polish:
 *   - Inline validation (red border on invalid number)
 *   - Save buttons have hover glow + success checkmark on click
 *   - Live confidence ring (mirrors the one in MessageCard)
 *   - Two-step destructive cancel (click once → "Confirm?")
 */
import React, { useState, useRef, useEffect } from 'react';
import { X, Zap, Save, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ParsedSignalRecord } from '../../database';
import styles from './ParsedSignalEditor.module.css';

interface ParsedSignalEditorProps {
    record: Omit<ParsedSignalRecord, 'id' | 'timestamp' | 'status'>;
    onSave: (markExecuted: boolean) => void;
    onCancel: () => void;
    onChange: (patch: Partial<Omit<ParsedSignalRecord, 'id' | 'timestamp' | 'status'>>) => void;
}

const ConfidenceRing: React.FC<{ pct: number }> = ({ pct }) => {
    const radius = 16;
    const circ = 2 * Math.PI * radius;
    const offset = circ - (pct / 100) * circ;
    const color = pct >= 70 ? '#34d399' : pct >= 40 ? '#fbbf24' : '#fb7185';
    return (
        <div className={styles.ringWrap} title={`Confidence ${pct.toFixed(0)}%`}>
            <svg width="38" height="38" viewBox="0 0 38 38">
                <circle cx="19" cy="19" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                <circle
                    cx="19" cy="19" r={radius}
                    fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={circ} strokeDashoffset={offset}
                    transform="rotate(-90 19 19)"
                    style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)' }}
                />
            </svg>
            <span className={styles.ringValue} style={{ color }}>{pct.toFixed(0)}</span>
        </div>
    );
};

export const ParsedSignalEditor: React.FC<ParsedSignalEditorProps> = ({ record, onSave, onCancel, onChange }) => {
    const [confirming, setConfirming] = useState(false);
    const confirmTimer = useRef<number | null>(null);

    useEffect(() => () => { if (confirmTimer.current) window.clearTimeout(confirmTimer.current); }, []);

    const updateField = (field: 'action' | 'tradingSymbol' | 'entry' | 'sl' | 'targetsRaw' | 'expiry', value: any) => {
        const parsed = { ...record.parsed };
        if (field === 'targetsRaw') {
            const parts = String(value).split(/[\/,]/).map(p => parseFloat(p.trim())).filter(n => !Number.isNaN(n));
            parsed.targets = parts;
        } else if (field === 'entry') {
            parsed.entry = parseFloat(value) || 0;
        } else if (field === 'sl') {
            parsed.sl = parseFloat(value) || 0;
        } else if (field === 'action') {
            parsed.action = value as 'BUY' | 'SELL';
        } else if (field === 'tradingSymbol') {
            parsed.tradingSymbol = value;
        } else if (field === 'expiry') {
            parsed.expiry = value || null;
        }
        onChange({ parsed, ticker: parsed.tradingSymbol });
    };

    const handleCancel = () => {
        if (!confirming) {
            setConfirming(true);
            confirmTimer.current = window.setTimeout(() => setConfirming(false), 2400);
            return;
        }
        if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
        onCancel();
    };

    const confPct = (record.confidence * 100);

    // Basic validation
    const symbolOk = !!record.parsed.tradingSymbol?.trim();
    const entryOk = record.parsed.entry > 0;
    const valid = symbolOk && entryOk;

    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <span className={styles.sourceTag}>{record.source}</span>
                <ConfidenceRing pct={confPct} />
                <span className={styles.confidence}>
                    Confidence: {confPct.toFixed(0)}%
                </span>
                <button className={styles.closeBtn} onClick={handleCancel} title={confirming ? 'Click again to confirm' : 'Discard'}>
                    {confirming ? <AlertCircle size={14} /> : <X size={14} />}
                </button>
            </div>
            <div className={styles.grid}>
                <div className={styles.field}>
                    <label>Action</label>
                    <select
                        value={record.parsed.action}
                        onChange={(e) => updateField('action', e.target.value)}
                        className={record.parsed.action === 'BUY' ? styles.fieldBuy : styles.fieldSell}
                    >
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                    </select>
                </div>
                <div className={`${styles.field} ${styles.wide}`}>
                    <label>Symbol</label>
                    <input
                        type="text"
                        value={record.parsed.tradingSymbol}
                        onChange={(e) => updateField('tradingSymbol', e.target.value)}
                        className={!symbolOk ? styles.invalid : ''}
                    />
                </div>
                <div className={styles.field}>
                    <label>Entry</label>
                    <input
                        type="number"
                        value={record.parsed.entry}
                        onChange={(e) => updateField('entry', e.target.value)}
                        className={!entryOk ? styles.invalid : ''}
                    />
                </div>
                <div className={styles.field}>
                    <label>SL</label>
                    <input
                        type="number"
                        value={record.parsed.sl}
                        onChange={(e) => updateField('sl', e.target.value)}
                    />
                </div>
                <div className={`${styles.field} ${styles.wide}`}>
                    <label>Targets (comma or / separated)</label>
                    <input
                        type="text"
                        value={(record.parsed.targets || []).join(', ')}
                        onChange={(e) => updateField('targetsRaw', e.target.value)}
                    />
                </div>
                <div className={styles.field}>
                    <label>Expiry</label>
                    <input
                        type="text"
                        placeholder="YYYY-MM-DD"
                        value={record.parsed.expiry ?? ''}
                        onChange={(e) => updateField('expiry', e.target.value)}
                    />
                </div>
            </div>
            <AnimatePresence>
                {confirming && (
                    <motion.div
                        className={styles.confirmHint}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                    >
                        Click again to discard
                    </motion.div>
                )}
            </AnimatePresence>
            <div className={styles.actions}>
                <button
                    className={`${styles.btn} ${styles.secondary} ${confirming ? styles.btnDanger : ''}`}
                    onClick={handleCancel}
                >
                    <X size={12} /> {confirming ? 'Confirm?' : 'Cancel'}
                </button>
                <button
                    className={`${styles.btn} ${styles.ghost}`}
                    onClick={() => onSave(false)}
                    disabled={!valid}
                    title="Add to ledger"
                >
                    <Save size={12} /> Save to Ledger
                </button>
                <button
                    className={`${styles.btn} ${styles.primary}`}
                    onClick={() => onSave(true)}
                    disabled={!valid}
                    title="Save and autofill order"
                >
                    <Zap size={12} /> Execute via Dhan/Upstox
                </button>
            </div>
        </div>
    );
};

export default ParsedSignalEditor;
