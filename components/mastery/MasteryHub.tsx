
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Target, 
    Layout, 
    Zap, 
    Shield, 
    BookOpen, 
    Eye, 
    Trophy, 
    Award, 
    ChevronRight, 
    Clock, 
    Users, 
    TrendingUp, 
    User,
    Sparkles,
    Loader2,
    Lock
} from 'lucide-react';
import { useMasteryStore } from '../../store/masteryStore';
import { socialBenchmarkService, BenchmarkData } from '../../services/SocialBenchmarkService';
import { usePortfolioStore } from '../../store/portfolioStore';
import { XPCelebration } from './XPCelebration';
import MarkdownRenderer from '../ai/MarkdownRenderer';
import { llmPipeline } from '../../services/llm';
import { COPY } from '../../utils/appCopy';

const ICON_MAP: any = {
    Target: Target,
    Layout: Layout,
    Zap: Zap,
    Shield: Shield,
    BookOpen: BookOpen,
    Eye: Eye
};

export const MasteryHub: React.FC = () => {
    const { skillTrees, achievements, dailyMissions, refreshMastery, completeMission, totalMasteryXp } = useMasteryStore();
    const investments = usePortfolioStore(s => s.investments);
    const stats = usePortfolioStore(s => s.stats);
    const [benchmarks, setBenchmarks] = useState<BenchmarkData[]>([]);
    const [personality, setPersonality] = useState<string | null>(null);
    const [isPersonalityLoading, setIsPersonalityLoading] = useState(false);
    const [activeTree, setActiveTree] = useState<string | null>(null);

    useEffect(() => {
        refreshMastery();
        fetchBenchmarks();
    }, []);

    const fetchBenchmarks = async () => {
        const data = await socialBenchmarkService.getBenchmarks({
            xirr: parseFloat(stats?.totalGainPercent || '0'),
            winRate: 45, // In real impl, calc from trades
            diversification: new Set(investments.map(i => i.sector)).size
        });
        setBenchmarks(data);
    };

    const generatePersonality = async () => {
        setIsPersonalityLoading(true);
        const prompt = `Analyze this investor's profile and generate a 2-paragraph personality assessment.
        Stats: XIRR ${stats?.totalGainPercent}%, ${investments.length} holdings.
        Goal: Categorize into one of 8 archetypes (Value Hunter, Momentum Rider, etc.) and explain strengths/blind spots.
        Return in Markdown.`;

        try {
            const res = await llmPipeline(prompt, { modelOverride: 'gemini-3-flash-preview' });
            setPersonality(res.text);
        } catch (e) {
            setPersonality("The Oracle is gathering data on your behavior. Check back after logging more trades.");
        } finally {
            setIsPersonalityLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-8 font-sans">
            <XPCelebration />
            
            {/* Header */}
            <header className="mb-12 flex justify-between items-end">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                            <Trophy className="w-8 h-8 text-indigo-400" />
                        </div>
                        <h1 className="text-4xl font-black tracking-tighter uppercase italic">Mastery <span className="text-slate-500 text-2xl not-italic">Hub</span></h1>
                    </div>
                    <p className="text-slate-500 text-sm font-bold tracking-widest uppercase">Elite Financial Progression System</p>
                </div>
                <div className="text-right">
                    <span className="block text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Global Mastery XP</span>
                    <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400 font-mono">
                        {totalMasteryXp.toLocaleString()}
                    </span>
                </div>
            </header>

            <div className="grid grid-cols-12 gap-8">
                
                {/* Left: Skill Trees */}
                <div className="col-span-8 space-y-8">
                    <section>
                        <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Zap className="w-4 h-4 text-amber-400" /> Skill Path Mastery
                        </h2>
                        <div className="grid grid-cols-3 gap-4">
                            {skillTrees.map(tree => {
                                const Icon = ICON_MAP[tree.icon] || Zap;
                                return (
                                    <motion.div
                                        key={tree.id}
                                        whileHover={{ y: -4 }}
                                        onClick={() => setActiveTree(tree.id)}
                                        className="p-6 bg-slate-900/40 border border-slate-800 rounded-3xl cursor-pointer group relative overflow-hidden"
                                    >
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="p-3 bg-indigo-500/10 rounded-xl group-hover:bg-indigo-500/20 transition-colors">
                                                <Icon className="w-6 h-6 text-indigo-400" />
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{tree.level}</span>
                                            </div>
                                        </div>
                                        <h3 className="font-black text-lg mb-1">{tree.name}</h3>
                                        <p className="text-[10px] text-slate-500 font-bold uppercase mb-4 leading-tight">{tree.description}</p>
                                        
                                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <motion.div 
                                                initial={{ width: 0 }}
                                                animate={{ width: `${tree.progress}%` }}
                                                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500"
                                            />
                                        </div>
                                        
                                        <div className="mt-4 flex justify-between items-center text-[10px] font-black text-slate-500">
                                            <span>{tree.xp} / {tree.nextLevelXp} XP</span>
                                            <span>{tree.progress.toFixed(0)}%</span>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </section>

                    <section>
                        <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Award className="w-4 h-4 text-emerald-400" /> Achievement Gallery
                        </h2>
                        {achievements.length === 0 ? (
                            <div className="p-12 border-2 border-dashed border-slate-800 rounded-[2.5rem] text-center bg-slate-900/20">
                                <div className="mb-6 flex justify-center text-slate-600">
                                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                                        <path d="M12 8V12L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </div>
                                <h4 className="text-lg font-black uppercase tracking-tighter text-slate-400 mb-2">No Accolades Yet</h4>
                                <p className="text-sm font-bold text-slate-600 uppercase tracking-widest leading-relaxed max-w-xs mx-auto">
                                    {COPY.empty.noAchievements}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-4 gap-4">
                                {achievements.map(ach => (
                                    <div 
                                        key={ach.id}
                                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center text-center ${
                                            ach.isUnlocked 
                                            ? 'bg-slate-900/60 border-indigo-500/30' 
                                            : 'bg-slate-900/20 border-slate-800 opacity-50 grayscale'
                                        }`}
                                    >
                                        <div className={`p-3 rounded-xl mb-3 ${ach.isUnlocked ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-600'}`}>
                                            <Award className="w-6 h-6" />
                                        </div>
                                        <h4 className="font-bold text-xs mb-1">{ach.title}</h4>
                                        <p className="text-[9px] text-slate-500 font-medium leading-tight">{ach.description}</p>
                                        {!ach.isUnlocked && (
                                            <div className="mt-2 text-[8px] font-black text-slate-600 uppercase tracking-tighter">Locked</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>

                {/* Right: Missions & Benchmarks */}
                <div className="col-span-4 space-y-8">
                    <section className="p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-3xl relative overflow-hidden">
                        <div className="flex items-center gap-2 mb-6">
                            <Clock className="w-4 h-4 text-indigo-400" />
                            <h2 className="text-xs font-black text-indigo-400 uppercase tracking-widest">Active Missions</h2>
                        </div>
                        <div className="space-y-4">
                            {dailyMissions.map(mission => (
                                <div key={mission.id} className="p-4 bg-slate-900/50 border border-slate-800 rounded-2xl hover:border-slate-700 transition-all">
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-sm text-slate-200">{mission.title}</h4>
                                        <span className="text-[10px] font-black text-emerald-400">+{mission.rewardXp} XP</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 mb-3">{mission.description}</p>
                                    <button 
                                        onClick={() => completeMission(mission.id)}
                                        disabled={mission.isCompleted}
                                        className={`w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                                            mission.isCompleted 
                                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' 
                                            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)]'
                                        }`}
                                    >
                                        {mission.isCompleted ? 'Completed' : 'Claim Reward'}
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 blur-3xl rounded-full -mr-16 -mt-16" />
                    </section>

                    <section className="p-6 bg-slate-900/30 border border-slate-800 rounded-3xl">
                        <div className="flex items-center gap-2 mb-6">
                            <Users className="w-4 h-4 text-slate-400" />
                            <h2 className="text-xs font-black text-slate-500 uppercase tracking-widest">Community Benchmarks</h2>
                        </div>
                        <div className="space-y-6">
                            {benchmarks.map((bench, i) => (
                                <div key={i}>
                                    <div className="flex justify-between items-end mb-2">
                                        <span className="text-[10px] font-black text-slate-400 uppercase">{bench.category}</span>
                                        <span className="text-xs font-bold text-emerald-400">{bench.percentile}th Percentile</span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-800 rounded-full relative">
                                        <div 
                                            className="absolute top-0 bottom-0 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-1000"
                                            style={{ width: `${bench.percentile}%` }}
                                        />
                                        {/* Average marker */}
                                        <div 
                                            className="absolute top-[-4px] bottom-[-4px] w-0.5 bg-slate-600 z-10"
                                            style={{ left: '50%' }}
                                        />
                                    </div>
                                    <p className="text-[9px] text-slate-600 mt-2 font-medium italic">"You are outperforming {bench.percentile}% of retail investors in this category."</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-[8px] text-slate-700 mt-6 text-center uppercase font-black">Data based on simulated retail distribution</p>
                    </section>

                    <section className="p-6 bg-gradient-to-br from-slate-900 to-indigo-900/20 border border-indigo-500/20 rounded-3xl">
                        <div className="flex items-center gap-2 mb-4">
                            <User className="w-4 h-4 text-indigo-400" />
                            <h2 className="text-xs font-black text-indigo-400 uppercase tracking-widest">Investor Personality</h2>
                        </div>
                        
                        {!personality ? (
                            <button 
                                onClick={generatePersonality}
                                disabled={isPersonalityLoading}
                                className="w-full p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center gap-3 hover:bg-indigo-500/20 transition-all group"
                            >
                                {isPersonalityLoading ? <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" /> : <Sparkles className="w-4 h-4 text-indigo-400 group-hover:scale-125 transition-transform" />}
                                <span className="text-xs font-black text-indigo-300 uppercase tracking-widest">Reveal My Archetype</span>
                            </button>
                        ) : (
                            <div className="prose prose-invert prose-xs">
                                <MarkdownRenderer content={personality} />
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {/* Tree Detail Modal Overlay */}
            <AnimatePresence>
                {activeTree && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setActiveTree(null)}
                        className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-50 flex items-center justify-center p-8"
                    >
                        <motion.div 
                            initial={{ scale: 0.9, y: 20 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.9, y: 20 }}
                            onClick={e => e.stopPropagation()}
                            className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-[40px] p-10 relative overflow-hidden"
                        >
                            {/* Modal Content */}
                            <div className="relative z-10">
                                <h2 className="text-4xl font-black italic tracking-tighter uppercase mb-2">
                                    Path of the <span className="text-indigo-400">{skillTrees.find(t => t.id === activeTree)?.name}</span>
                                </h2>
                                <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mb-10">Ascend to Financial Sovereignty</p>
                                
                                <div className="space-y-6">
                                    {['Novice', 'Apprentice', 'Expert', 'Master', 'Legend'].map((lvl, i) => {
                                        const currentLvl = skillTrees.find(t => t.id === activeTree)?.level;
                                        const isReached = ['Novice', 'Apprentice', 'Expert', 'Master', 'Legend'].indexOf(lvl) <= ['Novice', 'Apprentice', 'Expert', 'Master', 'Legend'].indexOf(currentLvl || 'Novice');
                                        
                                        return (
                                            <div key={lvl} className={`flex items-center gap-6 p-4 rounded-2xl border transition-all ${isReached ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-slate-950/40 border-slate-800 opacity-40'}`}>
                                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black ${isReached ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-600'}`}>
                                                    {i + 1}
                                                </div>
                                                <div>
                                                    <h4 className={`font-black uppercase tracking-wider ${isReached ? 'text-indigo-200' : 'text-slate-600'}`}>{lvl}</h4>
                                                    <p className="text-[10px] text-slate-500 font-bold uppercase">Requirement: {i * 10}+ Successful Actions</p>
                                                </div>
                                                {isReached && <div className="ml-auto p-1.5 bg-emerald-500/20 rounded-lg"><Zap className="w-4 h-4 text-emerald-400" /></div>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Background Decoration */}
                            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[120px] rounded-full -mr-32 -mt-32" />
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MasteryHub;
