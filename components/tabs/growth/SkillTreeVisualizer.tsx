
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Lock, Crown, Zap, Shield, BookOpen, TrendingUp, Sigma,
    Map, Calculator, Castle, Coins, CandlestickChart, Activity,
    BarChart3, Radio, Waves, Network, Cpu, Sliders, Radar, Umbrella,
    X, Sparkles, Check, Plus, Award
} from 'lucide-react';
import {
    masteryEngine,
    SkillBranch,
    SkillNode,
    MasteryContext
} from '../../../services/MasteryEngine';
import { useMasteryStore } from '../../../store/masteryStore';
import { triggerXP } from '../../mastery/XPCelebration';

const ICON_MAP: Record<string, any> = {
    BookOpen, Calculator, Map, Castle, Coins, Crown,
    CandlestickChart, TrendingUp, Activity, BarChart3, Radio,
    Sigma, Waves, Network, Cpu,
    Shield, Sliders, Radar, Umbrella, Lock, Zap, Award
};

type NodeStatus = 'LOCKED' | 'AVAILABLE' | 'MASTERED';

interface PositionedNode {
    node: SkillNode;
    x: number;
    y: number;
}

interface BranchLayout {
    branch: SkillBranch;
    nodes: PositionedNode[];
    pathD: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
}

const CX = 500;          // center x
const CY = 360;          // center y
const CENTRAL_R = 78;    // central node radius
const NODE_R = 36;       // branch node radius
const BRANCH_SPREAD = 260; // distance from center to last node
const NODE_GAP = 90;     // gap between nodes on the same branch
const CANVAS_W = 1000;
const CANVAS_H = 720;

const branchAngles: Record<string, number> = {
    FUNDAMENTAL: -Math.PI / 2,                 // top
    TECHNICAL:   0,                            // right
    QUANT:       Math.PI / 2,                  // bottom
    RISK:        Math.PI                       // left
};

/**
 * Build a smooth quadratic-bezier path from one node to the next, tangent
 * to the radial axis at the start.
 */
const buildRadialPath = (x1: number, y1: number, x2: number, y2: number): string => {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    // Use control point perpendicular to the radial axis for a smooth curve
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const curveStrength = Math.min(60, len * 0.2);
    const cx = midX + nx * curveStrength * (Math.abs(nx) > Math.abs(ny) ? 1 : -1);
    const cy = midY + ny * curveStrength * (Math.abs(nx) > Math.abs(ny) ? 1 : -1);
    return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
};

const buildEdgePath = (x1: number, y1: number, x2: number, y2: number, status: NodeStatus, animKey: string): string => {
    const path = buildRadialPath(x1, y1, x2, y2);
    return path;
};

const computeBranchLayout = (branch: SkillBranch): BranchLayout => {
    const angle = branchAngles[branch.id] ?? 0;
    const nodeCount = branch.nodes.length;
    const step = BRANCH_SPREAD / nodeCount;

    const nodes: PositionedNode[] = branch.nodes.map((node, idx) => {
        const dist = CENTRAL_R + 80 + idx * NODE_GAP;
        const x = CX + Math.cos(angle) * dist;
        const y = CY + Math.sin(angle) * dist;
        return { node, x, y };
    });

    // Edge path: from "Wealth Master" center → node 0 → node 1 ...
    const segments: string[] = [];
    let prevX = CX;
    let prevY = CY;
    for (const pn of nodes) {
        segments.push(buildRadialPath(prevX, prevY, pn.x, pn.y));
        prevX = pn.x;
        prevY = pn.y;
    }
    const pathD = segments.join(' ');

    return {
        branch,
        nodes,
        pathD,
        startX: CX,
        startY: CY,
        endX: nodes[nodes.length - 1]?.x ?? CX,
        endY: nodes[nodes.length - 1]?.y ?? CY
    };
};

interface SkillTreeVisualizerProps {
    context?: MasteryContext;
    onAllocated?: (nodeId: string) => void;
}

export const SkillTreeVisualizer: React.FC<SkillTreeVisualizerProps> = ({ context, onAllocated }) => {
    const graph = useMemo(() => masteryEngine.getSkillGraph(), []);
    const layouts = useMemo<BranchLayout[]>(
        () => graph.branches.map(b => computeBranchLayout(b)),
        [graph]
    );
    const allNodes = useMemo(
        () => graph.branches.flatMap(b => b.nodes),
        [graph]
    );

    const allocatedNodes = useMasteryStore(s => s.allocatedNodes);
    const totalMasteryXp = useMasteryStore(s => s.totalMasteryXp);
    const allocateSkillNode = useMasteryStore(s => s.allocateSkillNode);

    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [burst, setBurst] = useState<{ id: number; x: number; y: number } | null>(null);

    // Wheel zoom + drag-to-pan
    const [scale, setScale] = useState(1);
    const [tx, setTx] = useState(0);
    const [ty, setTy] = useState(0);
    const panRef = useRef<{ x: number; y: number } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
        e.preventDefault();
        const delta = -e.deltaY * 0.0015;
        setScale(prev => Math.min(2.2, Math.max(0.4, prev + delta)));
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
        if ((e.target as Element).closest('[data-node]')) return;
        panRef.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
        if (!panRef.current) return;
        const dx = e.clientX - panRef.current.x;
        const dy = e.clientY - panRef.current.y;
        panRef.current = { x: e.clientX, y: e.clientY };
        setTx(t => t + dx);
        setTy(t => t + dy);
    }, []);

    const onPointerUp = useCallback(() => {
        panRef.current = null;
    }, []);

    const resetView = () => {
        setScale(1);
        setTx(0);
        setTy(0);
    };

    const computeStatus = (node: SkillNode): NodeStatus => {
        if (allocatedNodes.includes(node.id)) return 'MASTERED';
        const prereqsMet = node.prerequisites.every(p => p === 'root' || allocatedNodes.includes(p));
        return prereqsMet ? 'AVAILABLE' : 'LOCKED';
    };

    const selectedNode = useMemo(
        () => allNodes.find(n => n.id === selectedNodeId) || null,
        [selectedNodeId, allNodes]
    );
    const selectedLayout = useMemo(() => {
        if (!selectedNode) return null;
        for (const layout of layouts) {
            const found = layout.nodes.find(p => p.node.id === selectedNode.id);
            if (found) return { layout, found };
        }
        return null;
    }, [selectedNode, layouts]);

    const handleAllocate = (node: SkillNode) => {
        const result = allocateSkillNode(node.id, node.xpCost);
        if (result.success) {
            // Trigger particle burst at the node position
            if (selectedLayout) {
                const screenX = selectedLayout.found.x * scale + tx;
                const screenY = selectedLayout.found.y * scale + ty;
                setBurst({ id: Date.now(), x: screenX, y: screenY });
                setTimeout(() => setBurst(null), 1200);
            }
            try { triggerXP(node.xpBenefit); } catch { /* non-DOM */ }
            onAllocated?.(node.id);
        }
    };

    return (
        <div className="relative w-full h-full min-h-[640px] bg-slate-950 rounded-3xl border border-slate-800 overflow-hidden">
            {/* Header HUD */}
            <div className="absolute top-0 inset-x-0 z-20 p-5 flex items-center justify-between bg-gradient-to-b from-slate-950/95 to-transparent pointer-events-none">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
                        <Sparkles className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-base font-black uppercase italic tracking-tighter">Skill Tree</h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Drag to pan, scroll to zoom</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 backdrop-blur-md">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-2">XP</span>
                        <span className="text-sm font-black text-amber-300 font-mono">{totalMasteryXp.toLocaleString()}</span>
                    </div>
                    <button
                        onClick={resetView}
                        className="px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-800 backdrop-blur-md text-[10px] font-black uppercase text-slate-300 hover:bg-slate-800"
                    >
                        Reset View
                    </button>
                </div>
            </div>

            {/* SVG Canvas */}
            <svg
                ref={svgRef}
                viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                className="absolute inset-0 w-full h-full select-none"
                onWheel={onWheel}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
                style={{ cursor: panRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
            >
                <defs>
                    {/* Background grid pattern */}
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" />
                    </pattern>
                    {/* Radial gradient for the central node */}
                    <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#fde68a" />
                        <stop offset="50%" stopColor="#f59e0b" />
                        <stop offset="100%" stopColor="#92400e" />
                    </radialGradient>
                    {/* Mastered gradient */}
                    <linearGradient id="masteredGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#fde68a" />
                        <stop offset="100%" stopColor="#f59e0b" />
                    </linearGradient>
                    {/* Available pulsing gradient */}
                    <radialGradient id="availableGrad" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#6366f1" />
                        <stop offset="100%" stopColor="#312e81" />
                    </radialGradient>
                    {/* Glow filters */}
                    <filter id="glowGold" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="glowBlue" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                <g style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: '0 0' }}>
                    {/* Background grid */}
                    <rect width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" opacity={0.35} />

                    {/* Branches */}
                    {layouts.map(layout => (
                        <g key={layout.branch.id}>
                            {/* Branch edge path with animated dash for available nodes */}
                            {layout.nodes.map((pn, idx) => {
                                const prevX = idx === 0 ? layout.startX : layout.nodes[idx - 1]!.x;
                                const prevY = idx === 0 ? layout.startY : layout.nodes[idx - 1]!.y;
                                const status = computeStatus(pn.node);
                                const isActive = status !== 'LOCKED';
                                return (
                                    <path
                                        key={`edge-${pn.node.id}`}
                                        d={buildEdgePath(prevX, prevY, pn.x, pn.y, status, pn.node.id)}
                                        fill="none"
                                        stroke={status === 'MASTERED' ? '#fbbf24' : (isActive ? layout.branch.color : '#334155')}
                                        strokeWidth={status === 'MASTERED' ? 3 : 2}
                                        strokeDasharray={isActive ? '6 6' : '3 5'}
                                        strokeLinecap="round"
                                        opacity={status === 'LOCKED' ? 0.4 : 0.9}
                                        style={isActive ? { animation: 'dashflow 4s linear infinite' } : undefined}
                                        filter={status === 'MASTERED' ? 'url(#glowGold)' : undefined}
                                    />
                                );
                            })}

                            {/* Branch label */}
                            {(() => {
                                const angle = branchAngles[layout.branch.id] ?? 0;
                                const labelDist = CENTRAL_R + 80 + layout.nodes.length * NODE_GAP + 24;
                                const lx = CX + Math.cos(angle) * labelDist;
                                const ly = CY + Math.sin(angle) * labelDist;
                                return (
                                    <foreignObject x={lx - 110} y={ly - 18} width={220} height={40}>
                                        <div className="flex justify-center">
                                            <div
                                                className="px-3 py-1.5 rounded-full bg-slate-900/80 border border-slate-700 text-[10px] font-black uppercase tracking-widest backdrop-blur-md whitespace-nowrap"
                                                style={{ color: layout.branch.color }}
                                            >
                                                {layout.branch.name}
                                            </div>
                                        </div>
                                    </foreignObject>
                                );
                            })()}

                            {/* Nodes */}
                            {layout.nodes.map(pn => {
                                const status = computeStatus(pn.node);
                                const Icon = ICON_MAP[pn.node.icon] || Zap;
                                return (
                                    <g
                                        key={pn.node.id}
                                        data-node={pn.node.id}
                                        transform={`translate(${pn.x}, ${pn.y})`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedNodeId(pn.node.id);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {/* Outer glow ring for available state */}
                                        {status === 'AVAILABLE' && (
                                            <circle
                                                r={NODE_R + 8}
                                                fill="none"
                                                stroke={layout.branch.color}
                                                strokeWidth={2}
                                                opacity={0.6}
                                                style={{ animation: 'pulse 2s ease-in-out infinite', transformOrigin: 'center' }}
                                            />
                                        )}
                                        {/* Node body */}
                                        <circle
                                            r={NODE_R}
                                            fill={
                                                status === 'MASTERED' ? 'url(#masteredGrad)' :
                                                status === 'AVAILABLE' ? 'url(#availableGrad)' :
                                                '#0f172a'
                                            }
                                            stroke={
                                                status === 'MASTERED' ? '#fbbf24' :
                                                status === 'AVAILABLE' ? layout.branch.color :
                                                '#334155'
                                            }
                                            strokeWidth={status === 'LOCKED' ? 2 : 3}
                                            opacity={status === 'LOCKED' ? 0.4 : 1}
                                            filter={status === 'MASTERED' ? 'url(#glowGold)' : status === 'AVAILABLE' ? 'url(#glowBlue)' : undefined}
                                        />
                                        {/* Icon */}
                                        {status === 'LOCKED' ? (
                                            <g opacity={0.4}>
                                                <Lock x={-10} y={-10} width={20} height={20} color="#64748b" />
                                            </g>
                                        ) : status === 'MASTERED' ? (
                                            <Crown x={-12} y={-12} width={24} height={24} color="#7c2d12" />
                                        ) : (
                                            <g>
                                                <Icon x={-11} y={-11} width={22} height={22} color="#c7d2fe" />
                                            </g>
                                        )}
                                        {/* +XP badge for available nodes */}
                                        {status === 'AVAILABLE' && (
                                            <g transform={`translate(${NODE_R - 6}, ${-NODE_R - 6})`}>
                                                <rect x={-22} y={-12} width={36} height={20} rx={10} fill="#10b981" />
                                                <text x={-4} y={3} textAnchor="middle" fontSize={10} fontWeight={900} fill="#022c22">+XP</text>
                                            </g>
                                        )}
                                        {/* Level indicator */}
                                        <text x={0} y={NODE_R + 16} textAnchor="middle" fontSize={10} fontWeight={800} fill={status === 'LOCKED' ? '#475569' : '#94a3b8'}>
                                            L{pn.node.level}
                                        </text>
                                    </g>
                                );
                            })}
                        </g>
                    ))}

                    {/* Central "Wealth Master" node */}
                    <g transform={`translate(${CX}, ${CY})`}>
                        <circle r={CENTRAL_R + 12} fill="none" stroke="#fbbf24" strokeWidth={1} opacity={0.4}
                                style={{ animation: 'pulse 3s ease-in-out infinite', transformOrigin: 'center' }} />
                        <circle r={CENTRAL_R} fill="url(#centerGrad)" stroke="#fef3c7" strokeWidth={3} filter="url(#glowGold)" />
                        <Crown x={-18} y={-18} width={36} height={36} color="#7c2d12" />
                        <text x={0} y={CENTRAL_R + 26} textAnchor="middle" fontSize={11} fontWeight={900} fill="#fbbf24" letterSpacing="1">
                            WEALTH MASTER
                        </text>
                    </g>

                    {/* Particle burst (CSS-only, triggered on level-up) */}
                    {burst && (
                        <g transform={`translate(${burst.x / scale - tx / scale}, ${burst.y / scale - ty / scale})`} pointerEvents="none">
                            {Array.from({ length: 12 }).map((_, i) => {
                                const a = (i / 12) * Math.PI * 2;
                                const r = 60;
                                return (
                                    <circle
                                        key={i}
                                        cx={Math.cos(a) * 0}
                                        cy={Math.sin(a) * 0}
                                        r={3}
                                        fill="#fbbf24"
                                        style={{
                                            animation: `particle 1.1s ease-out ${i * 30}ms forwards`,
                                            ['--tx' as any]: `${Math.cos(a) * r}px`,
                                            ['--ty' as any]: `${Math.sin(a) * r}px`
                                        }}
                                    />
                                );
                            })}
                        </g>
                    )}
                </g>
            </svg>

            {/* CSS keyframes (animation-only, no per-frame state) */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50%      { opacity: 1;   transform: scale(1.08); }
                }
                @keyframes dashflow {
                    from { stroke-dashoffset: 0; }
                    to   { stroke-dashoffset: -120; }
                }
                @keyframes particle {
                    0%   { transform: translate(0, 0); opacity: 1; }
                    100% { transform: translate(var(--tx), var(--ty)); opacity: 0; }
                }
            `}</style>

            {/* Detail panel (side panel) */}
            <AnimatePresence>
                {selectedNode && selectedLayout && (
                    <motion.div
                        key={selectedNode.id}
                        initial={{ opacity: 0, x: 320 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 320 }}
                        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
                        className="absolute top-0 right-0 bottom-0 w-[360px] bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 p-6 z-30 overflow-y-auto"
                    >
                        <button
                            onClick={() => setSelectedNodeId(null)}
                            className="absolute top-4 right-4 p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400"
                        >
                            <X className="w-4 h-4" />
                        </button>
                        <div className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: selectedLayout.layout.branch.color }}>
                            {selectedLayout.layout.branch.name}
                        </div>
                        <h3 className="text-2xl font-black italic tracking-tighter uppercase mb-1">{selectedNode.title}</h3>
                        <p className="text-xs text-slate-400 mb-5">{selectedNode.description}</p>

                        <div className="grid grid-cols-3 gap-2 mb-5">
                            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800 text-center">
                                <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Level</div>
                                <div className="text-base font-black text-indigo-300">{selectedNode.level}</div>
                            </div>
                            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800 text-center">
                                <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Cost</div>
                                <div className="text-base font-black text-amber-300">{selectedNode.xpCost}</div>
                            </div>
                            <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800 text-center">
                                <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Benefit</div>
                                <div className="text-base font-black text-emerald-300">+{selectedNode.xpBenefit}</div>
                            </div>
                        </div>

                        <div className="mb-5 p-4 rounded-2xl bg-slate-950/50 border border-slate-800">
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Quest</div>
                            <p className="text-sm text-slate-200 mb-3">{selectedNode.questHint}</p>
                            {(() => {
                                const q = masteryEngine.evaluateNodeQuest(selectedNode, context || {});
                                return (
                                    <div>
                                        <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">
                                            <span>Progress</span>
                                            <span>{q.progress} / {q.target}</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500"
                                                style={{ width: `${Math.min(100, (q.progress / Math.max(1, q.target)) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        <div className="mb-5">
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Prerequisites</div>
                            <div className="flex flex-wrap gap-1.5">
                                {selectedNode.prerequisites.map(p => (
                                    <span key={p} className="px-2 py-1 rounded-full bg-slate-800 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                                        {p === 'root' ? 'Central Node' : p}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={() => handleAllocate(selectedNode)}
                            disabled={
                                computeStatus(selectedNode) !== 'AVAILABLE' ||
                                totalMasteryXp < selectedNode.xpCost
                            }
                            className={`w-full py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                                computeStatus(selectedNode) === 'MASTERED'
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : totalMasteryXp < selectedNode.xpCost
                                    ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(99,102,241,0.35)]'
                            }`}
                        >
                            {computeStatus(selectedNode) === 'MASTERED' ? (
                                <>
                                    <Check className="w-4 h-4" /> Mastered
                                </>
                            ) : (
                                <>
                                    <Plus className="w-4 h-4" /> Allocate {selectedNode.xpCost} XP
                                </>
                            )}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default SkillTreeVisualizer;
