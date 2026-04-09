
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
    Calendar, 
    Clock, 
    AlertCircle, 
    TrendingUp, 
    Zap,
    ChevronRight,
    Circle
} from 'lucide-react';
import { indianFinancialCalendarService, CalendarEvent } from '../../../services/IndianFinancialCalendarService';

export const FinancialCalendarWidget: React.FC = () => {
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [isMarketOpen, setIsMarketOpen] = useState(false);
    const [nextExpiry, setNextExpiry] = useState<any>(null);

    useEffect(() => {
        const updateCalendar = () => {
            setEvents(indianFinancialCalendarService.getUpcomingEvents(30).slice(0, 5));
            setIsMarketOpen(indianFinancialCalendarService.isMarketOpen());
            setNextExpiry(indianFinancialCalendarService.getDaysToNextExpiry());
        };

        updateCalendar();
        const interval = setInterval(updateCalendar, 60000); // Update every minute
        return () => clearInterval(interval);
    }, []);

    const getCategoryStyles = (category: string) => {
        switch (category) {
            case 'holiday': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
            case 'fno_expiry': return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
            case 'rbi': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
            case 'earnings_season': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-slate-900/50 border border-slate-800 rounded-[2rem] h-full flex flex-col relative overflow-hidden group"
        >
            {/* Header */}
            <div className="flex justify-between items-center mb-6 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-indigo-500/10 rounded-xl">
                        <Calendar className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-200">Market Calendar</h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <div className={`w-2 h-2 rounded-full animate-pulse ${isMarketOpen ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
                            <span className={`text-[10px] font-black uppercase tracking-tighter ${isMarketOpen ? 'text-emerald-400' : 'text-rose-400'}`}>
                                Market {isMarketOpen ? 'Open' : 'Closed'}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <span className="block text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Next Expiry</span>
                    <span className="text-sm font-black text-white font-mono">
                        {nextExpiry?.days} Days
                    </span>
                </div>
            </div>

            {/* Event List */}
            <div className="flex-1 space-y-3 relative z-10">
                {events.map((event, i) => (
                    <motion.div 
                        key={i}
                        whileHover={{ x: 4 }}
                        className="flex items-center justify-between p-3 bg-slate-800/30 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-all group/item"
                    >
                        <div className="flex items-center gap-3">
                            <div className="text-center min-w-[32px]">
                                <span className="block text-[10px] font-black text-slate-500 uppercase leading-none">
                                    {event.date.toLocaleString('default', { month: 'short' })}
                                </span>
                                <span className="block text-sm font-black text-white leading-tight">
                                    {event.date.getDate()}
                                </span>
                            </div>
                            <div className="w-px h-6 bg-slate-700" />
                            <div>
                                <h4 className="text-[11px] font-bold text-slate-200 line-clamp-1">{event.title}</h4>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-md border ${getCategoryStyles(event.category)}`}>
                                        {event.category.replace('_', ' ')}
                                    </span>
                                    {event.importance === 'high' && (
                                        <Zap className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                                    )}
                                </div>
                            </div>
                        </div>
                        <ChevronRight className="w-3 h-3 text-slate-600 opacity-0 group-hover/item:opacity-100 transition-opacity" />
                    </motion.div>
                ))}
            </div>

            {/* Footer Stats */}
            <div className="mt-6 pt-4 border-t border-slate-800/50 grid grid-cols-2 gap-4 relative z-10">
                <div className="flex items-center gap-2">
                    <TrendingUp className="w-3 h-3 text-indigo-400" />
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">
                        {nextExpiry?.type} Cycle
                    </span>
                </div>
                <div className="flex items-center gap-2 justify-end">
                    <Clock className="w-3 h-3 text-slate-500" />
                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tighter">
                        9:15 - 15:30 IST
                    </span>
                </div>
            </div>

            {/* Background Glow */}
            <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-indigo-500/5 blur-3xl rounded-full group-hover:bg-indigo-500/10 transition-colors" />
        </motion.div>
    );
};

export default FinancialCalendarWidget;
