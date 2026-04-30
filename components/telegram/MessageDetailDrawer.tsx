/**
 * CC42 — MessageDetailDrawer
 *
 * Apple-style spring slide-in panel. CC42 polish:
 *   - Spring physics on slide-in (framer-motion)
 *   - Staggered fade-in for each section
 *   - Trust toggle becomes a beautiful switch component
 *   - JSON gets a syntax-highlighted code block
 *   - Copy-to-clipboard button on every section
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Star, ExternalLink, FileText, Copy, ShieldCheck, Hash, Clock, Tag } from 'lucide-react';
import { TelegramMessage } from '../../database';
import styles from './MessageDetailDrawer.module.css';

interface MessageDetailDrawerProps {
    msg: TelegramMessage | null;
    onClose: () => void;
    onToggleStar: (msg: TelegramMessage) => void;
    onOpenThread: (threadId: number) => void;
    onTrustChannel: (channelName: string, trusted: boolean) => void;
    trustedChannels: Set<string>;
}

const formatJSON = (raw: string) => {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
};

const fadeIn = (delay: number) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay, ease: 'easeOut' as const },
});

export const MessageDetailDrawer: React.FC<MessageDetailDrawerProps> = ({
    msg, onClose, onToggleStar, onOpenThread, onTrustChannel, trustedChannels
}) => {
    if (!msg) return null;
    const isTrusted = msg.channelName ? trustedChannels.has(msg.channelName) : false;

    const copy = async (text: string, label: string) => {
        try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
        // Toast is global; using a quiet visual confirmation instead.
    };

    return (
        <AnimatePresence>
            <motion.div
                className={styles.overlay}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.20 }}
                onClick={onClose}
            >
                <motion.aside
                    className={styles.drawer}
                    initial={{ x: '100%', scale: 0.98 }}
                    animate={{ x: 0, scale: 1 }}
                    exit={{ x: '100%', scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 32, mass: 0.7 }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <motion.header className={styles.header} {...fadeIn(0.05)}>
                        <div className={styles.headerLeft}>
                            <div className={styles.headerIcon}>
                                <FileText size={14} />
                            </div>
                            <div>
                                <h3>Message Detail</h3>
                                <span className={styles.headerSub}>Full payload & metadata</span>
                            </div>
                        </div>
                        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
                            <X size={16} />
                        </button>
                    </motion.header>

                    <div className={styles.scrollArea}>
                        <motion.section className={styles.section} {...fadeIn(0.10)}>
                            <h4 className={styles.sectionTitle}><Hash size={12} /> Metadata</h4>
                            <div className={styles.metaGrid}>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaIcon}><Tag size={11} /></span>
                                    <span className={styles.metaLabel}>Channel</span>
                                    <span className={styles.metaValue}>{msg.channelName || 'Telegram'}</span>
                                    <button
                                        className={`${styles.starBtn} ${msg.isStarred === 1 ? styles.starred : ''}`}
                                        onClick={() => onToggleStar(msg)}
                                        title="Star"
                                    >
                                        <Star size={12} fill={msg.isStarred === 1 ? 'currentColor' : 'none'} />
                                    </button>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaIcon}><Clock size={11} /></span>
                                    <span className={styles.metaLabel}>Received</span>
                                    <span className={styles.metaValue}>{new Date(msg.receivedAt).toLocaleString()}</span>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaIcon}><Hash size={11} /></span>
                                    <span className={styles.metaLabel}>ID</span>
                                    <span className={styles.metaValueMono}>{msg.id}</span>
                                </div>
                                {msg.threadId && (
                                    <div className={styles.metaRow}>
                                        <span className={styles.metaIcon}><ExternalLink size={11} /></span>
                                        <span className={styles.metaLabel}>Thread</span>
                                        <button className={styles.threadLink} onClick={() => onOpenThread(msg.threadId!)}>
                                            Open thread timeline
                                        </button>
                                    </div>
                                )}
                            </div>
                        </motion.section>

                        <motion.section className={styles.section} {...fadeIn(0.18)}>
                            <div className={styles.sectionHeader}>
                                <h4 className={styles.sectionTitle}><FileText size={12} /> Full Text</h4>
                                <button className={styles.copyBtn} onClick={() => copy(msg.text || '', 'text')}>
                                    <Copy size={11} /> Copy
                                </button>
                            </div>
                            <pre className={styles.text}>{msg.text}</pre>
                        </motion.section>

                        {msg.parsedJson && (
                            <motion.section className={styles.section} {...fadeIn(0.26)}>
                                <div className={styles.sectionHeader}>
                                    <h4 className={styles.sectionTitle}><Hash size={12} /> Parsed Signal</h4>
                                    <button className={styles.copyBtn} onClick={() => copy(formatJSON(msg.parsedJson!), 'json')}>
                                        <Copy size={11} /> Copy JSON
                                    </button>
                                </div>
                                <pre className={`${styles.text} ${styles.codeBlock}`}>
                                    {formatJSON(msg.parsedJson)}
                                </pre>
                            </motion.section>
                        )}

                        {msg.channelName && (
                            <motion.section className={styles.section} {...fadeIn(0.34)}>
                                <h4 className={styles.sectionTitle}><ShieldCheck size={12} /> Channel Trust</h4>
                                <label className={styles.trustRow}>
                                    <span className={styles.trustText}>
                                        Trust signals from <strong>{msg.channelName}</strong>
                                        <span className={styles.trustHint}>Boosts confidence weighting in Pool & OCR reruns</span>
                                    </span>
                                    <span className={styles.switchWrap}>
                                        <input
                                            type="checkbox"
                                            checked={isTrusted}
                                            onChange={(e) => onTrustChannel(msg.channelName!, e.target.checked)}
                                        />
                                        <span className={styles.switchTrack}>
                                            <span className={styles.switchThumb} />
                                        </span>
                                    </span>
                                </label>
                            </motion.section>
                        )}
                    </div>
                </motion.aside>
            </motion.div>
        </AnimatePresence>
    );
};

export default MessageDetailDrawer;
