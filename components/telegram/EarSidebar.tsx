/**
 * CC42 — EarSidebar
 *
 * The left panel. CC42 adds:
 *   - Sticky search box at the top (filter ears by name)
 *   - Animated "unread" badge per ear (count of new messages since last visit)
 *   - iOS-style sliding active-state indicator (animates between rows)
 *   - Connection-state mini-pill on each ear (● / ○)
 *   - Glass surface, gradient hover, proper hierarchy
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { MessageSquare, Settings, Search, X, CircleDot, TrendingUp, Newspaper, Zap } from 'lucide-react';
import { EarStats } from '../../services/TelegramEarManager';
import styles from './EarSidebar.module.css';
import anim from './animations.module.css';

interface EarSidebarProps {
    ears: EarStats[];
    activeEarId: string;
    onSelectEar: (earId: string) => void;
    onConfigure: () => void;
    unreadByEarId?: Record<string, number>;
}

const getEarIcon = (ear: EarStats) => {
    const id = ear.earId.toLowerCase();
    if (id.includes('signal') || ear.type === 'SIGNALS') {
        return <TrendingUp size={13} />;
    }
    if (id.includes('news') || ear.type === 'NEWS') {
        return <Newspaper size={13} />;
    }
    if (id.includes('active') || id.includes('upstox')) {
        return <Zap size={13} />;
    }
    return <MessageSquare size={13} />;
};

export const EarSidebar: React.FC<EarSidebarProps> = ({
    ears, activeEarId, onSelectEar, onConfigure, unreadByEarId = {},
}) => {
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            return localStorage.getItem('telegram_ear_sidebar_collapsed') === 'true';
        } catch {
            return false;
        }
    });
    const [search, setSearch] = useState('');
    const listRef = useRef<HTMLDivElement | null>(null);
    const itemRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
    const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

    const toggleCollapse = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            try {
                localStorage.setItem('telegram_ear_sidebar_collapsed', String(next));
            } catch (e) {
                console.warn(e);
            }
            return next;
        });
    };

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return ears;
        return ears.filter(e => e.name.toLowerCase().includes(q));
    }, [ears, search]);

    // Sliding active indicator: re-measure on resize / active change.
    useEffect(() => {
        const measure = () => {
            const node = itemRefs.current.get(activeEarId);
            const parent = listRef.current;
            if (!node || !parent) return;
            const nodeRect = node.getBoundingClientRect();
            const parentRect = parent.getBoundingClientRect();
            setIndicator({
                top: nodeRect.top - parentRect.top + parent.scrollTop,
                height: nodeRect.height,
            });
        };
        measure();
        const ro = new ResizeObserver(measure);
        if (listRef.current) ro.observe(listRef.current);
        window.addEventListener('resize', measure);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [activeEarId, filtered.length, isCollapsed]);

    return (
        <div className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''}`}>
            <div className={styles.title} onClick={toggleCollapse} style={{ cursor: 'pointer' }} title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                <button className={styles.collapseBtn} aria-label="Toggle sidebar" onClick={(e) => { e.stopPropagation(); toggleCollapse(); }}>
                    <MessageSquare size={14} />
                </button>
                {!isCollapsed && (
                    <>
                        <h2>Telegram Ears</h2>
                        <span className={styles.count}>{ears.length}</span>
                    </>
                )}
            </div>

            {!isCollapsed && ears.length > 3 && (
                <div className={styles.searchRow}>
                    <Search size={12} className={styles.searchIcon} />
                    <input
                        className={styles.searchInput}
                        placeholder="Filter ears…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                        <button className={styles.searchClear} onClick={() => setSearch('')} title="Clear">
                            <X size={11} />
                        </button>
                    )}
                </div>
            )}

            <div className={styles.listWrap} ref={listRef}>
                {indicator && !isCollapsed && (
                    <div
                        className={styles.activeIndicator}
                        style={{ top: indicator.top, height: indicator.height }}
                        aria-hidden
                    />
                )}
                <div className={styles.list}>
                    {filtered.map(ear => {
                        const isSelected = activeEarId === ear.earId;
                        const unread = unreadByEarId[ear.earId] || 0;
                        return (
                            <button
                                key={ear.earId}
                                ref={(el) => { itemRefs.current.set(ear.earId, el); }}
                                className={`${styles.item} ${isSelected ? styles.active : ''} ${isCollapsed ? styles.collapsedItem : ''} ${ear.enabled === false ? styles.disabled : ''}`}
                                onClick={() => onSelectEar(ear.earId)}
                                style={{ ['--ear-color' as any]: ear.color }}
                                title={ear.name}
                            >
                                {!isCollapsed && <span className={styles.colorBar} />}
                                <div
                                    className={styles.iconBadge}
                                    style={{
                                        borderColor: `${ear.color}40`,
                                        backgroundColor: `${ear.color}12`,
                                        color: ear.color,
                                        opacity: ear.enabled === false ? 0.4 : 1
                                    }}
                                >
                                    {getEarIcon(ear)}
                                    {isCollapsed && unread > 0 && (
                                        <span className={styles.unreadBadgeMini}>
                                            {unread > 99 ? '99+' : unread}
                                        </span>
                                    )}
                                </div>
                                {!isCollapsed ? (
                                    <div className={styles.meta} style={{ opacity: ear.enabled === false ? 0.45 : 1 }}>
                                        <div className={styles.nameRow}>
                                            <span className={styles.name}>{ear.name}</span>
                                            {unread > 0 && (
                                                <span className={styles.unread}>{unread > 99 ? '99+' : unread}</span>
                                            )}
                                        </div>
                                        <div className={styles.subRow}>
                                            <span className={styles.subItem}>
                                                <CircleDot size={9} className={ear.enabled === false ? styles.connDisabled : (ear.isConnected ? styles.connOn : styles.connOff)} />
                                                <span className={styles.subLabel}>
                                                    {ear.enabled === false ? 'paused' : (ear.isConnected ? 'live' : 'idle')}
                                                </span>
                                            </span>
                                            <span className={styles.subDot} />
                                            <span className={styles.subItem}>
                                                <span className={styles.subNum}>{ear.messageCount}</span>
                                                <span className={styles.subLabel}>msgs</span>
                                            </span>
                                            {ear.type === 'SIGNALS' && ear.signalCount > 0 && (
                                                <>
                                                    <span className={styles.subDot} />
                                                    <span className={styles.subItem}>
                                                        <span className={`${styles.subNum} ${styles.signalNum}`}>{ear.signalCount}</span>
                                                        <span className={styles.subLabel}>sig</span>
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            </div>

        </div>
    );
};

export default EarSidebar;
