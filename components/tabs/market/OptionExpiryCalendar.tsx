
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Calendar as CalendarIcon, 
    ChevronLeft, 
    ChevronRight, 
    Info, 
    AlertCircle,
    TrendingUp,
    Zap,
    Target,
    Shield
} from 'lucide-react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday, startOfWeek, endOfWeek, addDays, isSameMonth } from 'date-fns';

interface ExpiryEvent {
    id: string;
    date: Date;
    segment: 'NIFTY' | 'BANKNIFTY' | 'FINNIFTY' | 'MIDCAP' | 'SENSEX' | 'STOCKS';
    type: 'Weekly' | 'Monthly';
    description: string;
    color: string;
}

const HOLIDAYS_2026 = [
    '2026-01-26', // Republic Day
    '2026-03-17', // Mahashivratri
    '2026-03-30', // Holi
    '2026-04-02', // Ram Navami
    '2026-04-10', // Good Friday
    '2026-04-14', // Ambedkar Jayanti
    '2026-05-01', // Maharashtra Day
    '2026-10-02', // Gandhi Jayanti
    '2026-10-20', // Dussehra
    '2026-11-05', // Diwali
    '2026-12-25', // Christmas
];

const SEGMENT_CONFIG = {
    NIFTY: { color: 'bg-indigo-500', text: 'text-indigo-400', border: 'border-indigo-500/30' },
    BANKNIFTY: { color: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    FINNIFTY: { color: 'bg-purple-500', text: 'text-purple-400', border: 'border-purple-500/30' },
    MIDCAP: { color: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/30' },
    SENSEX: { color: 'bg-rose-500', text: 'text-rose-400', border: 'border-rose-500/30' },
    STOCKS: { color: 'bg-slate-500', text: 'text-slate-400', border: 'border-slate-500/30' },
};

export const OptionExpiryCalendar: React.FC = () => {
    const [currentDate, setCurrentDate] = useState(new Date(2026, 3, 28)); // Default to user's "today"
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

    const getExpiryEvents = (date: Date): ExpiryEvent[] => {
        const events: ExpiryEvent[] = [];
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayOfWeek = format(date, 'EEEE');
        const isLastTuesday = isSameDay(date, endOfMonth(date)) || (dayOfWeek === 'Tuesday' && isSameMonth(date, addDays(date, 7)) === false);
        const isLastThursday = dayOfWeek === 'Thursday' && isSameMonth(date, addDays(date, 7)) === false;

        // Holiday Check (Simplification: Expiry moves to previous trading day)
        // In a real app, we'd recursively check for holidays.
        if (HOLIDAYS_2026.includes(dateStr)) return [];

        // Monday: Midcap Nifty
        if (dayOfWeek === 'Monday') {
            events.push({ id: `midcap-${dateStr}`, date, segment: 'MIDCAP', type: 'Weekly', description: 'Midcap Nifty Expiry', color: SEGMENT_CONFIG.MIDCAP.color });
        }

        // Tuesday: Nifty 50, Bank Nifty, FinNifty (Consolidated in 2026)
        if (dayOfWeek === 'Tuesday') {
            const type = isLastTuesday ? 'Monthly' : 'Weekly';
            events.push({ id: `nifty-${dateStr}`, date, segment: 'NIFTY', type, description: `Nifty 50 ${type} Expiry`, color: SEGMENT_CONFIG.NIFTY.color });
            events.push({ id: `banknifty-${dateStr}`, date, segment: 'BANKNIFTY', type, description: `Bank Nifty ${type} Expiry`, color: SEGMENT_CONFIG.BANKNIFTY.color });
            events.push({ id: `finnifty-${dateStr}`, date, segment: 'FINNIFTY', type: 'Weekly', description: 'FinNifty Weekly Expiry', color: SEGMENT_CONFIG.FINNIFTY.color });
        }

        // Thursday: Sensex (BSE) / Stocks
        if (dayOfWeek === 'Thursday') {
            events.push({ id: `sensex-${dateStr}`, date, segment: 'SENSEX', type: 'Weekly', description: 'Sensex Weekly Expiry', color: SEGMENT_CONFIG.SENSEX.color });
            if (isLastThursday) {
                events.push({ id: `stocks-${dateStr}`, date, segment: 'STOCKS', type: 'Monthly', description: 'Equity Derivatives (Stocks) Expiry', color: SEGMENT_CONFIG.STOCKS.color });
            }
        }

        return events;
    };

    const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

    const selectedEvents = useMemo(() => selectedDate ? getExpiryEvents(selectedDate) : [], [selectedDate]);

    return (
        <div className="flex flex-col h-full gap-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shadow-xl shadow-indigo-500/5">
                        <CalendarIcon className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-black bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent uppercase tracking-tighter leading-none">
                            Option Expiry Calendar
                        </h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-1">Multi-Segment Derivatives Roadmap • 2026</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-2xl border border-white/5 backdrop-blur-sm">
                    <button onClick={prevMonth} className="p-2 hover:bg-white/5 rounded-xl text-slate-400 hover:text-white transition-all">
                        <ChevronLeft size={18} />
                    </button>
                    <span className="text-sm font-black text-white px-4 min-w-[140px] text-center uppercase tracking-widest">
                        {format(currentDate, 'MMMM yyyy')}
                    </span>
                    <button onClick={nextMonth} className="p-2 hover:bg-white/5 rounded-xl text-slate-400 hover:text-white transition-all">
                        <ChevronRight size={18} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
                {/* Calendar Grid */}
                <div className="lg:col-span-8 flex flex-col bg-slate-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden backdrop-blur-md shadow-2xl">
                    {/* Days Header */}
                    <div className="grid grid-cols-7 border-b border-white/5 bg-white/5">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                            <div key={day} className="py-4 text-center">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{day}</span>
                            </div>
                        ))}
                    </div>

                    {/* Days Grid */}
                    <div className="grid grid-cols-7 flex-1 min-h-[300px] md:min-h-[400px]">
                        {calendarDays.map((day, i) => {
                            const events = getExpiryEvents(day);
                            const isCurrentMonth = isSameMonth(day, monthStart);
                            const isSelected = selectedDate && isSameDay(day, selectedDate);
                            const isTodayDay = isToday(day);
                            const isHoliday = HOLIDAYS_2026.includes(format(day, 'yyyy-MM-dd'));

                            return (
                                <div 
                                    key={i}
                                    onClick={() => setSelectedDate(day)}
                                    className={`relative p-2 border-r border-b border-white/5 cursor-pointer transition-all hover:bg-white/[0.02] group ${!isCurrentMonth ? 'opacity-20' : ''} ${isSelected ? 'bg-indigo-500/5' : ''}`}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <span className={`text-xs font-black ${isTodayDay ? 'w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white' : isHoliday ? 'text-rose-500' : 'text-slate-400'}`}>
                                            {format(day, 'd')}
                                        </span>
                                        {isHoliday && <div className="w-1 h-1 rounded-full bg-rose-500" title="Market Holiday" />}
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        {events.map(event => (
                                            <div 
                                                key={event.id}
                                                className={`h-1.5 rounded-full ${event.color} shadow-[0_0_8px_rgba(255,255,255,0.1)]`}
                                                title={event.description}
                                            />
                                        ))}
                                    </div>

                                    {isSelected && (
                                        <motion.div 
                                            layoutId="activeDay"
                                            className="absolute inset-0 border-2 border-indigo-500/50 pointer-events-none"
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Details Side Panel */}
                <div className="lg:col-span-4 flex flex-col gap-6">
                    {/* Selected Date Details */}
                    <div className="bg-slate-900/60 border border-white/5 rounded-[2rem] p-6 backdrop-blur-md">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                                <Info size={14} className="text-indigo-400" />
                                Selection Intel
                            </h3>
                            {selectedDate && (
                                <span className="text-[10px] font-bold text-slate-500">
                                    {format(selectedDate, 'do MMM, yyyy')}
                                </span>
                            )}
                        </div>

                        {selectedEvents.length > 0 ? (
                            <div className="space-y-4">
                                {selectedEvents.map(event => (
                                    <motion.div 
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        key={event.id}
                                        className={`p-4 rounded-2xl border ${SEGMENT_CONFIG[event.segment].border} bg-white/5 group hover:bg-white/10 transition-all`}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${SEGMENT_CONFIG[event.segment].text}`}>
                                                {event.segment}
                                            </span>
                                            <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${event.type === 'Monthly' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-800 text-slate-400'}`}>
                                                {event.type}
                                            </span>
                                        </div>
                                        <p className="text-sm font-bold text-slate-200">{event.description}</p>
                                        <div className="mt-3 flex items-center gap-2">
                                            <TrendingUp size={10} className="text-slate-500" />
                                            <span className="text-[10px] text-slate-500 font-medium">Gamma Exposure: High</span>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-4">
                                    <AlertCircle size={20} className="text-slate-600" />
                                </div>
                                <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">No Active Expiries</p>
                                <p className="text-[10px] text-slate-600 mt-1">Select a marked day on the calendar</p>
                            </div>
                        )}
                    </div>

                    {/* Expiry Protocol Card */}
                    <div className="flex-1 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-[2rem] p-6 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
                            <Zap size={160} className="text-indigo-500" />
                        </div>
                        
                        <div className="relative z-10">
                            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-6 flex items-center gap-2">
                                <Shield size={14} className="text-indigo-400" />
                                Execution Guard
                            </h3>
                            
                            <div className="space-y-4">
                                {[
                                    { icon: <Target size={12} />, label: 'Max Pain Neutrality', desc: 'Monitor OI shifts 60m before close.' },
                                    { icon: <AlertCircle size={12} />, label: 'Gamma Risk Management', desc: 'Avoid far-OTM long positions after 1 PM.' },
                                    { icon: <TrendingUp size={12} />, label: 'Vol Expansion', desc: 'Straddle positions favored if VIX < 15.' }
                                ].map((protocol, i) => (
                                    <div key={i} className="flex gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0 text-indigo-400">
                                            {protocol.icon}
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-black text-indigo-100 uppercase tracking-tighter">{protocol.label}</p>
                                            <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{protocol.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 items-center justify-center bg-slate-900/40 p-4 rounded-2xl border border-white/5">
                {Object.entries(SEGMENT_CONFIG).map(([key, config]) => (
                    <div key={key} className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${config.color}`} />
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{key}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
