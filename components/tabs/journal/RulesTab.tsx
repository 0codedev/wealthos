import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus, ShieldCheck, X, Edit2, Trash2, TrendingUp, TrendingDown,
    Award, AlertTriangle, BookOpen, Clock, Activity, HelpCircle
} from 'lucide-react';
import {
    PageHeader,
    SectionCard,
    CategoryBadge,
    DataTable,
    EmptyState,
    GradientProgressBar
} from './ReusableUI';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';

interface TradingRule {
    id: string;
    name: string;
    category: string;
    description: string;
    followCount: number;
    totalSessions: number;
    createdAt: string;
    active?: boolean;
}

const STORAGE_KEY = 'trading_rules_v1';

const defaultRules: TradingRule[] = [
    { id: '1', name: 'Never Risk More Than 1%', category: 'Risk Management', description: 'Maximum 1% of capital at risk per trade.', followCount: 18, totalSessions: 22, createdAt: new Date().toISOString(), active: true },
    { id: '2', name: 'No Trading After 2 Losses', category: 'Psychology', description: 'Stop for the day after 2 consecutive losses.', followCount: 14, totalSessions: 22, createdAt: new Date().toISOString(), active: true },
    { id: '3', name: 'Wait for Confirmation Candle', category: 'Entry', description: 'Never enter on the first signal candle — wait for close.', followCount: 16, totalSessions: 22, createdAt: new Date().toISOString(), active: true },
    { id: '4', name: 'Always Set Stop Loss Before Entry', category: 'Risk Management', description: 'SL must be placed before executing any trade.', followCount: 20, totalSessions: 22, createdAt: new Date().toISOString(), active: true },
    { id: '5', name: 'R:R Must Be Minimum 1:2', category: 'Strategy', description: 'Only take trades with at least 1:2 risk-to-reward.', followCount: 12, totalSessions: 22, createdAt: new Date().toISOString(), active: true },
];

const RULE_CATEGORIES = [
    'Risk Management',
    'Psychology',
    'Strategy',
    'Entry',
    'Exit',
    'Position Sizing',
    'Other'
];

export const RulesTab: React.FC = () => {
    const [rules, setRules] = useState<TradingRule[]>([]);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<TradingRule | null>(null);
    const [timeframe, setTimeframe] = useState('30D');
    const [showInactive, setShowInactive] = useState(false);

    // Modal fields
    const [name, setName] = useState('');
    const [category, setCategory] = useState('Risk Management');
    const [description, setDescription] = useState('');
    const [ruleActive, setRuleActive] = useState(true);

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        setRules(stored ? JSON.parse(stored) : defaultRules);
    }, []);

    const persist = (updated: TradingRule[]) => {
        setRules(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    };

    const handleOpenCreate = () => {
        setEditingRule(null);
        setName('');
        setCategory('Risk Management');
        setDescription('');
        setRuleActive(true);
        setModalOpen(true);
    };

    const handleOpenEdit = (rule: TradingRule) => {
        setEditingRule(rule);
        setName(rule.name);
        setCategory(rule.category);
        setDescription(rule.description);
        setRuleActive(rule.active !== false);
        setModalOpen(true);
    };

    const handleSave = () => {
        if (!name.trim()) return;

        let updated: TradingRule[];
        if (editingRule) {
            updated = rules.map(r => r.id === editingRule.id ? {
                ...r,
                name: name.trim(),
                category,
                description: description.trim(),
                active: ruleActive
            } : r);
        } else {
            const newRule: TradingRule = {
                id: Date.now().toString(),
                name: name.trim(),
                category,
                description: description.trim(),
                followCount: 0,
                totalSessions: 0,
                createdAt: new Date().toISOString(),
                active: true
            };
            updated = [...rules, newRule];
        }

        persist(updated);
        setModalOpen(false);
    };

    const handleDelete = (id: string) => {
        if (confirm('Are you sure you want to delete this rule?')) {
            persist(rules.filter(r => r.id !== id));
        }
    };

    // Derived statistics
    const activeRules = useMemo(() => rules.filter(r => r.active !== false), [rules]);
    const displayRules = useMemo(() => showInactive ? rules : activeRules, [rules, activeRules, showInactive]);

    const sortedRules = useMemo(() => {
        return [...activeRules].sort((a, b) => {
            const rateA = a.totalSessions > 0 ? a.followCount / a.totalSessions : 0;
            const rateB = b.totalSessions > 0 ? b.followCount / b.totalSessions : 0;
            return rateB - rateA;
        });
    }, [activeRules]);

    const topFollowed = useMemo(() => sortedRules.slice(0, 5), [sortedRules]);
    
    const leastUsed = useMemo(() => {
        return [...activeRules]
            .sort((a, b) => a.totalSessions - b.totalSessions)
            .slice(0, 5);
    }, [activeRules]);

    // Mock trend data for Rules Discipline Chart
    const trendData = [
        { date: 'Jun 01', adherence: 85 },
        { date: 'Jun 02', adherence: 90 },
        { date: 'Jun 03', adherence: 75 },
        { date: 'Jun 04', adherence: 80 },
        { date: 'Jun 05', adherence: 95 },
        { date: 'Jun 06', adherence: 88 },
        { date: 'Jun 07', adherence: 92 }
    ];

    return (
        <div className="space-y-5 pb-20 tab-content">
            {/* Page Header */}
            <PageHeader
                title="Rules Performance Analysis"
                subtitle="Track and audit compliance of your trade execution rules"
                rightControls={
                    <div className="flex items-center gap-3">
                        <select
                            value={timeframe}
                            onChange={(e) => setTimeframe(e.target.value)}
                            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-xs text-[#e2e8f0] px-3 py-2 outline-none focus:border-blue-500 transition-colors cursor-pointer"
                        >
                            <option value="30D">Last 30 Days</option>
                            <option value="90D">Last 90 Days</option>
                            <option value="1Y">Last 1 Year</option>
                        </select>
                        <button
                            onClick={handleOpenCreate}
                            className="px-4 py-2 bg-[#3b82f6] hover:bg-[#3b82f6]/90 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-blue-500/20 transition-all duration-150"
                        >
                            <Plus size={14} /> Create Rule
                        </button>
                    </div>
                }
            />

            {/* Side-by-side Widgets */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Top 5 Most Followed */}
                <SectionCard title="Top 5 Most Followed Rules" icon={Award} iconColor="#00d4aa" iconBg="rgba(0,212,170,0.1)">
                    {topFollowed.length === 0 ? (
                        <EmptyState icon={ShieldCheck} title="No Rules Data" subtitle="Rules stats will appear once you record sessions." />
                    ) : (
                        <div className="space-y-3">
                            {topFollowed.map((rule, idx) => {
                                const rate = rule.totalSessions > 0 ? Math.round((rule.followCount / rule.totalSessions) * 100) : 0;
                                return (
                                    <div key={rule.id} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="w-5 h-5 rounded-full bg-[#00d4aa]/15 text-[#00d4aa] text-[10px] font-black flex items-center justify-center shrink-0">
                                                {idx + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-white truncate">{rule.name}</p>
                                                <span className="mt-1 block"><CategoryBadge category={rule.category} /></span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="text-sm font-mono font-bold text-[#00d4aa]">{rate}%</span>
                                            <p className="text-[9px] text-[#64748b] mt-0.5">{rule.followCount}/{rule.totalSessions} sessions</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </SectionCard>

                {/* Least Used Rules */}
                <SectionCard title="Least Used Rules" icon={AlertTriangle} iconColor="#ef4444" iconBg="rgba(239,68,68,0.1)">
                    {leastUsed.length === 0 ? (
                        <EmptyState icon={ShieldCheck} title="No Rules Data" subtitle="Rules stats will appear once you record sessions." />
                    ) : (
                        <div className="space-y-3">
                            {leastUsed.map((rule) => {
                                return (
                                    <div key={rule.id} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-7 h-7 rounded-lg bg-white/[0.02] flex items-center justify-center shrink-0 text-[#64748b]">
                                                <BookOpen size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-white truncate">{rule.name}</p>
                                                <span className="mt-1 block"><CategoryBadge category={rule.category} /></span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 font-bold text-[10px] rounded-full border border-rose-500/15">
                                                {rule.totalSessions} uses
                                            </span>
                                            <p className="text-[9px] text-[#64748b] mt-1">Creation: {new Date(rule.createdAt).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </SectionCard>
            </div>

            {/* Rules Discipline Trend */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)] h-[280px] flex flex-col justify-between">
                <div className="flex items-center justify-between mb-4 border-b border-white/[0.03] pb-2">
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide flex items-center gap-2">
                        <Activity size={16} className="text-[#3b82f6]" /> Rules Discipline
                    </h3>
                    <button className="px-2.5 py-1 bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] rounded-lg text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] transition-colors">
                        Discipline Trend
                    </button>
                </div>
                <div className="flex-1 min-h-0 w-full">
                    <SafeChartContainer>
                        <LineChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
                            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(val) => `${val}%`} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1c2333', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}
                                labelStyle={{ color: '#64748b', fontSize: '11px', fontWeight: 'bold' }}
                                formatter={(value: any) => [`${value}%`, 'Rule Compliance']}
                            />
                            <Line type="monotone" dataKey="adherence" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} />
                        </LineChart>
                    </SafeChartContainer>
                </div>
            </div>

            {/* Rules Collection Grid */}
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/[0.03]">
                    <h3 className="text-sm font-semibold text-[#e2e8f0] tracking-wide">Rules Collection</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-[#64748b]">Show Inactive</span>
                        <button
                            onClick={() => setShowInactive(!showInactive)}
                            className={`w-9 h-5 rounded-full p-0.5 transition-colors ${showInactive ? 'bg-[#3b82f6]' : 'bg-[#1c2333] border border-white/[0.05]'}`}
                        >
                            <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${showInactive ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>

                {displayRules.length === 0 ? (
                    <EmptyState icon={ShieldCheck} title="No Rules Found" subtitle="Click 'Create Rule' to add your trading guidelines." />
                ) : (
                    <DataTable headers={['Rule', 'Category', 'Adherence', 'Usage', 'Actions']}>
                        {displayRules.map((rule) => {
                            const rate = rule.totalSessions > 0 ? Math.round((rule.followCount / rule.totalSessions) * 100) : 0;
                            return (
                                <tr key={rule.id} className={`hover:bg-white/[0.01] transition-colors ${!rule.active ? 'opacity-40' : ''}`}>
                                    <td className="px-4 py-3">
                                        <p className="text-xs font-bold text-white">{rule.name}</p>
                                        {rule.description && <p className="text-[11px] text-[#64748b] mt-0.5">{rule.description}</p>}
                                    </td>
                                    <td className="px-4 py-3"><CategoryBadge category={rule.category} /></td>
                                    <td className="px-4 py-3 font-mono font-bold">
                                        <span className={rate >= 70 ? 'text-[#00d4aa]' : rate >= 40 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}>
                                            {rate}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 w-40">
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 h-1.5 bg-[#1c2333] rounded-full overflow-hidden">
                                                <div className="h-full bg-[#3b82f6] rounded-full" style={{ width: `${Math.min(100, (rule.followCount / Math.max(1, rule.totalSessions)) * 100)}%` }} />
                                            </div>
                                            <span className="text-[10px] text-[#64748b] font-mono shrink-0">{rule.followCount}/{rule.totalSessions}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                onClick={() => handleOpenEdit(rule)}
                                                className="p-1 hover:bg-white/[0.03] rounded text-[#64748b] hover:text-[#3b82f6] transition-colors"
                                                title="Edit Rule"
                                            >
                                                <Edit2 size={13} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(rule.id)}
                                                className="p-1 hover:bg-white/[0.03] rounded text-[#64748b] hover:text-[#ef4444] transition-colors"
                                                title="Delete Rule"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </DataTable>
                )}
            </div>

            {/* Create/Edit Modal */}
            <AnimatePresence>
                {modalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 shadow-2xl"
                        >
                            <div className="flex items-center justify-between mb-5">
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                                    {editingRule ? 'Edit Rule' : 'Create New Rule'}
                                </h3>
                                <button
                                    onClick={() => setModalOpen(false)}
                                    className="text-[#64748b] hover:text-white transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Rule Name *</label>
                                    <input
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        placeholder="e.g. Never risk more than 1% per trade"
                                        className="w-full rounded-xl bg-[#232d42] border border-white/[0.05] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#3b82f6] transition-colors placeholder-[#334155]"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Category</label>
                                    <select
                                        value={category}
                                        onChange={e => setCategory(e.target.value)}
                                        className="w-full rounded-xl bg-[#232d42] border border-white/[0.05] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#3b82f6] transition-colors cursor-pointer"
                                    >
                                        {RULE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Description</label>
                                    <textarea
                                        value={description}
                                        onChange={e => setDescription(e.target.value)}
                                        placeholder="Explain the rules conditions, constraints, or reasoning..."
                                        rows={3}
                                        className="w-full rounded-xl bg-[#232d42] border border-white/[0.05] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#3b82f6] transition-colors resize-none placeholder-[#334155]"
                                    />
                                </div>
                                {editingRule && (
                                    <div className="flex items-center justify-between py-2 border-t border-white/[0.03] mt-2">
                                        <span className="text-xs text-[#94a3b8] font-semibold">Rule Active</span>
                                        <button
                                            onClick={() => setRuleActive(!ruleActive)}
                                            className={`w-9 h-5 rounded-full p-0.5 transition-colors ${ruleActive ? 'bg-[#3b82f6]' : 'bg-[#1c2333] border border-white/[0.05]'}`}
                                        >
                                            <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${ruleActive ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => setModalOpen(false)}
                                    className="flex-1 py-2.5 rounded-xl text-xs font-bold text-[#64748b] bg-[#1c2333] hover:bg-white/[0.03] hover:text-[#e2e8f0] transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 transition-opacity"
                                >
                                    Save Rule
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default RulesTab;
