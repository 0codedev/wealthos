
import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Award, Share2, Lock, Copy, Check, Sparkles, Trophy, Crown } from 'lucide-react';
import { Achievement } from '../../../services/MasteryEngine';
import { useMasteryStore } from '../../../store/masteryStore';
import { useShallow } from 'zustand/react/shallow';
import { triggerAchievement } from '../../mastery/XPCelebration';

const RARITY_STYLES: Record<string, { gradient: string; ring: string; chip: string; label: string }> = {
    COMMON:    { gradient: 'from-slate-700/60 to-slate-900/60',  ring: 'ring-slate-700/50',  chip: 'bg-slate-700/30 text-slate-300',  label: 'Common' },
    UNCOMMON:  { gradient: 'from-emerald-700/60 to-emerald-900/60', ring: 'ring-emerald-600/50', chip: 'bg-emerald-500/20 text-emerald-300', label: 'Uncommon' },
    RARE:      { gradient: 'from-sky-700/60 to-sky-900/60', ring: 'ring-sky-500/50', chip: 'bg-sky-500/20 text-sky-300', label: 'Rare' },
    EPIC:      { gradient: 'from-indigo-700/60 to-indigo-900/60', ring: 'ring-indigo-500/50', chip: 'bg-indigo-500/20 text-indigo-300', label: 'Epic' },
    LEGENDARY: { gradient: 'from-amber-500/70 to-amber-700/70', ring: 'ring-amber-400/60', chip: 'bg-amber-500/30 text-amber-200', label: 'Legendary' }
};

const CATEGORY_LABEL: Record<string, string> = {
    TRADING: 'Trading',
    PORTFOLIO: 'Portfolio',
    ALPHA: 'Alpha',
    RISK: 'Risk',
    KNOWLEDGE: 'Knowledge',
    ORACLE: 'Oracle',
    SOCIAL: 'Social',
    DISCIPLINE: 'Discipline'
};

interface AchievementCardProps {
    achievement: Achievement;
    onClaim: (id: string) => void;
}

const AchievementCard: React.FC<AchievementCardProps> = ({ achievement, onClaim }) => {
    const [flipped, setFlipped] = useState(false);
    const [copied, setCopied] = useState(false);

    const rarity = RARITY_STYLES[achievement.rarity] || RARITY_STYLES.COMMON;
    const isUnlocked = achievement.isUnlocked;
    const isClaimed = !!achievement.claimedAt;

    const shareText = useMemo(() => {
        return `🏆 ${achievement.title}\n${achievement.description}\nRarity: ${rarity.label}  •  +${achievement.xpReward} XP  •  #WealthMastery`;
    }, [achievement, rarity.label]);

    const handleShare = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(shareText);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Fallback for non-secure contexts: create a textarea
            const ta = document.createElement('textarea');
            ta.value = shareText;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch { /* noop */ }
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }
    };

    const handleClaim = (e: React.MouseEvent) => {
        e.stopPropagation();
        onClaim(achievement.id);
    };

    return (
        <div
            className={`relative aspect-[3/4] [perspective:1200px] cursor-pointer group`}
            onClick={() => setFlipped(f => !f)}
        >
            <motion.div
                className="relative w-full h-full [transform-style:preserve-3d]"
                animate={{ rotateY: flipped ? 180 : 0 }}
                transition={{ duration: 0.6, type: 'spring', stiffness: 220, damping: 22 }}
            >
                {/* ── Front face ─────────────────────────────────────── */}
                <div className={`absolute inset-0 [backface-visibility:hidden] rounded-3xl p-4 border ${isUnlocked ? 'border-white/10 ring-1' : 'border-slate-800'} ${rarity.ring} bg-gradient-to-br ${rarity.gradient} backdrop-blur-xl flex flex-col items-center justify-center text-center`}>
                    {/* Decorative grain */}
                    <div className="absolute inset-0 rounded-3xl opacity-25 mix-blend-overlay pointer-events-none" style={{ background: 'radial-gradient(ellipse at top, rgba(255,255,255,0.4), transparent 60%)' }} />

                    {isUnlocked ? (
                        <div className="relative">
                            <div className="text-5xl mb-3 select-none">{achievement.emoji || '🏆'}</div>
                            <div className="absolute -inset-2 rounded-full bg-amber-400/20 blur-xl pointer-events-none" />
                        </div>
                    ) : (
                        <div className="relative">
                            <div className="text-5xl mb-3 grayscale opacity-30 select-none">{achievement.emoji || '🏆'}</div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Lock className="w-7 h-7 text-slate-500" />
                            </div>
                        </div>
                    )}

                    <h3 className={`text-sm font-black uppercase tracking-tighter italic ${isUnlocked ? 'text-white' : 'text-slate-500'}`}>
                        {achievement.title}
                    </h3>
                    <span className={`mt-1 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${rarity.chip}`}>
                        {rarity.label}
                    </span>
                    <span className="mt-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                        {CATEGORY_LABEL[achievement.category] || achievement.category}
                    </span>

                    {!isUnlocked && (
                        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-slate-900/80 border border-slate-700 text-[8px] font-black text-slate-500 uppercase tracking-widest">
                            Locked
                        </span>
                    )}
                    {isUnlocked && (
                        <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-[8px] font-black text-emerald-300 uppercase tracking-widest">
                            Unlocked
                        </span>
                    )}
                </div>

                {/* ── Back face ──────────────────────────────────────── */}
                <div className={`absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-3xl p-4 border ${rarity.ring} bg-slate-900/95 backdrop-blur-xl flex flex-col text-center`}>
                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">
                        {isUnlocked ? 'Unlocked' : 'Locked'} • {CATEGORY_LABEL[achievement.category] || achievement.category}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
                        {achievement.description}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-[9px] font-black uppercase tracking-widest mb-3">
                        <div className="p-2 rounded-xl bg-slate-950/50 border border-slate-800">
                            <div className="text-slate-500">XP</div>
                            <div className="text-amber-300 text-base">+{achievement.xpReward}</div>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-950/50 border border-slate-800">
                            <div className="text-slate-500">Rarity</div>
                            <div className={`text-sm ${rarity.chip.split(' ')[1] || 'text-slate-200'}`}>{rarity.label}</div>
                        </div>
                    </div>
                    {isUnlocked && achievement.unlockedAt && (
                        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-3">
                            Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}
                        </div>
                    )}
                    <div className="mt-auto flex gap-2">
                        <button
                            onClick={handleShare}
                            className="flex-1 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-[10px] font-black text-indigo-300 uppercase tracking-widest flex items-center justify-center gap-1.5 hover:bg-indigo-500/30"
                        >
                            {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                            {copied ? 'Copied' : 'Share'}
                        </button>
                        {isUnlocked && !isClaimed && (
                            <button
                                onClick={handleClaim}
                                className="flex-1 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-[10px] font-black text-emerald-300 uppercase tracking-widest flex items-center justify-center gap-1.5 hover:bg-emerald-500/30"
                            >
                                <Trophy className="w-3.5 h-3.5" /> Claim
                            </button>
                        )}
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

interface AchievementCabinetProps {
    achievements?: Achievement[];
}

export const AchievementCabinet: React.FC<AchievementCabinetProps> = ({ achievements }) => {
    const storeAchievements = useMasteryStore(useShallow(s => s.achievements));
    const claimAchievement = useMasteryStore(useShallow(s => s.claimAchievement));
    const data = achievements || storeAchievements;

    const [filter, setFilter] = useState<'ALL' | 'UNLOCKED' | 'LOCKED' | 'TRADING' | 'DISCIPLINE' | 'RISK' | 'PORTFOLIO' | 'ALPHA' | 'ORACLE'>('ALL');

    const filtered = useMemo(() => {
        if (filter === 'ALL') return data;
        if (filter === 'UNLOCKED') return data.filter(a => a.isUnlocked);
        if (filter === 'LOCKED') return data.filter(a => !a.isUnlocked);
        return data.filter(a => a.category === filter);
    }, [data, filter]);

    const counts = useMemo(() => ({
        total: data.length,
        unlocked: data.filter(a => a.isUnlocked).length,
        legendary: data.filter(a => a.isUnlocked && a.rarity === 'LEGENDARY').length
    }), [data]);

    // Fire side-effect event the first time a NEW achievement is unlocked while
    // this component is mounted. Keeps the existing XPCelebration event intact.
    useEffect(() => {
        const newlyUnlocked = data.find(a => a.isUnlocked && !a.claimedAt && !a.unlockedAt);
        if (newlyUnlocked) {
            try { triggerAchievement(newlyUnlocked.title); } catch { /* noop */ }
        }
    }, [data]);

    return (
        <div className="bg-slate-950 rounded-3xl border border-slate-800 p-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
                        <Crown className="w-5 h-5 text-amber-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-black uppercase italic tracking-tighter">Achievement Cabinet</h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                            {counts.unlocked}/{counts.total} Unlocked  •  {counts.legendary} Legendary
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {(['ALL', 'UNLOCKED', 'LOCKED', 'TRADING', 'DISCIPLINE', 'RISK', 'PORTFOLIO', 'ALPHA', 'ORACLE'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={`px-2.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${
                                filter === f
                                ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)]'
                                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'
                            }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Empty state */}
            <AnimatePresence>
                {filtered.length === 0 && (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="p-12 border-2 border-dashed border-slate-800 rounded-3xl text-center bg-slate-900/20"
                    >
                        <Sparkles className="w-10 h-10 text-slate-600 mx-auto mb-4" />
                        <h4 className="text-lg font-black uppercase tracking-tighter text-slate-400 mb-2">No Accolades Here</h4>
                        <p className="text-xs text-slate-600 max-w-xs mx-auto">
                            Log more trades, set stop losses, and diversify your portfolio to unlock achievements.
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Masonry grid */}
            <div
                className="grid gap-4"
                style={{
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gridAutoFlow: 'dense'
                }}
            >
                {filtered.map((ach, i) => (
                    <motion.div
                        key={ach.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04, type: 'spring', stiffness: 240, damping: 22 }}
                        style={i % 7 === 3 ? { gridRow: 'span 2' } : undefined}
                    >
                        <AchievementCard
                            achievement={ach}
                            onClaim={claimAchievement}
                        />
                    </motion.div>
                ))}
            </div>
        </div>
    );
};

export default AchievementCabinet;
