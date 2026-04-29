/**
 * AutopilotGatesModal.tsx - WealthOS Autopilot Execution Risk Gates Controller
 * 
 * Provides an intuitive, visual control surface for all trading execution gates:
 * - Environment Toggle: Sandbox Mode (Paper / Testing) vs Live Production (Real Capital)
 * - Master Switch: Execution Risk Gates (Bypassed by default in Sandbox)
 * - Individual Gates: Channel Trust, Swarm Consensus, Dedup Lock, Spread Shield, Whitelist
 */
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Shield,
    ShieldAlert,
    ShieldCheck,
    ShieldOff,
    Zap,
    Check,
    X,
    RefreshCw,
    AlertCircle,
    Sliders,
    Layers,
    Lock,
    Unlock,
    Info,
    ArrowRight,
    Clock,
    Calendar,
    TrendingDown,
    Activity,
    AlertTriangle
} from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

export interface ExecutionGatesConfig {
    sandboxMode: boolean;
    masterEnabled: boolean;
    channelTrustGate: boolean;
    swarmConsensusGate: boolean;
    dedupLockGate: boolean;
    spreadShieldGate: boolean;
    tickerWhitelistGate: boolean;
    afternoonChopGate: boolean;
    afternoonCutoffTime: string;
    afternoonCutoffMode: 'ALL_DAYS' | 'EXPIRY_ONLY' | 'CUSTOM';
    afternoonCutoffDays: string[];
    dailyLossLimitEnabled: boolean;
    dailyLossLimit: number;
    maxDailyTradesEnabled: boolean;
    maxDailyTrades: number;
    entryOrderTtlEnabled: boolean;
    limitOrderTtlSec: number;
    triggerOrderTtlMin: number;
    updatedAt?: string;
}

interface AutopilotGatesModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGatesUpdated?: (gates: ExecutionGatesConfig) => void;
}

const DEFAULT_GATES: ExecutionGatesConfig = {
    sandboxMode: true,
    masterEnabled: false,
    channelTrustGate: false,
    swarmConsensusGate: false,
    dedupLockGate: false,
    spreadShieldGate: false,
    tickerWhitelistGate: false,
    afternoonChopGate: true,
    afternoonCutoffTime: '14:00',
    afternoonCutoffMode: 'ALL_DAYS',
    afternoonCutoffDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    dailyLossLimitEnabled: true,
    dailyLossLimit: 5000,
    maxDailyTradesEnabled: false,
    maxDailyTrades: 10,
    entryOrderTtlEnabled: true,
    limitOrderTtlSec: 90,
    triggerOrderTtlMin: 15,
};

export const AutopilotGatesModal: React.FC<AutopilotGatesModalProps> = ({
    isOpen,
    onClose,
    onGatesUpdated
}) => {
    const { toast } = useToast();
    const [gates, setGates] = useState<ExecutionGatesConfig>(DEFAULT_GATES);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const getEarHttpBase = () => {
        if (typeof window !== 'undefined' && (window as any).__TELEGRAM_EAR_HTTP_URL__) {
            return (window as any).__TELEGRAM_EAR_HTTP_URL__;
        }
        return (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
            ? `${window.location.protocol}//${window.location.host}/api/telegram-ear`
            : 'http://127.0.0.1:3001';
    };

    const fetchGates = async () => {
        setIsLoading(true);
        try {
            const res = await fetch(`${getEarHttpBase()}/api/autopilot/gates`);
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.gates) {
                    setGates({
                        ...DEFAULT_GATES,
                        ...data.gates
                    });
                }
            }
        } catch (e) {
            // Silently retain current state if server is offline
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchGates();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleToggle = (key: keyof ExecutionGatesConfig) => {
        setGates(prev => {
            const next = { ...prev, [key]: !prev[key] };
            // If turning on live production mode, suggest enabling master gates
            if (key === 'sandboxMode' && prev.sandboxMode) {
                // Switching from sandbox to live prod
                next.masterEnabled = true;
            } else if (key === 'sandboxMode' && !prev.sandboxMode) {
                // Switching from live prod to sandbox
                next.masterEnabled = false;
            }
            return next;
        });
    };

    const updateGate = <K extends keyof ExecutionGatesConfig>(key: K, value: ExecutionGatesConfig[K]) => {
        setGates(prev => ({ ...prev, [key]: value }));
    };

    const toggleWeekday = (day: string) => {
        setGates(prev => {
            const current = prev.afternoonCutoffDays || ['mon', 'tue', 'wed', 'thu', 'fri'];
            const exists = current.includes(day);
            const updated = exists ? current.filter(d => d !== day) : [...current, day];
            return {
                ...prev,
                afternoonCutoffDays: updated.length > 0 ? updated : [day]
            };
        });
    };

    const applyPreset = (preset: 'sandbox' | 'balanced' | 'lockdown') => {
        if (preset === 'sandbox') {
            setGates({
                sandboxMode: true,
                masterEnabled: false,
                channelTrustGate: false,
                swarmConsensusGate: false,
                dedupLockGate: false,
                spreadShieldGate: false,
                tickerWhitelistGate: false,
                afternoonChopGate: false,
                afternoonCutoffTime: '14:00',
                afternoonCutoffMode: 'ALL_DAYS',
                afternoonCutoffDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
                dailyLossLimitEnabled: false,
                dailyLossLimit: 5000,
                maxDailyTradesEnabled: false,
                maxDailyTrades: 10,
                entryOrderTtlEnabled: true,
                limitOrderTtlSec: 90,
                triggerOrderTtlMin: 15,
            });
            toast.info('Applied Sandbox Preset: All risk gates bypassed for frictionless paper testing.');
        } else if (preset === 'balanced') {
            setGates({
                sandboxMode: false,
                masterEnabled: true,
                channelTrustGate: true,
                swarmConsensusGate: false,
                dedupLockGate: true,
                spreadShieldGate: true,
                tickerWhitelistGate: false,
                afternoonChopGate: true,
                afternoonCutoffTime: '14:00',
                afternoonCutoffMode: 'EXPIRY_ONLY',
                afternoonCutoffDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
                dailyLossLimitEnabled: true,
                dailyLossLimit: 5000,
                maxDailyTradesEnabled: true,
                maxDailyTrades: 10,
                entryOrderTtlEnabled: true,
                limitOrderTtlSec: 90,
                triggerOrderTtlMin: 15,
            });
            toast.info('Applied Balanced Preset: Trust scoring, spread shield, dedup lock, and expiry cutoff active.');
        } else if (preset === 'lockdown') {
            setGates({
                sandboxMode: false,
                masterEnabled: true,
                channelTrustGate: true,
                swarmConsensusGate: true,
                dedupLockGate: true,
                spreadShieldGate: true,
                tickerWhitelistGate: true,
                afternoonChopGate: true,
                afternoonCutoffTime: '14:00',
                afternoonCutoffMode: 'ALL_DAYS',
                afternoonCutoffDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
                dailyLossLimitEnabled: true,
                dailyLossLimit: 3000,
                maxDailyTradesEnabled: true,
                maxDailyTrades: 6,
                entryOrderTtlEnabled: true,
                limitOrderTtlSec: 60,
                triggerOrderTtlMin: 10,
            });
            toast.info('Applied Production Lockdown: All 5 execution risk gates & strict daily limits strictly enforced.');
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch(`${getEarHttpBase()}/api/autopilot/gates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(gates)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    toast.success(
                        gates.masterEnabled
                            ? '🛡️ Strict Production Execution Gates Saved & Active'
                            : '⚡ Sandbox Mode Active: All Execution Gates Bypassed'
                    );
                    onGatesUpdated?.(data.gates);
                    setTimeout(onClose, 400);
                } else {
                    toast.error('Failed to update gates: ' + (data.error || 'Unknown error'));
                }
            } else {
                toast.error('Failed to communicate with Ear Server');
            }
        } catch (e: any) {
            toast.error('Network error saving gate settings: ' + e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const gateDefinitions = [
        {
            key: 'channelTrustGate' as const,
            title: 'Channel Trust & P&L Gate',
            subtitle: 'Suppresses signals from low-confidence or negative cumulative P&L channels (< ₹-2,500).',
            icon: ShieldCheck,
            badge: 'Capital Preserver',
            color: '#a855f7'
        },
        {
            key: 'swarmConsensusGate' as const,
            title: 'Multi-Channel Swarm Consensus',
            subtitle: 'Requires >= 70% directional agreement (CE vs PE) across channels before placing index options.',
            icon: Layers,
            badge: 'Swarm Intelligence',
            color: '#06b6d4'
        },
        {
            key: 'dedupLockGate' as const,
            title: '30-Minute Deduplication Lock',
            subtitle: 'Blocks duplicate trade punches for the same strike & symbol within a 30-minute rolling window.',
            icon: Lock,
            badge: 'Anti-Spam Guard',
            color: '#f59e0b'
        },
        {
            key: 'spreadShieldGate' as const,
            title: 'Spread Shield & Limit-Chaser',
            subtitle: 'Forces tight Limit order pricing and aborts trades if the ask-bid spread exceeds 1.5%.',
            icon: Zap,
            badge: 'Slippage Shield',
            color: '#10b981'
        },
        {
            key: 'tickerWhitelistGate' as const,
            title: 'Master Contract Whitelist',
            subtitle: 'Validates non-index equities and contracts strictly against exchange symtoken master tables.',
            icon: Check,
            badge: 'Contract Gate',
            color: '#6366f1'
        }
    ];

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <motion.div
                className="settings-modal"
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                transition={{ duration: 0.2 }}
                style={{
                    width: 'min(760px, calc(100vw - 2rem))',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    backgroundColor: '#0c0e14',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '16px',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '18px 24px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '10px',
                            backgroundColor: gates.masterEnabled ? 'rgba(168, 85, 247, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                            border: `1px solid ${gates.masterEnabled ? 'rgba(168, 85, 247, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: gates.masterEnabled ? '#c084fc' : '#34d399'
                        }}>
                            {gates.masterEnabled ? <ShieldCheck size={20} /> : <Zap size={20} />}
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                Autopilot Execution Risk Gates
                                <span style={{
                                    fontSize: '10px',
                                    fontWeight: 800,
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    textTransform: 'uppercase',
                                    backgroundColor: gates.sandboxMode ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                    color: gates.sandboxMode ? '#34d399' : '#f87171',
                                    border: `1px solid ${gates.sandboxMode ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`
                                }}>
                                    {gates.sandboxMode ? 'Sandbox Mode' : 'Live Production'}
                                </span>
                            </h3>
                            <p style={{ margin: '3px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
                                Manage OpenAlgo auto-trade punching filters, risk scoring, and channel suppression barriers.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#64748b',
                            cursor: 'pointer',
                            padding: '6px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    
                    {/* Environment Banner */}
                    <div style={{
                        padding: '14px 18px',
                        borderRadius: '12px',
                        backgroundColor: gates.masterEnabled ? 'rgba(168, 85, 247, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                        border: `1px solid ${gates.masterEnabled ? 'rgba(168, 85, 247, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '16px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: gates.masterEnabled ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                                color: gates.masterEnabled ? '#d8b4fe' : '#6ee7b7'
                            }}>
                                {gates.masterEnabled ? <Lock size={16} /> : <Unlock size={16} />}
                            </div>
                            <div>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                                    {gates.masterEnabled
                                        ? '🛡️ Quality Gates Active (Capital Protection Mode)'
                                        : '⚡ Sandbox Bypass: All Execution Gates Disabled'}
                                </div>
                                <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
                                    {gates.masterEnabled
                                        ? 'Signals are filtered by trust score, consensus, spread shield, and dedup before punching.'
                                        : 'All Telegram signals punch cleanly into OpenAlgo sandbox without being blocked by P&L or trust metrics.'}
                                </div>
                            </div>
                        </div>

                        {/* Master Override Toggle */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: gates.masterEnabled ? '#c084fc' : '#64748b' }}>
                                {gates.masterEnabled ? 'GATES ON' : 'GATES OFF'}
                            </span>
                            <button
                                onClick={() => handleToggle('masterEnabled')}
                                style={{
                                    width: '46px',
                                    height: '24px',
                                    borderRadius: '999px',
                                    backgroundColor: gates.masterEnabled ? '#9333ea' : '#334155',
                                    position: 'relative',
                                    cursor: 'pointer',
                                    border: 'none',
                                    padding: '2px',
                                    transition: 'background-color 0.2s'
                                }}
                            >
                                <motion.div
                                    layout
                                    style={{
                                        width: '20px',
                                        height: '20px',
                                        borderRadius: '50%',
                                        backgroundColor: '#ffffff',
                                        position: 'absolute',
                                        top: '2px',
                                        left: gates.masterEnabled ? '24px' : '2px',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                    }}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Quick Presets */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Execution Mode Presets
                            </span>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>One-click operational profiles</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                            <button
                                onClick={() => applyPreset('sandbox')}
                                style={{
                                    padding: '10px 12px',
                                    borderRadius: '10px',
                                    border: !gates.masterEnabled ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                                    backgroundColor: !gates.masterEnabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: !gates.masterEnabled ? '#34d399' : '#e2e8f0' }}>
                                    <Zap size={13} />
                                    <span>Sandbox Testing</span>
                                </div>
                                <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '3px' }}>
                                    Bypass all gates. Free punching for paper simulation.
                                </div>
                            </button>

                            <button
                                onClick={() => applyPreset('balanced')}
                                style={{
                                    padding: '10px 12px',
                                    borderRadius: '10px',
                                    border: (gates.masterEnabled && !gates.swarmConsensusGate) ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                                    backgroundColor: (gates.masterEnabled && !gates.swarmConsensusGate) ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: (gates.masterEnabled && !gates.swarmConsensusGate) ? '#22d3ee' : '#e2e8f0' }}>
                                    <Sliders size={13} />
                                    <span>Balanced Guard</span>
                                </div>
                                <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '3px' }}>
                                    Trust gate + Spread shield + Dedup lockout.
                                </div>
                            </button>

                            <button
                                onClick={() => applyPreset('lockdown')}
                                style={{
                                    padding: '10px 12px',
                                    borderRadius: '10px',
                                    border: (gates.masterEnabled && gates.swarmConsensusGate && gates.channelTrustGate) ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                                    backgroundColor: (gates.masterEnabled && gates.swarmConsensusGate && gates.channelTrustGate) ? 'rgba(168, 85, 247, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: (gates.masterEnabled && gates.swarmConsensusGate && gates.channelTrustGate) ? '#c084fc' : '#e2e8f0' }}>
                                    <ShieldCheck size={13} />
                                    <span>Live Production</span>
                                </div>
                                <div style={{ fontSize: '10.5px', color: '#94a3b8', marginTop: '3px' }}>
                                    Enforce all 5 gates. Max capital protection.
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Session Timing & Capital Defense Section */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Session Timing & Capital Defense
                                </span>
                                <span style={{
                                    fontSize: '9.5px',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                    color: '#fbbf24',
                                    border: '1px solid rgba(245, 158, 11, 0.3)'
                                }}>
                                    Live Risk Controls
                                </span>
                            </div>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                                Defense against late afternoon chop & daily drawdown
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {/* Card 1: Afternoon Volatility & Chop Cutoff */}
                            <div style={{
                                padding: '14px 16px',
                                borderRadius: '12px',
                                backgroundColor: gates.afternoonChopGate ? 'rgba(245, 158, 11, 0.04)' : 'rgba(255, 255, 255, 0.015)',
                                border: gates.afternoonChopGate ? '1px solid rgba(245, 158, 11, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                                transition: 'all 0.2s'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                            width: '34px',
                                            height: '34px',
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(245, 158, 11, 0.12)',
                                            border: '1px solid rgba(245, 158, 11, 0.3)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#fbbf24'
                                        }}>
                                            <Clock size={17} />
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                                                    Afternoon Volatility & Chop Cutoff Gate
                                                </span>
                                                <span style={{
                                                    fontSize: '9.5px',
                                                    fontWeight: 700,
                                                    padding: '1px 6px',
                                                    borderRadius: '4px',
                                                    backgroundColor: gates.afternoonChopGate ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                                                    color: gates.afternoonChopGate ? '#fbbf24' : '#64748b'
                                                }}>
                                                    {gates.afternoonChopGate ? `Active @ ${gates.afternoonCutoffTime || '14:00'}` : 'Disabled'}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                                                Suppresses new trade punches in volatile late sessions to preserve accumulated morning profits.
                                            </div>
                                        </div>
                                    </div>

                                    {/* Toggle Button */}
                                    <button
                                        onClick={() => handleToggle('afternoonChopGate')}
                                        style={{
                                            width: '42px',
                                            height: '22px',
                                            borderRadius: '999px',
                                            backgroundColor: gates.afternoonChopGate ? '#f59e0b' : '#334155',
                                            position: 'relative',
                                            cursor: 'pointer',
                                            border: 'none',
                                            padding: '2px',
                                            flexShrink: 0,
                                            transition: 'background-color 0.2s'
                                        }}
                                        title={gates.afternoonChopGate ? 'Disable afternoon cutoff' : 'Enable afternoon cutoff'}
                                    >
                                        <motion.div
                                            layout
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: '50%',
                                                backgroundColor: '#ffffff',
                                                position: 'absolute',
                                                top: '2px',
                                                left: gates.afternoonChopGate ? '22px' : '2px',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.25)'
                                            }}
                                        />
                                    </button>
                                </div>

                                {/* Expanded Settings Tray for Cutoff */}
                                {gates.afternoonChopGate && (
                                    <div style={{
                                        marginTop: '14px',
                                        paddingTop: '12px',
                                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                    }}>
                                        {/* Row 1: Cutoff Time */}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#e2e8f0' }}>Cutoff Time (IST):</span>
                                                <span style={{ fontSize: '10.5px', color: '#64748b' }}>(No new trades punched after this time)</span>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                {['13:30', '14:00', '14:15', '14:30', '14:45', '15:00'].map(time => {
                                                    const isSelected = gates.afternoonCutoffTime === time;
                                                    return (
                                                        <button
                                                            key={time}
                                                            onClick={() => updateGate('afternoonCutoffTime', time)}
                                                            style={{
                                                                padding: '3px 8px',
                                                                borderRadius: '6px',
                                                                fontSize: '11px',
                                                                fontWeight: 600,
                                                                fontFamily: 'monospace',
                                                                cursor: 'pointer',
                                                                border: isSelected ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                                                                backgroundColor: isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                                                                color: isSelected ? '#fbbf24' : '#94a3b8',
                                                                transition: 'all 0.15s'
                                                            }}
                                                        >
                                                            {time}
                                                        </button>
                                                    );
                                                })}
                                                <input
                                                    type="time"
                                                    value={gates.afternoonCutoffTime || '14:00'}
                                                    onChange={e => updateGate('afternoonCutoffTime', e.target.value)}
                                                    style={{
                                                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                                        borderRadius: '6px',
                                                        color: '#f8fafc',
                                                        padding: '2px 6px',
                                                        fontSize: '11px',
                                                        fontFamily: 'monospace',
                                                        outline: 'none',
                                                        cursor: 'pointer'
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {/* Row 2: Cutoff Enforcement Mode */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#e2e8f0' }}>Active Days Schedule:</span>
                                                <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                                                    {gates.afternoonCutoffMode === 'ALL_DAYS' && 'Active Monday through Friday'}
                                                    {gates.afternoonCutoffMode === 'EXPIRY_ONLY' && 'Enforced strictly on underlying index expiry day'}
                                                    {gates.afternoonCutoffMode === 'CUSTOM' && `${gates.afternoonCutoffDays?.length || 0} days selected`}
                                                </span>
                                            </div>

                                            {/* Mode Tabs */}
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                                                {[
                                                    { id: 'ALL_DAYS' as const, label: 'All Weekdays', desc: 'Mon - Fri daily cutoff' },
                                                    { id: 'EXPIRY_ONLY' as const, label: 'Expiry Days Only', desc: 'Index weekly expiry (Nifty: Thu, Sensex: Fri...)' },
                                                    { id: 'CUSTOM' as const, label: 'Custom Days', desc: 'Select individual days' }
                                                ].map(m => {
                                                    const isModeActive = gates.afternoonCutoffMode === m.id;
                                                    return (
                                                        <button
                                                            key={m.id}
                                                            onClick={() => updateGate('afternoonCutoffMode', m.id)}
                                                            style={{
                                                                padding: '8px 10px',
                                                                borderRadius: '8px',
                                                                textAlign: 'left',
                                                                cursor: 'pointer',
                                                                border: isModeActive ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.08)',
                                                                backgroundColor: isModeActive ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                                                                transition: 'all 0.15s'
                                                            }}
                                                        >
                                                            <div style={{ fontSize: '11.5px', fontWeight: 700, color: isModeActive ? '#fbbf24' : '#e2e8f0' }}>
                                                                {m.label}
                                                            </div>
                                                            <div style={{ fontSize: '9.5px', color: '#94a3b8', marginTop: '2px' }}>
                                                                {m.desc}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* Custom Day Chips */}
                                            {gates.afternoonCutoffMode === 'CUSTOM' && (
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    marginTop: '4px',
                                                    padding: '8px 12px',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                                                    borderRadius: '8px',
                                                    border: '1px solid rgba(255, 255, 255, 0.05)'
                                                }}>
                                                    <span style={{ fontSize: '11px', color: '#94a3b8', marginRight: '6px' }}>Enforce Cutoff On:</span>
                                                    {[
                                                        { id: 'mon', label: 'Mon' },
                                                        { id: 'tue', label: 'Tue' },
                                                        { id: 'wed', label: 'Wed' },
                                                        { id: 'thu', label: 'Thu' },
                                                        { id: 'fri', label: 'Fri' }
                                                    ].map(d => {
                                                        const isDayOn = (gates.afternoonCutoffDays || []).includes(d.id);
                                                        return (
                                                            <button
                                                                key={d.id}
                                                                onClick={() => toggleWeekday(d.id)}
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    borderRadius: '6px',
                                                                    fontSize: '11px',
                                                                    fontWeight: 700,
                                                                    cursor: 'pointer',
                                                                    border: isDayOn ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                                                                    backgroundColor: isDayOn ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                                                                    color: isDayOn ? '#fbbf24' : '#64748b',
                                                                    transition: 'all 0.15s'
                                                                }}
                                                            >
                                                                {d.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Card 2: Daily Drawdown Circuit Breaker */}
                            <div style={{
                                padding: '14px 16px',
                                borderRadius: '12px',
                                backgroundColor: gates.dailyLossLimitEnabled ? 'rgba(239, 68, 68, 0.04)' : 'rgba(255, 255, 255, 0.015)',
                                border: gates.dailyLossLimitEnabled ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                                transition: 'all 0.2s'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                            width: '34px',
                                            height: '34px',
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                            border: '1px solid rgba(239, 68, 68, 0.3)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#f87171'
                                        }}>
                                            <TrendingDown size={17} />
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                                                    Daily Loss Circuit Breaker
                                                </span>
                                                <span style={{
                                                    fontSize: '9.5px',
                                                    fontWeight: 700,
                                                    padding: '1px 6px',
                                                    borderRadius: '4px',
                                                    backgroundColor: gates.dailyLossLimitEnabled ? 'rgba(239, 68, 68, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                                                    color: gates.dailyLossLimitEnabled ? '#f87171' : '#64748b'
                                                }}>
                                                    {gates.dailyLossLimitEnabled ? `Limit: ₹${(gates.dailyLossLimit || 5000).toLocaleString()}` : 'Disabled'}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                                                Instantly halts all automated trade execution if realized intraday loss breaches limit.
                                            </div>
                                        </div>
                                    </div>

                                    {/* Toggle Button */}
                                    <button
                                        onClick={() => handleToggle('dailyLossLimitEnabled')}
                                        style={{
                                            width: '42px',
                                            height: '22px',
                                            borderRadius: '999px',
                                            backgroundColor: gates.dailyLossLimitEnabled ? '#ef4444' : '#334155',
                                            position: 'relative',
                                            cursor: 'pointer',
                                            border: 'none',
                                            padding: '2px',
                                            flexShrink: 0,
                                            transition: 'background-color 0.2s'
                                        }}
                                        title={gates.dailyLossLimitEnabled ? 'Disable daily loss limit' : 'Enable daily loss limit'}
                                    >
                                        <motion.div
                                            layout
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: '50%',
                                                backgroundColor: '#ffffff',
                                                position: 'absolute',
                                                top: '2px',
                                                left: gates.dailyLossLimitEnabled ? '22px' : '2px',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.25)'
                                            }}
                                        />
                                    </button>
                                </div>

                                {/* Expanded Tray for Loss Limit */}
                                {gates.dailyLossLimitEnabled && (
                                    <div style={{
                                        marginTop: '14px',
                                        paddingTop: '12px',
                                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        flexWrap: 'wrap',
                                        gap: '10px'
                                    }}>
                                        <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#e2e8f0' }}>Max Permitted Daily Loss:</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            {[2500, 5000, 7500, 10000].map(amt => {
                                                const isSelected = gates.dailyLossLimit === amt;
                                                return (
                                                    <button
                                                        key={amt}
                                                        onClick={() => updateGate('dailyLossLimit', amt)}
                                                        style={{
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            fontSize: '11px',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            border: isSelected ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.1)',
                                                            backgroundColor: isSelected ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                                                            color: isSelected ? '#f87171' : '#94a3b8',
                                                            transition: 'all 0.15s'
                                                        }}
                                                    >
                                                        ₹{amt.toLocaleString()}
                                                    </button>
                                                );
                                            })}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                <span style={{ fontSize: '11px', color: '#94a3b8' }}>₹</span>
                                                <input
                                                    type="number"
                                                    step="500"
                                                    min="500"
                                                    value={gates.dailyLossLimit || 5000}
                                                    onChange={e => updateGate('dailyLossLimit', Math.max(500, Number(e.target.value) || 0))}
                                                    style={{
                                                        width: '75px',
                                                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                                        borderRadius: '6px',
                                                        color: '#f8fafc',
                                                        padding: '3px 6px',
                                                        fontSize: '11px',
                                                        fontFamily: 'monospace',
                                                        outline: 'none'
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Card 3: Max Daily Scalp Trades Limit */}
                            <div style={{
                                padding: '14px 16px',
                                borderRadius: '12px',
                                backgroundColor: gates.maxDailyTradesEnabled ? 'rgba(6, 182, 212, 0.04)' : 'rgba(255, 255, 255, 0.015)',
                                border: gates.maxDailyTradesEnabled ? '1px solid rgba(6, 182, 212, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                                transition: 'all 0.2s'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                            width: '34px',
                                            height: '34px',
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(6, 182, 212, 0.12)',
                                            border: '1px solid rgba(6, 182, 212, 0.3)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#22d3ee'
                                        }}>
                                            <Activity size={17} />
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                                                    Max Daily Scalp Trades Cap
                                                </span>
                                                <span style={{
                                                    fontSize: '9.5px',
                                                    fontWeight: 700,
                                                    padding: '1px 6px',
                                                    borderRadius: '4px',
                                                    backgroundColor: gates.maxDailyTradesEnabled ? 'rgba(6, 182, 212, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                                                    color: gates.maxDailyTradesEnabled ? '#22d3ee' : '#64748b'
                                                }}>
                                                    {gates.maxDailyTradesEnabled ? `Cap: ${gates.maxDailyTrades || 10} Trades` : 'Unlimited'}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                                                Caps total automated trade punches per session to eliminate over-trading in sideways markets.
                                            </div>
                                        </div>
                                    </div>

                                    {/* Toggle Button */}
                                    <button
                                        onClick={() => handleToggle('maxDailyTradesEnabled')}
                                        style={{
                                            width: '42px',
                                            height: '22px',
                                            borderRadius: '999px',
                                            backgroundColor: gates.maxDailyTradesEnabled ? '#06b6d4' : '#334155',
                                            position: 'relative',
                                            cursor: 'pointer',
                                            border: 'none',
                                            padding: '2px',
                                            flexShrink: 0,
                                            transition: 'background-color 0.2s'
                                        }}
                                        title={gates.maxDailyTradesEnabled ? 'Disable trades cap' : 'Enable trades cap'}
                                    >
                                        <motion.div
                                            layout
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: '50%',
                                                backgroundColor: '#ffffff',
                                                position: 'absolute',
                                                top: '2px',
                                                left: gates.maxDailyTradesEnabled ? '22px' : '2px',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.25)'
                                            }}
                                        />
                                    </button>
                                </div>

                                {/* Expanded Tray for Trades Cap */}
                                {gates.maxDailyTradesEnabled && (
                                    <div style={{
                                        marginTop: '14px',
                                        paddingTop: '12px',
                                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        flexWrap: 'wrap',
                                        gap: '10px'
                                    }}>
                                        <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#e2e8f0' }}>Max Trades Per Day:</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            {[3, 5, 8, 10, 15].map(cnt => {
                                                const isSelected = gates.maxDailyTrades === cnt;
                                                return (
                                                    <button
                                                        key={cnt}
                                                        onClick={() => updateGate('maxDailyTrades', cnt)}
                                                        style={{
                                                            padding: '3px 8px',
                                                            borderRadius: '6px',
                                                            fontSize: '11px',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            border: isSelected ? '1px solid #06b6d4' : '1px solid rgba(255, 255, 255, 0.1)',
                                                            backgroundColor: isSelected ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                                                            color: isSelected ? '#22d3ee' : '#94a3b8',
                                                            transition: 'all 0.15s'
                                                        }}
                                                    >
                                                        {cnt} Trades
                                                    </button>
                                                );
                                            })}
                                            <input
                                                type="number"
                                                min="1"
                                                max="50"
                                                value={gates.maxDailyTrades || 10}
                                                onChange={e => updateGate('maxDailyTrades', Math.max(1, Number(e.target.value) || 1))}
                                                style={{
                                                    width: '60px',
                                                    backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                                    border: '1px solid rgba(255, 255, 255, 0.15)',
                                                    borderRadius: '6px',
                                                    color: '#f8fafc',
                                                    padding: '3px 6px',
                                                    fontSize: '11px',
                                                    fontFamily: 'monospace',
                                                    outline: 'none'
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Card 4: Pending Entry Order Auto-Expiry (TTL) */}
                            <div style={{
                                padding: '14px 16px',
                                borderRadius: '12px',
                                backgroundColor: gates.entryOrderTtlEnabled ? 'rgba(168, 85, 247, 0.04)' : 'rgba(255, 255, 255, 0.015)',
                                border: gates.entryOrderTtlEnabled ? '1px solid rgba(168, 85, 247, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                                transition: 'all 0.2s'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                            width: '34px',
                                            height: '34px',
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(168, 85, 247, 0.12)',
                                            border: '1px solid rgba(168, 85, 247, 0.3)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#c084fc'
                                        }}>
                                            <Clock size={17} />
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                                                    Pending Entry Order Auto-Expiry (TTL)
                                                </span>
                                                <span style={{
                                                    fontSize: '9.5px',
                                                    fontWeight: 700,
                                                    padding: '1px 6px',
                                                    borderRadius: '4px',
                                                    backgroundColor: gates.entryOrderTtlEnabled ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                                                    color: gates.entryOrderTtlEnabled ? '#c084fc' : '#64748b'
                                                }}>
                                                    {gates.entryOrderTtlEnabled ? `Limit: ${gates.limitOrderTtlSec || 90}s | Trigger: ${gates.triggerOrderTtlMin || 15}m` : 'Disabled'}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                                                Auto-cancels lingering orders to eliminate ghost fills and allow breakouts sufficient room to develop.
                                            </div>
                                        </div>
                                    </div>

                                    {/* Toggle Button */}
                                    <button
                                        onClick={() => handleToggle('entryOrderTtlEnabled')}
                                        style={{
                                            width: '42px',
                                            height: '22px',
                                            borderRadius: '999px',
                                            backgroundColor: gates.entryOrderTtlEnabled ? '#a855f7' : '#334155',
                                            position: 'relative',
                                            cursor: 'pointer',
                                            border: 'none',
                                            padding: '2px',
                                            flexShrink: 0,
                                            transition: 'background-color 0.2s'
                                        }}
                                        title={gates.entryOrderTtlEnabled ? 'Disable order TTL' : 'Enable order TTL'}
                                    >
                                        <motion.div
                                            layout
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: '50%',
                                                backgroundColor: '#ffffff',
                                                position: 'absolute',
                                                top: '2px',
                                                left: gates.entryOrderTtlEnabled ? '22px' : '2px',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.25)'
                                            }}
                                        />
                                    </button>
                                </div>

                                {/* Expanded Tray for Order TTL Settings */}
                                {gates.entryOrderTtlEnabled && (
                                    <div style={{
                                        marginTop: '14px',
                                        paddingTop: '12px',
                                        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                    }}>
                                        {/* Row 1: Normal Limit Order TTL */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            flexWrap: 'wrap',
                                            gap: '10px'
                                        }}>
                                            <div>
                                                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#e2e8f0' }}>Normal Limit Order TTL:</span>
                                                <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '6px' }}>(Cancels unreached limit fills)</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                {[30, 60, 90, 120, 180].map(sec => {
                                                    const isSelected = (gates.limitOrderTtlSec || 90) === sec;
                                                    return (
                                                        <button
                                                            key={sec}
                                                            onClick={() => updateGate('limitOrderTtlSec', sec)}
                                                            style={{
                                                                padding: '3px 8px',
                                                                borderRadius: '6px',
                                                                fontSize: '11px',
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                                border: isSelected ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.1)',
                                                                backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                                                                color: isSelected ? '#c084fc' : '#94a3b8',
                                                                transition: 'all 0.15s'
                                                            }}
                                                        >
                                                            {sec}s
                                                        </button>
                                                    );
                                                })}
                                                <input
                                                    type="number"
                                                    min="10"
                                                    max="900"
                                                    step="5"
                                                    value={gates.limitOrderTtlSec || 90}
                                                    onChange={e => updateGate('limitOrderTtlSec', Math.max(10, Number(e.target.value) || 10))}
                                                    style={{
                                                        width: '55px',
                                                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                                        borderRadius: '6px',
                                                        color: '#f8fafc',
                                                        padding: '3px 6px',
                                                        fontSize: '11px',
                                                        fontFamily: 'monospace',
                                                        outline: 'none'
                                                    }}
                                                />
                                                <span style={{ fontSize: '11px', color: '#64748b' }}>sec</span>
                                            </div>
                                        </div>

                                        {/* Row 2: Breakout Trigger (SL) Order TTL */}
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            flexWrap: 'wrap',
                                            gap: '10px'
                                        }}>
                                            <div>
                                                <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#e2e8f0' }}>Breakout Trigger (SL) TTL:</span>
                                                <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '6px' }}>(Wait window for price to breach trigger)</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                {[5, 10, 15, 30, 60].map(min => {
                                                    const isSelected = (gates.triggerOrderTtlMin || 15) === min;
                                                    return (
                                                        <button
                                                            key={min}
                                                            onClick={() => updateGate('triggerOrderTtlMin', min)}
                                                            style={{
                                                                padding: '3px 8px',
                                                                borderRadius: '6px',
                                                                fontSize: '11px',
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                                border: isSelected ? '1px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.1)',
                                                                backgroundColor: isSelected ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                                                                color: isSelected ? '#c084fc' : '#94a3b8',
                                                                transition: 'all 0.15s'
                                                            }}
                                                        >
                                                            {min}m
                                                        </button>
                                                    );
                                                })}
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="180"
                                                    step="1"
                                                    value={gates.triggerOrderTtlMin || 15}
                                                    onChange={e => updateGate('triggerOrderTtlMin', Math.max(1, Number(e.target.value) || 1))}
                                                    style={{
                                                        width: '55px',
                                                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                                        border: '1px solid rgba(255, 255, 255, 0.15)',
                                                        borderRadius: '6px',
                                                        color: '#f8fafc',
                                                        padding: '3px 6px',
                                                        fontSize: '11px',
                                                        fontFamily: 'monospace',
                                                        outline: 'none'
                                                    }}
                                                />
                                                <span style={{ fontSize: '11px', color: '#64748b' }}>min</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Individual Gate Cards */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Individual Gate Configuration
                            </span>
                            {!gates.masterEnabled && (
                                <span style={{ fontSize: '11px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Info size={11} /> Master switch currently bypassing all gates below
                                </span>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {gateDefinitions.map((def) => {
                                const isEnabled = gates.masterEnabled && gates[def.key];
                                const isIndividuallyToggled = gates[def.key];
                                const IconComp = def.icon;

                                return (
                                    <div
                                        key={def.key}
                                        style={{
                                            padding: '12px 16px',
                                            borderRadius: '10px',
                                            backgroundColor: isEnabled ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.015)',
                                            border: isEnabled ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(255, 255, 255, 0.05)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '14px',
                                            transition: 'all 0.15s'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{
                                                width: '32px',
                                                height: '32px',
                                                borderRadius: '8px',
                                                backgroundColor: `${def.color}15`,
                                                border: `1px solid ${def.color}30`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: def.color
                                            }}>
                                                <IconComp size={16} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>
                                                        {def.title}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '9.5px',
                                                        fontWeight: 700,
                                                        padding: '1px 6px',
                                                        borderRadius: '4px',
                                                        backgroundColor: 'rgba(255, 255, 255, 0.06)',
                                                        color: '#94a3b8'
                                                    }}>
                                                        {def.badge}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                                                    {def.subtitle}
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => handleToggle(def.key)}
                                            style={{
                                                width: '40px',
                                                height: '20px',
                                                borderRadius: '999px',
                                                backgroundColor: isIndividuallyToggled ? '#6366f1' : '#334155',
                                                position: 'relative',
                                                cursor: 'pointer',
                                                border: 'none',
                                                padding: '2px',
                                                flexShrink: 0,
                                                opacity: !gates.masterEnabled ? 0.6 : 1,
                                                transition: 'background-color 0.2s'
                                            }}
                                            title={!gates.masterEnabled ? 'Gate configured but currently bypassed by Master Switch' : 'Toggle gate'}
                                        >
                                            <motion.div
                                                layout
                                                style={{
                                                    width: '16px',
                                                    height: '16px',
                                                    borderRadius: '50%',
                                                    backgroundColor: '#ffffff',
                                                    position: 'absolute',
                                                    top: '2px',
                                                    left: isIndividuallyToggled ? '22px' : '2px',
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                                }}
                                            />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                </div>

                {/* Modal Footer */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)'
                }}>
                    <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />
                        <span>Last updated: {gates.updatedAt ? new Date(gates.updatedAt).toLocaleTimeString() : 'Default'}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '8px 14px',
                                borderRadius: '8px',
                                backgroundColor: 'transparent',
                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                color: '#94a3b8',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer'
                            }}
                        >
                            Cancel
                        </button>

                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            style={{
                                padding: '8px 18px',
                                borderRadius: '8px',
                                backgroundColor: gates.masterEnabled ? '#9333ea' : '#10b981',
                                border: 'none',
                                color: '#ffffff',
                                fontSize: '12px',
                                fontWeight: 700,
                                cursor: isSaving ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                opacity: isSaving ? 0.7 : 1,
                                boxShadow: gates.masterEnabled
                                    ? '0 4px 12px rgba(147, 51, 234, 0.35)'
                                    : '0 4px 12px rgba(16, 185, 129, 0.35)'
                            }}
                        >
                            {isSaving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                            <span>{isSaving ? 'Saving…' : 'Save & Apply Gates'}</span>
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default AutopilotGatesModal;
