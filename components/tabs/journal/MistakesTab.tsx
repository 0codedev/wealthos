import React, { useState, useEffect, useMemo } from 'react';
import { SafeChartContainer } from '../../shared/SafeChartContainer';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus, ShieldAlert, X, Edit2, Trash2, TrendingUp, TrendingDown,
    Zap, Calendar, HelpCircle, Activity, Award, BarChart2, PieChart as PieIcon, AlertTriangle
} from 'lucide-react';
import {
    PageHeader,
    MetricCard,
    SectionCard,
    CategoryBadge,
    SeverityBadge,
    DataTable,
    EmptyState,
    TimeframePills
} from './ReusableUI';
import {
    PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import { liveQuery } from 'dexie';
import { db, Mistake } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { useToast } from '../../shared/ToastProvider';
import { ToggleGroup } from '../../ui/toggle-group';
import { COPY } from '../../../utils/appCopy';
import { deleteWithUndo } from '../../../lib/deleteWithUndo';
import { consumeUndo } from '../../../lib/undoStack';
import { MistakeClusterer } from '../../../services/ml/MistakeClusterer';

interface LocalMistake extends Mistake {
    severity?: 'High' | 'Medium' | 'Low';
    impact?: 'High' | 'Medium' | 'Low';
}

const SEVERITY_COLORS = {
    High: '#ef4444',
    Medium: '#f59e0b',
    Low: '#10b981'
};

const CATEGORY_COLORS = {
    TRADING: '#3b82f6',
    LIFE: '#f59e0b'
};

export const MistakesTab: React.FC = () => {
    const { toast } = useToast();
    const [mistakes, setMistakes] = useState<LocalMistake[]>([]);
    const [viewMode, setViewMode] = useState<'This Month' | 'All Time'>('This Month');
    const [modalOpen, setModalOpen] = useState(false);
    const [editingMistake, setEditingMistake] = useState<LocalMistake | null>(null);

    // Form fields
    const [title, setTitle] = useState('');
    const [describeContext, setDescribeContext] = useState('');
    const [cost, setCost] = useState('');
    const [category, setCategory] = useState<'TRADING' | 'LIFE'>('TRADING');
    const [severity, setSeverity] = useState<'High' | 'Medium' | 'Low'>('Medium');
    const [impact, setImpact] = useState<'High' | 'Medium' | 'Low'>('Medium');
    const [lesson, setLesson] = useState('');

    useEffect(() => {
        const subscription = liveQuery(() => (db.mistakes as any).active().toArray())
            .subscribe((data) => {
                const sorted = [...data].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                setMistakes(sorted as LocalMistake[]);
            });
        return () => subscription.unsubscribe();
    }, []);

    const handleOpenCreate = () => {
        setEditingMistake(null);
        setTitle('');
        setDescribeContext('');
        setCost('');
        setCategory('TRADING');
        setSeverity('Medium');
        setImpact('Medium');
        setLesson('');
        setModalOpen(true);
    };

    const handleOpenEdit = (mistake: LocalMistake) => {
        setEditingMistake(mistake);
        setTitle(mistake.title || '');
        setDescribeContext(mistake.describeContext || '');
        setCost(mistake.cost?.toString() || '');
        setCategory(mistake.category || 'TRADING');
        setSeverity(mistake.severity || 'Medium');
        setImpact(mistake.impact || 'Medium');
        setLesson(mistake.lesson || '');
        setModalOpen(true);
    };

    const handleSave = async () => {
        if (!title.trim() || !lesson.trim()) {
            toast.warning(COPY.toasts.titleAndLessonRequired);
            return;
        }

        const numericCost = parseFloat(cost) || 0;
        const record: LocalMistake = {
            id: editingMistake?.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date: editingMistake?.date || new Date().toISOString().split('T')[0],
            title: title.trim(),
            describeContext: describeContext.trim(),
            cost: numericCost,
            category,
            severity,
            impact,
            lesson: lesson.trim(),
            tags: editingMistake?.tags || [category.toLowerCase()]
        };

        try {
            await db.mistakes.put(record);
            toast.success(COPY.toasts.mistakeSaved);
            setModalOpen(false);
        } catch (error) {
            console.error('Failed to save mistake:', error);
            toast.error(COPY.toasts.mistakeSaveFailed);
        }
    };

    const handleDelete = async (id: string) => {
        const m = mistakes.find(x => x.id === id);
        const label = m?.title ?? 'Mistake';
        const entryId = await deleteWithUndo({
            table: 'mistakes',
            id,
            kind: 'mistake',
            label,
            message: COPY.undo.mistakeDeleted(label),
        });
        if (!entryId) {
            toast.error(COPY.undo.failed);
            return;
        }
        setMistakes(prev => prev.filter(x => x.id !== id));
        toast.success(COPY.undo.mistakeDeleted(label), {
            duration: 30000,
            action: { label: 'Undo', onClick: () => { void consumeUndo(entryId)?.undo(); } },
        });
    };

    // Derived stats
    const totalCost = useMemo(() => {
        return mistakes.reduce((acc, m) => acc + (m.cost || 0), 0);
    }, [mistakes]);

    const activeStreak = useMemo(() => {
        if (mistakes.length === 0) return 0;
        const diffTime = Math.abs(new Date().getTime() - new Date(mistakes[0].date).getTime());
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }, [mistakes]);

    const mostCommonMistake = useMemo(() => {
        if (mistakes.length === 0) return 'None';
        const counts: Record<string, number> = {};
        mistakes.forEach(m => {
            const title = m.title.trim();
            counts[title] = (counts[title] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return sorted[0]?.[0] || 'None';
    }, [mistakes]);

    const filteredForCharts = useMemo(() => {
        if (viewMode === 'All Time') return mistakes;
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        return mistakes.filter(m => {
            const d = new Date(m.date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });
    }, [mistakes, viewMode]);

    const distributionData = useMemo(() => {
        const counts: Record<string, number> = { Trading: 0, Life: 0 };
        filteredForCharts.forEach(m => {
            if (m.category === 'TRADING') counts.Trading++;
            else counts.Life++;
        });
        return [
            { name: 'Trading', value: counts.Trading, color: CATEGORY_COLORS.TRADING },
            { name: 'Life', value: counts.Life, color: CATEGORY_COLORS.LIFE }
        ].filter(d => d.value > 0);
    }, [filteredForCharts]);

    // Frequency heatmap data
    // Creates a grid of the last 35 days (5 weeks) ending on the current Sunday
    const heatmapCells = useMemo(() => {
        const cells = [];
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday...
        const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
        const endDate = new Date(today.getTime() + daysToSunday * 24 * 60 * 60 * 1000);

        // Map date string to mistake counts
        const dateCounts: Record<string, number> = {};
        mistakes.forEach(m => {
            dateCounts[m.date] = (dateCounts[m.date] || 0) + 1;
        });

        for (let i = 34; i >= 0; i--) {
            const cellDate = new Date(endDate.getTime() - i * 24 * 60 * 60 * 1000);
            const dateStr = cellDate.toISOString().split('T')[0];
            const count = dateCounts[dateStr] || 0;
            cells.push({
                date: dateStr,
                label: cellDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                count
            });
        }
        return cells;
    }, [mistakes]);

    const mlClusterInsights = useMemo(() => {
        if (mistakes.length === 0) return [];
        const clusterer = new MistakeClusterer(3);
        const syntheticTrades: any[] = mistakes.map(m => ({
            id: m.id,
            mistakes: [m.title, m.describeContext || ''].filter(Boolean),
            notes: m.lesson || '',
            entryPrice: 100,
            exitPrice: m.cost ? 100 - m.cost : 95,
        }));
        return clusterer.fit(syntheticTrades);
    }, [mistakes]);

    return (
        <div className="space-y-5 pb-20 tab-content">
            {/* Page Header */}
            <PageHeader
                title="Mirror of Truth"
                subtitle="Track and reflect on execution errors to build discipline"
                rightControls={
                    <button
                        onClick={handleOpenCreate}
                        className="px-4 py-2 bg-[#ef4444] hover:bg-[#ef4444]/90 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-rose-500/20 transition-all duration-150"
                    >
                        <Plus size={14} /> Log Mistake
                    </button>
                }
            />

            {/* 3 Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <MetricCard
                    label="Total Mistakes Logged"
                    value={`${mistakes.length} Mistakes`}
                    icon={ShieldAlert}
                    iconColor="#ef4444"
                    iconBg="rgba(239,68,68,0.12)"
                    progressColor="#ef4444"
                    change={mistakes.length > 0 ? 100 : 0}
                    changeLabel="total indexed rules compliance"
                />
                <MetricCard
                    label="Most Common Mistake"
                    value={mostCommonMistake}
                    icon={AlertTriangle}
                    iconColor="#f59e0b"
                    iconBg="rgba(245,158,11,0.12)"
                    progressColor="#f59e0b"
                    changeLabel="highest count item"
                />
                <MetricCard
                    label="Improvement Status"
                    value={activeStreak > 0 ? `${activeStreak} Days Clear` : 'No Streak'}
                    icon={Zap}
                    iconColor="#10b981"
                    iconBg="rgba(16,185,129,0.12)"
                    progressColor="#10b981"
                    change={activeStreak > 0 ? activeStreak : undefined}
                    changeLabel="since last logged mistake"
                />
            </div>

            {/* Domain 4.1: ML Mistake Pattern Clusters */}
            {mlClusterInsights.length > 0 && (
                <div className="bg-slate-900/60 backdrop-blur-xl border border-indigo-500/20 rounded-2xl p-5 space-y-3 shadow-lg">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Zap className="w-4 h-4 text-indigo-400" />
                            ML Mistake Pattern Clusters (K-Means Discovered)
                        </h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                            Domain 4.1 ML
                        </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {mlClusterInsights.map((c, idx) => (
                            <div key={idx} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-1">
                                <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                                    <span>{c.label}</span>
                                    <span className="text-[10px] text-rose-400 font-mono">avg {formatCurrency(c.avgPnl)}</span>
                                </div>
                                <div className="text-[10px] text-slate-400 truncate">
                                    Keywords: {c.topTokens.slice(0, 4).join(', ') || 'general'}
                                </div>
                                <div className="text-[9px] text-slate-500 font-medium">
                                    {c.count} instances clustered
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Visual Analytics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Mistake Distribution Chart */}
                <SectionCard
                    title="Mistake Distribution"
                    icon={PieIcon}
                    iconColor="#3b82f6"
                    headerAction={
                        <ToggleGroup
                            options={[
                                { value: 'This Month', label: 'This Month' },
                                { value: 'All Time', label: 'All Time' }
                            ]}
                            value={viewMode}
                            onChange={(mode) => setViewMode(mode as 'This Month' | 'All Time')}
                            layoutId="mistakesDistributionViewMode"
                            size="xs"
                            ariaLabel="Mistake distribution period"
                        />
                    }
                >
                    <div className="h-[200px] flex items-center justify-center">
                        {distributionData.length === 0 ? (
                            <EmptyState
                                icon={HelpCircle}
                                title="No Data Available"
                                subtitle="Distribution will populate when mistakes are logged for this period."
                            />
                        ) : (
                            <SafeChartContainer>
                                <PieChart>
                                    <Pie
                                        data={distributionData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={4}
                                        dataKey="value"
                                    >
                                        {distributionData.map((entry, idx) => (
                                            <Cell key={`cell-${idx}`} fill={entry.color} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#161b27',
                                            border: '1px solid rgba(255, 255, 255, 0.06)',
                                            borderRadius: '8px',
                                            color: '#fff'
                                        }}
                                    />
                                </PieChart>
                            </SafeChartContainer>
                        )}
                    </div>
                    {distributionData.length > 0 && (
                        <div className="flex justify-center gap-6 mt-2 text-xs">
                            {distributionData.map(d => (
                                <div key={d.name} className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                                    <span className="text-[#94a3b8]">{d.name}:</span>
                                    <span className="font-bold text-white">{d.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </SectionCard>

                {/* Frequency Heatmap Grid */}
                <SectionCard title="Frequency Heatmap" icon={Calendar} iconColor="#10b981">
                    <div className="flex flex-col h-full justify-between">
                        <div className="grid grid-cols-7 gap-2 text-center text-[10px] font-bold text-[#64748b] border-b border-white/[0.03] pb-2 mb-3">
                            <span>MON</span>
                            <span>TUE</span>
                            <span>WED</span>
                            <span>THU</span>
                            <span>FRI</span>
                            <span>SAT</span>
                            <span>SUN</span>
                        </div>
                        <div className="grid grid-cols-7 gap-2 flex-1 items-center">
                            {heatmapCells.map((cell, idx) => {
                                let bg = 'rgba(255, 255, 255, 0.02)';
                                let border = 'rgba(255, 255, 255, 0.04)';
                                if (cell.count > 0) {
                                    bg = cell.count >= 3
                                        ? 'rgba(239, 68, 68, 0.8)' // High (rose)
                                        : cell.count === 2
                                        ? 'rgba(245, 158, 11, 0.6)' // Medium (amber)
                                        : 'rgba(59, 130, 246, 0.4)'; // Low (blue)
                                    border = 'rgba(255, 255, 255, 0.15)';
                                }
                                return (
                                    <div
                                        key={idx}
                                        className="aspect-square rounded-lg flex flex-col items-center justify-center border transition-all duration-150 relative group cursor-help"
                                        style={{ backgroundColor: bg, borderColor: border }}
                                    >
                                        <span className={`text-[10px] font-mono ${cell.count > 0 ? 'text-white font-bold' : 'text-[#334155]'}`}>
                                            {cell.count > 0 ? cell.count : ''}
                                        </span>
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block bg-[#1c2333] border border-white/[0.06] text-[9px] font-bold text-[#e2e8f0] px-2 py-1 rounded shadow-lg whitespace-nowrap z-20 pointer-events-none">
                                            {cell.label}: {cell.count} {cell.count === 1 ? 'mistake' : 'mistakes'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-[#64748b] mt-4 pt-2 border-t border-white/[0.03]">
                            <span>Past 5 Weeks compliance trend</span>
                            <div className="flex items-center gap-1.5">
                                <span>Less</span>
                                <span className="w-2.5 h-2.5 rounded bg-white/[0.02] border border-white/[0.04]" />
                                <span className="w-2.5 h-2.5 rounded bg-blue-500/40" />
                                <span className="w-2.5 h-2.5 rounded bg-amber-500/60" />
                                <span className="w-2.5 h-2.5 rounded bg-red-500/80" />
                                <span>More</span>
                            </div>
                        </div>
                    </div>
                </SectionCard>
            </div>

            {/* Recent Mistakes Collection */}
            <SectionCard title="Recent Mistakes Archive" icon={Activity} iconColor="#ef4444">
                {mistakes.length === 0 ? (
                    <EmptyState
                        icon={ShieldAlert}
                        title="Your Journal is Spotless"
                        subtitle="Excellent work. Log a custom mistake if you ever diverge from your plan."
                    />
                ) : (
                    <DataTable headers={['Mistake', 'Severity', 'Impact', 'Tuition Paid', 'Actions']}>
                        {mistakes.map(m => (
                            <tr key={m.id} className="hover:bg-white/[0.01] transition-colors">
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_rgba(255,255,255,0.1)]"
                                            style={{
                                                backgroundColor: m.category === 'TRADING' ? CATEGORY_COLORS.TRADING : CATEGORY_COLORS.LIFE
                                            }}
                                        />
                                        <div>
                                            <p className="text-xs font-bold text-white leading-snug">{m.title}</p>
                                            <p className="text-[10px] text-[#64748b] mt-0.5 max-w-md line-clamp-1 italic">
                                                "{m.lesson}"
                                            </p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <SeverityBadge severity={m.severity || 'Medium'} />
                                </td>
                                <td className="px-4 py-3">
                                    <SeverityBadge severity={m.impact || 'Medium'} />
                                </td>
                                <td className="px-4 py-3 font-mono font-bold text-rose-500">
                                    {m.cost > 0 ? `-${formatCurrency(m.cost)}` : '—'}
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => handleOpenEdit(m)}
                                            className="p-1 hover:bg-white/[0.03] rounded text-[#64748b] hover:text-[#3b82f6] transition-colors"
                                            title="Edit Reflection"
                                        >
                                            <Edit2 size={13} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(m.id)}
                                            className="p-1 hover:bg-white/[0.03] rounded text-[#64748b] hover:text-[#ef4444] transition-colors"
                                            title="Delete Entry"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </DataTable>
                )}
            </SectionCard>

            {/* Create/Edit Modal */}
            <AnimatePresence>
                {modalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="w-full max-w-md bg-[#161b27] border border-white/[0.06] rounded-2xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]"
                        >
                            <div className="flex items-center justify-between mb-5">
                                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                                    {editingMistake ? 'Edit Reflection' : 'Log New Mistake'}
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
                                    <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Mistake Heading *</label>
                                    <input
                                        value={title}
                                        onChange={e => setTitle(e.target.value)}
                                        placeholder="e.g. FOMO buy during breakout"
                                        className="w-full rounded-xl bg-[#232d42] border border-white/[0.06] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#ef4444] transition-colors placeholder-[#334155]"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Tuition Paid (₹)</label>
                                        <input
                                            type="number"
                                            value={cost}
                                            onChange={e => setCost(e.target.value)}
                                            placeholder="0"
                                            className="w-full rounded-xl bg-[#232d42] border border-white/[0.06] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#ef4444] transition-colors placeholder-[#334155] font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Category Domain</label>
                                        <select
                                            value={category}
                                            onChange={e => setCategory(e.target.value as 'TRADING' | 'LIFE')}
                                            className="w-full rounded-xl bg-[#232d42] border border-white/[0.06] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#ef4444] transition-colors cursor-pointer"
                                        >
                                            <option value="TRADING">Trading</option>
                                            <option value="LIFE">Life</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Severity</label>
                                        <select
                                            value={severity}
                                            onChange={e => setSeverity(e.target.value as 'High' | 'Medium' | 'Low')}
                                            className="w-full rounded-xl bg-[#232d42] border border-white/[0.06] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#ef4444] transition-colors cursor-pointer"
                                        >
                                            <option value="Low">Low</option>
                                            <option value="Medium">Medium</option>
                                            <option value="High">High</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Impact</label>
                                        <select
                                            value={impact}
                                            onChange={e => setImpact(e.target.value as 'High' | 'Medium' | 'Low')}
                                            className="w-full rounded-xl bg-[#232d42] border border-white/[0.06] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#ef4444] transition-colors cursor-pointer"
                                        >
                                            <option value="Low">Low</option>
                                            <option value="Medium">Medium</option>
                                            <option value="High">High</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5 block">Describe Context</label>
                                    <textarea
                                        value={describeContext}
                                        onChange={e => setDescribeContext(e.target.value)}
                                        placeholder="Explain the circumstances surrounding this mistake..."
                                        rows={3}
                                        className="w-full rounded-xl bg-[#232d42] border border-white/[0.06] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#ef4444] transition-colors resize-none placeholder-[#334155]"
                                    />
                                </div>

                                <div>
                                    <label className="text-[10px] font-bold text-[#10b981] uppercase tracking-wider mb-1.5 block">The Golden Lesson *</label>
                                    <textarea
                                        value={lesson}
                                        onChange={e => setLesson(e.target.value)}
                                        placeholder="What did you learn and how will you prevent it?"
                                        rows={3}
                                        className="w-full rounded-xl bg-[#232d42] border border-white/[0.06] text-white text-xs px-3.5 py-2.5 outline-none focus:border-[#10b981] transition-colors resize-none placeholder-[#334155]"
                                    />
                                </div>
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
                                    className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-red-500 to-rose-600 hover:opacity-90 transition-opacity"
                                >
                                    Save Reflection
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MistakesTab;
