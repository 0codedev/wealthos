/**
 * CC42 — EarConfigModal
 *
 * The multi-channel configuration modal. CC42 polish:
 *   - Tabbed interface: one tab per ear, sliding underline indicator
 *   - Channel pills have drag-to-reorder visual hint + remove animation
 *   - Search highlights matches in dropdown
 *   - "Save" button morphs to "Saving…" → "✓ Saved" sequence
 *   - Section dividers with gradient lines
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, Hash, Check, Save, Search, ChevronDown } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';
import styles from './EarConfigModal.module.css';
import anim from './animations.module.css';

export interface JoinedChannel { id: string; name: string; }
export interface DiscoveredChannel { id: string; name: string; }

interface EarConfigModalProps {
    isOpen: boolean;
    ears: any[];
    joinedChannels: JoinedChannel[];
    discoveredChannels: DiscoveredChannel[];
    onRefreshChannels: () => Promise<void>;
    isRefreshingChannels: boolean;
    onSave: (configs: any[]) => Promise<boolean>;
    onClose: () => void;
}

const earNumber = (id: string) => {
    if (id === 'premium_signals') return '1';
    if (id === 'news_data') return '2';
    if (id === 'general_archive') return '3';
    return '';
};

type SaveState = 'idle' | 'saving' | 'saved';

export const EarConfigModal: React.FC<EarConfigModalProps> = ({
    isOpen, ears, joinedChannels, discoveredChannels,
    onRefreshChannels, isRefreshingChannels, onSave, onClose
}) => {
    const { toast } = useToast();
    const [localConfigs, setLocalConfigs] = useState<any[]>([]);
    const [earSearchQueries, setEarSearchQueries] = useState<Record<string, string>>({});
    const [activeDropdownEarId, setActiveDropdownEarId] = useState<string | null>(null);
    const [activeTabIdx, setActiveTabIdx] = useState(0);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const tabRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
    const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number } | null>(null);

    useEffect(() => {
        if (isOpen) {
            setLocalConfigs(ears.map(e => ({
                ...e,
                channelIds: Array.isArray(e.channelIds) ? [...e.channelIds] : e.channelIds,
                keywords: e.keywords ? [...e.keywords] : [],
            })));
            setEarSearchQueries({});
            setActiveDropdownEarId(null);
            setActiveTabIdx(0);
            setSaveState('idle');
        }
    }, [isOpen, ears]);

    // Sliding tab indicator
    useEffect(() => {
        const measure = () => {
            const node = tabRefs.current.get(activeTabIdx);
            const parent = node?.parentElement;
            if (!node || !parent) return;
            const r = node.getBoundingClientRect();
            const pr = parent.getBoundingClientRect();
            setTabIndicator({ left: r.left - pr.left, width: r.width });
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [activeTabIdx, localConfigs.length]);

    if (!isOpen) return null;

    const updateEar = (idx: number, patch: any) => {
        setLocalConfigs(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    };

    const handleSave = async () => {
        setSaveState('saving');
        const ok = await onSave(localConfigs);
        if (ok) {
            setSaveState('saved');
            toast.success('Telegram configuration updated');
            window.setTimeout(() => setSaveState('idle'), 1400);
        } else {
            setSaveState('idle');
            toast.error('Failed to save configuration');
        }
    };

    const activeConfig = localConfigs[activeTabIdx];

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <motion.div
                className="settings-modal"
                style={{ width: 'min(560px, calc(100vw - 2rem))', maxHeight: '90vh', overflowY: 'auto' }}
                onClick={(e) => e.stopPropagation()}
                initial={{ opacity: 0, scale: 0.94, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            >
                <div className="modal-header">
                    <h3>🎧 Telegram Ear Configurations</h3>
                    <button className="close-btn" aria-label="Close Telegram ear configurations" onClick={onClose}><X size={16} /></button>
                </div>

                {/* Tabbed nav */}
                <div className={styles.tabBar}>
                    {tabIndicator && (
                        <div
                            className={styles.tabIndicator}
                            style={{ left: tabIndicator.left, width: tabIndicator.width }}
                            aria-hidden
                        />
                    )}
                    {localConfigs.map((cfg, idx) => (
                        <button
                            key={cfg.earId}
                            ref={(el) => { tabRefs.current.set(idx, el); }}
                            className={`${styles.tab} ${activeTabIdx === idx ? styles.tabActive : ''}`}
                            onClick={() => setActiveTabIdx(idx)}
                        >
                            <span className={styles.tabColor} style={{ backgroundColor: cfg.color }} />
                            <span>{cfg.name}</span>
                        </button>
                    ))}
                </div>

                <div className="modal-body">
                    <div className={styles.section}>
                        <div className={styles.sectionHeaderRow}>
                            <h4>
                                <span className={styles.tabColor} style={{ backgroundColor: activeConfig?.color }} />
                                Configure {activeConfig?.name}
                            </h4>
                            <button
                                type="button"
                                className={styles.refreshChannelsBtn}
                                onClick={onRefreshChannels}
                                disabled={isRefreshingChannels}
                            >
                                <RefreshCw size={11} className={isRefreshingChannels ? 'spin' : ''} />
                                {isRefreshingChannels ? 'Pulling…' : 'Refresh Channels'}
                            </button>
                        </div>

                        {activeConfig && (
                            <div className={styles.earConfigCard}>
                                <div className={styles.earEnabledRow}>
                                    <div className={styles.earEnabledLabelBlock}>
                                        <span className={styles.earEnabledTitle}>Active Status</span>
                                        <span className={styles.earEnabledDesc}>Enable or disable processing for this ear</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => updateEar(activeTabIdx, { enabled: activeConfig.enabled !== false ? false : true })}
                                        className={`${styles.toggleSwitch} ${activeConfig.enabled !== false ? styles.toggleOn : ''}`}
                                        aria-label={`Toggle active status for ${activeConfig.name}`}
                                    >
                                        <span className={styles.toggleSlider} />
                                    </button>
                                </div>
                                {activeConfig.channelIds === 'ALL' ? (
                                    <div className={styles.formGroup}>
                                        <label>Channel IDs:</label>
                                        <input type="text" value="ALL (Listening to all joined channels)" disabled />
                                    </div>
                                ) : (
                                    <div className={styles.earChannelsSelector}>
                                        <label>Selected Channels ({Array.isArray(activeConfig.channelIds) ? Array.from(new Set(activeConfig.channelIds)).length : 0})</label>
                                        <div className={styles.selectedPillsRow}>
                                            <AnimatePresence initial={false}>
                                                {Array.isArray(activeConfig.channelIds) && (Array.from(new Set(activeConfig.channelIds)) as string[]).map((id: string) => {
                                                    const found = joinedChannels.find(jc => jc.id === id);
                                                    const displayName = found ? found.name : id;
                                                    return (
                                                        <motion.span
                                                            key={id}
                                                            layout
                                                            initial={{ opacity: 0, scale: 0.8 }}
                                                            animate={{ opacity: 1, scale: 1 }}
                                                            exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.15 } }}
                                                            className={styles.channelPill}
                                                            style={{ borderLeftColor: activeConfig.color }}
                                                        >
                                                            <span className={styles.channelDot} style={{ backgroundColor: activeConfig.color }} />
                                                            {displayName}
                                                            <button
                                                                type="button"
                                                                className={styles.removePillBtn}
                                                                onClick={() => updateEar(activeTabIdx, {
                                                                    channelIds: (activeConfig.channelIds || []).filter((cid: string) => cid !== id)
                                                                })}
                                                                title="Remove"
                                                            >
                                                                <X size={10} />
                                                            </button>
                                                        </motion.span>
                                                    );
                                                })}
                                            </AnimatePresence>
                                            {(!Array.isArray(activeConfig.channelIds) || activeConfig.channelIds.length === 0) && (
                                                <span className={styles.noChannelsSelectedLbl} style={{ color: activeConfig.earId === 'general_archive' ? '#38bdf8' : undefined }}>
                                                    {activeConfig.earId === 'general_archive' 
                                                        ? '🌐 Universal Fallback: Capturing all messages from other unassigned channels.'
                                                        : 'No channels assigned. All messages will be discarded.'}
                                                </span>
                                            )}
                                        </div>

                                        <div className={styles.channelSearchBox}>
                                            <Search size={11} className={styles.searchInputIcon} />
                                            <input
                                                type="text"
                                                placeholder="Search joined Telegram channels…"
                                                value={earSearchQueries[activeConfig.earId] || ''}
                                                onChange={(e) => setEarSearchQueries(prev => ({ ...prev, [activeConfig.earId]: e.target.value }))}
                                                onFocus={() => setActiveDropdownEarId(activeConfig.earId)}
                                                onBlur={() => window.setTimeout(() => setActiveDropdownEarId(null), 250)}
                                                className={styles.searchChannelInput}
                                            />
                                            <ChevronDown size={11} className={styles.searchInputChev} />
                                            {activeDropdownEarId === activeConfig.earId && (
                                                <div className={styles.channelDropdownOptions}>
                                                    {(() => {
                                                        const query = (earSearchQueries[activeConfig.earId] || '').toLowerCase();
                                                        const filtered = joinedChannels.filter(jc =>
                                                            (!query || jc.name.toLowerCase().includes(query)) &&
                                                            (!Array.isArray(activeConfig.channelIds) || !activeConfig.channelIds.includes(jc.id))
                                                        );
                                                        if (filtered.length === 0) return <div className={styles.noMatchesItem}>No matching channels found</div>;
                                                        return filtered.slice(0, 100).map(jc => {
                                                            const others = localConfigs.filter(ec =>
                                                                ec.earId !== activeConfig.earId &&
                                                                Array.isArray(ec.channelIds) && ec.channelIds.includes(jc.id)
                                                            );
                                                            return (
                                                                <button
                                                                    key={jc.id}
                                                                    type="button"
                                                                    className={styles.dropdownOptionItem}
                                                                    onClick={() => {
                                                                        updateEar(activeTabIdx, {
                                                                            channelIds: [...(activeConfig.channelIds || []), jc.id]
                                                                        });
                                                                        setEarSearchQueries(prev => ({ ...prev, [activeConfig.earId]: '' }));
                                                                        setActiveDropdownEarId(null);
                                                                    }}
                                                                >
                                                                    <div className={styles.optNameWrapper}>
                                                                        <span className={styles.optName}>
                                                                            {query ? (
                                                                                <HighlightMatch text={jc.name} q={query} />
                                                                            ) : jc.name}
                                                                        </span>
                                                                        {others.map(ec => (
                                                                            <span
                                                                                key={ec.earId}
                                                                                className={styles.earIndicatorBadge}
                                                                                style={{ borderColor: ec.color, color: ec.color }}
                                                                                title={`Also selected in: ${ec.name}`}
                                                                            >
                                                                                {earNumber(ec.earId)}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                    <span className={styles.optId}>{jc.id}</span>
                                                                </button>
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className={styles.formGroup} style={{ marginTop: '12px' }}>
                                    <label>Keywords Filter (comma separated)</label>
                                    <input
                                        type="text"
                                        value={activeConfig.keywords ? activeConfig.keywords.join(', ') : ''}
                                        onChange={(e) => updateEar(activeTabIdx, {
                                            keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                                        })}
                                        placeholder="e.g. BANKNIFTY, NIFTY, breakout"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={styles.section}>
                        <div className={styles.sectionHeaderRow}>
                            <h4><Hash size={12} /> Discovered Channels (last 30s)</h4>
                        </div>
                        {discoveredChannels.length === 0 ? (
                            <p className={styles.noChannelsText}>No channels logged yet. Run Ear Server in Discovery mode to populate.</p>
                        ) : (
                            <div className={styles.discoveredList}>
                                {discoveredChannels.map((ch, idx) => (
                                    <div key={idx} className={styles.discoveredChItem}>
                                        <span className={styles.chName}>{ch.name}</span>
                                        <div className={styles.chActions}>
                                            <span className={styles.chId}>{ch.id}</span>
                                            <button
                                                className={styles.copyChIdBtn}
                                                onClick={() => {
                                                    navigator.clipboard.writeText(ch.id);
                                                    toast.success('Channel ID copied');
                                                }}
                                            >
                                                Copy ID
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="cancel-btn" onClick={onClose}>Cancel</button>
                    <button className="save-btn" onClick={handleSave} disabled={saveState !== 'idle'}>
                        <AnimatePresence mode="wait">
                            {saveState === 'idle' && (
                                <motion.span key="save" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                    <Save size={12} /> Save Configuration
                                </motion.span>
                            )}
                            {saveState === 'saving' && (
                                <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                    <RefreshCw size={12} className={anim.spin} /> Saving…
                                </motion.span>
                            )}
                            {saveState === 'saved' && (
                                <motion.span key="saved" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                    <Check size={12} /> Saved
                                </motion.span>
                            )}
                        </AnimatePresence>
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

const HighlightMatch: React.FC<{ text: string; q: string }> = ({ text, q }) => {
    if (!q) return <>{text}</>;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return <>{text}</>;
    return (
        <>
            {text.slice(0, idx)}
            <mark className={styles.highlight}>{text.slice(idx, idx + q.length)}</mark>
            {text.slice(idx + q.length)}
        </>
    );
};

export default EarConfigModal;
