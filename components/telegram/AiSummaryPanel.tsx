/**
 * CC42 — AiSummaryPanel
 *
 * Right-column "AI Intelligence" panel. CC42 polish:
 *   - "Live" typing animation while the brief streams in
 *   - Animated count-up on the "regenerate" cooldown
 *   - Sentiment badge morphs with color cross-fade
 *   - Key signals become cards (not bullets)
 *   - Markdown gets rendered through react-markdown (already installed)
 *   - "Magic" regen button has rotating ring on hover
 */
import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Send, TrendingUp, FileText, Sparkles, Copy, Check, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EarStats, EarSummary } from '../../services/TelegramEarManager';
import { useToast } from '../shared/ToastProvider';
import styles from './AiSummaryPanel.module.css';
import anim from './animations.module.css';

interface AiSummaryPanelProps {
    activeEar: EarStats | undefined;
    summary: EarSummary | null;
    isSummarizing: boolean;
    onSummarize: (customPrompt: string | undefined) => Promise<void>;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
}

const sentimentEmoji = (s: string) => {
    if (s === 'BULLISH') return '🐂';
    if (s === 'BEARISH') return '🐻';
    return '⚖️';
};

const sentimentColor = (s: string) => {
    if (s === 'BULLISH') return 'var(--tlh-emerald)';
    if (s === 'BEARISH') return 'var(--tlh-rose)';
    return 'var(--tlh-text-mute)';
};

const sentimentClass = (s: string) => {
    if (s === 'BULLISH') return 'bullish';
    if (s === 'BEARISH') return 'bearish';
    return 'neutral';
};

export const AiSummaryPanel: React.FC<AiSummaryPanelProps> = ({ activeEar, summary, isSummarizing, onSummarize, isCollapsed, onToggleCollapse }) => {
    const { toast } = useToast();
    const [customQuestion, setCustomQuestion] = useState('');
    const [copied, setCopied] = useState(false);
    const [typedBrief, setTypedBrief] = useState('');

    // Live "typing" effect when a new summary arrives — the brief reveals
    // char-by-char for ~1.6s. We re-trigger on summary.generatedAt change.
    useEffect(() => {
        if (!summary?.brief) { setTypedBrief(''); return; }
        const text = summary.brief;
        setTypedBrief('');
        let i = 0;
        const interval = window.setInterval(() => {
            i += 1;
            setTypedBrief(text.slice(0, i));
            if (i >= text.length) window.clearInterval(interval);
        }, 14);
        return () => window.clearInterval(interval);
    }, [summary?.generatedAt, summary?.brief]);

    const handleCopy = async () => {
        if (!summary) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
            setCopied(true);
            toast.success('Summary copied to clipboard');
            window.setTimeout(() => setCopied(false), 1500);
        } catch { toast.error('Copy failed'); }
    };

    return (
        <div className={`summary-panel ${isCollapsed ? 'collapsed' : ''}`}>
            <div
                className="panel-title"
                onClick={onToggleCollapse}
                style={{ cursor: 'pointer', justifyContent: isCollapsed ? 'center' : 'flex-start', margin: isCollapsed ? '0' : '0 0 12px 0' }}
                title={isCollapsed ? 'Expand AI Panel' : 'Collapse AI Panel'}
            >
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleCollapse();
                    }}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        color: 'currentColor',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'transform 150ms ease',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                    <Wand2 size={14} className={isSummarizing ? anim.spinSlow : ''} />
                </button>
                {!isCollapsed && <h2>AI Intelligence</h2>}
            </div>

            {!isCollapsed && (
                <>
                    <div className={styles.actionsBox}>
                        <button
                            className={styles.summarizeBtn}
                            onClick={() => onSummarize(undefined)}
                            disabled={isSummarizing}
                        >
                            {isSummarizing ? (
                                <>
                                    <RefreshCw size={13} className="spin" />
                                    Analyzing {activeEar?.name || 'ear'}…
                                </>
                            ) : (
                                <>
                                    <Sparkles size={13} />
                                    Summarize {activeEar?.name || 'Ear'}
                                </>
                            )}
                        </button>
                        <div className={styles.customQuestionBox}>
                            <textarea
                                placeholder="Ask AI anything about these telegram logs…"
                                value={customQuestion}
                                onChange={(e) => setCustomQuestion(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && customQuestion && !isSummarizing) {
                                        onSummarize(customQuestion);
                                    }
                                }}
                            />
                            <button
                                className={styles.sendBtn}
                                onClick={() => onSummarize(customQuestion || undefined)}
                                disabled={isSummarizing || !customQuestion}
                                title="Ask (⌘/Ctrl + Enter)"
                            >
                                <Send size={12} />
                            </button>
                        </div>
                        <div className={styles.hint}>
                            <kbd>⌘</kbd>+<kbd>Enter</kbd> to ask
                        </div>
                    </div>

                    <div className={styles.scrollBox}>
                        {summary ? (
                            <motion.div
                                className={styles.body}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                            >
                                <div className={styles.header}>
                                    <AnimatePresence mode="wait">
                                        <motion.span
                                            key={summary.sentiment}
                                            className={`${styles.sentimentBadge} ${styles[sentimentClass(summary.sentiment)] || ''}`}
                                            initial={{ opacity: 0, scale: 0.85, y: -4 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.9, y: -4 }}
                                            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                                        >
                                            <span className={styles.sentimentEmoji}>{sentimentEmoji(summary.sentiment)}</span>
                                            {summary.sentiment}
                                        </motion.span>
                                    </AnimatePresence>
                                    <span className={styles.date}>
                                        {new Date(summary.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>

                                <div className={styles.section}>
                                    <h3>🤖 The Oracle's Verdict</h3>
                                    <div className={styles.markdown}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{typedBrief || ' '}</ReactMarkdown>
                                        {typedBrief && typedBrief.length < (summary.brief?.length || 0) && (
                                            <span className={styles.cursor} />
                                        )}
                                    </div>
                                </div>

                                {summary.keySignals.length > 0 && (
                                    <div className={styles.section}>
                                        <h3>🎯 Key Signals Analyzed</h3>
                                        <div className={styles.signalGrid}>
                                            {summary.keySignals.map((sig, idx) => (
                                                <motion.div
                                                    key={`${summary.generatedAt}-${idx}`}
                                                    className={styles.signalCard}
                                                    initial={{ opacity: 0, y: 6 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: idx * 0.06, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                                                >
                                                    <TrendingUp size={11} className={styles.signalIcon} />
                                                    <span>{sig}</span>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {summary.newsHeadlines.length > 0 && (
                                    <div className={styles.section}>
                                        <h3>📰 Important Highlights</h3>
                                        <ul className={styles.headlineList}>
                                            {summary.newsHeadlines.map((n, idx) => (
                                                <motion.li
                                                    key={`${summary.generatedAt}-n-${idx}`}
                                                    initial={{ opacity: 0, x: -6 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: idx * 0.05, duration: 0.24 }}
                                                >
                                                    {n}
                                                </motion.li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <button
                                    className={styles.copyBtn}
                                    onClick={handleCopy}
                                >
                                    {copied ? <Check size={11} /> : <Copy size={11} />}
                                    {copied ? 'Copied' : 'Copy Raw JSON'}
                                </button>
                            </motion.div>
                        ) : (
                            <div className={styles.placeholder}>
                                <div className={styles.placeholderArt}>
                                    <Wand2 size={16} />
                                </div>
                                <p>Click "Summarize" above to generate a real-time AI brief from recent messages.</p>
                                <span className={styles.placeholderSub}>
                                    Briefs run on the latest 50 messages from the active ear.
                                </span>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default AiSummaryPanel;
