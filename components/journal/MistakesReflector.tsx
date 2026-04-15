
import React, { useState, useEffect, useMemo } from 'react';
import { liveQuery } from 'dexie';
import { db, Mistake } from '../../database';
import { Download, Upload, Plus, Trash2, DollarSign, Brain, Target, ShieldAlert, Pencil, ArrowLeft, TrendingDown, BookOpen, Search, Filter, SortAsc, Calendar, Zap } from 'lucide-react';
import { formatCurrency, calculateStreaks } from '../../utils/helpers';
import { useToast } from '../shared/ToastProvider';
import { analyzeMistakeReflection } from '../../services/MistakeIntelligenceService';
import { useMasteryStore } from '../../store/masteryStore';
import { triggerXP } from '../mastery/XPCelebration';
import { deleteWithUndo } from '../../lib/deleteWithUndo';
import { consumeUndo } from '../../lib/undoStack';
import { COPY } from '../../utils/appCopy';
import { EmptyState } from '../shared/EmptyState';

interface MirrorPrefillData {
    title: string;
    coreLesson: string;
    emotionalContext: string;
}

interface MistakesReflectorProps {
    initialData?: MirrorPrefillData | null;
    onConsumeInitialData?: () => void;
}

const MistakesReflector: React.FC<MistakesReflectorProps> = ({ initialData, onConsumeInitialData }) => {
    const { toast } = useToast();
    const [mistakes, setMistakes] = useState<Mistake[]>([]);
    const [rules, setRules] = useState<any[]>([]);
    const [view, setView] = useState<'LIST' | 'new' | 'rules'>('LIST');

    // Filter & Sort State
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState<'ALL' | 'TRADING' | 'LIFE'>('ALL');
    const [sortBy, setSortBy] = useState<'DATE' | 'COST'>('DATE');

    // Form State
    const [title, setTitle] = useState('');
    const [describeContext, setDescribeContext] = useState('');
    const [cost, setCost] = useState('');
    const [category, setCategory] = useState<'TRADING' | 'LIFE'>('TRADING');
    const [lesson, setLesson] = useState('');
    const [emotionalState, setEmotionalState] = useState('');
    const [editId, setEditId] = useState<string | null>(null);
    const [selectedMistake, setSelectedMistake] = useState<Mistake | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    
    // Rules State
    const [ruleText, setRuleText] = useState('');
    // Banner state for prefill notification
    const [showPrefillBanner, setShowPrefillBanner] = useState(false);

    // Consume initialData from Trading Journal to pre-fill the new entry form
    useEffect(() => {
        if (initialData) {
            setTitle(initialData.title);
            setLesson(initialData.coreLesson);
            setEmotionalState(initialData.emotionalContext);
            setCategory('TRADING');
            setView('new');
            setShowPrefillBanner(true);
            onConsumeInitialData?.();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData]);

    // Data Subscription & Migration
    useEffect(() => {
        // Subscribe to DB updates
        const subscription = liveQuery(() => (db.mistakes as any).active().toArray())
            .subscribe((data: Mistake[]) => {
                const sorted = [...data].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                setMistakes(sorted);
            });
        
        const rulesSub = liveQuery(() => db.mirror_rules.orderBy('date').reverse().toArray())
            .subscribe(setRules);

        // Migration Check
        const migrateData = async () => {
            const hasData = await db.mistakes.count();
            if (hasData === 0) {
                const saved = localStorage.getItem('financial_mistakes');
                if (saved) {
                    try {
                        const legacyMistakes: Mistake[] = JSON.parse(saved);
                        if (legacyMistakes.length > 0) {
                            await db.mistakes.bulkAdd(legacyMistakes);
                            toast.success("Migrated your lessons to the secure database!");
                        }
                    } catch (e) {
                        console.error("Migration failed", e);
                    }
                }
            }
        };
        migrateData();

        return () => {
            subscription.unsubscribe();
            rulesSub.unsubscribe();
        };
    }, []);

    const saveMistakeToDB = async (mistake: Mistake) => {
        try {
            await db.mistakes.put(mistake);
        } catch (error) {
            console.error("Failed to save mistake:", error);
            toast.error("Failed to save. Please try again.");
        }
    };

    const deleteMistakeFromDB = async (id: string): Promise<string | null> => {
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
            console.error('Failed to delete mistake');
        }
        return entryId;
    };

    // Backup & Restore Handlers
    const handleBackup = () => {
        const dataStr = JSON.stringify(mistakes, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `MirrorOfTruth_Backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("Lessons backed up successfully!");
    };

    const handleAddRule = async () => {
        if (!ruleText.trim()) return;
        const newRule = {
            id: `rule-${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            text: ruleText,
            version: 1,
            isActive: true
        };
        await db.mirror_rules.add(newRule);
        setRuleText('');
        toast.success("New rule added to your arsenal!");
    };

    const toggleRuleStatus = async (id: string, current: boolean) => {
        await db.mirror_rules.update(id, { isActive: !current });
    };

    const deleteRule = async (id: string) => {
        if (window.confirm("Abandon this rule?")) {
            await db.mirror_rules.delete(id);
            toast.success("Rule removed.");
        }
    };

    const handleRestore = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = async (e: any) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const imported = JSON.parse(event.target?.result as string);
                    if (Array.isArray(imported)) {
                        if (window.confirm(`Restore ${imported.length} lessons? This will merge with existing ones.`)) {
                            await db.mistakes.bulkPut(imported);
                            toast.success("Lessons restored successfully!");
                        }
                    } else {
                        toast.error("Invalid backup file.");
                    }
                } catch (err) {
                    toast.error("Failed to parse backup file.");
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    const handleSubmit = async () => {
        if (!title || !cost || !lesson) {
            toast.warning("Please fill in all required fields.");
            return;
        }

        setIsAnalyzing(true);
        const aiResult = await analyzeMistakeReflection(`${title}. ${describeContext}. ${lesson}`);
        setIsAnalyzing(false);

        const mistakeData: Mistake = {
            id: editId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            date: editId ? (mistakes.find(m => m.id === editId)?.date || new Date().toISOString().split('T')[0]) : new Date().toISOString().split('T')[0],
            title,
            describeContext,
            cost: parseFloat(cost),
            category,
            lesson,
            emotionalState: aiResult.mood || emotionalState,
            tags: aiResult.tags,
            actionItems: aiResult.actionItems,
            relatedTopics: aiResult.relatedTopics,
            summary: aiResult.summary
        };

        if (editId) {
            await saveMistakeToDB(mistakeData);
            useMasteryStore.getState().refreshMastery();
            triggerXP(100);
            toast.success("Reflection updated with AI insights.");
        } else {
            await saveMistakeToDB(mistakeData);
            useMasteryStore.getState().refreshMastery();
            triggerXP(250);
            toast.success("Reflection logged. AI has extracted key lessons.");
        }

        resetForm();
        setView('LIST');
    };

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        const entryId = await deleteMistakeFromDB(id);
        if (!entryId) {
            toast.error(COPY.undo.failed);
            return;
        }
        const m = mistakes.find(x => x.id === id);
        const label = m?.title ?? 'Mistake';
        toast.success(COPY.undo.mistakeDeleted(label), {
            duration: 30000,
            action: { label: 'Undo', onClick: () => { void consumeUndo(entryId)?.undo(); } },
        });
    };

    const handleEdit = (mistake: Mistake) => {
        setTitle(mistake.title);
        setDescribeContext(mistake.describeContext || '');
        setCost(mistake.cost.toString());
        setCategory(mistake.category);
        setLesson(mistake.lesson);
        setEmotionalState(mistake.emotionalState || '');
        setEditId(mistake.id);
        setView('new');
    };

    const resetForm = () => {
        setTitle('');
        setDescribeContext('');
        setCost('');
        setCategory('TRADING');
        setLesson('');
        setEmotionalState('');
        setEditId(null);
    };

    const totalCost = mistakes.reduce((acc, m) => acc + m.cost, 0);

    const mistakeFreeStreak = mistakes.length > 0
        ? Math.floor((new Date().getTime() - new Date(mistakes[0].date).getTime()) / (1000 * 3600 * 24))
        : 0;

    const filteredMistakes = useMemo(() => {
        return mistakes
            .filter(m => {
                const matchesSearch = m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    m.lesson.toLowerCase().includes(searchTerm.toLowerCase());
                const matchesCategory = filterCategory === 'ALL' || m.category === filterCategory;
                return matchesSearch && matchesCategory;
            })
            .sort((a, b) => {
                if (sortBy === 'DATE') return new Date(b.date).getTime() - new Date(a.date).getTime();
                if (sortBy === 'COST') return b.cost - a.cost;
                return 0;
            });
    }, [mistakes, searchTerm, filterCategory, sortBy]);

    return (
        <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="mb-6 bg-slate-900/40 backdrop-blur-xl p-6 rounded-[2rem] border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-xl">
                <div className="flex items-center gap-5">
                    <div className="p-3 bg-gradient-to-br from-indigo-500/20 to-rose-500/20 rounded-2xl border border-white/5 shadow-inner">
                        <ShieldAlert className="text-rose-400" size={28} />
                    </div>
                    <div>
                        <h2 className="text-3xl font-black text-white tracking-tight flex items-center gap-3">
                            {selectedMistake ? 'Reflection Detail' : 'Mirror of Truth'}
                        </h2>
                        <div className="flex items-center gap-3 mt-1">
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Mistakes & Learnings Reflector</p>
                            {mistakeFreeStreak > 0 && (
                                <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg flex items-center gap-1.5 border border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                                    <Zap size={12} className="text-emerald-400" /> {mistakeFreeStreak} Day Streak
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <div className="flex bg-slate-950/50 p-1.5 rounded-2xl border border-slate-800">
                        <button onClick={handleBackup} className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 group border border-transparent hover:border-slate-700">
                            <Download size={14} className="group-hover:-translate-y-0.5 transition-transform" /> Backup
                        </button>
                        <div className="w-px bg-slate-800 my-2 mx-1"></div>
                        <button onClick={handleRestore} className="px-4 py-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 group border border-transparent hover:border-slate-700">
                            <Upload size={14} className="group-hover:-translate-y-0.5 transition-transform" /> Restore
                        </button>
                    </div>
                    
                    {view === 'LIST' && !selectedMistake && (
                        <button
                            onClick={() => setView('rules')}
                            className="px-6 py-2.5 rounded-2xl text-sm font-black text-indigo-400 bg-slate-950/50 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900 transition-all active:scale-95 flex items-center gap-2 group shadow-lg"
                        >
                            <ShieldAlert size={18} className="group-hover:scale-110 transition-transform" />
                            <span>My Rules</span>
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (selectedMistake) {
                                setSelectedMistake(null);
                                setView('LIST');
                            } else if (view === 'rules' || view === 'new') {
                                setView('LIST');
                            } else {
                                resetForm(); // CLEAR OLD DATA
                                setView('new');
                            }
                        }}
                        className="relative px-6 py-2.5 rounded-2xl text-sm font-black text-white overflow-hidden group shadow-[0_0_20px_rgba(99,102,241,0.3)] hover:shadow-[0_0_30px_rgba(99,102,241,0.5)] transition-all active:scale-95 flex items-center gap-2 ml-2"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-violet-600 opacity-90 group-hover:opacity-100 transition-opacity"></div>
                        {view === 'LIST' && !selectedMistake ? (
                            <><Plus size={18} className="relative z-10 group-hover:rotate-90 transition-transform duration-500" /><span className="relative z-10">Log New Mistake</span></>
                        ) : (
                            <><ArrowLeft size={18} className="relative z-10 group-hover:-translate-x-1 transition-transform" /><span className="relative z-10">Back to Library</span></>
                        )}
                    </button>
                </div>
            </div>

            <div className="w-full">
                {view === 'LIST' ? (
                    <div className="flex flex-col gap-8">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <div className="md:col-span-2 relative p-8 rounded-3xl border border-slate-800 bg-slate-900/40 backdrop-blur-xl shadow-2xl overflow-hidden group">
                                <div className="absolute inset-0 bg-gradient-to-br from-rose-900/30 via-slate-900/0 to-slate-900/0 z-0"></div>
                                <div className="absolute -top-24 -right-24 w-64 h-64 bg-rose-600/20 rounded-full blur-3xl group-hover:bg-rose-600/30 transition-colors duration-700"></div>
                                <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2 text-rose-400">
                                            <ShieldAlert size={14} /><p className="text-[10px] font-black uppercase tracking-widest">Total Tuition Paid</p>
                                        </div>
                                        <div className="flex items-baseline">
                                            <span className="text-2xl font-bold text-slate-500 mr-1.5 font-mono">₹</span>
                                            <h3 className="text-5xl font-black text-white drop-shadow-lg tracking-tighter">{formatCurrency(totalCost).replace('₹', '').trim()}</h3>
                                        </div>
                                    </div>
                                    <div className="bg-slate-950/60 backdrop-blur-md p-5 rounded-2xl border border-slate-800/80 max-w-[280px]">
                                        <p className="text-xs font-semibold text-slate-300 italic opacity-95 leading-relaxed">
                                            "Experience is the name everyone gives to their mistakes."
                                            <span className="block mt-2 text-[10px] text-slate-500 not-italic uppercase font-black tracking-widest">Oscar Wilde</span>
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-800 shadow-xl flex flex-col justify-center gap-4 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-3 opacity-5 group-hover:opacity-10 transition-opacity"><Brain size={48} className="text-indigo-400" /></div>
                                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Distribution</h4>
                                <div className="space-y-4 relative z-10">
                                    <div className="flex justify-between items-end">
                                        <div className="flex items-baseline gap-2"><span className="text-xl font-black text-indigo-400">{mistakes.filter(m => m.category === 'TRADING').length}</span><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Trading</span></div>
                                        <div className="flex items-baseline gap-2"><span className="text-xl font-black text-amber-500">{mistakes.filter(m => m.category === 'LIFE').length}</span><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Life</span></div>
                                    </div>
                                    <div className="w-full bg-slate-950/80 rounded-full h-2 flex overflow-hidden border border-slate-800">
                                        <div className="bg-indigo-600 h-full transition-all duration-700" style={{ width: `${(mistakes.filter(m => m.category === 'TRADING').length / (mistakes.length || 1)) * 100}%` }}></div>
                                        <div className="bg-amber-600 h-full transition-all duration-700" style={{ width: `${(mistakes.filter(m => m.category === 'LIFE').length / (mistakes.length || 1)) * 100}%` }}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-slate-900/40 backdrop-blur-xl p-6 rounded-3xl border border-slate-800 shadow-xl flex flex-col justify-center gap-2 group">
                                <h4 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Current Strategy</h4>
                                <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 group-hover:bg-emerald-500/20 transition-colors"><Zap size={20} className="text-emerald-400" /></div>
                                    <div><p className="text-lg font-black text-white italic">Self-Correction</p><p className="text-[10px] font-bold text-slate-500 tracking-wider">Mistake detection active</p></div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-900/20 backdrop-blur-md p-4 rounded-2xl border border-slate-800/60 flex flex-wrap items-center gap-6">
                            <div className="relative group min-w-[300px] flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={16} />
                                <input
                                    type="text"
                                    placeholder="Search the archive of lessons..."
                                    className="w-full bg-slate-950/40 pl-11 pr-4 py-3 rounded-xl border border-slate-800/80 outline-none focus:border-indigo-500/30 transition-all text-sm font-bold text-white placeholder:text-slate-600 tracking-tight"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>

                            <div className="flex items-center gap-6">
                                <div className="flex items-center gap-3">
                                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Filter:</span>
                                    <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800/80 shadow-inner">
                                        {(['ALL', 'TRADING', 'LIFE'] as const).map(cat => (
                                            <button key={cat} onClick={() => setFilterCategory(cat)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all duration-300 ${filterCategory === cat ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'text-slate-500 hover:text-slate-300'}`}>{cat}</button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Sort:</span>
                                    <div className="flex bg-slate-950/60 p-1 rounded-xl border border-slate-800/80 shadow-inner">
                                        <button onClick={() => setSortBy('DATE')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all duration-300 ${sortBy === 'DATE' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>DATE</button>
                                        <button onClick={() => setSortBy('COST')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all duration-300 ${sortBy === 'COST' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>COST</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="flex items-center gap-4 mb-2">
                                {selectedMistake && (
                                    <button onClick={() => setSelectedMistake(null)} aria-label="Back to lesson archive" className="p-2 hover:bg-slate-800 text-slate-500 hover:text-white rounded-xl transition-all border border-transparent hover:border-slate-700"><ArrowLeft size={20} /></button>
                                )}
                                <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20"><BookOpen className="text-indigo-400" size={18} /></div>
                                <h3 className="font-black text-xl text-white tracking-tight">{selectedMistake ? 'Reflection Detail' : 'Lesson Archive'}</h3>
                                {!selectedMistake && <span className="bg-slate-800 text-indigo-400 text-[10px] font-black px-3 py-1 rounded-full border border-slate-700">{filteredMistakes.length} RECORDED</span>}
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                                {mistakes.length === 0 ? (
                                    <div className="xl:col-span-2 text-center py-24 border border-dashed border-slate-700/50 rounded-[2.5rem] bg-slate-900/20 relative overflow-hidden group">
                                        <Brain size={80} className="mx-auto text-slate-800 mb-6 group-hover:scale-110 transition-transform duration-700 group-hover:text-indigo-500/20" />
                                        <p className="text-white font-black text-2xl mb-2">No mistakes logged yet.</p>
                                        <p className="text-sm text-slate-500 font-medium">Be humble. Log your first mistake to start learning.</p>
                                        <button onClick={() => setView('new')} className="mt-8 px-8 py-3 bg-white text-slate-900 font-black rounded-xl hover:scale-105 transition-all shadow-xl">Start Reflecting</button>
                                    </div>
                                ) : filteredMistakes.length === 0 ? (
                                    <EmptyState
                                        variant="card"
                                        type="no-results"
                                        message="No results matching your filters."
                                        actionLabel="Reset Filters"
                                        onAction={() => { setSearchTerm(''); setFilterCategory('ALL'); }}
                                        icon={Search}
                                    />
                                ) : selectedMistake ? (
                                    <div className="xl:col-span-2 grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-right-4 duration-500">
                                        <div className="lg:col-span-2 space-y-6">
                                            {/* MAIN LESSON: THE GOLD EXTRACT */}
                                            <div className="bg-slate-900/60 backdrop-blur-xl p-8 rounded-[2.5rem] border border-slate-800/80 shadow-2xl relative overflow-hidden">
                                                <div className="absolute top-0 right-0 p-6 opacity-30 text-right">
                                                    <Calendar size={20} className="text-slate-700 ml-auto" />
                                                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mt-1">{selectedMistake.date}</p>
                                                </div>
                                                <div className="flex items-center gap-3 mb-4">
                                                    <span className={`px-4 py-1 rounded-lg text-[9px] font-black uppercase border ${selectedMistake.category === 'TRADING' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
                                                        {selectedMistake.category} Reflection
                                                    </span>
                                                    {selectedMistake.emotionalState && (
                                                        <span className="px-4 py-1 rounded-lg text-[9px] font-black uppercase border bg-rose-500/10 border-rose-500/30 text-rose-400 flex items-center gap-2">
                                                            <Brain size={12} /> {selectedMistake.emotionalState}
                                                        </span>
                                                    )}
                                                </div>
                                                <h3 className="text-4xl font-black text-white mb-8 leading-tight pr-20 tracking-tight">{selectedMistake.title}</h3>
                                                
                                                <div className="space-y-6">
                                                    <div className="p-6 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl relative group">
                                                        <div className="absolute -top-3 left-6 px-3 py-1 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg shadow-lg">The Golden Extract</div>
                                                        <p className="text-emerald-50 text-xl font-bold leading-relaxed italic">"{selectedMistake.lesson}"</p>
                                                    </div>

                                                    {selectedMistake.describeContext && (
                                                        <div className="p-6 bg-slate-950/50 border border-slate-800 rounded-2xl relative group">
                                                            <div className="absolute -top-3 left-6 px-3 py-1 bg-slate-700 text-slate-300 text-[9px] font-black uppercase tracking-widest rounded-lg border border-slate-600">Situational Context</div>
                                                            <p className="text-slate-300 text-base font-medium leading-relaxed whitespace-pre-wrap">{selectedMistake.describeContext}</p>
                                                        </div>
                                                    )}
                                                </div>

                                                {selectedMistake.tags && selectedMistake.tags.length > 0 && (
                                                    <div className="mt-8 pt-6 border-t border-slate-800/50 flex flex-wrap gap-2">
                                                        {selectedMistake.tags.map(tag => (
                                                            <span key={tag} className="px-3 py-1.5 bg-slate-950/80 text-slate-500 text-[9px] font-black rounded-xl border border-slate-800 uppercase hover:border-indigo-500/30 transition-colors">
                                                                #{tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* AI SYNTHESIS */}
                                            {selectedMistake.summary && (
                                                <div className="bg-gradient-to-br from-indigo-900/20 to-slate-900/40 backdrop-blur-xl p-8 rounded-[2.5rem] border border-indigo-500/10 shadow-xl relative group">
                                                    <div className="flex items-center gap-3 mb-4">
                                                        <div className="p-2 bg-indigo-500/20 rounded-xl"><Brain size={20} className="text-indigo-400" /></div>
                                                        <h4 className="text-sm font-black text-white uppercase tracking-widest">AI Behavioral Synthesis</h4>
                                                    </div>
                                                    <p className="text-slate-300 text-base font-medium leading-relaxed">{selectedMistake.summary}</p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-8">
                                            <div className="bg-emerald-950/10 backdrop-blur-xl p-8 rounded-[2.5rem] border border-emerald-500/10 shadow-xl min-h-[300px]">
                                                <div className="flex items-center gap-3 mb-8"><div className="p-2 bg-emerald-500/20 rounded-xl"><Target size={20} className="text-emerald-400" /></div><h4 className="text-sm font-black text-white uppercase tracking-widest">Action Items</h4></div>
                                                <ul className="space-y-6">
                                                    {selectedMistake.actionItems?.map((item, i) => (
                                                        <li key={i} className="flex items-start gap-4 group/item"><div className="mt-1.5 size-2.5 bg-emerald-50 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.8)]"></div><p className="text-slate-300 text-sm font-bold">{item}</p></li>
                                                    )) || <p className="text-slate-600 text-xs italic">No specific action items extracted.</p>}
                                                </ul>
                                            </div>
                                            <div className="bg-slate-900/40 backdrop-blur-xl p-8 rounded-[2.5rem] border border-slate-800 shadow-xl">
                                                <div className="space-y-6">
                                                    <div><p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3">Tuition Cost</p><div className="flex items-baseline gap-2"><span className="text-sm font-black text-rose-500">₹</span><span className="text-3xl font-black text-white">{formatCurrency(selectedMistake.cost).replace('₹', '').trim()}</span></div></div>
                                                    <div className="pt-6 border-t border-slate-800"><button onClick={() => handleEdit(selectedMistake)} className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white font-black text-xs rounded-xl transition-all flex items-center justify-center gap-2"><Pencil size={14} /> Update Reflection</button></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    filteredMistakes.map((mistake: Mistake, index: number) => (
                                        <div key={mistake.id} onClick={() => setSelectedMistake(mistake)} className="group relative bg-slate-900/40 backdrop-blur-xl p-8 rounded-[2rem] border border-slate-800/80 shadow-xl hover:bg-slate-900/60 hover:border-indigo-500/40 transition-all duration-300 cursor-pointer">
                                            <div className="flex justify-between items-center mb-6">
                                                <div className="flex items-center gap-3"><span className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase border ${mistake.category === 'TRADING' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>{mistake.category}</span><span className="text-[10px] font-black text-slate-600 uppercase">{mistake.date}</span></div>
                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100"><button onClick={(e) => { e.stopPropagation(); handleEdit(mistake); }} className="p-2 text-slate-500 hover:text-white rounded-lg"><Pencil size={14} /></button><button onClick={(e) => { e.stopPropagation(); handleDelete(e, mistake.id); }} className="p-2 text-slate-500 hover:text-rose-500 rounded-lg"><Trash2 size={14} /></button></div>
                                            </div>
                                            <h4 className="text-xl font-black text-white mb-2 group-hover:text-indigo-400 transition-colors line-clamp-1">{mistake.title}</h4>
                                            <p className="text-slate-400 text-xs font-medium italic line-clamp-2 mb-6">{mistake.summary || mistake.lesson}</p>
                                            <div className="flex items-center justify-between mt-auto pt-6 border-t border-slate-800/50">
                                                <div className="flex flex-wrap gap-2">{mistake.tags?.slice(0, 3).map((tag: string) => (<span key={tag} className="px-2.5 py-1 bg-slate-950/60 text-slate-500 text-[8px] font-black rounded-lg border border-slate-800 uppercase">#{tag}</span>))}</div>
                                                <div className="flex items-baseline gap-1"><span className="text-[10px] font-black text-rose-500/60 font-mono">₹</span><span className="text-sm font-black text-white font-mono">{formatCurrency(mistake.cost).replace('₹', '').trim()}</span></div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {view === 'rules' ? (
                            <div className="max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-500">
                                <div className="bg-slate-900/40 backdrop-blur-2xl rounded-[2.5rem] border border-slate-800 p-8 shadow-2xl">
                                    <div className="flex items-center gap-4 mb-8">
                                        <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400"><ShieldAlert size={24} /></div>
                                        <div><h3 className="text-2xl font-black text-white tracking-tight">The Guardian Protocol</h3><p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Trading Rules & Personal Laws</p></div>
                                    </div>
                                    <div className="space-y-6">
                                        <div className="relative group">
                                            <textarea value={ruleText} onChange={e => setRuleText(e.target.value)} placeholder="Type your rule here..." className="w-full bg-slate-950/60 p-5 rounded-2xl border border-slate-800 outline-none focus:border-indigo-500/50 min-h-[100px] resize-none text-white text-base font-medium shadow-inner" />
                                            <button onClick={handleAddRule} disabled={!ruleText.trim()} className="absolute bottom-4 right-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white p-3 rounded-xl transition-all flex items-center gap-2 group/btn"><Plus size={18} /><span className="text-xs font-black">ADD RULE</span></button>
                                        </div>
                                        <div className="space-y-4 pt-4">
                                            <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-4">ACTIVE RULES ({rules.filter(r => r.isActive).length})</h4>
                                            <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-3">
                                                {rules.map((rule) => (
                                                    <div key={rule.id} className={`group flex items-start gap-4 p-5 rounded-2xl border transition-all ${rule.isActive ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-950/30 border-transparent opacity-60'}`}>
                                                        <button onClick={() => toggleRuleStatus(rule.id, rule.isActive)} className={`mt-1 size-5 rounded-md border flex items-center justify-center ${rule.isActive ? 'bg-indigo-500 border-indigo-400 shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'border-slate-700'}`}>{rule.isActive && <Zap size={10} className="text-white fill-white" />}</button>
                                                        <div className="flex-1"><p className={`text-sm font-bold ${rule.isActive ? 'text-slate-200' : 'text-slate-500 line-through'}`}>{rule.text}</p><div className="flex items-center gap-3 mt-3"><span className="text-[9px] font-black text-slate-700 uppercase">{rule.date}</span><button onClick={() => deleteRule(rule.id)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-700 hover:text-rose-500"><Trash2 size={12} /></button></div></div>
                                                    </div>
                                                ))}
                                                {rules.length === 0 && <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl"><ShieldAlert size={32} className="mx-auto text-slate-800 mb-3" /><p className="text-xs font-black text-slate-600 uppercase">Your Guardian Protocol is empty.</p></div>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-500">
                                <div className="relative bg-slate-900/40 backdrop-blur-2xl rounded-[2rem] shadow-2xl border border-slate-800 p-6 overflow-hidden group">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none z-0"></div>
                                    <div className="relative z-10">
                                        {showPrefillBanner && (
                                            <div className="mb-5 flex items-start gap-3 p-4 rounded-2xl bg-gradient-to-r from-rose-500/10 to-indigo-500/10 border border-rose-500/20 animate-in fade-in slide-in-from-top-3 duration-500">
                                                <ShieldAlert size={18} className="text-rose-400 mt-0.5 shrink-0" />
                                                <div className="flex-1">
                                                    <p className="text-xs font-black text-white uppercase tracking-widest">Extracted from Trading Journal</p>
                                                    <p className="text-[10px] text-slate-400 mt-1">Core lesson &amp; emotional context have been auto-filled. Review and enrich before committing.</p>
                                                </div>
                                                <button onClick={() => setShowPrefillBanner(false)} aria-label="Dismiss pre-fill banner" className="text-slate-600 hover:text-slate-400 transition-colors p-0.5">✕</button>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between mb-6 border-b border-slate-800/50 pb-4"><div className="flex items-center gap-3"><h3 className="font-black text-xl text-white tracking-tight">{editId ? 'Edit Reflection' : 'New Reflection'}</h3></div><ShieldAlert className="text-indigo-500/30" size={24} /></div>
                                        <div className="space-y-6">
                                            <div className="group/input">
                                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Main Heading</label>
                                                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. FOMO into high volatility breakout" className="w-full bg-slate-950/50 p-4 rounded-xl border border-slate-800 outline-none focus:border-indigo-500 transition-all font-black text-lg text-white" autoFocus />
                                            </div>
                                            <div className="group/input">
                                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Describe Context</label>
                                                <textarea value={describeContext} onChange={e => setDescribeContext(e.target.value)} placeholder="Detailed situational notes..." className="w-full bg-slate-950/50 p-4 rounded-xl border border-slate-800 outline-none focus:border-indigo-500 transition-all text-sm text-white min-h-[100px] resize-none" />
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="group/cost"><label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Financial Loss</label><div className="relative"><div className="absolute left-4 top-1/2 -translate-y-1/2 text-rose-500 font-bold text-lg">₹</div><input type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder="0" className="w-full bg-slate-950/50 p-4 pl-10 rounded-xl border border-slate-800 outline-none focus:border-rose-500 transition-all font-mono text-lg text-white shadow-inner" /></div></div>
                                                <div><label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Category Domain</label><div className="grid grid-cols-2 bg-slate-950/50 p-1 rounded-2xl border border-slate-800 relative z-10"><button onClick={() => setCategory('TRADING')} className={`relative rounded-xl py-2.5 text-[11px] font-black transition-all ${category === 'TRADING' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>{category === 'TRADING' && <div className="absolute inset-0 bg-indigo-600 rounded-xl -z-10 shadow-lg"></div>}<Target size={14} className="inline mr-1" /> Trade</button><button onClick={() => setCategory('LIFE')} className={`relative rounded-xl py-2.5 text-[11px] font-black transition-all ${category === 'LIFE' ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>{category === 'LIFE' && <div className="absolute inset-0 bg-amber-600 rounded-xl -z-10 shadow-lg"></div>}<TrendingDown size={14} className="inline mr-1" /> Life</button></div></div>
                                            </div>
                                            <div className="group/state"><label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Emotional Context</label><input value={emotionalState} onChange={e => setEmotionalState(e.target.value)} placeholder="Greedy, Tired, Euphoric..." className="w-full bg-slate-950/50 p-4 rounded-xl border border-slate-800 outline-none text-sm text-white shadow-inner" /></div>
                                            <div className="group/lesson relative"><label className="block text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-2"><Brain size={14} /> The Gold Extract</label><textarea value={lesson} onChange={e => setLesson(e.target.value)} placeholder="What did you learn?" className="w-full bg-slate-950/80 p-5 rounded-2xl border border-emerald-500/20 outline-none focus:border-emerald-500 min-h-[140px] resize-none text-emerald-50 text-base leading-relaxed" /></div>
                                            <button onClick={handleSubmit} className="relative w-full py-4 rounded-xl font-black text-base text-white overflow-hidden group/submit shadow-xl transition-all active:scale-[0.98] disabled:cursor-not-allowed" disabled={!title || !lesson || isAnalyzing}>
                                                <div className={`absolute inset-0 transition-opacity duration-300 ${(!title || !lesson || isAnalyzing) ? 'bg-slate-800 opacity-100' : 'bg-gradient-to-r from-indigo-600 to-violet-600 opacity-100 group-hover/submit:opacity-90'}`}></div>
                                                <span className="relative flex items-center justify-center gap-2">
                                                    {isAnalyzing ? (<><div className="size-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>AI Analyzing...</>) : (<>{editId ? 'Update Archive' : 'Commit Lesson'} <Zap size={16} className={!title || !lesson ? 'text-slate-600' : 'text-amber-300 animate-pulse'} /></>)}
                                                </span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default React.memo(MistakesReflector);
