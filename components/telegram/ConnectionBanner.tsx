/**
 * CC42 — ConnectionBanner
 *
 * Top "hero strip" of the Telegram Intel Hub. In CC40 this was a single
 * line of text. CC42 turns it into a true status surface that shows:
 *
 *   [Live pulse ●]  EAR NAME    ↳ 142 messages · 7 signals   ⟳ 2s ago
 *                                           [Refresh] [Reconnect] [Launch]
 *
 * Sub-states (CC41) for the disconnected case still apply, but the visual
 * surface is now gradient-bordered, glass-blurred, and pulses with the
 * live status.
 */
import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, Radio, Zap, Activity, Bell, Settings, Sparkles, Shield } from 'lucide-react';
import { telegramEarManager } from '../../services/TelegramEarManager';
import styles from './ConnectionBanner.module.css';
import anim from './animations.module.css';

interface ConnectionBannerProps {
    isReady: boolean;
    isRefreshingChannels: boolean;
    activeEarName?: string;
    messageCount?: number;
    signalCount?: number;
    lastMessageAt?: number | null;
    onRefreshChannels: () => void;
    onReconnect: () => void;
    onLaunchServer: () => void;
    onConfigure: () => void;
    onTestScalp?: () => void;
    onOpenGates?: () => void;
}

const relTime = (ts: number | null | undefined) => {
    if (!ts) return '-';
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    return `${hr}h ago`;
};

export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({
    isReady, isRefreshingChannels,
    activeEarName, messageCount = 0, signalCount = 0, lastMessageAt,
    onRefreshChannels, onReconnect, onLaunchServer, onConfigure, onTestScalp, onOpenGates,
}) => {
    const [statusMsg, setStatusMsg] = useState<string>('');
    const [, setTick] = useState(0);

    // Re-tick every 5s so the "Xs ago" label stays current.
    useEffect(() => {
        const i = window.setInterval(() => setTick(t => t + 1), 5_000);
        return () => window.clearInterval(i);
    }, []);

    useEffect(() => {
        return telegramEarManager.onStatus((e) => {
            if (e.type === 'closed') setStatusMsg(`WS closed: ${e.reason}`);
            else if (e.type === 'reconnect_scheduled') setStatusMsg(`Reconnecting in ${Math.round(e.delayMs / 1000)}s…`);
            else if (e.type === 'open') setStatusMsg('');
            else if (e.type === 'connecting') setStatusMsg('Connecting…');
            else if (e.type === 'error') setStatusMsg(`WS error: ${e.message}`);
        });
    }, []);

    // Fix 1: Optimistic UI using message activity as a source of truth
    const isEffectivelyLive = isReady || (lastMessageAt && (Date.now() - lastMessageAt) < 90_000);

    let statusKind: 'live' | 'warn' | 'down' = 'down';
    let statusText = '✗ BRIDGE OFFLINE - Showing Cached Local Data';

    if (isEffectivelyLive) {
        statusKind = 'live';
        statusText = '● LIVE - Ear Server Connected';
    } else {
        if (statusMsg) {
            const isReconnectingMsg = statusMsg.includes('Reconnecting') || statusMsg.includes('Connecting') || statusMsg.includes('closed') || statusMsg.includes('error');
            if (isReconnectingMsg) {
                statusKind = 'warn';
                const timeLabel = lastMessageAt ? ` · Last update ${relTime(lastMessageAt)}` : '';
                statusText = `⟳ Syncing…${timeLabel}`;
            } else {
                statusKind = 'down';
                statusText = `✗ OFFLINE - ${statusMsg}`;
            }
        } else {
            statusKind = 'down';
            statusText = '✗ BRIDGE OFFLINE - Showing Cached Local Data';
        }
    }

    return (
        <div className={`${styles.strip} ${styles[statusKind]}`}>
            {/* Glow accent edge - gradient line that shifts with status */}
            <div className={styles.glowEdge} />

            {/* Left: status pulse + ear name + metrics */}
            <div className={styles.left}>
                <div className={styles.statusBlock}>
                    <span className={`${styles.dot} ${styles[statusKind]} ${anim.liveBreathe}`} />
                    <span className={styles.statusText}>{statusText}</span>
                </div>

                <div className={styles.metrics}>
                    <div className={styles.metric}>
                        <Radio size={11} className={styles.metricIcon} />
                        <span className={styles.metricValue}>{activeEarName || '-'}</span>
                    </div>
                    <div className={styles.divider} />
                    <div className={styles.metric} title="Messages in last hour">
                        <Activity size={11} className={styles.metricIcon} />
                        <span className={styles.metricValue}>{messageCount}</span>
                        <span className={styles.metricLabel}>msgs</span>
                    </div>
                    <div className={styles.divider} />
                    <div className={styles.metric} title="Signals detected">
                        <Zap size={11} className={styles.metricIcon} />
                        <span className={`${styles.metricValue} ${styles.signalAccent}`}>{signalCount}</span>
                        <span className={styles.metricLabel}>signals</span>
                    </div>
                    <div className={styles.divider} />
                    <div className={styles.metric} title="Last message received">
                        <Bell size={11} className={styles.metricIcon} />
                        <span className={styles.metricValue}>{relTime(lastMessageAt)}</span>
                    </div>
                </div>
            </div>

            {/* Right: action buttons */}
            <div className={styles.actions}>
                {onTestScalp && (
                    <button
                        className={styles.btn}
                        onClick={onTestScalp}
                        title="Simulate signals & verify OpenAlgo auto-trade"
                        aria-label="Test Scalp Engine"
                        style={{
                            backgroundColor: 'rgba(168, 85, 247, 0.15)',
                            borderColor: 'rgba(168, 85, 247, 0.35)',
                            color: '#d8b4fe'
                        }}
                    >
                        <Sparkles size={12} />
                        <span className="hidden sm:inline">Test Scalp Engine</span>
                    </button>
                )}
                {onOpenGates && (
                    <button
                        className={styles.btn}
                        onClick={onOpenGates}
                        title="Configure Autopilot Execution Risk Gates (Sandbox / Live Production)"
                        aria-label="Execution Risk Gates"
                        style={{
                            backgroundColor: 'rgba(56, 189, 248, 0.12)',
                            borderColor: 'rgba(56, 189, 248, 0.35)',
                            color: '#38bdf8'
                        }}
                    >
                        <Shield size={12} />
                        <span className="hidden sm:inline">Risk Gates</span>
                    </button>
                )}
                <button
                    className={`${styles.btn} ${styles.btnGhost}`}
                    onClick={onConfigure}
                    title="Configure Telegram Ears"
                    aria-label="Configure Telegram Ears"
                >
                    <Settings size={12} />
                    <span className="hidden sm:inline">Configure</span>
                </button>
                <button
                    className={`${styles.btn} ${styles.btnGhost} ${isRefreshingChannels ? anim.spin : ''}`}
                    onClick={onRefreshChannels}
                    disabled={isRefreshingChannels}
                    title="Re-fetch joined channels from Telegram"
                    aria-label="Refresh Channels"
                >
                    <RefreshCw size={12} />
                    <span className="hidden sm:inline">{isRefreshingChannels ? 'Refreshing…' : 'Refresh Channels'}</span>
                </button>
                {!isReady && (
                    <>
                        <button className={`${styles.btn} ${styles.btnAmber}`} onClick={onReconnect} title="Reconnect" aria-label="Reconnect">
                            <RefreshCw size={12} />
                            <span className="hidden sm:inline">Reconnect</span>
                        </button>
                        <button className={`${styles.btn} ${styles.btnRose}`} onClick={onLaunchServer} title="Launch Ear Server" aria-label="Launch Ear Server">
                            <Play size={12} />
                            <span className="hidden sm:inline">Launch Ear Server</span>
                        </button>
                    </>
                )}
            </div>
        </div>
    );
};

export default ConnectionBanner;
