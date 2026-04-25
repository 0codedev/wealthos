
import React, { useState, useEffect } from 'react';
import { useToast } from '../shared/ToastProvider';
import { motion, AnimatePresence } from 'framer-motion';
import { COPY } from '../../utils/appCopy';
import {
    Book, Video, FileText, AlertTriangle, Brain, Disc, Trophy,
    CheckCircle, Lock, PlayCircle, Star, Search, ChevronRight,
    GraduationCap, Zap, Clock, ShieldAlert, BadgeInfo, Target,
    Plus, Minus, TrendingUp, TrendingDown, RotateCcw, DollarSign, History
} from 'lucide-react';
import { useGamificationStore } from '../../store/gamificationStore';
import { ACADEMY_CURRICULUM, AcademyModule, AcademyItem } from '../../data/AcademyContent';
import confetti from 'canvas-confetti';
import { InteractiveQuiz } from '../academy/InteractiveQuiz';
import TabHero from '../shared/TabHero';
import { SectionHeader, StateSurface } from '../shared/SurfacePrimitives';
import { Investment } from '../../types';
import { db, PaperTrade } from '../../database';

// --- Types ---
interface CompletedItems {
    [id: string]: boolean;
}

const EMPTY_INVESTMENTS: Investment[] = [];

const Academy: React.FC = () => {
    const { toast } = useToast();
    const { xp, level, addXp } = useGamificationStore();
    const [selectedModuleId, setSelectedModuleId] = useState<string>(ACADEMY_CURRICULUM.length > 0 ? ACADEMY_CURRICULUM[0].id : '');
    const [completedItems, setCompletedItems] = useState<CompletedItems>(() => {
        try {
            const saved = localStorage.getItem('academy_completed_items');
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });

    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<'lessons' | 'quiz' | 'simulator'>('lessons');

    // Simulator State
    const [balance, setBalance] = useState<number>(() => {
        try {
            const saved = localStorage.getItem('academy_simulator_balance');
            return saved ? parseFloat(saved) : 1000000;
        } catch {
            return 1000000;
        }
    });
    const [simTicker, setSimTicker] = useState<string>('RELIANCE');
    const [simTradeType, setSimTradeType] = useState<'BUY' | 'SELL'>('BUY');
    const [simQty, setSimQty] = useState<number>(10);
    const [openPositions, setOpenPositions] = useState<PaperTrade[]>([]);
    const [closedTrades, setClosedTrades] = useState<PaperTrade[]>([]);
    const [simTab, setSimTab] = useState<'positions' | 'history'>('positions');

    const [mockPrices, setMockPrices] = useState<Record<string, number>>({
        RELIANCE: 2450.50,
        TCS: 3400.25,
        INFY: 1420.80,
        SBIN: 570.40,
        HDFCBANK: 1600.15,
        ICICIBANK: 930.60,
        AXISBANK: 980.30,
        LT: 2200.00,
        ITC: 440.75
    });

    const loadPaperTrades = async () => {
        try {
            const allTrades = await db.paper_trades.toArray();
            setOpenPositions(allTrades.filter(t => t.status === 'OPEN'));
            setClosedTrades(allTrades.filter(t => t.status === 'CLOSED').sort((a, b) => new Date(b.closeDate || '').getTime() - new Date(a.closeDate || '').getTime()));
        } catch (err) {
            console.error("Failed to load paper trades:", err);
        }
    };

    useEffect(() => {
        loadPaperTrades();
    }, []);

    // Live ticking mock prices
    useEffect(() => {
        if (activeView !== 'simulator') return;
        const interval = setInterval(() => {
            setMockPrices(prev => {
                const next = { ...prev };
                Object.keys(next).forEach(t => {
                    const pctChange = (Math.random() - 0.5) * 0.003; // max 0.15% change per tick
                    next[t] = parseFloat((next[t] * (1 + pctChange)).toFixed(2));
                });
                return next;
            });
        }, 3000);
        return () => clearInterval(interval);
    }, [activeView]);



    // Persist progress
    useEffect(() => {
        localStorage.setItem('academy_completed_items', JSON.stringify(completedItems));
    }, [completedItems]);

    const executePaperTrade = async () => {
        const currentPrice = mockPrices[simTicker];
        if (!currentPrice) {
            toast.error("Invalid Ticker price.");

        } else if (currentPrice <= 0) {
            toast.error("Live price not available.");
            return;
        }

        const requiredCapital = currentPrice * simQty;
        if (simTradeType === 'BUY' && requiredCapital > balance) {
            toast.error(COPY.toasts.insufficientFunds(requiredCapital.toLocaleString(), balance.toLocaleString()));
            return;
        }

        try {
            const newTrade: PaperTrade = {
                ticker: simTicker,
                type: simTradeType,
                entryPrice: currentPrice,
                quantity: simQty,
                openDate: new Date().toISOString(),
                status: 'OPEN',
                notes: 'Academy Simulator Trade'
            };

            await db.paper_trades.add(newTrade);
            
            // Deduct balance for BUY
            let nextBalance = balance;
            if (simTradeType === 'BUY') {
                nextBalance = balance - requiredCapital;
                setBalance(nextBalance);
                localStorage.setItem('academy_simulator_balance', nextBalance.toString());
            }

            toast.success(COPY.toasts.positionOpened(simTradeType, simQty, simTicker, String(currentPrice)));
            loadPaperTrades();
        } catch (err) {
            toast.error("Failed to execute paper trade.");
            console.error(err);
        }
    };

    const closePaperPosition = async (trade: PaperTrade) => {
        if (!trade.id) return;
        const currentPrice = mockPrices[trade.ticker] || trade.entryPrice;
        const priceDiff = currentPrice - trade.entryPrice;
        const pnl = trade.type === 'BUY' ? priceDiff * trade.quantity : -priceDiff * trade.quantity;

        try {
            await db.paper_trades.update(trade.id, {
                status: 'CLOSED',
                closePrice: currentPrice,
                closeDate: new Date().toISOString(),
                pnl: pnl
            });

            // Adjust balance:
            // BUY closed: we get back the capital + pnl (which is: entryPrice*qty + (exitPrice - entryPrice)*qty = exitPrice * qty)
            // SELL closed: we pay back the capital + pnl (which is: entryPrice*qty + (entryPrice - exitPrice)*qty = (2*entryPrice - exitPrice)*qty)
            let nextBalance = balance;
            if (trade.type === 'BUY') {
                nextBalance = balance + (currentPrice * trade.quantity);
            } else {
                nextBalance = balance + pnl;
            }

            setBalance(nextBalance);
            localStorage.setItem('academy_simulator_balance', nextBalance.toString());

            if (pnl > 0) {
                addXp(25);
                triggerConfetti();
                toast.success(COPY.toasts.positionClosedProfit(pnl.toFixed(2)));
            } else {
                toast.info(COPY.toasts.positionClosedLoss(Math.abs(pnl).toFixed(2)));
            }

            loadPaperTrades();
        } catch (err) {
            toast.error("Failed to close position.");
            console.error(err);
        }
    };

    const resetSimulator = async () => {
        if (window.confirm("Are you sure you want to reset the simulator? This will clear all mock trade logs and reset your balance to ₹1,000,000.")) {
            try {
                await db.paper_trades.clear();
                setBalance(1000000);
                localStorage.setItem('academy_simulator_balance', '1000000');
                setOpenPositions([]);
                setClosedTrades([]);
                toast.success(COPY.toasts.simulatorReset);
            } catch (err) {
                toast.error(COPY.toasts.simulatorResetFailed);
            }
        }
    };

    const activeModule = ACADEMY_CURRICULUM.find(m => m.id === selectedModuleId) || ACADEMY_CURRICULUM[0];
    const completedCount = activeModule.items.filter(item => completedItems[item.id]).length;
    const isModuleMastered = activeModule.items.length > 0 && completedCount === activeModule.items.length;

    // Calculate Progress
    const getModuleProgress = (moduleId: string) => {
        const module = ACADEMY_CURRICULUM.find(m => m.id === moduleId);
        if (!module) return 0;
        const total = module.items.length;
        const completed = module.items.filter(i => completedItems[i.id]).length;
        return (completed / total) * 100;
    };

    const handleCompleteItem = (item: AcademyItem) => {
        if (completedItems[item.id]) return;

        setCompletedItems(prev => ({
            ...prev,
            [item.id]: true
        }));

        addXp(item.xpReward);
        triggerConfetti();
        toast.success(COPY.toasts.lessonCompleted(item.xpReward));
    };

    const triggerConfetti = () => {
        confetti({
            particleCount: 150,
            spread: 100,
            origin: { y: 0.6 },
            colors: ['#6366f1', '#10b981', '#f43f5e', '#fbbf24'],
            disableForReducedMotion: true
        });
    };

    // --- Render Helpers ---

    const renderItemIcon = (type: string, isCompleted: boolean) => {
        const colorClass = isCompleted ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500';

        switch (type) {
            case 'VIDEO': return <Video size={20} className={colorClass} />;
            case 'BOOK': return <Book size={20} className={colorClass} />;
            case 'ARTICLE': return <FileText size={20} className={colorClass} />;
            case 'TERM': return <BadgeInfo size={20} className={colorClass} />;
            case 'NORM': return <ShieldAlert size={20} className={colorClass} />;
            case 'ALERT': return <AlertTriangle size={20} className="text-rose-500" />;
            case 'COURSE': return <GraduationCap size={20} className={colorClass} />;
            case 'PODCAST': return <PlayCircle size={20} className={colorClass} />;
            case 'PAPER': return <FileText size={20} className={colorClass} />;
            default: return <Book size={20} className={colorClass} />;
        }
    };

    const getItemColor = (type: string) => {
        switch (type) {
            case 'VIDEO': return 'bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800';
            case 'BOOK': return 'bg-indigo-50 dark:bg-indigo-900/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800';
            case 'ALERT': return 'bg-rose-50 dark:bg-rose-900/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800';
            case 'COURSE': return 'bg-violet-50 dark:bg-violet-900/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800';
            case 'PODCAST': return 'bg-amber-50 dark:bg-amber-900/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800';
            case 'PAPER': return 'bg-emerald-50 dark:bg-emerald-900/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
            default: return 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';
        }
    };

    return (
        <div className="relative flex h-full flex-col overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 p-5 md:p-7">
            {/* Decorative background */}
            <div className="absolute top-0 right-0 w-full h-64 bg-gradient-to-b from-slate-200/50 via-transparent to-transparent dark:from-slate-900/50 pointer-events-none"></div>

            {/* TOP HEADER SECTION (Full Width) */}
            <div className="relative z-10 w-full mb-6">
                <TabHero
                    eyebrow="Skill Stack"
                    title="Wealth Academy"
                    description="Compact learning lane for structured lessons, progress tracking, and quiz-based mastery."
                    icon={GraduationCap}
                    iconTone="text-indigo-500"
                    gradientClassName="from-indigo-50 via-white to-sky-50 dark:from-indigo-950/20 dark:via-slate-950 dark:to-sky-950/20"
                    chips={[`${activeModule.items.length} lessons`, `Level ${level}`, `${xp} XP`]}
                    actions={
                        <div className="inline-flex min-h-[38px] items-center gap-1 rounded-full border border-slate-200 bg-white/85 p-0.5 dark:border-slate-700 dark:bg-slate-900/80">
                            <button
                                onClick={() => setActiveView('lessons')}
                                className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${activeView === 'lessons'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
                                    }`}
                            >
                                <GraduationCap size={12} />
                                Lessons
                            </button>
                            <button
                                onClick={() => setActiveView('quiz')}
                                className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${activeView === 'quiz'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
                                    }`}
                            >
                                <Target size={12} />
                                Quiz
                            </button>
                            <button
                                onClick={() => setActiveView('simulator')}
                                className={`inline-flex min-h-[30px] items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-all ${activeView === 'simulator'
                                    ? 'bg-indigo-600 text-white shadow-md'
                                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
                                    }`}
                            >
                                <PlayCircle size={12} />
                                Simulator
                            </button>
                        </div>
                    }
                />


            </div>

            {/* TWO COLUMN CONTENT SECTION */}
            <div className="relative z-10 flex flex-col md:flex-row gap-6 items-start w-full">
                {/* LEFT COLUMN: CURRICULUM */}
                <div className="z-20 flex w-full md:w-80 shrink-0 flex-col rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-indigo-100 p-2 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                                <GraduationCap size={20} />
                            </div>
                            <div>
                                <h2 className="font-bold text-slate-900 dark:text-white leading-tight">Wealth Academy</h2>
                                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Professional Series</p>
                            </div>
                        </div>
                    </div>

                    <div className="p-3 space-y-2.5">
                    {ACADEMY_CURRICULUM.map((module) => {
                        const progress = getModuleProgress(module.id);
                        const isSelected = selectedModuleId === module.id;

                        return (
                            <button
                                key={module.id}
                                onClick={() => setSelectedModuleId(module.id)}
                                className={`group relative w-full overflow-hidden rounded-xl border p-3 text-left transition-all ${isSelected
                                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent shadow-lg transform scale-[1.02]'
                                    : 'bg-white dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                                    }`}
                            >
                                <div className="flex justify-between items-start mb-2 relative z-10">
                                    <h3 className={`text-[13px] font-bold leading-snug ${isSelected ? 'text-white dark:text-slate-900' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {module.title.replace(':', ':\n')}
                                    </h3>
                                    {progress === 100 && <CheckCircle size={14} className="text-emerald-500" />}
                                </div>

                                <div className="relative z-10">
                                    <div className="mb-1 flex justify-between text-[9px] font-bold uppercase tracking-[0.14em] opacity-70">
                                        <span>Progress</span>
                                        <span>{Math.round(progress)}%</span>
                                    </div>
                                    <div className={`h-1.5 w-full rounded-full overflow-hidden ${isSelected ? 'bg-white/20 dark:bg-slate-900/20' : 'bg-slate-100 dark:bg-slate-700/50'}`}>
                                        <div
                                            className={`h-full rounded-full transition-all duration-1000 ${isSelected ? 'bg-indigo-500' : 'bg-indigo-500'}`}
                                            style={{ width: `${progress}%` }}
                                        ></div>
                                    </div>
                                </div>

                                {/* Subtle background icon */}
                                <module.icon
                                    size={80}
                                    className={`absolute -right-4 -bottom-4 opacity-5 pointer-events-none transition-transform group-hover:scale-110 group-hover:rotate-12 ${isSelected ? 'text-white dark:text-slate-900' : 'text-slate-900 dark:text-white'}`}
                                />
                            </button>
                        );
                    })}
                </div>

                {/* Sidebar Footer: User Stats */}
                <div className="border-t border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-black/20">
                    <div className="flex items-center justify-between rounded-lg bg-indigo-900 p-2.5 text-white shadow-inner">
                        <div className="flex items-center gap-2">
                            <Trophy size={14} className="text-yellow-400" />
                            <span className="text-[11px] font-bold">Level {level}</span>
                        </div>
                        <span className="font-mono text-[11px] font-bold text-indigo-200">{xp} XP</span>
                    </div>
                </div>
            </div>

            {/* RIGHT COLUMN: MAIN CONTENT */}
            <div className="flex-1 min-w-0 w-full">

                    {/* Views Routing */}
                    {activeView === 'quiz' ? (
                        <InteractiveQuiz />
                    ) : activeView === 'simulator' ? (
                        <div className="space-y-6">
                            {/* Stats Cards */}
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-sm relative overflow-hidden">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Available Capital</span>
                                        <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/20 p-1.5 text-emerald-600">
                                            <DollarSign size={14} />
                                        </div>
                                    </div>
                                    <div className="text-2xl font-black text-slate-950 dark:text-white">
                                        ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">Starting with ₹10,00,000.00</p>
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Realized P&L</span>
                                        <div className={`rounded-full p-1.5 ${closedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0) >= 0 ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20' : 'bg-rose-100 text-rose-600 dark:bg-rose-900/20'}`}>
                                            {closedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0) >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                        </div>
                                    </div>
                                    <div className={`text-2xl font-black ${closedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                        {closedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0) >= 0 ? '+' : ''}
                                        ₹{closedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">From {closedTrades.length} completed trades</p>
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Win Rate & Trades</span>
                                        <div className="rounded-full bg-indigo-100 dark:bg-indigo-900/20 p-1.5 text-indigo-600">
                                            <Trophy size={14} />
                                        </div>
                                    </div>
                                    <div className="text-2xl font-black text-slate-950 dark:text-white">
                                        {closedTrades.length > 0 
                                            ? `${Math.round((closedTrades.filter(t => (t.pnl || 0) > 0).length / closedTrades.length) * 100)}%` 
                                            : '0%'}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">
                                        {closedTrades.filter(t => (t.pnl || 0) > 0).length} W / {closedTrades.filter(t => (t.pnl || 0) <= 0).length} L
                                    </p>
                                </div>
                            </div>

                            {/* Execution Terminal */}
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
                                <div className="md:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-lg relative overflow-hidden flex flex-col justify-between">
                                    <div>
                                        <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-1.5">
                                            <Zap size={14} className="text-indigo-500" />
                                            Market Terminal
                                        </h3>
                                        
                                        {/* Ticker Selector */}
                                        <div className="mb-4">
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5 block">Select Ticker</label>
                                            <div className="grid grid-cols-3 gap-2">
                                                {Object.keys(mockPrices).map(t => (
                                                    <button
                                                        key={t}
                                                        onClick={() => setSimTicker(t)}
                                                        className={`py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                            simTicker === t 
                                                                ? 'bg-indigo-600 text-white border-transparent shadow-md' 
                                                                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                                                        }`}
                                                    >
                                                        {t}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Ticker Ticking Display */}
                                        <div className="mb-4 rounded-xl bg-slate-50 dark:bg-slate-950 p-4 border border-slate-105 dark:border-slate-800 flex items-center justify-between">
                                            <div>
                                                <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Live Feed</div>
                                                <div className="text-lg font-black text-slate-900 dark:text-white">{simTicker}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Current Price</div>
                                                <div className="text-xl font-mono font-black text-indigo-600 dark:text-indigo-400 animate-pulse">
                                                    ₹{mockPrices[simTicker]?.toFixed(2)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Direction Toggle */}
                                        <div className="mb-4">
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5 block">Trade Direction</label>
                                            <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-950 p-1 rounded-xl">
                                                <button
                                                    onClick={() => setSimTradeType('BUY')}
                                                    className={`py-1.5 rounded-lg text-xs font-black transition-all ${
                                                        simTradeType === 'BUY' 
                                                            ? 'bg-emerald-500 text-white shadow-md' 
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    BUY (Long)
                                                </button>
                                                <button
                                                    onClick={() => setSimTradeType('SELL')}
                                                    className={`py-1.5 rounded-lg text-xs font-black transition-all ${
                                                        simTradeType === 'SELL' 
                                                            ? 'bg-rose-500 text-white shadow-md' 
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    SELL (Short)
                                                </button>
                                            </div>
                                        </div>

                                        {/* Quantity Selector */}
                                        <div className="mb-6">
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1.5 block">Quantity</label>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setSimQty(prev => Math.max(1, prev - 5))}
                                                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300"
                                                >
                                                    <Minus size={16} />
                                                </button>
                                                <input
                                                    type="number"
                                                    value={simQty}
                                                    onChange={(e) => setSimQty(Math.max(1, parseInt(e.target.value) || 1))}
                                                    className="flex-1 text-center h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                                                />
                                                <button
                                                    onClick={() => setSimQty(prev => prev + 5)}
                                                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300"
                                                >
                                                    <Plus size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        {/* Cost Info */}
                                        <div className="mb-4 flex items-center justify-between text-xs font-bold text-slate-500">
                                            <span>Est. Margin Required:</span>
                                            <span className="font-mono text-slate-800 dark:text-white">
                                                ₹{((mockPrices[simTicker] || 0) * simQty).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>

                                        <button
                                            onClick={executePaperTrade}
                                            className={`w-full py-3 rounded-2xl text-xs font-black uppercase tracking-wider text-white shadow-md transition-all transform hover:scale-[1.01] active:scale-[0.99] ${
                                                simTradeType === 'BUY' 
                                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:shadow-emerald-500/20' 
                                                    : 'bg-gradient-to-r from-rose-500 to-red-500 hover:shadow-rose-500/20'
                                            }`}
                                        >
                                            Execute {simTradeType} Order
                                        </button>
                                    </div>
                                </div>

                                {/* Positions & Logs */}
                                <div className="md:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-lg flex flex-col justify-between min-h-[480px]">
                                    <div className="flex-1">
                                        <div className="flex justify-between items-center mb-4">
                                            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-950">
                                                <button
                                                    onClick={() => setSimTab('positions')}
                                                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                                                        simTab === 'positions' 
                                                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                                                            : 'text-slate-500'
                                                    }`}
                                                >
                                                    Open Positions ({openPositions.length})
                                                </button>
                                                <button
                                                    onClick={() => setSimTab('history')}
                                                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                                                        simTab === 'history' 
                                                            ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                                                            : 'text-slate-500'
                                                    }`}
                                                >
                                                    Trade History ({closedTrades.length})
                                                </button>
                                            </div>

                                            <button
                                                onClick={resetSimulator}
                                                className="text-xs font-bold text-slate-400 hover:text-rose-500 flex items-center gap-1.5 transition-colors"
                                            >
                                                <RotateCcw size={12} />
                                                Reset
                                            </button>
                                        </div>

                                        {simTab === 'positions' ? (
                                            openPositions.length === 0 ? (
                                                <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-200 dark:border-slate-850 rounded-2xl">
                                                    <Zap size={24} className="text-slate-300 mb-2" />
                                                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">No Open Positions</h4>
                                                    <p className="text-[10px] text-slate-400 mt-1 max-w-[200px]">Use the Market Terminal on the left to execute paper trades and build your streak!</p>
                                                </div>
                                            ) : (
                                                <div className="overflow-y-auto max-h-[340px] space-y-3.5 pr-1">
                                                    {openPositions.map(trade => {
                                                        const currentPrice = mockPrices[trade.ticker] || trade.entryPrice;
                                                        const pDiff = currentPrice - trade.entryPrice;
                                                        const pnl = trade.type === 'BUY' ? pDiff * trade.quantity : -pDiff * trade.quantity;

                                                        return (
                                                            <div key={trade.id} className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/40 bg-slate-50/40 dark:bg-slate-950/20 flex justify-between items-center transition-all hover:border-slate-200 dark:hover:border-slate-700">
                                                                <div>
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${trade.type === 'BUY' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20' : 'bg-rose-100 text-rose-600 dark:bg-rose-900/20'}`}>
                                                                            {trade.type}
                                                                        </span>
                                                                        <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">{trade.ticker}</span>
                                                                        <span className="text-[10px] text-slate-400 font-medium">({trade.quantity} Shares)</span>
                                                                    </div>
                                                                    <div className="text-[10px] text-slate-500 font-bold flex gap-3">
                                                                        <span>Entry: <strong className="font-mono text-slate-700 dark:text-slate-300">₹{trade.entryPrice}</strong></span>
                                                                        <span>Live: <strong className="font-mono text-indigo-600 dark:text-indigo-400">₹{currentPrice}</strong></span>
                                                                    </div>
                                                                </div>

                                                                <div className="flex items-center gap-4">
                                                                    <div className="text-right">
                                                                        <div className="text-[9px] text-slate-400 font-black uppercase tracking-wider">Unrealized P&L</div>
                                                                        <div className={`text-sm font-mono font-black ${pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                            {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                                                                        </div>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => closePaperPosition(trade)}
                                                                        className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 shadow-sm"
                                                                    >
                                                                        Close
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )
                                        ) : (
                                            closedTrades.length === 0 ? (
                                                <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-200 dark:border-slate-850 rounded-2xl">
                                                    <History size={24} className="text-slate-300 mb-2" />
                                                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">No Trade History</h4>
                                                    <p className="text-[10px] text-slate-400 mt-1 max-w-[200px]">Completed trade records will appear here once you close open positions.</p>
                                                </div>
                                            ) : (
                                                <div className="overflow-y-auto max-h-[340px] space-y-3 pr-1">
                                                    {closedTrades.map(trade => (
                                                        <div key={trade.id} className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/10 flex justify-between items-center text-xs">
                                                            <div>
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className="font-bold text-slate-700 dark:text-slate-300">{trade.ticker}</span>
                                                                    <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${trade.type === 'BUY' ? 'bg-emerald-50 text-emerald-500 dark:bg-emerald-950/20' : 'bg-rose-50 text-rose-500 dark:bg-rose-950/20'}`}>
                                                                        {trade.type}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400">x{trade.quantity}</span>
                                                                </div>
                                                                <div className="text-[9px] text-slate-400 flex gap-2 font-medium">
                                                                    <span>In: ₹{trade.entryPrice}</span>
                                                                    <span>Out: ₹{trade.closePrice}</span>
                                                                    <span>{new Date(trade.closeDate || '').toLocaleTimeString()}</span>
                                                                </div>
                                                            </div>
                                                            <div className={`font-mono font-black text-right ${trade.pnl && trade.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                                                {trade.pnl && trade.pnl >= 0 ? '+' : ''}₹{trade.pnl?.toFixed(2)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )
                                        )}
                                    </div>
                                    <div className="border-t border-slate-150 pt-3 dark:border-slate-800 text-[10px] text-slate-400 text-center font-bold uppercase tracking-wider flex justify-between items-center">
                                        <span>Simulator Streaks Active</span>
                                        <span className="text-indigo-500">Close profitable trades to earn +25 XP</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div>
                            {/* Header */}
                            <div className="mb-6 space-y-3">
                                <SectionHeader
                                    eyebrow="Module Focus"
                                    title={activeModule.title}
                                    description={activeModule.description}
                                    icon={activeModule.icon}
                                    tone={isModuleMastered ? 'success' : completedCount > 0 ? 'info' : 'neutral'}
                                    badge={`${completedCount}/${activeModule.items.length} complete`}
                                    chips={[
                                        `${activeModule.items.length} lessons`,
                                        `${Math.round(getModuleProgress(activeModule.id))}% progress`
                                    ]}
                                />
                                {isModuleMastered ? (
                                    <StateSurface
                                        title="Module Mastered"
                                        description="Excellent work. This track is complete and locked into your progress history."
                                        icon={Trophy}
                                        tone="success"
                                        badge="done"
                                        compact
                                    />
                                ) : completedCount === 0 ? (
                                    <StateSurface
                                        title="Ready To Start"
                                        description="Complete your first lesson in this module to unlock momentum and XP streaks."
                                        icon={Zap}
                                        tone="info"
                                        badge="new"
                                        compact
                                    />
                                ) : null}
                            </div>

                            {/* Content List */}
                            <div className="space-y-3.5">
                                {activeModule.items.map((item, idx) => {
                                    const isCompleted = !!completedItems[item.id];
                                    const isHovered = hoveredItem === item.id;

                                    return (
                                        <div
                                            key={item.id}
                                            onMouseEnter={() => setHoveredItem(item.id)}
                                            onMouseLeave={() => setHoveredItem(null)}
                                            className={`group relative rounded-2xl border bg-white p-4 transition-all duration-300 dark:bg-slate-900 ${isCompleted
                                                ? 'border-emerald-500/30 shadow-sm opacity-80'
                                                : isHovered
                                                    ? 'border-indigo-500 shadow-xl shadow-indigo-500/10 scale-[1.01] z-20'
                                                    : 'border-slate-200 dark:border-slate-800 shadow-sm'
                                                }`}
                                        >
                                            <div className="flex gap-4 items-start">

                                                {/* Status Indicator / Action */}
                                                <div className="shrink-0 pt-0.5">
                                                    <button
                                                        onClick={() => handleCompleteItem(item)}
                                                        disabled={isCompleted}
                                                        className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-500 ${isCompleted
                                                            ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-500 rotate-0 scale-100'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-300 group-hover:bg-indigo-600 group-hover:text-white group-hover:shadow-lg group-hover:scale-110'
                                                            }`}
                                                    >
                                                        {isCompleted ? <CheckCircle size={18} /> : <PlayCircle size={18} />}
                                                    </button>
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="mb-2 flex items-center gap-2">
                                                        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${getItemColor(item.type)}`}>
                                                            {item.type}
                                                        </span>
                                                        {item.duration && (
                                                            <span className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">
                                                                <Clock size={10} /> {item.duration}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <h3 className={`mb-1.5 text-base font-bold transition-colors ${isCompleted ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400'
                                                        }`}>
                                                        {item.title}
                                                    </h3>

                                                    <p className="mb-3 text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
                                                        {item.description}
                                                    </p>

                                                    {item.url && !isCompleted && (
                                                        <a
                                                            href={item.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500 hover:text-indigo-600 underline decoration-indigo-200 underline-offset-4"
                                                        >
                                                            Open Resource <ChevronRight size={12} />
                                                        </a>
                                                    )}
                                                </div>

                                                {/* XP Badge */}
                                                <div className="shrink-0 text-right">
                                                    <div className={`inline-flex h-12 w-12 flex-col items-center justify-center rounded-xl border-2 border-dashed ${isCompleted
                                                        ? 'border-emerald-200 text-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800'
                                                        : 'border-indigo-100 text-indigo-400 bg-indigo-50 dark:bg-indigo-900/10 dark:border-indigo-800 group-hover:border-indigo-500 group-hover:text-indigo-600 transition-colors'
                                                        }`}>
                                                        <span className="text-sm font-black">{item.xpReward}</span>
                                                        <span className="text-[8px] uppercase font-bold tracking-[0.14em]">XP</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Success Message Overlay */}
                                            {isCompleted && (
                                                <div className="absolute inset-x-0 bottom-0 rounded-b-2xl border-t border-emerald-100 bg-emerald-50 py-1 text-center dark:border-emerald-800/30 dark:bg-emerald-900/20">
                                                    <span className="flex items-center justify-center gap-2 text-[9px] font-bold text-emerald-600 uppercase tracking-[0.16em]">
                                                        <Trophy size={10} /> Lesson Mastered
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Wrap with React.memo to prevent unnecessary re-renders
export default React.memo(Academy);
// Rebuild trigger: Fixed unterminated regex issue
