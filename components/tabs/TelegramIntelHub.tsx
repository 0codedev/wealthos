/**
 * CC42 - TelegramIntelHub (slim composition shell)
 *
 * All cross-component state + side-effects live in `useTelegramIntelHub`.
 * This file is now a thin composer: lays out the hero strip, the 3-column
 * grid, and the bottom status dock.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { AlertCircle, Keyboard, Inbox, MessageCircle, X, Settings } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useSystemHealthStore } from '../../store/systemHealthStore';
import { useShallow } from 'zustand/react/shallow';
import { useToast } from '../shared/ToastProvider';
import { telegramEarManager } from '../../services/TelegramEarManager';
import {
    OcrPanel,
    SignalLedger,
    MessageCard,
    MessageDetailDrawer,
    PositionSizerModal,
    EarConfigModal,
    AiSummaryPanel,
    ConnectionBanner,
    EarSidebar,
    FeedControls,
    FeedRollupBanner,
    ParsedSignalEditor,
    ScalpSimulationModal,
    AutopilotGatesModal,
} from '../telegram';
import { useTelegramIntelHub } from './useTelegramIntelHub';
import './TelegramIntelHub.css';
import '../telegram/tokens.module.css';
import '../telegram/animations.module.css';

export const TelegramIntelHub: React.FC = () => {
    const isTelegramReady = useSystemHealthStore(useShallow(state => state.isTelegramReady));
    const { toast } = useToast();
    const h = useTelegramIntelHub();
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [isScalpModalOpen, setIsScalpModalOpen] = useState(false);
    const [isGatesModalOpen, setIsGatesModalOpen] = useState(false);

    const handleReconnect = useCallback(() => {
        toast.info('Attempting to reconnect to Ear Server...');
        telegramEarManager.reconnect();
    }, [toast]);
    const handleLaunchServer = useCallback(() => {
        toast.info('Starting bridge launcher scripts. Check external Windows command prompts.');
        fetch('http://localhost:8000/launch-bridge', { method: 'POST' })
            .catch(() => console.warn('Triggering launch failed. Please start from powershell manually.'));
    }, [toast]);

    // Keyboard shortcuts: j/k navigate, s star, ? opens help
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const tgt = e.target as HTMLElement | null;
            if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
            if (e.key === '?') { setShowShortcuts(true); return; }
            if (e.key === 'Escape' && showShortcuts) { setShowShortcuts(false); return; }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showShortcuts]);

    // Derive metrics for the hero strip
    const lastMessageAt = useMemo(() => {
        if (h.viewMessages.length === 0) return null;
        return h.viewMessages[0]?.msg.receivedAt ?? null;
    }, [h.viewMessages]);
    const signalCount = useMemo(
        () => h.viewMessages.filter(v => v.isSignal).length,
        [h.viewMessages]
    );
    const counts = useMemo(() => ({
        all: h.viewMessages.length,
        signals: h.viewMessages.filter(v => v.isSignal).length,
        news: h.viewMessages.filter(v => v.isNews).length,
        starred: h.viewMessages.filter(v => v.msg.isStarred === 1).length,
    }), [h.viewMessages]);

    // Sticky filter bar - shows on scroll up, hides on scroll down
    const [filterVisible, setFilterVisible] = useState(true);
    const lastScrollY = React.useRef(0);
    const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const y = e.currentTarget.scrollTop;
        const goingDown = y > lastScrollY.current && y > 60;
        setFilterVisible(!goingDown);
        lastScrollY.current = y;
    }, []);

    const isMobile = useIsMobile();

    return (
        <div className="telegram-intel-hub type-lift">
            {/* MOBILE: compact ear selector - replaces the 250px sidebar column
                that crushed the feed to a sliver on phones. */}
            {isMobile && (
                <div className="flex items-center gap-2 px-3 py-2 shrink-0 overflow-x-auto no-scrollbar border-b border-slate-800/50 bg-slate-950/40">
                    {h.ears.map(ear => {
                        const active = h.activeEarId === ear.earId;
                        return (
                            <button
                                key={ear.earId}
                                onClick={() => h.setActiveEarId(ear.earId)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-wider whitespace-nowrap shrink-0 transition-all ${active ? 'text-white' : 'text-slate-400 border-slate-800 bg-slate-900/50'}`}
                                style={active ? { backgroundColor: `${ear.color ?? '#6366f1'}33`, borderColor: `${ear.color ?? '#6366f1'}66` } : undefined}
                            >
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: ear.color ?? '#6366f1' }} />
                                {ear.name}
                            </button>
                        );
                    })}
                    <button
                        onClick={h.openConfigSettings}
                        aria-label="Configure ears"
                        className="ml-auto shrink-0 p-2 rounded-full border border-slate-800 bg-slate-900/50 text-slate-400"
                    >
                        <Settings size={13} />
                    </button>
                </div>
            )}
            {/* Aurora backdrop - fixed to the tab, lives behind everything */}
            <div className="tih-aurora" aria-hidden>
                <div className="tih-aurora-blob tih-aurora-1" />
                <div className="tih-aurora-blob tih-aurora-2" />
                <div className="tih-aurora-blob tih-aurora-3" />
            </div>

            <ConnectionBanner
                isReady={isTelegramReady}
                isRefreshingChannels={h.isRefreshingChannels}
                activeEarName={h.activeEar?.name}
                messageCount={h.viewMessages.length}
                signalCount={signalCount}
                lastMessageAt={lastMessageAt}
                onRefreshChannels={h.handleRefreshJoinedChannels}
                onReconnect={handleReconnect}
                onLaunchServer={handleLaunchServer}
                onConfigure={h.openConfigSettings}
                onTestScalp={() => setIsScalpModalOpen(true)}
                onOpenGates={() => setIsGatesModalOpen(true)}
            />

            <motion.div
                className="intel-layout"
                initial="hidden"
                animate="show"
                variants={{
                    hidden: { opacity: 1 },
                    show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
                }}
            >
                <motion.div
                    className="ear-sidebar-col"
                    style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                    variants={{
                        hidden: { opacity: 0, x: -8 },
                        show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
                    }}
                >
                    <EarSidebar
                        ears={h.ears}
                        activeEarId={h.activeEarId}
                        onSelectEar={(id) => { h.setActiveEarId(id); }}
                        onConfigure={h.openConfigSettings}
                    />
                </motion.div>

                <motion.div
                    className="feed-panel"
                    variants={{
                        hidden: { opacity: 0, y: 8 },
                        show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
                    }}
                >
                    <FeedRollupBanner messages={h.messages} />

                    <div className={`feed-controls-sticky ${filterVisible ? '' : 'is-hidden'}`}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                                <FeedControls
                                    activeEarName={h.activeEar?.name}
                                    searchQuery={h.searchQuery}
                                    onSearchChange={h.setSearchQuery}
                                    filterType={h.filterType}
                                    onFilterChange={h.setFilterType}
                                    activeEarId={h.activeEarId}
                                    counts={counts}
                                    onOpenLedger={() => h.setShowLedgerModal(true)}
                                />
                            </div>
                            <OcrPanel
                                pending={h.pendingSignal}
                                onParsed={h.setPendingSignal}
                                onSavePending={h.handleSavePendingSignal}
                                onCancelPending={h.handleCancelPendingSignal}
                                compact={true}
                            />
                        </div>
                    </div>

                    {h.pendingSignal && (
                        <div style={{ marginBottom: '10px', flexShrink: 0 }}>
                            <ParsedSignalEditor
                                record={h.pendingSignal.record}
                                onSave={h.handleSavePendingSignal}
                                onCancel={h.handleCancelPendingSignal}
                                onChange={(patch) => h.setPendingSignal({ record: { ...h.pendingSignal!.record, ...patch }, editable: true })}
                            />
                        </div>
                    )}

                    <div className="messages-scroll-box" onScroll={onScroll}>
                        {h.viewMessages.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-art">
                                    <MessageCircle size={20} />
                                </div>
                                <h3 className="empty-title">No messages in {h.activeEar?.name || 'this ear'}</h3>
                                <p className="empty-desc">
                                    {h.searchQuery
                                        ? `No messages match "${h.searchQuery}". Try a different search term.`
                                        : 'Drop a screenshot, paste an image, or wait for the bridge to receive new messages.'}
                                </p>
                                {h.searchQuery && (
                                    <button className="empty-action" onClick={() => h.setSearchQuery('')}>
                                        Clear search
                                    </button>
                                )}
                            </div>
                        ) : (
                            h.viewMessages.map(({ msg, parsed, isSignal, isNews, earColor, dteDetails, newsTags }) => (
                                <MessageCard
                                    key={msg.id}
                                    msg={msg}
                                    parsed={parsed}
                                    isSignal={!!isSignal}
                                    isNews={isNews}
                                    earColor={earColor}
                                    dteDetails={dteDetails}
                                    newsTags={newsTags}
                                    isThreadExpanded={!!(msg.threadId && h.expandedThreads[msg.threadId])}
                                    threadMessages={msg.threadId ? h.threadMessages[msg.threadId] : undefined}
                                    onToggleStar={h.toggleStar}
                                    onAutofill={h.autofillOrder}
                                    onOpenPositionSizer={h.setSelectedSignalForSizing}
                                    onToggleThread={(tid) => h.toggleThread(tid)}
                                    onAddToJournal={h.handleAddToJournal}
                                    onOpenChart={h.handleOpenChart}
                                    onCopyRaw={h.handleCopyRaw}
                                    onOpenDetail={h.handleOpenDetail}
                                />
                            ))
                        )}
                    </div>
                </motion.div>

                <motion.div
                    style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                    variants={{
                        hidden: { opacity: 0, x: 8 },
                        show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
                    }}
                >
                    <AiSummaryPanel
                        activeEar={h.activeEar}
                        summary={h.summary}
                        isSummarizing={h.isSummarizing}
                        onSummarize={h.handleSummarize}
                        isCollapsed={h.isSummaryCollapsed}
                        onToggleCollapse={h.toggleSummaryCollapse}
                    />
                </motion.div>
            </motion.div>

            {/* Bottom status dock - quick-glance metrics + keyboard help */}
            <div className="tih-dock">
                <div className="tih-dock-left">
                    <button
                        className="tih-dock-pill"
                        onClick={() => h.setShowLedgerModal(true)}
                        style={{ cursor: 'pointer', border: '1px solid var(--tlh-border)', display: 'inline-flex', alignItems: 'center' }}
                        title="Open Signal Ledger"
                    >
                        <Inbox size={10} />
                        <span className="tih-dock-label">Ledger</span>
                        <span className="tih-dock-value">{h.ledgerRecords.length}</span>
                    </button>
                    <span className="tih-dock-pill">
                        <AlertCircle size={10} />
                        <span className="tih-dock-label">Ear</span>
                        <span className="tih-dock-value">{h.activeEar?.name?.split(' ')[0] || '-'}</span>
                    </span>
                </div>
                <div className="tih-dock-right">
                    <button className="tih-dock-help" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)">
                        <Keyboard size={11} />
                        <span>Press <kbd>?</kbd> for shortcuts</span>
                    </button>
                </div>
            </div>

            {h.showLedgerModal && typeof document !== 'undefined' && createPortal(
                <div className="settings-modal-overlay" onClick={() => h.setShowLedgerModal(false)}>
                    <div
                        className="settings-modal"
                        style={{ width: 'min(800px, calc(100vw - 2rem))', maxHeight: '90vh', overflowY: 'auto' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header">
                            <h3>
                                <Inbox size={14} />
                                <span>Signal Ledger</span>
                            </h3>
                            <button className="close-btn" onClick={() => h.setShowLedgerModal(false)} title="Close Ledger">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ padding: '12px', overflow: 'hidden' }}>
                            <SignalLedger
                                records={h.ledgerRecords}
                                filter={h.ledgerFilter}
                                onFilterChange={h.setLedgerFilter}
                                onExport={h.exportLedgerJson}
                            />
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {h.selectedSignalForSizing !== null && typeof document !== 'undefined' && createPortal(
                <PositionSizerModal
                    isOpen={h.selectedSignalForSizing !== null}
                    signal={h.selectedSignalForSizing}
                    source="TELEGRAM"
                    onClose={() => h.setSelectedSignalForSizing(null)}
                />,
                document.body
            )}
            {h.showSettings && typeof document !== 'undefined' && createPortal(
                <EarConfigModal
                    isOpen={h.showSettings}
                    ears={h.earConfigs}
                    joinedChannels={h.joinedChannels}
                    discoveredChannels={h.discoveredChannels}
                    onRefreshChannels={h.handleRefreshJoinedChannels}
                    isRefreshingChannels={h.isRefreshingChannels}
                    onSave={h.handleSaveConfig}
                    onClose={() => h.setShowSettings(false)}
                />,
                document.body
            )}
            {isScalpModalOpen && typeof document !== 'undefined' && createPortal(
                <ScalpSimulationModal
                    isOpen={isScalpModalOpen}
                    onClose={() => setIsScalpModalOpen(false)}
                />,
                document.body
            )}
            {isGatesModalOpen && typeof document !== 'undefined' && createPortal(
                <AutopilotGatesModal
                    isOpen={isGatesModalOpen}
                    onClose={() => setIsGatesModalOpen(false)}
                />,
                document.body
            )}
            {h.detailMsg !== null && typeof document !== 'undefined' && createPortal(
                <MessageDetailDrawer
                    msg={h.detailMsg}
                    onClose={() => h.setDetailMsg(null)}
                    onToggleStar={h.toggleStar}
                    onOpenThread={(tid) => { h.setDetailMsg(null); h.toggleThread(tid); }}
                    onTrustChannel={h.handleTrustChannel}
                    trustedChannels={h.trustedChannels}
                />,
                document.body
            )}

            {showShortcuts && typeof document !== 'undefined' && createPortal(
                <div className="tih-shortcuts-overlay" onClick={() => setShowShortcuts(false)}>
                    <div className="tih-shortcuts-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Keyboard Shortcuts</h3>
                        <div className="tih-shortcuts-grid">
                            <div className="tih-shortcut"><kbd>?</kbd><span>Show / hide this help</span></div>
                            <div className="tih-shortcut"><kbd>Esc</kbd><span>Close dialogs</span></div>
                            <div className="tih-shortcut"><kbd>/</kbd><span>Focus search</span></div>
                            <div className="tih-shortcut"><kbd>s</kbd><span>Star highlighted message</span></div>
                            <div className="tih-shortcut"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span>Switch ear</span></div>
                        </div>
                        <button className="tih-shortcuts-close" onClick={() => setShowShortcuts(false)}>Close</button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default TelegramIntelHub;
