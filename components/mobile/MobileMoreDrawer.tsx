import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence, useDragControls, PanInfo } from 'framer-motion';
import {
    X, Search, Rocket, BookOpen, Zap, Target, FlaskConical,
    Calculator, Shield, Beaker, Eye, Wrench, Settings,
    Activity, MessageSquare, TrendingUp, Grid
} from 'lucide-react';

interface MobileMoreDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    activeCategory: string;
    onNavigate: (category: string) => void;
}

interface DrawerModule {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    category: 'trading' | 'markets' | 'wealth' | 'system';
    description?: string;
}

const ALL_MODULES: DrawerModule[] = [
    // ⚡ Trading & Execution
    { id: 'signals', label: 'Signal Intel', icon: Activity, color: 'text-amber-400 bg-amber-500/10', category: 'trading', description: 'Real-time quant algo triggers' },
    { id: 'telegram', label: 'Telegram Intel', icon: MessageSquare, color: 'text-sky-400 bg-sky-500/10', category: 'trading', description: 'Live channel signal harvester' },
    { id: 'tradefinder', label: 'TradeFinder', icon: TrendingUp, color: 'text-emerald-400 bg-emerald-500/10', category: 'trading', description: 'Pattern scanner & screener' },
    { id: 'backtester', label: 'Strategy Lab', icon: Beaker, color: 'text-orange-400 bg-orange-500/10', category: 'trading', description: 'Apex quantitative backtester' },
    { id: 'pool', label: 'Momentum Pool', icon: Eye, color: 'text-violet-400 bg-violet-500/10', category: 'trading', description: 'Breakout & volume radar' },

    // 📊 Markets & Intelligence
    { id: 'ipo', label: 'IPO War Room', icon: Rocket, color: 'text-rose-400 bg-rose-500/10', category: 'markets', description: 'GMP tracker & allotment status' },
    { id: 'launchpad', label: 'Launchpad', icon: Grid, color: 'text-pink-400 bg-pink-500/10', category: 'markets', description: 'Curated financial tools portal' },
    { id: 'analytics', label: 'Analytics Center', icon: Calculator, color: 'text-purple-400 bg-purple-500/10', category: 'markets', description: 'Deep quant & math lab' },
    { id: 'journal', label: 'Psych Dashboard', icon: BookOpen, color: 'text-yellow-400 bg-yellow-500/10', category: 'markets', description: 'Behavioral trade journal' },

    // 💼 Wealth & Growth
    { id: 'planning', label: 'Goal GPS', icon: Target, color: 'text-cyan-400 bg-cyan-500/10', category: 'wealth', description: 'Retirement & FIRE simulations' },
    { id: 'growth', label: 'Growth Engine', icon: Zap, color: 'text-teal-400 bg-teal-500/10', category: 'wealth', description: 'Alpha Predator compounding' },
    { id: 'innovation', label: 'Moonshot Lab', icon: FlaskConical, color: 'text-indigo-400 bg-indigo-500/10', category: 'wealth', description: 'AI boardroom & asymmetric bets' },

    // 🛡️ Security & System
    { id: 'fortress', label: 'The Fortress', icon: Shield, color: 'text-blue-400 bg-blue-500/10', category: 'system', description: 'Dead man switch & lockbox' },
    { id: 'tools', label: 'Advanced Tools', icon: Wrench, color: 'text-indigo-300 bg-indigo-500/10', category: 'system', description: 'Sector rotation & utilities' },
    { id: 'settings', label: 'Settings', icon: Settings, color: 'text-slate-400 bg-slate-500/10', category: 'system', description: 'Preferences & themes' }
];

const CATEGORY_TABS = [
    { id: 'all', label: 'All' },
    { id: 'trading', label: 'Trading' },
    { id: 'markets', label: 'Markets' },
    { id: 'wealth', label: 'Wealth' },
    { id: 'system', label: 'System' }
];

export const MobileMoreDrawer: React.FC<MobileMoreDrawerProps> = ({
    isOpen,
    onClose,
    activeCategory,
    onNavigate
}) => {
    const dragControls = useDragControls();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');

    const haptic = (ms: number = 8) => {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(ms); } catch { /* unsupported */ }
        }
    };

    const handleDragEnd = (_: unknown, info: PanInfo) => {
        if (info.offset.y > 120 || info.velocity.y > 800) {
            haptic(14);
            onClose();
        }
    };

    const filteredModules = useMemo(() => {
        return ALL_MODULES.filter(item => {
            const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
            const matchesSearch = searchQuery.trim() === '' ||
                item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));
            return matchesCategory && matchesSearch;
        });
    }, [searchQuery, selectedCategory]);

    const groupedSections = useMemo(() => {
        if (searchQuery.trim() !== '' || selectedCategory !== 'all') {
            return [{ title: 'Matching Modules', items: filteredModules }];
        }
        return [
            { title: '⚡ Trading & Execution', items: ALL_MODULES.filter(m => m.category === 'trading') },
            { title: '📊 Markets & Intelligence', items: ALL_MODULES.filter(m => m.category === 'markets') },
            { title: '💼 Wealth Planning', items: ALL_MODULES.filter(m => m.category === 'wealth') },
            { title: '🛡️ Security & System', items: ALL_MODULES.filter(m => m.category === 'system') }
        ];
    }, [filteredModules, searchQuery, selectedCategory]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop Overlay */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[150]"
                    />

                    {/* Bottom Drawer Content */}
                    <motion.div
                        role="dialog"
                        aria-label="All modules drawer"
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                        drag="y"
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.5 }}
                        onDragEnd={handleDragEnd}
                        className="fixed bottom-0 left-0 right-0 max-h-[88vh] bg-slate-900/95 backdrop-blur-2xl border-t border-slate-800/80 rounded-t-[32px] p-5 z-[160] overflow-y-auto pb-safe shadow-2xl no-scrollbar"
                    >
                        {/* Drag/Close Handle Indicator */}
                        <div
                            className="w-12 h-1.5 bg-slate-700/60 rounded-full mx-auto mb-4 cursor-grab active:cursor-grabbing touch-none"
                            onPointerDown={(e) => dragControls.start(e)}
                            onClick={onClose}
                        />

                        {/* Drawer Header */}
                        <div
                            className="flex items-center justify-between mb-4 touch-none cursor-grab active:cursor-grabbing"
                            onPointerDown={(e) => dragControls.start(e)}
                        >
                            <div>
                                <h3 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                                    <span>All Modules</span>
                                    <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full font-mono font-medium">
                                        {ALL_MODULES.length} Workspaces
                                    </span>
                                </h3>
                                <p className="text-[11px] text-slate-400 mt-0.5">Explore institutional-grade quantitative tooling</p>
                            </div>
                            <button
                                onClick={onClose}
                                onPointerDown={(e) => e.stopPropagation()}
                                className="p-2 rounded-full bg-slate-800/60 text-slate-400 hover:text-white transition-colors"
                                aria-label="Close drawer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Fast Search Input */}
                        <div className="relative mb-3.5">
                            <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search modules (e.g. Telegram, Signals, IPO)..."
                                className="w-full bg-slate-950/60 border border-slate-800/80 rounded-xl py-2 pl-9 pr-8 text-xs text-white placeholder:text-slate-500 focus:border-indigo-500/60 focus:outline-none transition-all"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-1"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>

                        {/* Category Segment Pills */}
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4 pb-0.5">
                            {CATEGORY_TABS.map(cat => {
                                const isSelected = selectedCategory === cat.id;
                                return (
                                    <button
                                        key={cat.id}
                                        onClick={() => {
                                            haptic(6);
                                            setSelectedCategory(cat.id);
                                        }}
                                        className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 ${
                                            isSelected
                                                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                                                : 'bg-slate-950/40 text-slate-400 hover:text-slate-200 border border-slate-800/60'
                                        }`}
                                    >
                                        {cat.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Categorized Grid Menu */}
                        <div className="space-y-4">
                            {groupedSections.map((section, sIdx) => {
                                if (section.items.length === 0) return null;
                                return (
                                    <div key={section.title || sIdx}>
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 px-0.5 flex items-center justify-between">
                                            <span>{section.title}</span>
                                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-800/60 text-slate-400 rounded-full font-mono">
                                                {section.items.length}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2">
                                            {section.items.map(item => {
                                                const Icon = item.icon;
                                                const isActive = activeCategory === item.id;
                                                return (
                                                    <button
                                                        key={item.id}
                                                        onClick={() => {
                                                             haptic(10);
                                                             onNavigate(item.id);
                                                             onClose();
                                                        }}
                                                        className={`aspect-square flex flex-col items-center justify-center gap-1.5 p-1.5 rounded-xl border transition-all duration-150 ${
                                                            isActive
                                                                ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300 shadow-sm shadow-indigo-500/10'
                                                                : 'bg-slate-950/40 border-slate-800/60 hover:bg-slate-800/30 text-slate-300 active:scale-95'
                                                        }`}
                                                    >
                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.color} border border-white/5 shrink-0`}>
                                                            <Icon className="w-4 h-4" />
                                                        </div>
                                                        <span className="text-[9px] font-semibold text-center leading-[11px] tracking-tight line-clamp-2 w-full text-slate-300 px-0.5">
                                                            {item.label}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Footer Status Summary */}
                        <div className="mt-6 pt-4 border-t border-slate-800/60 flex justify-between items-center text-[10px] text-slate-500 font-medium px-1">
                            <span>WEALTHOS v2.0 • 100% Mobile Parity</span>
                            <div className="flex items-center gap-1.5 bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-full border border-indigo-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                                <span>ALL WORKSPACES ONLINE</span>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
