
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Trophy, Star, Zap, Award } from 'lucide-react';

interface XPPaticle {
    id: number;
    amount: number;
    x: number;
    y: number;
}

export const XPCelebration: React.FC = () => {
    const [particles, setParticles] = useState<XPPaticle[]>([]);
    const [levelup, setLevelup] = useState<{ level: string } | null>(null);
    const [achievement, setAchievement] = useState<{ title: string, icon: string } | null>(null);

    // Global listener for XP events
    useEffect(() => {
        const handleXP = (e: any) => {
            const { amount, x, y } = e.detail;
            const id = Date.now();
            setParticles(prev => [...prev, { id, amount, x: x || window.innerWidth / 2, y: y || window.innerHeight / 2 }]);
            setTimeout(() => setParticles(prev => prev.filter(p => p.id !== id)), 2000);
        };

        const handleLevelUp = (e: any) => {
            const { level } = e.detail;
            setLevelup({ level });
            confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#4f46e5', '#10b981', '#f59e0b']
            });
            setTimeout(() => setLevelup(null), 5000);
        };

        const handleAchievement = (e: any) => {
            const { title, icon } = e.detail;
            setAchievement({ title, icon });
            setTimeout(() => setAchievement(null), 4000);
        };

        window.addEventListener('xp-earned', handleXP);
        window.addEventListener('level-up', handleLevelUp);
        window.addEventListener('achievement-unlocked', handleAchievement);

        return () => {
            window.removeEventListener('xp-earned', handleXP);
            window.removeEventListener('level-up', handleLevelUp);
            window.removeEventListener('achievement-unlocked', handleAchievement);
        };
    }, []);

    return (
        <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
            <AnimatePresence>
                {particles.map(p => (
                    <motion.div
                        key={p.id}
                        initial={{ opacity: 1, y: p.y, x: p.x, scale: 0.5 }}
                        animate={{ opacity: 0, y: p.y - 150, scale: 1.5 }}
                        exit={{ opacity: 0 }}
                        className="absolute text-indigo-400 font-black text-2xl flex items-center gap-1"
                    >
                        <Zap className="w-5 h-5 fill-indigo-400" />
                        +{p.amount} XP
                    </motion.div>
                ))}
            </AnimatePresence>

            <AnimatePresence>
                {levelup && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.1 }}
                        className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-md"
                    >
                        <div className="text-center">
                            <motion.div
                                animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.2, 1] }}
                                transition={{ repeat: Infinity, duration: 2 }}
                                className="w-32 h-32 bg-indigo-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-[0_0_50px_rgba(79,70,229,0.5)]"
                            >
                                <Trophy className="w-16 h-16 text-white" />
                            </motion.div>
                            <h2 className="text-slate-500 font-black tracking-widest uppercase text-sm mb-2">Mastery Increased</h2>
                            <h1 className="text-6xl font-black text-white tracking-tighter uppercase italic">
                                Level <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400">{levelup.level}</span>
                            </h1>
                            <p className="text-slate-400 mt-4 font-medium italic">"Your financial destiny is being rewritten."</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {achievement && (
                    <motion.div
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        className="absolute top-10 right-10 p-1 bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-2xl shadow-2xl"
                    >
                        <div className="bg-slate-900 rounded-xl p-4 flex items-center gap-4 border border-white/5">
                            <div className="p-3 bg-indigo-500/10 rounded-lg">
                                <Award className="w-8 h-8 text-indigo-400" />
                            </div>
                            <div>
                                <span className="block text-[10px] text-slate-500 font-black uppercase tracking-widest">Achievement Unlocked</span>
                                <h3 className="text-white font-bold text-lg">{achievement.title}</h3>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// Helper function to trigger events
export const triggerXP = (amount: number, x?: number, y?: number) => {
    window.dispatchEvent(new CustomEvent('xp-earned', { detail: { amount, x, y } }));
};

export const triggerLevelUp = (level: string) => {
    window.dispatchEvent(new CustomEvent('level-up', { detail: { level } }));
};

export const triggerAchievement = (title: string) => {
    window.dispatchEvent(new CustomEvent('achievement-unlocked', { detail: { title } }));
};
