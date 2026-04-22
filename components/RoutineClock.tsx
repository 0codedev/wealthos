import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Clock, Sun, Moon, Zap, Coffee, Activity, BarChart3, 
    AlertOctagon, Target, ShieldAlert, Crosshair, CheckCircle2, 
    TrendingUp, TrendingDown, Info, Gauge, ZapOff
} from 'lucide-react';
import { MarketStatus } from '../hooks/useMarketSentiment';
import { usePageVisibility } from '../contexts/PageVisibilityContext';
import { useLiteModeStore } from '../store/liteModeStore';

type Slot = 
    'PRE_MARKET' | 'OPENING_CHAOS' | 'TRUE_TREND' | 'TREND_CONTINUATION' | 'EXHAUSTION' | 
    'DEAD_ZONE_1' | 'DEAD_ZONE_2' | 'FAKEOUT_WINDOW' | 'EUROPEAN_OPEN' | 'AFTERNOON_SETUP' | 
    'BREAKOUT_WINDOW' | 'CONTINUATION' | 'POWER_HOUR' | 'CLOSING_CASINO' | 'EXPIRY_SPECIAL' | 'POST_MARKET' | 'REST' | 'CLOSED';

const NSE_HOLIDAYS_2026 = [
    '2026-01-26', // Republic Day
    '2026-03-03', // Holi
    '2026-03-26', // Shri Ram Navami
    '2026-03-31', // Shri Mahavir Jayanti
    '2026-04-03', // Good Friday
    '2026-04-14', // Ambedkar Jayanti
    '2026-05-01', // Maharashtra Day
    '2026-05-28', // Bakri Id
    '2026-06-26', // Muharram
    '2026-09-14', // Ganesh Chaturthi
    '2026-10-02', // Gandhi Jayanti
    '2026-10-20', // Dussehra
    '2026-11-10', // Diwali
    '2026-11-24', // Guru Nanak Jayanti
    '2026-12-25', // Christmas
];

interface MarketPulseProps {
    marketStatus: MarketStatus;
    marketVix: number;
}

const MarketPulse: React.FC<MarketPulseProps> = ({ marketStatus, marketVix }) => {
    const [time, setTime] = useState(new Date());
    const [currentSlot, setCurrentSlot] = useState<Slot>('REST');
    const [nextSlotInfo, setNextSlotInfo] = useState({ name: '', diff: 0 });
    const [showInsight, setShowInsight] = useState(false);
    const isVisible = usePageVisibility();
    const isLiteMode = useLiteModeStore(state => state.isLiteMode);

    useEffect(() => {
        if (!isVisible) return;

        const intervalMs = isLiteMode ? 5000 : 1000;
        const timer = setInterval(() => {
            const now = new Date();
            setTime(now);
            updateSlots(now);
        }, intervalMs);

        updateSlots(new Date());
        return () => clearInterval(timer);
    }, [isVisible, isLiteMode]);

    const updateSlots = (now: Date) => {
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const totalMinutes = hours * 60 + minutes;
        const day = now.getDay(); // 0: Sun, 6: Sat
        const dateStr = now.toISOString().split('T')[0];
        const isHoliday = NSE_HOLIDAYS_2026.includes(dateStr);
        const isWeekend = day === 0 || day === 6;
        const isExpiry = day === 4; // Thursday Expiry (Nifty/BankNifty)

        let slot: Slot = 'REST';
        let next: { name: string, startMinutes: number } | null = null;

        if (isWeekend || isHoliday) {
            slot = 'CLOSED';
            next = { name: 'Market Reopening', startMinutes: 540 }; // 9:00 AM next working day
        } else if (totalMinutes >= 540 && totalMinutes < 555) { slot = 'PRE_MARKET'; next = { name: 'Opening Chaos', startMinutes: 555 }; }
        else if (totalMinutes >= 555 && totalMinutes < 570) { slot = 'OPENING_CHAOS'; next = { name: 'True Trend Formation', startMinutes: 570 }; }
        else if (totalMinutes >= 570 && totalMinutes < 600) { slot = 'TRUE_TREND'; next = { name: 'Trend Continuation', startMinutes: 600 }; }
        else if (totalMinutes >= 600 && totalMinutes < 630) { slot = 'TREND_CONTINUATION'; next = { name: 'Exhaustion', startMinutes: 630 }; }
        else if (totalMinutes >= 630 && totalMinutes < 660) { slot = 'EXHAUSTION'; next = { name: 'Dead Zone (Part 1)', startMinutes: 660 }; }
        else if (totalMinutes >= 660 && totalMinutes < 690) { slot = 'DEAD_ZONE_1'; next = { name: 'Dead Zone (Part 2)', startMinutes: 690 }; }
        else if (totalMinutes >= 690 && totalMinutes < 720) { slot = 'DEAD_ZONE_2'; next = { name: 'Fakeout Window', startMinutes: 720 }; }
        else if (totalMinutes >= 720 && totalMinutes < 750) { slot = 'FAKEOUT_WINDOW'; next = { name: 'European Open', startMinutes: 750 }; }
        else if (totalMinutes >= 750 && totalMinutes < 780) { slot = 'EUROPEAN_OPEN'; next = { name: 'Afternoon Setup', startMinutes: 780 }; }
        else if (totalMinutes >= 780 && totalMinutes < 810) { slot = 'AFTERNOON_SETUP'; next = { name: 'Breakout Window', startMinutes: 810 }; }
        else if (totalMinutes >= 810 && totalMinutes < 840) { slot = 'BREAKOUT_WINDOW'; next = { name: 'The Continuation', startMinutes: 840 }; }
        else if (totalMinutes >= 840 && totalMinutes < 870) { slot = 'CONTINUATION'; next = { name: 'Power Hour', startMinutes: 870 }; }
        else if (totalMinutes >= 870 && totalMinutes < 900) { slot = 'POWER_HOUR'; next = { name: isExpiry ? 'Expiry Special' : 'Closing Casino', startMinutes: 900 }; }
        else if (totalMinutes >= 900 && totalMinutes < 930) { 
            slot = isExpiry ? 'EXPIRY_SPECIAL' : 'CLOSING_CASINO'; 
            next = { name: 'Post Market', startMinutes: 930 }; 
        }
        else if (totalMinutes >= 930 && totalMinutes < 960) { slot = 'POST_MARKET'; next = { name: 'Rest', startMinutes: 960 }; }
        else {
            slot = 'REST';
            next = { name: 'Pre-Market', startMinutes: totalMinutes < 540 ? 540 : 540 + 1440 };
        }

        setCurrentSlot(slot);

        if (next) {
            let nextStartSecs = next.startMinutes * 60;
            let currentSecs = (hours * 3600 + minutes * 60 + now.getSeconds());
            let diff = nextStartSecs - currentSecs;
            
            // If it's weekend/holiday or after market hours, add remaining time for the day and full days until next open
            if (isWeekend || isHoliday || totalMinutes >= 930) {
                if (diff < 0) diff += 24 * 3600; // Time until 9 AM tomorrow
                if (day === 6) diff += 24 * 3600; // Add Sunday if it's Saturday
                if (day === 0) { /* already handled by tomorrow logic above */ }
            }

            setNextSlotInfo({ name: next.name, diff });
        }
    };

    const formatCountdown = (seconds: number) => {
        if (seconds <= 0) return "NOW";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h > 0 ? h + 'h ' : ''}${m}m ${s}s`;
    };

    const getSlotDetails = (slot: Slot) => {
        switch (slot) {
            case 'PRE_MARKET':
                return {
                    label: 'PRE-MARKET', 
                    timeRange: '09:00 - 09:15',
                    directive: 'Check Global Cues. No Orders.', 
                    vol: '-',
                    insight: 'Market makers adjusting spreads. Observation is key.',
                    icon: Sun, color: 'text-amber-600 dark:text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', pulse: true, risk: 'low'
                };
            case 'OPENING_CHAOS':
                return {
                    label: 'THE OPENING CHAOS', 
                    timeRange: '09:15 - 09:30',
                    directive: 'DO NOT TRADE. Let the dust settle.', 
                    vol: '10/10',
                    insight: 'Overnight orders execute. Algorithmic warfare. Spreads are wide.',
                    icon: AlertOctagon, color: 'text-rose-600 dark:text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', pulse: true, risk: 'high'
                };
            case 'TRUE_TREND':
                return {
                    label: 'TRUE TREND FORMATION', 
                    timeRange: '09:30 - 10:00',
                    directive: 'PRIMARY HUNTING GROUND. Execute Snap-Backs.', 
                    vol: '8/10',
                    insight: 'The actual directional trend for the morning begins. Heavy institutional volume.',
                    icon: Target, color: 'text-emerald-600 dark:text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', pulse: true, risk: 'low'
                };
            case 'TREND_CONTINUATION':
                return {
                    label: 'TREND CONTINUATION', 
                    timeRange: '10:00 - 10:30',
                    directive: 'TAKE PROFITS. Trail stops aggressively.', 
                    vol: '7/10',
                    insight: 'Morning trend matures. Hits major resistance/support targets.',
                    icon: TrendingUp, color: 'text-indigo-600 dark:text-indigo-500', bg: 'bg-indigo-500/10 border-indigo-500/20', pulse: false, risk: 'medium'
                };
            case 'EXHAUSTION':
                return {
                    label: 'THE EXHAUSTION', 
                    timeRange: '10:30 - 11:00',
                    directive: 'CLOSE TERMINAL. Lock in morning profits.', 
                    vol: '4/10',
                    insight: 'Volume dries up. Retail FOMO buyers enter late and get trapped.',
                    icon: CheckCircle2, color: 'text-blue-600 dark:text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', pulse: false, risk: 'medium'
                };
            case 'DEAD_ZONE_1':
                return {
                    label: 'DEAD ZONE (PART 1)', 
                    timeRange: '11:00 - 11:30',
                    directive: 'DO NOT TRADE. Ignore Telegram.', 
                    vol: '2/10',
                    insight: 'Complete sideways chop. Algorithms ping-pong price between tight ranges.',
                    icon: ShieldAlert, color: 'text-rose-600 dark:text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', pulse: true, risk: 'high'
                };
            case 'DEAD_ZONE_2':
                return {
                    label: 'DEAD ZONE (PART 2)', 
                    timeRange: '11:30 - 12:00',
                    directive: 'DO NOT TRADE. Theta Melt.', 
                    vol: '2/10',
                    insight: 'Theta decay is at maximum. Options premiums melt even if index is flat.',
                    icon: ShieldAlert, color: 'text-rose-600 dark:text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', pulse: true, risk: 'high'
                };
            case 'FAKEOUT_WINDOW':
                return {
                    label: 'FAKEOUT WINDOW', 
                    timeRange: '12:00 - 12:30',
                    directive: 'IGNORE THE SPIKES. They are traps.', 
                    vol: '4/10',
                    insight: 'Random 1-minute spikes occur to hunt stops before Europe opens.',
                    icon: AlertOctagon, color: 'text-orange-600 dark:text-orange-500', bg: 'bg-orange-500/10 border-orange-500/20', pulse: false, risk: 'high'
                };
            case 'EUROPEAN_OPEN':
                return {
                    label: 'EUROPEAN OPEN', 
                    timeRange: '12:30 - 13:00',
                    directive: 'OBSERVE ONLY. Watch Volume Profile.', 
                    vol: '6/10',
                    insight: 'Global liquidity enters. A slight directional bias begins.',
                    icon: Activity, color: 'text-indigo-600 dark:text-indigo-500', bg: 'bg-indigo-500/10 border-indigo-500/20', pulse: false, risk: 'medium'
                };
            case 'AFTERNOON_SETUP':
                return {
                    label: 'AFTERNOON SETUP', 
                    timeRange: '13:00 - 13:30',
                    directive: 'PREPARE. Run your checklists.', 
                    vol: '6/10',
                    insight: 'Institutions positioning for the closing drive. New patterns emerge.',
                    icon: Coffee, color: 'text-amber-600 dark:text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', pulse: false, risk: 'low'
                };
            case 'BREAKOUT_WINDOW':
                return {
                    label: 'BREAKOUT WINDOW', 
                    timeRange: '13:30 - 14:00',
                    directive: 'SECONDARY HUNTING. High accuracy entries.', 
                    vol: '7/10',
                    insight: 'Market breaks out of the 11:00-1:00 PM sideways box.',
                    icon: Target, color: 'text-emerald-600 dark:text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', pulse: true, risk: 'low'
                };
            case 'CONTINUATION':
                return {
                    label: 'THE CONTINUATION', 
                    timeRange: '14:00 - 14:30',
                    directive: 'TRAIL PROFITS.', 
                    vol: '7/10',
                    insight: 'The afternoon trend accelerates. institutional push.',
                    icon: TrendingUp, color: 'text-indigo-600 dark:text-indigo-500', bg: 'bg-indigo-500/10 border-indigo-500/20', pulse: false, risk: 'medium'
                };
            case 'POWER_HOUR':
                return {
                    label: 'THE POWER HOUR', 
                    timeRange: '14:30 - 15:00',
                    directive: 'SNIPER TRADES ONLY. Highly volatile.', 
                    vol: '9/10',
                    insight: 'Brokers force retail to close MIS positions. Massive short-squeezes.',
                    icon: Crosshair, color: 'text-fuchsia-600 dark:text-fuchsia-500', bg: 'bg-fuchsia-500/10 border-fuchsia-500/20', pulse: true, risk: 'high'
                };
            case 'EXPIRY_SPECIAL':
                return {
                    label: 'EXPIRY SPECIAL (3 PM DRIVE)', 
                    timeRange: '15:00 - 15:30',
                    directive: 'ZERO-TO-HERO. High Opportunity.', 
                    vol: '10/10',
                    insight: 'Final settlement drive. Massive gamma moves in far-OTM strikes.',
                    icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20', pulse: true, risk: 'high'
                };
            case 'CLOSING_CASINO':
                return {
                    label: 'CLOSING CASINO', 
                    timeRange: '15:00 - 15:30',
                    directive: 'FLAT (NO POSITIONS). Screen closed.', 
                    vol: '8/10',
                    insight: 'BTST positions are taken. Pure gambling. High noise.',
                    icon: AlertOctagon, color: 'text-rose-600 dark:text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', pulse: true, risk: 'high'
                };
            case 'POST_MARKET':
                return {
                    label: 'POST-MARKET', 
                    timeRange: '15:30 - 16:00',
                    directive: 'Settlement & Analysis.', 
                    vol: '-',
                    insight: 'Analyzing daily pnl and logging mistakes.',
                    icon: BarChart3, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-200/50 dark:bg-slate-800 border-slate-300 dark:border-slate-700', pulse: false, risk: 'low'
                };
            case 'CLOSED':
                return {
                    label: 'MARKET CLOSED', 
                    timeRange: '-',
                    directive: 'Relax. Prepare for tomorrow.', 
                    vol: '-',
                    insight: 'Market is closed for weekend or holiday. Perfect time for analysis.',
                    icon: Moon, color: 'text-slate-400', bg: 'bg-slate-900/40 border-slate-800', pulse: false, risk: 'low'
                };
            default:
                return {
                    label: 'REST & ANALYZE', 
                    timeRange: '-',
                    directive: 'Relax. Prepare for tomorrow.', 
                    vol: '-',
                    insight: 'Rest is part of the work. Detach from PnL.',
                    icon: Moon, color: 'text-slate-400', bg: 'bg-slate-900/40 border-slate-800', pulse: false, risk: 'low'
                };
        }
    };

    const details = getSlotDetails(currentSlot);
    const Icon = details.icon;
    const isRed = marketStatus === 'RED';
    const statusColor = isRed ? 'text-rose-500' : marketStatus === 'AMBER' ? 'text-amber-500' : 'text-emerald-500';

    return (
        <div className="luxury-card relative overflow-hidden rounded-wa-lg border border-slate-800/80 dark:border-wa-border bg-slate-900/80 dark:bg-wa-card backdrop-blur-xl shadow-sm transition-all duration-300">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent dark:from-white/5 dark:to-transparent pointer-events-none" />
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-current opacity-5 blur-[100px] pointer-events-none" />
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 relative z-10">
                {/* LEFT: Phase & Timing */}
                <div className="lg:col-span-7 p-6 border-b lg:border-b-0 lg:border-r border-slate-800/80 dark:border-wa-border">
                    <div className="flex items-start justify-between mb-6">
                        <div className="flex items-center gap-5">
                            <div className={`p-3.5 rounded-wa-md bg-slate-900/80 dark:bg-wa-card-elevated shadow-sm ${details.color} ${details.pulse ? 'animate-pulse' : ''} border border-slate-800/80 dark:border-wa-border`}>
                                <Icon size={26} />
                            </div>
                            <div>
                                <h3 className={`font-bold text-lg tracking-tight leading-none mb-1.5 ${details.color}`}>
                                    {details.label}
                                </h3>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-black/20 dark:bg-white/5 border border-white/[0.06] dark:border-white/5">
                                        <Clock size={12} className="opacity-50" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            {details.timeRange}
                                        </span>
                                    </div>
                                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border font-bold text-[10px] uppercase tracking-wider ${details.color.replace('text-', 'bg-').replace('dark:text-', 'dark:bg-')}/10 ${details.color.replace('text-', 'border-').replace('dark:text-', 'dark:border-')}/20`}>
                                        <Zap size={12} /> VOL: {details.vol}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="hidden xl:block text-right">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5 opacity-70">
                                {currentSlot === 'REST' ? `Next: ${nextSlotInfo.name}` : 'Phase Ending In'}
                            </p>
                            <p className="text-2xl font-bold font-mono text-slate-800 dark:text-white tabular-nums tracking-tight">
                                {formatCountdown(nextSlotInfo.diff)}
                            </p>
                        </div>
                    </div>

                    <div 
                        className="relative group perspective-1000"
                        onMouseEnter={() => setShowInsight(true)}
                        onMouseLeave={() => setShowInsight(false)}
                    >
                        <div className={`p-4 rounded-xl border transition-all duration-300 shadow-sm ${showInsight ? 'bg-indigo-600 text-white border-indigo-400' : 'bg-slate-900/60 dark:bg-white/[0.04] border-slate-800/80 dark:border-white/[0.06] backdrop-blur-md hover:border-indigo-500/30 dark:hover:border-white/[0.12]'}`}>
                            {showInsight ? (
                                <div className="animate-in fade-in zoom-in-95 duration-300">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <div className="p-1 rounded-md bg-indigo-500/30">
                                            <ShieldAlert size={12} className="text-indigo-200" />
                                        </div>
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-200">Institutional Context</p>
                                    </div>
                                    <p className="text-sm font-bold leading-tight italic tracking-tight">
                                        "{details.insight}"
                                    </p>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-6">
                                    <div className="flex-1">
                                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 opacity-70">Trading Directive</p>
                                        <div className="flex items-center gap-3">
                                            {details.risk === 'high' && <ZapOff size={18} className="text-rose-500" />}
                                            <p className={`text-base font-bold tracking-tight leading-tight ${details.color}`}>
                                                {details.directive}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="p-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-400 group-hover:text-indigo-500 transition-colors">
                                        <Info size={18} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* RIGHT: Market Sentiment & VIX */}
                <div className="lg:col-span-5 p-6 flex flex-col justify-center bg-transparent backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl ${isRed ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30' : marketStatus === 'AMBER' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/30' : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30'}`}>
                                <Gauge size={22} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 opacity-70">Market Sentiment</p>
                                <h3 className={`font-bold text-lg tracking-tight leading-none ${statusColor}`}>
                                    {isRed ? 'DEFENSIVE' : marketStatus === 'AMBER' ? 'CAUTIOUS' : 'OPTIMAL'}
                                </h3>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 opacity-70">India VIX</p>
                            <p className="text-2xl font-bold text-slate-800 dark:text-white font-mono leading-none tracking-tight">
                                {marketVix.toFixed(2)}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider opacity-80">
                            <span className="flex items-center gap-1.5">
                                <Activity size={12} className="text-indigo-500" />
                                Volatility Meter
                            </span>
                            <span>{isRed ? 'Extreme Risk' : marketStatus === 'AMBER' ? 'Elevated Risk' : 'Low Fear'}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.06] p-0.5 overflow-hidden">
                            <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: isRed ? '15%' : marketStatus === 'AMBER' ? '50%' : '85%' }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className={`h-full rounded-full shadow-sm ${isRed ? 'bg-gradient-to-r from-rose-600 to-rose-400' : marketStatus === 'AMBER' ? 'bg-gradient-to-r from-amber-600 to-amber-400' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'}`}
                            />
                        </div>
                        <div className="p-3 rounded-wa-md bg-slate-900/60 dark:bg-wa-surface/60 border border-slate-800/80 dark:border-wa-border">
                            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-400 leading-tight italic">
                                {isRed ? 'High fear environment. Aggressively protect capital. All momentum setups are currently invalidated.' : marketStatus === 'AMBER' ? 'Mixed institutional flow. Reduce position sizes and wait for clear trend breakouts.' : 'Optimal conditions. Low volatility favors momentum and trend continuation strategies.'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MarketPulse;