
import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Star, ChevronRight, Zap } from 'lucide-react';
import { useMasteryStore } from '../../store/masteryStore';
import { useNavigate } from 'react-router-dom';

export const MasteryOverviewWidget: React.FC = () => {
    const { skillTrees, refreshMastery, totalMasteryXp, dailyMissions } = useMasteryStore();
    const navigate = useNavigate();

    useEffect(() => {
        refreshMastery();
    }, []);

    const activeMissions = dailyMissions.filter(m => !m.isCompleted).length;
    const avgProgress = skillTrees.length > 0 
        ? skillTrees.reduce((acc, tree) => acc + tree.progress, 0) / skillTrees.length 
        : 0;

    return (
        <motion.div 
            whileHover={{ y: -4 }}
            onClick={() => navigate('/mastery')}
            className="p-6 bg-slate-900/50 border border-slate-800 rounded-3xl cursor-pointer group relative overflow-hidden h-full"
        >
            <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-indigo-500/10 rounded-lg">
                        <Trophy className="w-4 h-4 text-indigo-400" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Mastery Level</span>
                </div>
                <div className="p-1.5 bg-slate-800 rounded-lg group-hover:bg-indigo-500/20 transition-colors">
                    <ChevronRight className="w-3 h-3 text-slate-500 group-hover:text-indigo-400" />
                </div>
            </div>

            <div className="space-y-6">
                <div>
                    <div className="flex justify-between items-end mb-2">
                        <span className="text-3xl font-black tracking-tighter uppercase italic">Legendary</span>
                        <span className="text-xs font-bold text-indigo-400 font-mono">{totalMasteryXp.toLocaleString()} XP</span>
                    </div>
                    <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${avgProgress}%` }}
                            className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-800/40 rounded-2xl border border-white/5">
                        <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Active Missions</span>
                        <div className="flex items-center gap-2">
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                            <span className="text-sm font-black">{activeMissions} Pending</span>
                        </div>
                    </div>
                    <div className="p-3 bg-slate-800/40 rounded-2xl border border-white/5">
                        <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Skill Paths</span>
                        <div className="flex items-center gap-2">
                            <Zap className="w-3 h-3 text-indigo-400" />
                            <span className="text-sm font-black">6 Paths</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800/50 flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                <span>Next Milestone in 2,450 XP</span>
                <span className="text-indigo-400">View Progress</span>
            </div>

            {/* Background Decoration */}
            <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-indigo-500/5 blur-3xl rounded-full" />
        </motion.div>
    );
};

export default MasteryOverviewWidget;
