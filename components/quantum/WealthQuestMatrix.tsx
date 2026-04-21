import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Crown, Sparkles, Target, Award, Zap, ChevronRight, Trophy,
    Sigma, Shield, BookOpen, Cpu, Activity, Flame, Star, Lock,
} from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import { wealthQuestEngine, recordUnlock } from '../../services/WealthQuestEngine';
import { usePortfolioStore } from '../../store/portfolioStore';
import { liveQuery } from 'dexie';
import { db } from '../../database';
import type { QuestBranch, QuestBranchId, QuestMatrix, QuestNode } from '../../types/quantum';

/**
 * WealthQuestMatrix — CC37
 * =====================================================================
 * A premium, gamified RPG-style skill tree for traders. Three branches
 * (Quant / Sentinel / Scribe) radiate from a central node, with
 * progressively unlocked cells that map onto real journal & portfolio
 * metrics.
 *
 *  • Interactive SVG node map with connection lines that "draw" as
 *    nodes unlock
 *  • Framer-Motion powered bounce on hover
 *  • Particle burst on unlock (lightweight canvas emitter)
 *  • Slide-out detail modal with progress bars and XP rewards
 *
 * "Anyone can win" layer: the central XP ring shows the user's tier
 * (Novice → Grandmaster) and the projected 21-day P&L (mirrored from
 * the ProfitabilityScore).
 */
export const WealthQuestMatrix: React.FC = () => {
    const [matrix, setMatrix] = useState<QuestMatrix | null>(null);
    const [selectedNode, setSelectedNode] = useState<QuestNode | null>(null);
    const [loading, setLoading] = useState(true);
    const [particles, setParticles] = useState<{ x: number; y: number; id: number }[]>([]);
    const focusedBranch = useQuantumStore(useShallow(s => s.focusedBranch));
    const setFocusedBranch = useQuantumStore(useShallow(s => s.setFocusedBranch));
    const setQuestMatrix = useQuantumStore(useShallow(s => s.setQuestMatrix));
    const investments = usePortfolioStore(useShallow(s => s.investments));

    // Recompute the matrix whenever the user navigates to this view.
    useEffect(() => {
        let cancelled = false;
        const compute = async () => {
            try {
                const trades = await db.trades.toArray();
                const mistakes = await db.mistakes.toArray();
                const goals = await db.goals.toArray();
                const ipos = await db.ipo_applications.toArray();
                if (cancelled) return;
                const m = await wealthQuestEngine.evaluate({
                    trades,
                    investments,
                    mistakes,
                    goals,
                    ipos,
                });
                setMatrix(m);
                setQuestMatrix(m);
                setLoading(false);
            } catch (err) {
                console.error('[WealthQuestMatrix] eval failed', err);
                setLoading(false);
            }
        };
        compute();
        return () => { cancelled = true; };
    }, [investments, setQuestMatrix]);

    const handleUnlock = (n: QuestNode) => {
        if (n.state !== 'AVAILABLE' && n.state !== 'IN_PROGRESS') return;
        // Emit a few particles at the node's position (approx)
        const branchOffset = n.branch === 'QUANT' ? 0 : n.branch === 'SENTINEL' ? 1 : 2;
        const cx = 50 + branchOffset * 0; // simplified
        const cy = 50 - n.level * 10;
        const newParticles = Array.from({ length: 14 }).map((_, i) => ({
            id: Date.now() + i,
            x: cx + (Math.random() - 0.5) * 6,
            y: cy + (Math.random() - 0.5) * 4,
        }));
        setParticles(p => [...p, ...newParticles]);
        setTimeout(() => setParticles(p => p.filter(pt => !newParticles.find(np => np.id === pt.id))), 1200);
        recordUnlock(n.id);
    };

    if (loading || !matrix) {
        return (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/50 p-12 text-center text-slate-400">
                <Sparkles className="animate-pulse mx-auto mb-3 text-cyan-400" size={32} />
                <div className="text-sm font-bold">Computing quest matrix from your journal…</div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Top bar — level, tier, total XP, level progress */}
            <div className="rounded-2xl border border-slate-800/80 bg-gradient-to-r from-cyan-500/5 via-violet-500/5 to-fuchsia-500/5 p-4 flex items-center gap-4">
                <TierBadge level={matrix.level} levelName={matrix.levelName} totalXp={matrix.totalXp} />
                <div className="flex-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">
                        <span>Path to {nextTierName(matrix.level)}</span>
                        <span>{matrix.totalXp.toLocaleString('en-IN')} / {matrix.nextLevelXp.toLocaleString('en-IN')} XP</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${matrix.levelProgress * 100}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                    </div>
                </div>
            </div>

            {/* Branch focus tabs */}
            <div className="flex items-center gap-2">
                {(['QUANT', 'SENTINEL', 'SCRIBE'] as QuestBranchId[]).map((b) => (
                    <button
                        key={b}
                        onClick={() => setFocusedBranch(b)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
                            focusedBranch === b
                                ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-300'
                                : 'bg-slate-900/40 border border-slate-800 text-slate-400 hover:border-slate-600'
                        }`}
                    >
                        {matrix.branches.find(x => x.id === b)?.name}
                    </button>
                ))}
            </div>

            {/* The matrix — SVG node map per branch */}
            <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-4">
                {matrix.branches.filter(b => b.id === focusedBranch).map((branch) => (
                    <BranchMap
                        key={branch.id}
                        branch={branch}
                        onSelectNode={(n) => { setSelectedNode(n); handleUnlock(n); }}
                    />
                ))}
            </div>

            {/* Particles overlay (canvas-style via absolute divs) */}
            <AnimatePresence>
                {particles.map(p => (
                    <motion.div
                        key={p.id}
                        initial={{ x: `${p.x}vw`, y: `${p.y}vh`, opacity: 1, scale: 1 }}
                        animate={{ y: `${p.y - 6}vh`, opacity: 0, scale: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.1, ease: 'easeOut' }}
                        className="pointer-events-none fixed z-[200] w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_20px_rgba(217,70,239,0.8)]"
                    />
                ))}
            </AnimatePresence>

            {/* Detail modal */}
            <AnimatePresence>
                {selectedNode && (
                    <NodeDetailModal
                        node={selectedNode}
                        onClose={() => setSelectedNode(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

const TierBadge: React.FC<{ level: number; levelName: string; totalXp: number }> = ({ level, levelName, totalXp }) => (
    <div className="flex items-center gap-3">
        <div className="relative h-14 w-14">
            <svg className="absolute inset-0" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" stroke="rgba(34,211,238,0.15)" strokeWidth="4" fill="none" />
                <motion.circle
                    cx="28" cy="28" r="24"
                    stroke="url(#tierGrad)" strokeWidth="4" fill="none"
                    strokeLinecap="round"
                    strokeDasharray="150.8"
                    initial={{ strokeDashoffset: 150.8 }}
                    animate={{ strokeDashoffset: 150.8 - (150.8 * (level / 6)) }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                />
                <defs>
                    <linearGradient id="tierGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#22d3ee" />
                        <stop offset="50%" stopColor="#a78bfa" />
                        <stop offset="100%" stopColor="#f0abfc" />
                    </linearGradient>
                </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-black text-cyan-300">{level}</div>
        </div>
        <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Tier</div>
            <div className="text-sm font-black text-cyan-300 tracking-wider">{levelName}</div>
            <div className="text-[10px] text-slate-500">{totalXp.toLocaleString('en-IN')} XP</div>
        </div>
    </div>
);

const BranchMap: React.FC<{ branch: QuestBranch; onSelectNode: (n: QuestNode) => void }> = ({ branch, onSelectNode }) => {
    return (
        <div className="relative h-[420px]">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 420" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id={`bg-${branch.id}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={branch.color} stopOpacity="0.7" />
                        <stop offset="100%" stopColor={branch.color} stopOpacity="0.1" />
                    </linearGradient>
                </defs>
                {/* Connection lines — drawn between consecutive nodes */}
                {branch.nodes.map((n, i) => {
                    if (i === 0) return null;
                    const prev = branch.nodes[i - 1]!;
                    const x1 = nodeX(branch.nodes, prev, 600);
                    const y1 = nodeY(prev, 420);
                    const x2 = nodeX(branch.nodes, n, 600);
                    const y2 = nodeY(n, 420);
                    const isUnlocked = prev.state === 'COMPLETED' || prev.state === 'IN_PROGRESS';
                    return (
                        <line
                            key={`l-${n.id}`}
                            x1={x1} y1={y1} x2={x2} y2={y2}
                            stroke={isUnlocked ? branch.color : 'rgba(100,116,139,0.3)'}
                            strokeWidth={isUnlocked ? 2.5 : 1.2}
                            strokeDasharray={isUnlocked ? '0' : '4 4'}
                            strokeLinecap="round"
                        />
                    );
                })}
                {/* Root node */}
                <circle cx={300} cy={390} r="22" fill={`url(#bg-${branch.id})`} stroke={branch.color} strokeWidth="2" />
                <text x={300} y={396} textAnchor="middle" fontSize="10" fontWeight="900" fill="#cbd5e1">YOU</text>
                {/* Quest nodes */}
                {branch.nodes.map((n) => {
                    const cx = nodeX(branch.nodes, n, 600);
                    const cy = nodeY(n, 420);
                    const isLocked = n.state === 'LOCKED';
                    const isAvailable = n.state === 'AVAILABLE';
                    const isDone = n.state === 'COMPLETED';
                    const isInProgress = n.state === 'IN_PROGRESS';
                    return (
                        <g
                            key={n.id}
                            onClick={() => onSelectNode(n)}
                            className="cursor-pointer"
                        >
                            <motion.circle
                                cx={cx} cy={cy} r="26"
                                fill={isDone ? branch.color : isInProgress ? `${branch.color}55` : isAvailable ? `${branch.color}22` : 'rgba(15,23,42,0.8)'}
                                stroke={isLocked ? 'rgba(100,116,139,0.4)' : branch.color}
                                strokeWidth="2"
                                whileHover={{ scale: 1.1 }}
                                style={{ transformOrigin: `${cx}px ${cy}px` }}
                            />
                            {isLocked && (
                                <g transform={`translate(${cx - 7}, ${cy - 7})`}>
                                    <rect width="14" height="14" fill="none" />
                                    <Lock size={14} x="0" y="0" color="#64748b" />
                                </g>
                            )}
                            {!isLocked && (
                                <text
                                    x={cx} y={cy + 4}
                                    textAnchor="middle"
                                    fontSize="14"
                                    fontWeight="900"
                                    fill={isDone ? '#0f172a' : '#e2e8f0'}
                                >
                                    {n.icon}
                                </text>
                            )}
                            <text x={cx} y={cy + 42} textAnchor="middle" fontSize="9" fontWeight="700" fill={isLocked ? '#64748b' : '#cbd5e1'}>
                                {n.title}
                            </text>
                            <text x={cx} y={cy + 54} textAnchor="middle" fontSize="8" fill={isLocked ? '#475569' : branch.color}>
                                +{n.xpReward} XP
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

function nodeX(nodes: QuestNode[], n: QuestNode, totalW: number): number {
    const idx = nodes.findIndex(x => x.id === n.id);
    const margin = 80;
    const step = (totalW - margin * 2) / Math.max(1, nodes.length - 1);
    return margin + idx * step;
}
function nodeY(n: QuestNode, totalH: number): number {
    const margin = 60;
    const usable = totalH - margin * 2;
    const y = margin + (n.level - 1) * (usable / 7);
    return Math.max(margin + 20, totalH - y); // flip so level 1 is at the bottom
}

function nextTierName(level: number): string {
    const names = ['NOVICE', 'APPRENTICE', 'OPERATOR', 'STRATEGIST', 'MASTER', 'GRANDMASTER'];
    return names[Math.min(level, names.length - 1)] ?? 'GRANDMASTER';
}

const NodeDetailModal: React.FC<{ node: QuestNode; onClose: () => void }> = ({ node, onClose }) => (
    <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4"
        onClick={onClose}
    >
        <motion.div
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 16 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-cyan-500/30 bg-slate-900/95 p-6 shadow-2xl shadow-cyan-500/20"
            style={{ borderColor: `${node.accentColor}55` }}
        >
            <div className="flex items-center gap-3 mb-3">
                <div
                    className="h-12 w-12 rounded-2xl flex items-center justify-center text-xl font-black"
                    style={{ background: `${node.accentColor}33`, color: node.accentColor }}
                >
                    {node.icon}
                </div>
                <div>
                    <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Lvl {node.level} · {node.branch}</div>
                    <h3 className="text-base font-black text-slate-100">{node.title}</h3>
                </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">{node.description}</p>
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 mb-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Quest</div>
                <div className="text-xs text-slate-300">{node.questHint}</div>
                <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full" style={{ width: `${node.progress * 100}%`, background: node.accentColor }} />
                </div>
                <div className="mt-1 text-[9px] text-slate-500">Progress: {(node.progress * 100).toFixed(0)}%</div>
            </div>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-amber-300 font-mono font-bold">
                    <Sparkles size={12} /> +{node.xpReward} XP
                </div>
                <button
                    onClick={onClose}
                    className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold uppercase tracking-widest"
                >
                    Close
                </button>
            </div>
        </motion.div>
    </motion.div>
);

export default WealthQuestMatrix;
