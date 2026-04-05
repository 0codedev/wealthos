import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowLeft, Trophy, Users, Target, Star, Crown, Medal, Flame, Zap,
    TrendingUp, Gift, ChevronRight, Award, Sparkles, Shield, Swords
} from 'lucide-react';
import { InvestmentClubsWidget, ChallengesWidget, SharePortfolioButton, AchievementsWidget } from '../../shared/GodTierFeatures';
import { Investment, AggregatedData } from '../../../types';

interface CommunityHubProps {
    onBack: () => void;
    investments: Investment[];
    stats: any;
    assetClassData: AggregatedData[];
}

// Tiered Achievement System
const ACHIEVEMENT_TIERS = [
    {
        level: 1,
        name: 'Beginner',
        icon: <Star size={16} />,
        color: 'gray',
        minXP: 0,
        badge: '🌱',
        perks: ['Basic portfolio insights', 'Weekly tips']
    },
    {
        level: 2,
        name: 'Investor',
        icon: <Medal size={16} />,
        color: 'emerald',
        minXP: 500,
        badge: '🥉',
        perks: ['Monthly reports', 'Community access']
    },
    {
        level: 3,
        name: 'Pro Trader',
        icon: <Trophy size={16} />,
        color: 'blue',
        minXP: 1500,
        badge: '🥈',
        perks: ['Advanced analytics', 'Priority support']
    },
    {
        level: 4,
        name: 'Elite',
        icon: <Crown size={16} />,
        color: 'purple',
        minXP: 5000,
        badge: '🥇',
        perks: ['Exclusive insights', 'Beta features']
    },
    {
        level: 5,
        name: 'Legend',
        icon: <Sparkles size={16} />,
        color: 'amber',
        minXP: 15000,
        badge: '👑',
        perks: ['All perks', 'Hall of Fame', 'Custom badge']
    },
];

// Social challenges
const ACTIVE_CHALLENGES = [
    { id: 1, name: 'SIP Streak Master', desc: 'Complete 12 months of SIP', reward: 500, progress: 8, total: 12, participants: 1247 },
    { id: 2, name: 'Diversification Pro', desc: 'Invest in 5+ asset classes', reward: 300, progress: 4, total: 5, participants: 892 },
    { id: 3, name: 'Goal Crusher', desc: 'Achieve 3 financial goals', reward: 750, progress: 1, total: 3, participants: 634 },
    { id: 4, name: 'Community Champion', desc: 'Help 10 members', reward: 200, progress: 10, total: 10, completed: true, participants: 445 },
];

// Leaderboard data
const LEADERBOARD = [
    { rank: 1, name: 'Rahul M.', xp: 18450, badge: '👑', streak: 156 },
    { rank: 2, name: 'Priya S.', xp: 16200, badge: '🥇', streak: 142 },
    { rank: 3, name: 'Amit K.', xp: 15800, badge: '🥇', streak: 98 },
    { rank: 4, name: 'You', xp: 2340, badge: '🥉', streak: 45, isYou: true },
    { rank: 5, name: 'Neha R.', xp: 2100, badge: '🥉', streak: 38 },
];

export const CommunityHub: React.FC<CommunityHubProps> = ({ onBack, investments, stats, assetClassData }) => {
    const [activeTab, setActiveTab] = useState<'achievements' | 'clubs' | 'challenges' | 'leaderboard'>('achievements');

    // Calculate user XP and tier
    const userProgress = useMemo(() => {
        const xp = 2340; // Simulated XP
        const currentTier = ACHIEVEMENT_TIERS.reduce((acc, tier) => xp >= tier.minXP ? tier : acc, ACHIEVEMENT_TIERS[0]);
        const nextTier = ACHIEVEMENT_TIERS.find(t => t.minXP > xp);
        const xpToNext = nextTier ? nextTier.minXP - xp : 0;
        const progress = nextTier ? ((xp - currentTier.minXP) / (nextTier.minXP - currentTier.minXP)) * 100 : 100;

        return { xp, currentTier, nextTier, xpToNext, progress };
    }, []);

    const tabs = [
        { id: 'achievements', label: 'Achievements', icon: <Trophy size={14} /> },
        { id: 'clubs', label: 'Clubs', icon: <Users size={14} /> },
        { id: 'challenges', label: 'Challenges', icon: <Target size={14} /> },
        { id: 'leaderboard', label: 'Leaderboard', icon: <Crown size={14} /> },
    ] as const;

    return (
        <div className="space-y-6 animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                    >
                        <ArrowLeft size={24} className="text-slate-600 dark:text-slate-300" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            🏆 Community & Rewards
                            <span className="text-[10px] bg-purple-500/20 text-purple-500 px-2 py-0.5 rounded-full font-bold">2.0</span>
                        </h1>
                        <p className="text-sm text-slate-500">Compete, earn achievements, and climb the ranks</p>
                    </div>
                </div>
                <SharePortfolioButton />
            </div>

            {/* User Tier Card */}
            <div className="bg-gradient-to-br from-slate-900 via-purple-950/30 to-slate-900 rounded-3xl border border-purple-500/20 p-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className={`w-16 h-16 rounded-2xl bg-${userProgress.currentTier.color}-500/20 flex items-center justify-center text-4xl`}>
                            {userProgress.currentTier.badge}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className={`text-${userProgress.currentTier.color}-400`}>{userProgress.currentTier.icon}</span>
                                <h3 className="text-xl font-black text-white">{userProgress.currentTier.name}</h3>
                                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">Level {userProgress.currentTier.level}</span>
                            </div>
                            <p className="text-sm text-purple-300/60 mt-1">{userProgress.xp.toLocaleString()} XP earned</p>
                        </div>
                    </div>
                    <div className="text-right">
                        {userProgress.nextTier && (
                            <>
                                <p className="text-xs text-slate-500">Next: {userProgress.nextTier.name}</p>
                                <p className="text-sm font-bold text-purple-400">{userProgress.xpToNext.toLocaleString()} XP to go</p>
                            </>
                        )}
                    </div>
                </div>

                {/* Progress Bar */}
                {userProgress.nextTier && (
                    <div className="mt-4">
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${userProgress.progress}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === tab.id
                                ? 'bg-white dark:bg-slate-900 text-purple-600 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
                {activeTab === 'achievements' && (
                    <motion.div
                        key="achievements"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
                    >
                        <AchievementsWidget investments={investments} stats={stats} assetClassData={assetClassData} />

                        {/* Tier Progression */}
                        <div className="bg-gradient-to-br from-slate-900 via-indigo-950/20 to-slate-900 rounded-3xl border border-indigo-500/20 p-6">
                            <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                                <Award size={16} className="text-indigo-400" />
                                Tier Progression
                            </h4>
                            <div className="space-y-3">
                                {ACHIEVEMENT_TIERS.map((tier, idx) => {
                                    const isUnlocked = userProgress.xp >= tier.minXP;
                                    const isCurrent = tier.level === userProgress.currentTier.level;

                                    return (
                                        <div
                                            key={tier.level}
                                            className={`p-3 rounded-xl border transition-all ${isCurrent
                                                    ? 'bg-purple-500/20 border-purple-500/30'
                                                    : isUnlocked
                                                        ? 'bg-slate-800/30 border-slate-700/50'
                                                        : 'bg-slate-900/50 border-slate-800/50 opacity-50'
                                                }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-2xl">{tier.badge}</span>
                                                    <div>
                                                        <p className={`text-sm font-bold ${isUnlocked ? 'text-white' : 'text-slate-500'}`}>{tier.name}</p>
                                                        <p className="text-[10px] text-slate-500">{tier.minXP.toLocaleString()} XP</p>
                                                    </div>
                                                </div>
                                                {isCurrent && <span className="text-[9px] bg-purple-500 text-white px-2 py-0.5 rounded font-bold">CURRENT</span>}
                                                {!isUnlocked && <Shield size={14} className="text-slate-600" />}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </motion.div>
                )}

                {activeTab === 'clubs' && (
                    <motion.div
                        key="clubs"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                    >
                        <InvestmentClubsWidget />
                    </motion.div>
                )}

                {activeTab === 'challenges' && (
                    <motion.div
                        key="challenges"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="grid grid-cols-1 lg:grid-cols-2 gap-6"
                    >
                        <div className="bg-gradient-to-br from-slate-900 via-amber-950/20 to-slate-900 rounded-3xl border border-amber-500/20 p-6">
                            <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                                <Swords size={16} className="text-amber-400" />
                                Active Challenges
                            </h4>
                            <div className="space-y-3">
                                {ACTIVE_CHALLENGES.map(challenge => (
                                    <div
                                        key={challenge.id}
                                        className={`p-4 rounded-xl border ${challenge.completed
                                                ? 'bg-emerald-500/10 border-emerald-500/30'
                                                : 'bg-slate-800/30 border-slate-700/50'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-bold text-white">{challenge.name}</span>
                                            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                                                +{challenge.reward} XP
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-400 mb-2">{challenge.desc}</p>
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full ${challenge.completed ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                                    style={{ width: `${(challenge.progress / challenge.total) * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-[10px] text-slate-500">{challenge.progress}/{challenge.total}</span>
                                        </div>
                                        <p className="text-[9px] text-slate-600 mt-2">{challenge.participants.toLocaleString()} participants</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <ChallengesWidget />
                    </motion.div>
                )}

                {activeTab === 'leaderboard' && (
                    <motion.div
                        key="leaderboard"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                    >
                        <div className="bg-gradient-to-br from-slate-900 via-amber-950/20 to-slate-900 rounded-3xl border border-amber-500/20 p-6">
                            <h4 className="text-white font-bold mb-4 flex items-center gap-2">
                                <Crown size={16} className="text-amber-400" />
                                Global Leaderboard
                            </h4>
                            <div className="space-y-2">
                                {LEADERBOARD.map((user, idx) => (
                                    <motion.div
                                        key={user.rank}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: idx * 0.1 }}
                                        className={`flex items-center justify-between p-4 rounded-xl border ${user.isYou
                                                ? 'bg-purple-500/20 border-purple-500/30'
                                                : user.rank <= 3
                                                    ? 'bg-amber-500/10 border-amber-500/20'
                                                    : 'bg-slate-800/30 border-slate-700/50'
                                            }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <span className={`text-lg font-black w-8 ${user.rank === 1 ? 'text-amber-400' :
                                                    user.rank === 2 ? 'text-slate-300' :
                                                        user.rank === 3 ? 'text-amber-600' : 'text-slate-500'
                                                }`}>
                                                #{user.rank}
                                            </span>
                                            <span className="text-2xl">{user.badge}</span>
                                            <div>
                                                <p className={`font-bold ${user.isYou ? 'text-purple-400' : 'text-white'}`}>
                                                    {user.name}
                                                </p>
                                                <p className="text-xs text-slate-500">🔥 {user.streak} day streak</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-lg font-black text-amber-400 font-mono">{user.xp.toLocaleString()}</p>
                                            <p className="text-[10px] text-slate-500">XP</p>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

