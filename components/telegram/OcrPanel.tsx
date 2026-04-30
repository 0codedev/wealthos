/**
 * CC42 — OcrPanel
 *
 * CC42 polish:
 *   - Dropzone uses a 3D tilt on drag, with a slowly-rotating dashed border
 *   - During OCR, a conic-gradient progress ring replaces the static strip
 *   - Result card "morphs in" from the dropzone position with framer-motion
 *   - Animated status text "loading model…" → "recognising text" → "parsing"
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Image as ImageIcon, Sparkles, FileScan, CheckCircle2 } from 'lucide-react';
import { ParsedSignalRecord } from '../../database';
import { TelegramSignalParser, regexParseSignal } from '../../services/TelegramSignalParser';
import { useToast } from '../shared/ToastProvider';
import { ParsedSignalEditor } from './ParsedSignalEditor';
import styles from './OcrPanel.module.css';
import anim from './animations.module.css';

export type OcrPending = {
    record: Omit<ParsedSignalRecord, 'id' | 'timestamp' | 'status'>;
    editable: boolean;
};

interface OcrPanelProps {
    pending: OcrPending | null;
    onParsed: (pending: OcrPending) => void;
    onSavePending: (markExecuted: boolean) => void;
    onCancelPending: () => void;
    compact?: boolean;
}

const STAGES = ['loading model…', 'recognising text…', 'parsing signal…'];

export const OcrPanel: React.FC<OcrPanelProps> = ({ pending, onParsed, onSavePending, onCancelPending, compact = false }) => {
    const { toast } = useToast();
    const [isOcrRunning, setIsOcrRunning] = useState(false);
    const [ocrProgress, setOcrProgress] = useState(0);
    const [ocrStatus, setOcrStatus] = useState('');
    const [ocrPreviewText, setOcrPreviewText] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [stageIdx, setStageIdx] = useState(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // Cycle through OCR status stages so the user sees progress even when
    // tesseract.js doesn't fire its own progress events (e.g. fast networks).
    useEffect(() => {
        if (!isOcrRunning) return;
        const i = window.setInterval(() => {
            setStageIdx(s => (s + 1) % STAGES.length);
        }, 1600);
        return () => window.clearInterval(i);
    }, [isOcrRunning]);

    const runOcrOnImage = useCallback(async (file: Blob) => {
        if (!file) return;
        setIsOcrRunning(true);
        setOcrProgress(0);
        setOcrStatus(STAGES[0]);
        setStageIdx(0);
        setOcrPreviewText('');
        try {
            const reader = new FileReader();
            const dataUrl: string = await new Promise((resolve, reject) => {
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const { OCREngine } = await import('../../services/ocrService');
            setOcrStatus(STAGES[1]);
            const result = await OCREngine.recognize(file, (p, s) => {
                setOcrProgress(Math.round((p || 0) * 100));
                if (s) setOcrStatus(s);
            });
            const text = (result.text || '').trim();
            setOcrPreviewText(text);
            setOcrProgress(95);
            setOcrStatus(STAGES[2]);
            if (!text) {
                toast.error('No text recognised in image. Try a clearer screenshot.');
                return;
            }
            const regex = regexParseSignal(text);
            const llmParsed = await TelegramSignalParser.parseRawSignal(text, result).catch(() => null);
            const finalParsed = llmParsed || TelegramSignalParser.parseSignalRegexOnly(text);
            if (!finalParsed) {
                toast.error('Could not extract a signal from the OCR text.');
                return;
            }
            setOcrProgress(100);
            const record: Omit<ParsedSignalRecord, 'id' | 'timestamp' | 'status'> = {
                rawText: text,
                parsed: {
                    action: finalParsed.action,
                    tradingSymbol: finalParsed.tradingSymbol,
                    strike: regex.strike,
                    type: regex.type,
                    entry: finalParsed.suggestedEntryPrice,
                    sl: finalParsed.stopLoss,
                    targets: finalParsed.targets,
                    expiry: finalParsed.expiryDate ?? regex.expiryDate ?? null,
                    productType: finalParsed.productType,
                    exchangeSegment: finalParsed.exchangeSegment,
                },
                confidence: finalParsed.confidence,
                source: 'OCR',
                ticker: finalParsed.tradingSymbol,
                ocrImageData: dataUrl,
                notes: 'Captured via OCR screenshot/paste',
            };
            onParsed({ record, editable: true });
            toast.success(`OCR parsed: ${finalParsed.tradingSymbol} (${(finalParsed.confidence * 100).toFixed(0)}%)`);
        } catch (err) {
            console.error('OCR pipeline failed', err);
            toast.error('OCR failed: ' + (err instanceof Error ? err.message : 'unknown error'));
        } finally {
            setIsOcrRunning(false);
            setTimeout(() => { setOcrProgress(0); setOcrStatus(''); }, 1800);
        }
    }, [toast, onParsed]);

    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            if (isOcrRunning) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) { e.preventDefault(); runOcrOnImage(file); return; }
                }
            }
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [isOcrRunning, runOcrOnImage]);

    const onDragOver = (e: React.DragEvent) => {
        if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setIsDragOver(true); }
    };
    const onDragLeave = (e: React.DragEvent) => {
        if (e.currentTarget === e.currentTarget) setIsDragOver(false);
    };
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) runOcrOnImage(file);
    };
    const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) runOcrOnImage(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <>
            <motion.div
                layout
                className={`${styles.dropRow} ${compact ? styles.compactRow : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <div
                    className={[
                        styles.dropzone,
                        isDragOver ? 'is-dragover' : '',
                        isOcrRunning ? 'is-running' : '',
                        pending ? 'has-result' : '',
                        compact ? styles.compact : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                >
                    <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickFile} />

                    {isOcrRunning ? (
                        compact ? (
                            <div className={styles.compactRunning} title={`OCR Running: ${ocrProgress}%`}>
                                <div className={styles.ringWrapCompact}>
                                    <svg width="28" height="28" viewBox="0 0 40 40" className={styles.ringSvg}>
                                        <defs>
                                            <linearGradient id="ocr-grad-compact" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stopColor="#a855f7" />
                                                <stop offset="50%" stopColor="#6366f1" />
                                                <stop offset="100%" stopColor="#22d3ee" />
                                            </linearGradient>
                                        </defs>
                                        <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                                        <circle
                                            cx="20" cy="20" r="16"
                                            fill="none"
                                            stroke="url(#ocr-grad-compact)"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                            strokeDasharray={`${(ocrProgress / 100) * 100.5} 100.5`}
                                            transform="rotate(-90 20 20)"
                                            style={{ transition: 'stroke-dasharray 240ms ease' }}
                                        />
                                    </svg>
                                    <Upload size={10} className={styles.ringIconCompact} />
                                </div>
                            </div>
                        ) : (
                            <div className={styles.runningRow}>
                                <div className={styles.ringWrap}>
                                    <svg width="40" height="40" viewBox="0 0 40 40" className={styles.ringSvg}>
                                        <defs>
                                            <linearGradient id="ocr-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stopColor="#a855f7" />
                                                <stop offset="50%" stopColor="#6366f1" />
                                                <stop offset="100%" stopColor="#22d3ee" />
                                            </linearGradient>
                                        </defs>
                                        <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                                        <circle
                                            cx="20" cy="20" r="16"
                                            fill="none"
                                            stroke="url(#ocr-grad)"
                                            strokeWidth="3"
                                            strokeLinecap="round"
                                            strokeDasharray={`${(ocrProgress / 100) * 100.5} 100.5`}
                                            transform="rotate(-90 20 20)"
                                            style={{ transition: 'stroke-dasharray 240ms ease' }}
                                        />
                                    </svg>
                                    <Upload size={14} className={styles.ringIcon} />
                                </div>
                                <div className={styles.runningMeta}>
                                    <span className={styles.runningTitle}>
                                        <Sparkles size={11} className={anim.pulse} />
                                        {ocrStatus || STAGES[stageIdx]}
                                    </span>
                                    <span className={styles.runningPct}>{ocrProgress}%</span>
                                </div>
                                <div className={styles.progressTrack}>
                                    <div className={styles.progressFill} style={{ width: `${ocrProgress}%` }} />
                                </div>
                            </div>
                        )
                    ) : pending ? (
                        compact ? (
                            <div className={styles.compactReady} title="Signal parsed and ready!">
                                <CheckCircle2 size={18} />
                            </div>
                        ) : (
                            <div className={styles.readyRow}>
                                <div className={styles.readyIcon}>
                                    <CheckCircle2 size={16} />
                                </div>
                                <div className={styles.readyMeta}>
                                    <span className={styles.readyTitle}>
                                        <FileScan size={11} /> Signal ready below ↓
                                    </span>
                                    <span className={styles.readySub}>Edit fields then save to ledger or execute</span>
                                </div>
                            </div>
                        )
                    ) : (
                        compact ? (
                            <div className={styles.compactIdle} title="OCR: Paste (Ctrl+V) or click to browse">
                                <ImageIcon size={18} />
                            </div>
                        ) : (
                            <div className={styles.idleRow}>
                                <div className={styles.idleIcon}>
                                    <ImageIcon size={16} />
                                </div>
                                <div className={styles.idleMeta}>
                                    <span className={styles.idleTitle}>
                                        Drop / paste / click — OCR screenshot to signal
                                    </span>
                                    <span className={styles.idleSub}>
                                        <kbd>Ctrl</kbd>+<kbd>V</kbd> a Telegram screenshot, or drag a file in
                                    </span>
                                </div>
                            </div>
                        )
                    )}
                </div>
            </motion.div>

            <AnimatePresence>
                {isOcrRunning && ocrPreviewText && (
                    <motion.div
                        className={styles.previewStrip}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <span className={styles.previewTag}>OCR</span>
                        <span className={styles.previewText}>
                            {ocrPreviewText.length > 100 ? ocrPreviewText.slice(0, 100) + '…' : ocrPreviewText}
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {!compact && pending && (
                    <motion.div
                        layout
                        initial={{ opacity: 0, y: 12, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.97 }}
                        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <ParsedSignalEditor
                            record={pending.record}
                            onSave={onSavePending}
                            onCancel={onCancelPending}
                            onChange={(patch) => onParsed({ record: { ...pending.record, ...patch }, editable: true })}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default OcrPanel;
