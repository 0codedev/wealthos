import React, { useMemo, useState } from 'react';
import { CalendarDays, Info, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Target, BarChart2, Zap, LayoutGrid, Calendar as CalendarIcon, Clock, Activity, CheckCircle2, XCircle } from 'lucide-react';
import { Trade } from '../../../database';
import { formatCurrency } from '../../../utils/helpers';
import { useLiteModeStore } from '../../../store/liteModeStore';

interface SeasonalHeatmapProps {
  trades: Trade[];
  isVisible?: boolean;
}

type ViewMode = 'YEAR' | 'MONTH' | 'WEEK';

export const SeasonalHeatmap = React.memo(({ trades, isVisible }: SeasonalHeatmapProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>('YEAR');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth()); // 0-11
  const [referenceDate, setReferenceDate] = useState(new Date()); // For week view
  const isLiteMode = useLiteModeStore(state => state.isLiteMode);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']; // Removed Sat/Sun

  // --- CORE FILTERING ---

  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      const d = new Date(t.date);
      // Ensure we don't include any accidental weekend data in calculations
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) return false;

      if (viewMode === 'YEAR') return d.getFullYear() === selectedYear;
      if (viewMode === 'MONTH') return d.getFullYear() === selectedYear && d.getMonth() === selectedMonth;
      if (viewMode === 'WEEK') {
        const startOfWeek = new Date(referenceDate);
        // Find Monday of the reference week
        const diff = referenceDate.getDay() === 0 ? -6 : 1 - referenceDate.getDay();
        startOfWeek.setDate(referenceDate.getDate() + diff);
        startOfWeek.setHours(0,0,0,0);
        
        const endOfTradingWeek = new Date(startOfWeek);
        endOfTradingWeek.setDate(startOfWeek.getDate() + 4); // Friday
        endOfTradingWeek.setHours(23,59,59,999);
        
        return d >= startOfWeek && d <= endOfTradingWeek;
      }
      return false;
    });
  }, [trades, viewMode, selectedYear, selectedMonth, referenceDate]);

  // --- STATS CALCULATION (Accurate & Strictly Trading Based) ---

  const stats = useMemo(() => {
    const totalTrades = filteredTrades.length;
    if (totalTrades === 0) return { totalPnL: 0, winRate: 0, maxProfit: 0, maxLoss: 0, totalTrades: 0 };
    
    let totalPnL = 0;
    let wins = 0;
    let maxProfit = -Infinity;
    let maxLoss = Infinity;

    filteredTrades.forEach(t => {
      const pnl = t.pnl || 0;
      totalPnL += pnl;
      if (pnl > 0) wins++;
      if (pnl > maxProfit) maxProfit = pnl;
      if (pnl < maxLoss) maxLoss = pnl;
    });

    return {
      totalPnL,
      winRate: (wins / totalTrades) * 100,
      maxProfit: maxProfit === -Infinity ? 0 : maxProfit,
      maxLoss: maxLoss === Infinity ? 0 : maxLoss,
      totalTrades
    };
  }, [filteredTrades]);

  // --- VIEW DATA PREPARATION ---

  // 1. YEAR VIEW (Skip Sat/Sun)
  const heatmapData = useMemo(() => {
    if (viewMode !== 'YEAR') return null;
    const grid = Array.from({ length: 12 }, () => Array.from({ length: 31 }, () => ({ pnl: 0, count: 0, wins: 0, losses: 0, isWeekend: false })));
    let maxAbs = 0;
    
    // Pre-mark weekends in the grid
    for(let m = 0; m < 12; m++) {
        for(let d = 0; d < 31; d++) {
            const date = new Date(selectedYear, m, d + 1);
            if (date.getMonth() === m) {
                const dow = date.getDay();
                if (dow === 0 || dow === 6) grid[m][d].isWeekend = true;
            }
        }
    }

    filteredTrades.forEach(t => {
      const d = new Date(t.date);
      const m = d.getMonth();
      const day = d.getDate() - 1;
      const pnl = t.pnl || 0;
      grid[m][day].pnl += pnl;
      grid[m][day].count++;
      if (pnl > 0) grid[m][day].wins++;
      else if (pnl < 0) grid[m][day].losses++;
    });
    
    grid.forEach(m => m.forEach(d => { if(!d.isWeekend) maxAbs = Math.max(maxAbs, Math.abs(d.pnl)); }));
    return { grid, maxAbs: maxAbs || 1 };
  }, [filteredTrades, viewMode, selectedYear]);

  // 2. MONTH VIEW (5-Day Calendar Grid: Mon-Fri)
  const monthCalendarData = useMemo(() => {
    if (viewMode !== 'MONTH') return null;
    
    // We want a 5-column grid. Padding depends on the first Monday.
    const firstDayOfMonth = new Date(selectedYear, selectedMonth, 1);
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    
    // Find how many padding days (Mon=0, Tue=1...)
    let firstWeekday = firstDayOfMonth.getDay(); // 0=Sun, 1=Mon...
    if (firstWeekday === 0) firstWeekday = 1; // Treat Sun start as Mon for layout if needed, but safer logic below
    else if (firstWeekday === 6) firstWeekday = 1; 

    // Adjust padding to only Mon-Fri
    // 1=Mon(0 pad), 2=Tue(1 pad), 3=Wed(2 pad), 4=Thu(3 pad), 5=Fri(4 pad)
    // If it starts on Sat/Sun, the first visible day is the following Monday.
    const paddingCount = firstDayOfMonth.getDay() === 0 ? 0 : (firstDayOfMonth.getDay() === 6 ? 0 : firstDayOfMonth.getDay() - 1);
    
    const days = [];
    for (let i = 0; i < paddingCount; i++) days.push({ day: null, trades: [], pnl: 0, wins: 0, losses: 0 }); 
    
    let maxAbs = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(selectedYear, selectedMonth, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue; // Skip weekends

      const dayTrades = filteredTrades.filter(t => new Date(t.date).getDate() === d);
      const dayPnL = dayTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
      const wins = dayTrades.filter(t => (t.pnl || 0) > 0).length;
      const losses = dayTrades.filter(t => (t.pnl || 0) < 0).length;
      maxAbs = Math.max(maxAbs, Math.abs(dayPnL));
      days.push({ day: d, trades: dayTrades, pnl: dayPnL, wins, losses });
    }
    return { days, maxAbs: maxAbs || 1 };
  }, [filteredTrades, viewMode, selectedYear, selectedMonth]);

  // 3. WEEK VIEW (5-Day Focus: Mon-Fri)
  const weekDaysData = useMemo(() => {
    if (viewMode !== 'WEEK') return null;
    
    const startOfWeek = new Date(referenceDate);
    // Move to Monday
    const diff = referenceDate.getDay() === 0 ? -6 : 1 - referenceDate.getDay();
    startOfWeek.setDate(referenceDate.getDate() + diff);
    startOfWeek.setHours(0,0,0,0);
    
    const days = [];
    let maxAbs = 0;
    
    for (let i = 0; i < 5; i++) { // Only 5 days
        const dDate = new Date(startOfWeek);
        dDate.setDate(startOfWeek.getDate() + i);
        
        const dayTrades = filteredTrades.filter(t => {
            const td = new Date(t.date);
            return td.getDate() === dDate.getDate() && td.getMonth() === dDate.getMonth();
        });
        const dayPnL = dayTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
        const wins = dayTrades.filter(t => (t.pnl || 0) > 0).length;
        const losses = dayTrades.filter(t => (t.pnl || 0) < 0).length;
        maxAbs = Math.max(maxAbs, Math.abs(dayPnL));
        
        days.push({ date: dDate, dayName: weekDays[i], trades: dayTrades, pnl: dayPnL, wins, losses });
    }
    return { days, maxAbs: maxAbs || 1 };
  }, [filteredTrades, viewMode, referenceDate]);

  if (!isVisible && isVisible !== undefined) return null;

  if (isLiteMode) {
    return (
      <div className="p-5 lg:px-6 lg:py-8 bg-[#0F172A] border border-white/10 rounded-3xl flex flex-col items-center justify-center gap-4 text-center">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <Zap size={32} className="text-orange-500" />
        </div>
        <div>
          <h3 className="text-lg font-black text-white uppercase tracking-widest">Seasonal Matrix (Paused)</h3>
          <p className="text-xs text-slate-500 mt-1">Analytics hidden in Lite Mode to save CPU.</p>
        </div>
      </div>
    );
  }

  // --- UTILS ---

  const getColorScale = (pnl: number, maxAbs: number) => {
    if (pnl === 0) return 'rgba(255, 255, 255, 0.04)';
    const intensity = Math.min(Math.abs(pnl) / maxAbs, 1);
    const opacity = 0.3 + (intensity * 0.7);
    if (pnl > 0) return `rgba(16, 185, 129, ${opacity})`;
    return `rgba(244, 63, 94, ${opacity})`;
  };

  const nextRange = () => {
    if (viewMode === 'YEAR') setSelectedYear(prev => prev + 1);
    if (viewMode === 'MONTH') {
      if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear(prev => prev + 1); }
      else setSelectedMonth(prev => prev + 1);
    }
    if (viewMode === 'WEEK') {
      const next = new Date(referenceDate);
      next.setDate(referenceDate.getDate() + 7);
      setReferenceDate(next);
    }
  };

  const prevRange = () => {
    if (viewMode === 'YEAR') setSelectedYear(prev => prev - 1);
    if (viewMode === 'MONTH') {
      if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear(prev => prev - 1); }
      else setSelectedMonth(prev => prev - 1);
    }
    if (viewMode === 'WEEK') {
      const prev = new Date(referenceDate);
      prev.setDate(referenceDate.getDate() - 7);
      setReferenceDate(prev);
    }
  };

  const KPICard = ({ title, value, sub, icon, type }: any) => (
    <div className="bg-[#0B1120] p-4 rounded-2xl border border-slate-800 flex flex-col gap-2">
      <div className="flex justify-between items-center text-slate-500">
        <span className="text-[9px] font-black uppercase tracking-widest">{title}</span>
        {icon}
      </div>
      <div className="text-xl font-black text-white">{value}</div>
      <div className={`text-[9px] font-bold ${type === 'good' ? 'text-emerald-500' : type === 'bad' ? 'text-rose-500' : 'text-slate-600'}`}>{sub}</div>
    </div>
  );

  return (
    <div className="p-5 lg:px-6 lg:py-5 bg-[#0F172A] border border-white/10 rounded-3xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)] flex flex-col gap-6 relative overflow-hidden group/hub transition-all duration-500 hover:border-slate-700">
      {/* Background Ambience */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-600/10 blur-[150px] rounded-full -mr-48 -mt-48 transition-opacity duration-1000 opacity-20 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-indigo-600/10 blur-[150px] rounded-full -ml-48 -mb-48 transition-opacity duration-1000 opacity-20 pointer-events-none" />
      
      {/* HEADER SECTION */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 relative z-10">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl shadow-[inset_0_0_20px_rgba(249,115,22,0.1)] transition-transform duration-500">
            <CalendarDays className="w-6 h-6 text-orange-500" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white tracking-tighter flex items-center gap-2">
              Seasonal Analytics
              <span className="text-[8px] px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-black uppercase tracking-[0.2em] shadow-[0_0_15px_rgba(249,115,22,0.2)]">PRO MATRIX</span>
            </h3>
            <p className="text-slate-400 font-medium text-xs mt-0.5 max-w-sm leading-relaxed tracking-wide">High-density performance heatmaps & cyclical tracking engine.</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full xl:w-auto">
          {/* View Toggles */}
          <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-700/50 backdrop-blur-xl w-full sm:w-auto shadow-inner">
            {(['YEAR', 'MONTH', 'WEEK'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black tracking-widest transition-all duration-300 flex items-center justify-center gap-2 ${viewMode === mode ? 'bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-[0_8px_20px_rgba(249,115,22,0.4)] scale-[1.02] z-10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
              >
                {mode === 'YEAR' && <LayoutGrid size={12} className={viewMode === mode ? 'animate-pulse' : ''} />}
                {mode === 'MONTH' && <CalendarIcon size={12} className={viewMode === mode ? 'animate-pulse' : ''} />}
                {mode === 'WEEK' && <Zap size={12} className={viewMode === mode ? 'animate-pulse' : ''} />}
                {mode}
              </button>
            ))}
          </div>

          {/* Time Navigation */}
          <div className="flex items-center bg-slate-900/80 p-1 rounded-xl border border-slate-700/50 backdrop-blur-xl w-full sm:w-auto overflow-hidden shadow-inner">
            <button onClick={prevRange} aria-label="Previous period" className="px-3 py-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"><ChevronLeft size={18} /></button>
            <div className="min-w-[120px] text-center px-2">
                <div className="text-[11px] font-black text-white uppercase tracking-[0.2em]">
                    {viewMode === 'YEAR' && selectedYear}
                    {viewMode === 'MONTH' && `${months[selectedMonth]} ${selectedYear}`}
                    {viewMode === 'WEEK' && `WK ${Math.ceil(referenceDate.getDate() / 7)} • ${months[referenceDate.getMonth()]}`}
                </div>
            </div>
            <button onClick={nextRange} aria-label="Next period" className="px-3 py-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>

      {/* KPI SCOREBOARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 relative z-10">
        <KPICard title="Period Net PnL" value={formatCurrency(stats.totalPnL)} sub="REALIZED RETURN" icon={<BarChart2 size={14}/>} type={ stats.totalPnL >= 0 ? 'good' : 'bad' } />
        <KPICard title="Strike Rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.totalTrades} EXES`} icon={<Target size={14}/>} type={stats.winRate >= 50 ? 'good' : 'neutral'} />
        <KPICard title="Peak Velocity" value={formatCurrency(stats.maxProfit)} sub="BEST OUTCOME" icon={<TrendingUp size={14}/>} type="good" />
        <KPICard title="Max Drawdown" value={formatCurrency(stats.maxLoss)} sub="WORST OUTCOME" icon={<TrendingDown size={14}/>} type="bad" />
      </div>

      {/* MAIN VIEWPORT */}
      <div className="relative min-h-[380px] bg-[#0B1120] rounded-2xl border border-slate-800/80 p-5 lg:p-6 flex items-center justify-center z-10 shadow-[inset_0_0_30px_rgba(0,0,0,0.5)]">
        {/* Subtle grid background */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        
          {viewMode === 'YEAR' && heatmapData && (
            <div className="flex flex-col gap-1.5 w-full max-w-6xl">
              <div className="flex ml-[44px] mb-1">
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <div key={d} className="flex-1 text-center text-[9px] text-slate-600 font-bold tracking-tight">{d % 5 === 0 || d === 1 ? d : ''}</div>
                ))}
              </div>
              {months.map((m, mIdx) => (
                <div key={m} className="flex items-center gap-3 relative">
                  <span className="text-[10px] text-slate-500 font-black w-8 text-right uppercase tracking-widest">{m}</span>
                  <div className="flex flex-1 gap-1 h-[18px]">
                    {heatmapData.grid[mIdx].map((dayData, dIdx) => {
                      const isValid = new Date(selectedYear, mIdx, dIdx + 1).getMonth() === mIdx;
                      if (!isValid || dayData.isWeekend) return <div key={dIdx} className="flex-1 rounded-[4px] opacity-0 pointer-events-none" />;
                      
                      const hasTrades = dayData.count > 0;
                      return (
                        <div 
                          key={dIdx} 
                          className="flex-1 rounded-[4px] transition-transform cursor-crosshair group relative hover:z-50 hover:scale-[1.3] border border-white/5"
                          style={{ backgroundColor: getColorScale(dayData.pnl, heatmapData.maxAbs) }}
                        >
                           {hasTrades && (
                             <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900/95 backdrop-blur-md border border-slate-700 p-2.5 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-all duration-200">
                               <div className="flex justify-between gap-4 mb-1.5 text-[8px] uppercase font-black text-slate-500 tracking-widest border-b border-white/5 pb-1.5">
                                 <span>{months[mIdx]} {dIdx + 1}, {selectedYear}</span>
                                 <span>{dayData.count} EXES</span>
                               </div>
                               <p className={`font-black text-lg tracking-tighter ${dayData.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                 {dayData.pnl >= 0 ? '+' : ''}{formatCurrency(dayData.pnl)}
                               </p>
                               <div className="flex items-center gap-3 mt-2 bg-black/40 p-1.5 rounded-md">
                                 <div className="flex items-center gap-1">
                                   <CheckCircle2 size={10} className="text-emerald-500" />
                                   <span className="text-[9px] font-black text-emerald-400">{dayData.wins}</span>
                                 </div>
                                 <div className="flex items-center gap-1">
                                   <XCircle size={10} className="text-rose-500" />
                                   <span className="text-[9px] font-black text-rose-400">{dayData.losses}</span>
                                 </div>
                                 <div className="flex flex-col ml-auto text-right">
                                   <span className="text-[7px] text-slate-500 font-bold uppercase">Avg</span>
                                   <span className="text-[9px] font-black text-blue-400">{formatCurrency(dayData.pnl / dayData.count)}</span>
                                 </div>
                               </div>
                             </div>
                           )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              </div>
          )}

          {/* ================= MONTH VIEW ================= */}
          {viewMode === 'MONTH' && monthCalendarData && (
            <div className="w-full max-w-5xl mx-auto flex flex-col gap-4">
              <div className="grid grid-cols-5 gap-2 sm:gap-3 w-full">
                {weekDays.map(d => (
                  <div key={d} className="text-center text-[10px] text-slate-500 uppercase font-black tracking-[0.2em] pb-2 border-b border-slate-800">{d}</div>
                ))}
                {monthCalendarData.days.map((dayData, i) => {
                  if (!dayData.day) return <div key={`empty-${i}`} className="min-h-[80px] bg-slate-900/30 rounded-2xl border border-white/[0.01]" />;
                  
                  const { day, trades, pnl, wins, losses } = dayData;
                  const isWin = pnl > 0;
                  const hasTrades = trades.length > 0;

                  return (
                    <div 
                      key={day}
                      className={`min-h-[80px] flex flex-col justify-between p-2.5 sm:p-3 rounded-2xl transition-all relative group cursor-crosshair border ${hasTrades ? (isWin ? 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20 hover:border-rose-500/50 hover:bg-rose-500/20') : 'bg-slate-900 border-slate-800 hover:bg-slate-800'}`}
                    >
                       <div className="flex justify-between items-start">
                          <span className={`text-xs font-black ${hasTrades ? (isWin ? 'text-emerald-500' : 'text-rose-500') : 'text-slate-600'}`}>{day}</span>
                          {hasTrades && <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-black/40 text-slate-300 tracking-widest">{trades.length} T</span>}
                       </div>
                       
                       <div className="mt-2 flex items-end justify-end">
                          {hasTrades && (
                              <span className={`text-xs sm:text-base font-black tracking-tighter ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {isWin ? '+' : ''}{formatCurrency(pnl)}
                              </span>
                          )}
                       </div>

                       {/* Exquisite Floating Tooltip */}
                       {hasTrades && (
                           <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 bg-[#0B1120]/95 backdrop-blur-md border border-slate-700/80 p-2 rounded-xl shadow-[0_20px_40px_-10px_rgba(0,0,0,0.8)] z-[100] opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-all duration-200 transform scale-95 group-hover:scale-100">
                             {/* Sprint 3.4: compressed padding/gaps/type ~15% per user request */}
                             <div className="flex justify-between gap-4 mb-2 text-[8px] uppercase font-black text-slate-500 tracking-widest border-b border-white/5 pb-1.5">
                               <span className="flex items-center gap-1"><CalendarIcon size={9}/>{months[selectedMonth]} {day}, {selectedYear}</span>
                               <span className="flex items-center gap-1"><Activity size={9}/>{trades.length} EXES</span>
                             </div>
                             <div className="flex justify-between items-end mb-2">
                                <div className="flex flex-col">
                                   <span className="text-[7px] text-slate-500 font-bold uppercase tracking-[0.18em] mb-0.5">Period Net</span>
                                   <span className={`text-xl font-black tracking-tighter ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {isWin ? '+' : ''}{formatCurrency(pnl)}
                                   </span>
                                </div>
                                <div className="flex flex-col items-end">
                                   <span className="text-[7px] text-slate-500 font-bold uppercase mb-0.5">Avg Efficiency</span>
                                   <span className="text-[11px] font-black text-blue-400">{formatCurrency(pnl / trades.length)}</span>
                                </div>
                             </div>
                            
                             <div className="grid grid-cols-2 gap-1.5 mb-2">
                                <div className="bg-emerald-500/5 border border-emerald-500/10 p-1 rounded-lg flex items-center justify-between">
                                   <div className="flex items-center gap-1">
                                      <CheckCircle2 size={9} className="text-emerald-500" />
                                      <span className="text-[8px] font-black text-emerald-400">WINS</span>
                                   </div>
                                   <span className="text-[9px] font-black text-white">{wins}</span>
                                </div>
                                <div className="bg-rose-500/5 border border-rose-500/10 p-1 rounded-lg flex items-center justify-between">
                                   <div className="flex items-center gap-1">
                                      <XCircle size={9} className="text-rose-500" />
                                      <span className="text-[8px] font-black text-rose-400">LOSSES</span>
                                   </div>
                                   <span className="text-[9px] font-black text-white">{losses}</span>
                                </div>
                             </div>

                            <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                               <div className={`h-full rounded-full transition-all ${isWin ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, Math.max(5, (Math.abs(pnl) / monthCalendarData.maxAbs) * 100))}%` }} />
                            </div>
                          </div>
                       )}
                    </div>
                  );
                })}
              </div>
              </div>
          )}

          {/* ================= WEEK VIEW ================= */}
          {viewMode === 'WEEK' && weekDaysData && (
            <div className="w-full max-w-4xl mx-auto flex flex-col gap-3">
               <div className="grid grid-cols-5 gap-3 h-[220px]">
                  {weekDaysData.days.map((dayData, i) => {
                     const hasTrades = dayData.trades.length > 0;
                     const isWin = dayData.pnl > 0;
                     const heightPct = hasTrades ? Math.max(15, (Math.abs(dayData.pnl) / weekDaysData.maxAbs) * 100) : 5;

                     return (
                         <div key={i} className="flex flex-col justify-end items-center group relative cursor-crosshair h-full">
                            {/* Floating Tooltip */}
                            {hasTrades && (
                                <div className="absolute bottom-[calc(100%+15px)] bg-[#0B1120]/95 backdrop-blur-md border border-slate-700/80 p-3 rounded-xl shadow-[0_15px_30px_-5px_rgba(0,0,0,0.8)] z-[100] opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-all duration-200 transform scale-95 group-hover:scale-100 flex flex-col items-center min-w-[150px]">
                                    <span className="text-[9px] text-slate-500 font-black tracking-[0.2em] mb-0.5">{dayData.dayName.toUpperCase()}, {dayData.date.getDate()}</span>
                                    <span className={`text-2xl font-black tracking-tighter ${isWin ? 'text-emerald-400' : 'text-rose-400'}`}>{isWin ? '+' : ''}{formatCurrency(dayData.pnl)}</span>
                                    
                                    <div className="w-full grid grid-cols-2 gap-2 mt-3">
                                       <div className="flex flex-col items-center">
                                          <span className="text-[7px] text-slate-500 font-black uppercase">Wins</span>
                                          <span className="text-[10px] font-black text-emerald-400">{dayData.wins}</span>
                                       </div>
                                       <div className="flex flex-col items-center border-l border-white/5">
                                          <span className="text-[7px] text-slate-500 font-black uppercase">Losses</span>
                                          <span className="text-[10px] font-black text-rose-400">{dayData.losses}</span>
                                       </div>
                                    </div>

                                    <div className="w-full h-px bg-white/5 my-2" />
                                    
                                    <div className="flex items-center justify-between w-full text-[8px] text-slate-500 font-bold uppercase tracking-widest px-1">
                                       <span>Avg/Trade</span>
                                       <span className="text-blue-400">{formatCurrency(dayData.pnl / dayData.trades.length)}</span>
                                    </div>
                                </div>
                            )}
                            
                            <div 
                                className={`w-full max-w-[50px] rounded-t-xl transition-all relative overflow-hidden ${hasTrades ? (isWin ? 'bg-emerald-500 hover:bg-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.3)]' : 'bg-rose-500 hover:bg-rose-400 shadow-[0_0_40px_rgba(244,63,94,0.3)]') : 'bg-slate-800'}`}
                                style={{ height: `${heightPct}%` }}
                            >
                                {/* Inner gradient shine */}
                                <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-50" />
                              </div>
                            <div className="mt-3 flex flex-col items-center">
                                <span className="text-xs font-black text-slate-400">{dayData.dayName}</span>
                                <span className="text-[10px] font-bold text-slate-600 mt-0.5">{dayData.date.getDate()}</span>
                            </div>
                         </div>
                     )
                  })}
               </div>
              </div>
          )}

          {/* ================= EMPTY STATE ================= */}
          {stats.totalTrades === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B1120]/80 backdrop-blur-sm z-50 rounded-[2rem]">
              <div className="p-6 rounded-3xl bg-slate-900 border border-slate-800 mb-4 shadow-2xl shadow-black/50">
                <Clock size={40} className="text-slate-500" />
              </div>
              <span className="text-base uppercase tracking-[0.3em] font-black text-slate-300 mb-2">No Market Intel</span>
              <span className="text-sm text-slate-500 font-medium">No closed positions logged for this timeframe.</span>
            </div>
          )}
      </div>

    </div>
  );
});

// Sub-component for Scoreboards
const KPICard = ({ title, value, sub, icon, type }: { title: string, value: string, sub: string, icon: React.ReactNode, type: 'good' | 'bad' | 'neutral' }) => (
  <div 
    className="p-4 lg:p-5 bg-[#0B1120] border border-slate-800 rounded-2xl relative group/kpi transition-all duration-300 overflow-hidden shadow-[inset_0_0_20px_rgba(0,0,0,0.2)] hover:border-slate-600"
  >
    <div className={`absolute -right-10 -top-10 w-24 h-24 blur-[40px] opacity-10 group-hover/kpi:opacity-30 transition-opacity duration-500 rounded-full ${type === 'good' ? 'bg-emerald-500' : type === 'bad' ? 'bg-rose-500' : 'bg-slate-400'}`} />
    
    <div className="flex items-center justify-between mb-3 relative z-10">
      <div className={`p-2 rounded-lg border border-white/5 bg-slate-900/80 text-slate-400 group-hover/kpi:text-white transition-colors`}>
        {icon}
      </div>
      <div className={`flex items-center gap-1 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest border border-white/5 bg-slate-900/50 ${type === 'good' ? 'text-emerald-400' : type === 'bad' ? 'text-rose-400' : 'text-slate-400'}`}>
         {type === 'good' ? 'WIN' : type === 'bad' ? 'LOSS' : 'NEU'}
      </div>
    </div>

    <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] relative z-10">{title}</span>
    <p className={`text-2xl lg:text-3xl font-black tracking-tighter mt-1 relative z-10 drop-shadow-md ${type === 'good' ? 'text-emerald-400' : type === 'bad' ? 'text-rose-400' : 'text-white'}`}>
        {value}
    </p>
    <p className="text-[8px] text-slate-500 font-bold uppercase tracking-widest mt-2 relative z-10">{sub}</p>
  </div>
);
