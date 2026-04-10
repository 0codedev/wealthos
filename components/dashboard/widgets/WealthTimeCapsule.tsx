import React, { useState, useMemo } from 'react';
import {
    Lock, Unlock, Plus, Clock, Trophy, Calendar, Send,
    Eye, Star, TrendingUp, TrendingDown, Minus, ChevronDown,
    ChevronUp, Trash2, X, Target
} from 'lucide-react';
import { useTimeCapsuleStore, type TimeCapsule } from '../../../store/timeCapsuleStore';
import { formatCurrency } from '../../../utils/helpers';
import { Investment } from '../../../types';
import EmptyState from '../../shared/EmptyState';

interface WealthTimeCapsuleProps {
    totalCurrentValue: number;
    totalInvested: number;
    investments: Investment[];
    isPrivacyMode?: boolean;
}

const OUTLOOK_EMOJI = { bull: '🐂', bear: '🐻', sideways: '🦀' };
const OUTLOOK_LABEL = { bull: 'Bullish', bear: 'Bearish', sideways: 'Sideways' };

const SEAL_PERIODS = [
    { label: '1 Month', months: 1 },
    { label: '3 Months', months: 3 },
    { label: '6 Months', months: 6 },
    { label: '1 Year', months: 12 },
    { label: '2 Years', months: 24 },
];

// Get verdict based on accuracy
const getVerdict = (predicted: number, actual: number): { emoji: string; label: string; color: string } => {
    const error = Math.abs(predicted - actual) / actual;
    if (error < 0.05) return { emoji: '🔮', label: 'Prophet!', color: 'text-violet-400' };
    if (error < 0.15) return { emoji: '🎯', label: 'Sharpshooter!', color: 'text-emerald-400' };
    if (error < 0.30) return { emoji: '👀', label: 'Close!', color: 'text-amber-400' };
    if (error < 0.50) return { emoji: '🤷', label: 'Nice Try', color: 'text-orange-400' };
    return { emoji: '💀', label: 'Way Off', color: 'text-red-400' };
};

// Format countdown
const getCountdown = (openDate: string): { label: string; isReady: boolean; progress: number; createdDays?: number } => {
    const now = new Date();
    const target = new Date(openDate);
    const diff = target.getTime() - now.getTime();

    if (diff <= 0) return { label: 'Ready to open!', isReady: true, progress: 100 };

    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    const hours = Math.ceil(diff / (1000 * 60 * 60));

    if (days > 365) {
        const years = (days / 365).toFixed(1);
        return { label: `${years} years`, isReady: false, progress: 0 };
    }
    if (days > 30) {
        const months = Math.ceil(days / 30);
        return { label: `${months} months`, isReady: false, progress: 0 };
    }
    if (days > 1) {
        return { label: `${days} days`, isReady: false, progress: 0 };
    }
    return { label: `${hours} hours`, isReady: false, progress: 0 };
};

const WealthTimeCapsule: React.FC<WealthTimeCapsuleProps> = ({
    totalCurrentValue,
    totalInvested,
    investments,
    isPrivacyMode = false,
}) => {
    const { capsules, createCapsule, openCapsule, deleteCapsule } = useTimeCapsuleStore();
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [expandedCapsule, setExpandedCapsule] = useState<string | null>(null);
    const [revealingCapsule, setRevealingCapsule] = useState<string | null>(null);

    // Form state
    const [targetValue, setTargetValue] = useState('');
    const [note, setNote] = useState('');
    const [confidence, setConfidence] = useState(50);
    const [outlook, setOutlook] = useState<'bull' | 'bear' | 'sideways'>('bull');
    const [sealMonths, setSealMonths] = useState(6);

    // Stats
    const stats = useMemo(() => {
        const opened = capsules.filter(c => c.isOpened);
        const sealed = capsules.filter(c => !c.isOpened);
        const ready = sealed.filter(c => new Date(c.openDate) <= new Date());

        let accuracySum = 0;
        let accuracyCount = 0;
        opened.forEach(c => {
            if (c.actualValueAtOpen && c.prediction.targetValue > 0) {
                const error = Math.abs(c.prediction.targetValue - c.actualValueAtOpen) / c.actualValueAtOpen;
                accuracySum += Math.max(0, 1 - error);
                accuracyCount++;
            }
        });

        return {
            total: capsules.length,
            sealed: sealed.length,
            opened: opened.length,
            ready: ready.length,
            avgAccuracy: accuracyCount > 0 ? Math.round((accuracySum / accuracyCount) * 100) : null,
        };
    }, [capsules]);

    const handleCreate = () => {
        const target = parseFloat(targetValue);
        if (!target || target <= 0) return;

        const openDate = new Date();
        openDate.setMonth(openDate.getMonth() + sealMonths);

        const topHoldings = [...investments]
            .sort((a, b) => b.currentValue - a.currentValue)
            .slice(0, 5)
            .map(i => ({ name: i.name, value: i.currentValue }));

        createCapsule({
            openDate: openDate.toISOString(),
            prediction: {
                targetValue: target,
                note: note || 'No note',
                confidence,
                topHolding: topHoldings[0]?.name || 'N/A',
                marketOutlook: outlook,
            },
            snapshotAtCreation: {
                totalValue: totalCurrentValue,
                totalInvested: totalInvested,
                topHoldings,
            },
        });

        // Reset form
        setTargetValue('');
        setNote('');
        setConfidence(50);
        setOutlook('bull');
        setShowCreateForm(false);
    };

    const handleOpen = (capsule: TimeCapsule) => {
        setRevealingCapsule(capsule.id);
        // Simulate reveal animation delay
        setTimeout(() => {
            openCapsule(capsule.id, totalCurrentValue);
            setTimeout(() => setRevealingCapsule(null), 1500);
        }, 1500);
    };

    return (
        <div className="glass-card p-5 rounded-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500/20 to-yellow-500/20">
                        <Lock className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">Wealth Time Capsule</h3>
                        <p className="text-[10px] text-white/40">
                            {stats.sealed} sealed · {stats.ready > 0 && <span className="text-amber-400 animate-pulse">{stats.ready} ready!</span>}
                            {stats.ready === 0 && `${stats.opened} opened`}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => setShowCreateForm(!showCreateForm)}
                    className={`p-2 rounded-xl transition-all ${showCreateForm
                        ? 'bg-red-500/20 text-red-400 rotate-45'
                        : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                        }`}
                >
                    {showCreateForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </button>
            </div>

            {/* Stats bar */}
            {stats.total > 0 && (
                <div className="grid grid-cols-3 gap-2">
                    <div className="bg-white/5 rounded-lg p-2 text-center">
                        <div className="text-[9px] text-white/40">Created</div>
                        <div className="text-xs font-bold text-white">{stats.total}</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2 text-center">
                        <div className="text-[9px] text-white/40">Opened</div>
                        <div className="text-xs font-bold text-emerald-400">{stats.opened}</div>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2 text-center">
                        <div className="text-[9px] text-white/40">Accuracy</div>
                        <div className="text-xs font-bold text-violet-400">
                            {stats.avgAccuracy !== null ? `${stats.avgAccuracy}%` : '—'}
                        </div>
                    </div>
                </div>
            )}

            {/* CREATE FORM */}
            {showCreateForm && (
                <div className="bg-white/5 rounded-xl p-4 space-y-3 border border-amber-500/10 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="text-xs font-bold text-amber-400 flex items-center gap-1">
                        <Star className="w-3 h-3" /> Seal Your Prediction
                    </div>

                    {/* Target Value */}
                    <div>
                        <label className="text-[10px] text-white/40 block mb-1">
                            Portfolio value in {sealMonths} months (₹)
                        </label>
                        <input
                            type="number"
                            value={targetValue}
                            onChange={e => setTargetValue(e.target.value)}
                            placeholder={`Current: ${isPrivacyMode ? '•••' : formatCurrency(totalCurrentValue)}`}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500/30"
                        />
                    </div>

                    {/* Seal Period */}
                    <div>
                        <label className="text-[10px] text-white/40 block mb-1">Seal Duration</label>
                        <div className="flex gap-1">
                            {SEAL_PERIODS.map(p => (
                                <button
                                    key={p.months}
                                    onClick={() => setSealMonths(p.months)}
                                    className={`flex-1 text-[10px] py-1.5 rounded-lg transition-all ${sealMonths === p.months
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                        : 'bg-white/5 text-white/40 hover:text-white/60 border border-transparent'
                                        }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Outlook */}
                    <div>
                        <label className="text-[10px] text-white/40 block mb-1">Market Outlook</label>
                        <div className="flex gap-2">
                            {(['bull', 'bear', 'sideways'] as const).map(o => (
                                <button
                                    key={o}
                                    onClick={() => setOutlook(o)}
                                    className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs transition-all ${outlook === o
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                        : 'bg-white/5 text-white/40 border border-transparent'
                                        }`}
                                >
                                    <span>{OUTLOOK_EMOJI[o]}</span>
                                    <span>{OUTLOOK_LABEL[o]}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Confidence Slider */}
                    <div>
                        <label className="text-[10px] text-white/40 flex items-center justify-between mb-1">
                            <span>Confidence Level</span>
                            <span className="text-amber-400 font-bold">{confidence}%</span>
                        </label>
                        <input
                            type="range"
                            min={10}
                            max={100}
                            step={5}
                            value={confidence}
                            onChange={e => setConfidence(Number(e.target.value))}
                            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                    </div>

                    {/* Note */}
                    <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Why do you believe this? (optional)"
                        rows={2}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none resize-none focus:border-amber-500/30"
                    />

                    {/* Seal Button */}
                    <button
                        onClick={handleCreate}
                        disabled={!targetValue || parseFloat(targetValue) <= 0}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 text-white text-sm font-bold
                            hover:from-amber-500 hover:to-yellow-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed
                            flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
                    >
                        <Send className="w-4 h-4" /> Seal This Capsule
                    </button>
                </div>
            )}

            {/* CAPSULE GALLERY */}
            {capsules.length === 0 && !showCreateForm && (
                <EmptyState
                    icon={Lock}
                    title="No capsules yet"
                    description="Create one to seal your prediction — we'll open it on the date you set and show you what your bet was worth."
                    actionLabel="Create capsule"
                    onAction={() => setShowCreateForm(true)}
                    variant="minimal"
                />
            )}

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {capsules.map(capsule => {
                    const countdown = getCountdown(capsule.openDate);
                    const isRevealing = revealingCapsule === capsule.id;
                    const isExpanded = expandedCapsule === capsule.id;

                    // Opened capsule — show results
                    if (capsule.isOpened && capsule.actualValueAtOpen) {
                        const verdict = getVerdict(capsule.prediction.targetValue, capsule.actualValueAtOpen);
                        const diff = capsule.actualValueAtOpen - capsule.prediction.targetValue;
                        const growthFromSnapshot = capsule.actualValueAtOpen - capsule.snapshotAtCreation.totalValue;

                        return (
                            <div
                                key={capsule.id}
                                className="bg-gradient-to-br from-emerald-500/5 to-violet-500/5 rounded-xl border border-emerald-500/10 overflow-hidden"
                            >
                                <div
                                    className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                                    onClick={() => setExpandedCapsule(isExpanded ? null : capsule.id)}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-xl">{verdict.emoji}</span>
                                        <div>
                                            <div className={`text-xs font-bold ${verdict.color}`}>{verdict.label}</div>
                                            <div className="text-[9px] text-white/30">
                                                Opened {new Date(capsule.openedAt!).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Unlock className="w-3.5 h-3.5 text-emerald-400/50" />
                                        {isExpanded ? <ChevronUp className="w-3 h-3 text-white/30" /> : <ChevronDown className="w-3 h-3 text-white/30" />}
                                    </div>
                                </div>

                                {isExpanded && !isPrivacyMode && (
                                    <div className="px-4 pb-4 space-y-2 animate-in fade-in duration-200">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="bg-white/5 rounded-lg p-2 text-center">
                                                <div className="text-[9px] text-white/40">Predicted</div>
                                                <div className="text-xs font-bold text-amber-400">{formatCurrency(capsule.prediction.targetValue)}</div>
                                            </div>
                                            <div className="bg-white/5 rounded-lg p-2 text-center">
                                                <div className="text-[9px] text-white/40">Actual</div>
                                                <div className="text-xs font-bold text-white">{formatCurrency(capsule.actualValueAtOpen)}</div>
                                            </div>
                                        </div>
                                        <div className="bg-white/5 rounded-lg p-2 text-center">
                                            <div className="text-[9px] text-white/40">Portfolio grew by</div>
                                            <div className={`text-sm font-bold ${growthFromSnapshot >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {growthFromSnapshot >= 0 ? '+' : ''}{formatCurrency(growthFromSnapshot)}
                                            </div>
                                        </div>
                                        {capsule.prediction.note !== 'No note' && (
                                            <div className="text-[10px] text-white/30 italic">"{capsule.prediction.note}"</div>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); deleteCapsule(capsule.id); }}
                                            className="text-[9px] text-red-400/50 hover:text-red-400 flex items-center gap-1"
                                        >
                                            <Trash2 className="w-2.5 h-2.5" /> Remove
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    }

                    // Sealed capsule
                    return (
                        <div
                            key={capsule.id}
                            className={`rounded-xl border overflow-hidden transition-all ${isRevealing
                                ? 'bg-gradient-to-br from-amber-500/20 to-yellow-500/20 border-amber-500/30 animate-pulse scale-105'
                                : countdown.isReady
                                    ? 'bg-gradient-to-br from-amber-500/10 to-yellow-500/5 border-amber-500/20'
                                    : 'bg-white/5 border-white/5'
                                }`}
                        >
                            <div
                                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                                onClick={() => setExpandedCapsule(isExpanded ? null : capsule.id)}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded-lg ${countdown.isReady
                                        ? 'bg-amber-500/20 animate-pulse'
                                        : 'bg-white/5'
                                        }`}>
                                        {countdown.isReady
                                            ? <Unlock className="w-4 h-4 text-amber-400" />
                                            : <Lock className="w-4 h-4 text-white/30" />
                                        }
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-medium text-white">
                                                {isPrivacyMode ? '•••' : formatCurrency(capsule.prediction.targetValue)}
                                            </span>
                                            <span className="text-sm">{OUTLOOK_EMOJI[capsule.prediction.marketOutlook]}</span>
                                        </div>
                                        <div className="text-[9px] text-white/30">
                                            {isRevealing ? '🔓 Breaking the seal...' : (
                                                countdown.isReady
                                                    ? '✨ Ready to open!'
                                                    : `⏱️ ${countdown.label} remaining`
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="text-right">
                                        <div className="text-[10px] text-white/40">{capsule.prediction.confidence}%</div>
                                        <div className="text-[9px] text-white/20">conf.</div>
                                    </div>
                                    {isExpanded ? <ChevronUp className="w-3 h-3 text-white/30" /> : <ChevronDown className="w-3 h-3 text-white/30" />}
                                </div>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                                <div className="px-4 pb-3 space-y-2 animate-in fade-in duration-200">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="bg-white/5 rounded-lg p-2">
                                            <div className="text-[9px] text-white/40">Sealed on</div>
                                            <div className="text-[10px] text-white/70">{new Date(capsule.createdAt).toLocaleDateString()}</div>
                                        </div>
                                        <div className="bg-white/5 rounded-lg p-2">
                                            <div className="text-[9px] text-white/40">Opens on</div>
                                            <div className="text-[10px] text-white/70">{new Date(capsule.openDate).toLocaleDateString()}</div>
                                        </div>
                                    </div>
                                    {!isPrivacyMode && (
                                        <div className="bg-white/5 rounded-lg p-2">
                                            <div className="text-[9px] text-white/40">Value when sealed</div>
                                            <div className="text-[10px] text-white/70">{formatCurrency(capsule.snapshotAtCreation.totalValue)}</div>
                                        </div>
                                    )}
                                    {capsule.prediction.note !== 'No note' && (
                                        <div className="text-[10px] text-white/30 italic">"{capsule.prediction.note}"</div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        {countdown.isReady && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleOpen(capsule); }}
                                                disabled={isRevealing}
                                                className="flex-1 py-2 rounded-lg bg-gradient-to-r from-amber-600 to-yellow-600 text-white text-xs font-bold
                                                    hover:from-amber-500 hover:to-yellow-500 transition-all disabled:opacity-50
                                                    flex items-center justify-center gap-1 shadow-lg shadow-amber-500/20"
                                            >
                                                <Eye className="w-3.5 h-3.5" /> {isRevealing ? 'Revealing...' : 'Open Capsule'}
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); deleteCapsule(capsule.id); }}
                                            className="p-2 rounded-lg bg-white/5 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Fun footer */}
            {capsules.length > 0 && (
                <div className="flex items-center justify-center gap-1 pt-1">
                    <Target className="w-3 h-3 text-white/15" />
                    <span className="text-[9px] text-white/15">
                        {stats.opened > 0
                            ? `${stats.avgAccuracy ?? 0}% prediction accuracy`
                            : 'Lock predictions, open them later'
                        }
                    </span>
                </div>
            )}
        </div>
    );
};

export default React.memo(WealthTimeCapsule);
