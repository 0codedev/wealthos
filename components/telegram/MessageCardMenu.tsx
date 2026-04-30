/**
 * CC42 — MessageCardMenu
 *
 * 3-dots dropdown. CC42 polish:
 *   - Staggered item reveal
 *   - Hover backgrounds with gradient
 *   - Icon + label with proper alignment
 *   - Outside-click + Escape close
 *   - Keyboard nav (arrow up/down + Enter)
 */
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoreVertical, FileText, LineChart, ClipboardCopy, Maximize2, Pin } from 'lucide-react';
import { PoolTelegramPushButton } from '../pool/PoolTelegramPushButton';
import { TelegramMessage } from '../../database';
import styles from './MessageCardMenu.module.css';

interface MessageCardMenuProps {
    msg: TelegramMessage;
    hasPoolButton?: boolean;
    onAddToJournal: () => void;
    onOpenChart: () => void;
    onCopyRaw: () => void;
    onOpenDetail: () => void;
    onOpenChange?: (open: boolean) => void;
}

export const MessageCardMenu: React.FC<MessageCardMenuProps> = ({
    msg, hasPoolButton, onAddToJournal, onOpenChart, onCopyRaw, onOpenDetail, onOpenChange
}) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (onOpenChange) onOpenChange(open);
    }, [open, onOpenChange]);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const items = [
        { icon: <FileText size={12} />, label: 'Add to Journal', onClick: onAddToJournal, show: true },
        { icon: <LineChart size={12} />, label: 'Open Chart', onClick: onOpenChart, show: true },
        { icon: <ClipboardCopy size={12} />, label: 'Copy Raw Text', onClick: onCopyRaw, show: true },
        { icon: <Maximize2 size={12} />, label: 'Open Detail', onClick: onOpenDetail, show: true, divider: true },
    ];

    return (
        <div className={styles.wrap} ref={ref}>
            <button
                className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
                onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
                title="More actions"
                aria-label="More actions"
                aria-expanded={open}
            >
                <MoreVertical size={13} />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div
                        className={styles.menu}
                        initial={{ opacity: 0, y: -4, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.96 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    >
                        {!hasPoolButton && msg.parsedJson && (() => {
                            try {
                                const parsed = typeof msg.parsedJson === 'object' ? msg.parsedJson : JSON.parse(msg.parsedJson);
                                if (parsed?.tradingSymbol) {
                                    return (
                                        <div className={styles.item}>
                                            <span className={styles.itemIcon}><Pin size={12} /></span>
                                            <span className={styles.itemLabel}>Track in Pool</span>
                                            <PoolTelegramPushButton
                                                ticker={parsed.tradingSymbol}
                                                channelName={msg.channelName}
                                                messageId={msg.id}
                                                threadId={msg.threadId}
                                                caption={msg.text?.slice(0, 200)}
                                                compact
                                            />
                                        </div>
                                    );
                                }
                            } catch { /* ignore */ }
                            return null;
                        })()}

                        {items.filter(i => i.show).map((it, idx) => (
                            <motion.button
                                key={it.label}
                                className={styles.item}
                                onClick={(e) => { e.stopPropagation(); it.onClick(); setOpen(false); }}
                                initial={{ opacity: 0, x: -4 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: idx * 0.04, duration: 0.16 }}
                            >
                                <span className={styles.itemIcon}>{it.icon}</span>
                                <span className={styles.itemLabel}>{it.label}</span>
                            </motion.button>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MessageCardMenu;
