
import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Calendar, CheckCircle2, Activity, Layers, Eye, EyeOff } from 'lucide-react';
import { Trade, DailyReview } from '../../database';
import { formatCurrency } from '../../utils/helpers';
import { useSettingsStore } from '../../store/settingsStore';

interface PnLCalendarProps {
  trades: Trade[];
  dailyReviews?: DailyReview[];
  onDateSelect: (date: string | null) => void;
  selectedDate: string | null;
  onSetMarketCondition?: (date: string, condition: 'Trending' | 'Choppy' | 'Volatile' | 'Sideways') => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MARKET_COLORS: Record<string, string> = {
  'Trending': 'bg-emerald-500',
  'Choppy': 'bg-amber-500',
  'Volatile': 'bg-fuchsia-500',
  'Sideways': 'bg-slate-400'
};

const PnLCalendar: React.FC<PnLCalendarProps> = React.memo(({ trades, dailyReviews = [], onDateSelect, selectedDate, onSetMarketCondition }) => {
  const designPreset = useSettingsStore((s) => s.designPreset);
  const isAstryx = designPreset === 'astryx';
  const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

  const [currentDate, setCurrentDate] = useState(new Date());
  const [showOverlay, setShowOverlay] = useState(false);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Use a ref for the tooltip to avoid re-rendering the whole calendar on every mouse move
  const tooltipRef = React.useRef<HTMLDivElement>(null);

  // --- Calendar Logic ---
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // --- Data Aggregation ---
  const dailyData = useMemo(() => {
    const map: Record<string, { pnl: number, grossPnl: number, count: number, wins: number, holdingCount: number, marketCondition?: string, hasIpo?: boolean, ipoGain?: number }> = {};

    trades.forEach(t => {
      const dateStr = t.date ? (t.date.includes('T') ? t.date.split('T')[0] : t.date) : '';
      if (!dateStr) return;
      if (!map[dateStr]) map[dateStr] = { pnl: 0, grossPnl: 0, count: 0, wins: 0, holdingCount: 0, hasIpo: false, ipoGain: 0 };

      const isIpo = (Array.isArray(t.tags) && (t.tags.includes('IPO') || t.tags.includes('ListingGain'))) || (typeof t.notes === 'string' && t.notes.includes('IPO'));
      if (isIpo) {
        map[dateStr].hasIpo = true;
        map[dateStr].ipoGain = (map[dateStr].ipoGain || 0) + (t.pnl || 0);
      }

      if (t.isStitchedEntry) {
        map[dateStr].holdingCount = (map[dateStr].holdingCount || 0) + 1;
      } else {
        map[dateStr].pnl += (t.pnl || 0);
        map[dateStr].grossPnl += (t.pnl || 0) + (t.fees || 0);
        if ((t.pnl || 0) > 0) map[dateStr].wins += 1;
      }
      map[dateStr].count += 1;
    });

    // Map Market Conditions
    dailyReviews.forEach(r => {
      if (map[r.date]) {
        map[r.date].marketCondition = r.marketCondition;
      } else {
        map[r.date] = { pnl: 0, grossPnl: 0, count: 0, wins: 0, holdingCount: 0, marketCondition: r.marketCondition };
      }
    });

    return map;
  }, [trades, dailyReviews]);

  const monthStats = useMemo(() => {
    let totalPnL = 0;
    let wins = 0;
    let losses = 0;
    let tradeCount = 0;

    Object.entries(dailyData).forEach(([date, data]) => {
      const d = data as { pnl: number, count: number, wins: number };
      if (new Date(date).getMonth() === month && new Date(date).getFullYear() === year && d.count > 0) {
        totalPnL += d.pnl;
        tradeCount += d.count;
        if (d.pnl > 0) wins++;
        else if (d.pnl < 0) losses++;
      }
    });

    return { totalPnL, wins, losses, tradeCount };
  }, [dailyData, month, year]);

  // --- Handlers ---
  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const handleDateClick = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (selectedDate === dateStr) {
      onDateSelect(null); // Deselect
    } else {
      onDateSelect(dateStr);
    }
  };

  // --- Render Helpers ---
  const renderDayCell = (day: number, isCurrentMonth: boolean) => {
    if (!isCurrentMonth) return <div className="h-24 md:h-32 bg-slate-50/50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl opacity-50 pointer-events-none"></div>;

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const data = dailyData[dateStr];
    const hasTrades = !!data && data.count > 0;
    const isProfit = hasTrades && data.pnl >= 0;
    const isSelected = selectedDate === dateStr;
    const marketColor = data?.marketCondition ? MARKET_COLORS[data.marketCondition] : null;

    // Deep emerald gradient for profitable days, deep crimson for losses,
    // subtle slate-gray for flat/no-trade days. Intensity scales with magnitude.
    const magnitude = hasTrades ? Math.min(Math.abs(data.pnl) / 5000, 1) : 0;
    const intensityClass = hasTrades
      ? isProfit
        ? magnitude > 0.5
          ? 'bg-gradient-to-br from-emerald-400/35 via-emerald-500/25 to-emerald-600/15 border-emerald-300/50 dark:from-emerald-400/25 dark:via-emerald-500/15 dark:to-emerald-700/10 dark:border-emerald-500/30'
          : 'bg-gradient-to-br from-emerald-300/25 via-emerald-400/15 to-emerald-500/10 border-emerald-200/60 dark:from-emerald-500/15 dark:via-emerald-600/10 dark:to-emerald-700/5 dark:border-emerald-500/20'
        : magnitude > 0.5
          ? 'bg-gradient-to-br from-rose-400/35 via-rose-500/25 to-rose-600/15 border-rose-300/50 dark:from-rose-400/25 dark:via-rose-500/15 dark:to-rose-700/10 dark:border-rose-500/30'
          : 'bg-gradient-to-br from-rose-300/25 via-rose-400/15 to-rose-500/10 border-rose-200/60 dark:from-rose-500/15 dark:via-rose-600/10 dark:to-rose-700/5 dark:border-rose-500/20'
      : 'bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800';

    return (
      <div
        onClick={() => handleDateClick(day)}
        onMouseEnter={(e) => {
          if (hasTrades) {
            setHoveredDate(dateStr);
            setMousePos({ x: e.clientX, y: e.clientY });
          }
        }}
        onMouseMove={(e) => {
          if (hasTrades) {
            // We still update mousePos but we could optimize further with a portal or CSS vars
            setMousePos({ x: e.clientX, y: e.clientY });
          }
        }}
        onMouseLeave={() => setHoveredDate(null)}
        className={`h-24 md:h-32 p-2 relative transition-all cursor-pointer group hover:scale-[1.02] hover:shadow-xl hover:z-10 overflow-hidden border
          ${isAstryx ? "rounded-[10px] border-white/[0.102] font-['Figtree',sans-serif]" : isReui ? "rounded-lg border-zinc-800 font-sans" : "rounded-2xl border-slate-200 dark:border-slate-800 font-sans"}
          ${isSelected
            ? (isAstryx ? 'ring-2 ring-white/50 shadow-2xl' : isReui ? 'ring-2 ring-zinc-500 ring-offset-1 dark:ring-offset-zinc-950 shadow-xl' : 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-slate-950 shadow-2xl')
            : ''
          }
          ${intensityClass}
        `}
      >
        {/* Market Context Overlay */}
        {showOverlay && marketColor && (
          <div
            className={`absolute top-0 right-0 w-8 h-8 -mr-4 -mt-4 transform rotate-45 ${marketColor} opacity-80 z-10 shadow-sm`}
            title={`Market: ${data.marketCondition}`}
          ></div>
        )}

        <div className="flex justify-between items-start relative z-0">
          <span className={`text-sm font-bold ${hasTrades ? (isProfit ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300') : 'text-slate-400'}`}>
            {day || 0}
          </span>
          {hasTrades && (
            <div className="flex items-center gap-1">
              {data.hasIpo && (
                <span className="text-[9px] font-extrabold px-1 py-0.5 rounded bg-amber-500/20 text-amber-500 dark:text-amber-400 border border-amber-500/30" title="IPO Listing Gains">
                  🚀 IPO
                </span>
              )}
              <span className="text-[10px] font-bold bg-white/80 dark:bg-black/30 px-1.5 py-0.5 rounded-md backdrop-blur-sm text-slate-700 dark:text-slate-200">
                {data.count || 0}T
              </span>
            </div>
          )}
        </div>

        {hasTrades && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className={`text-sm md:text-base font-black tracking-tight drop-shadow-sm ${isProfit ? 'text-emerald-700 dark:text-emerald-200' : 'text-rose-700 dark:text-rose-200'}`}>
              {isProfit ? '+' : ''}{formatCurrency(data.pnl)}
            </div>
            <div className="flex gap-1 mt-1">
              {/* Mini Dots for trade wins/losses/holdings visualization */}
              {Array.from({ length: Math.min(data.count, 6) }).map((_, i) => {
                // Determine color based on index
                let color = 'bg-rose-400';
                const hCount = data.holdingCount || 0;
                const wCount = data.wins || 0;

                if (i < hCount) color = 'bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.5)]';
                else if (i < hCount + wCount) color = 'bg-emerald-400';

                return <div key={i} className={`w-1.5 h-1.5 rounded-full ${color}`}></div>;
              })}
              {data.count > 5 && <span className="text-[8px] text-slate-500 leading-none">+</span>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">

      {/* Month Header & Stats - Single sleek row on mobile, spacious on desktop */}
      <div className={`flex items-center justify-between gap-2 sm:gap-4 p-2.5 sm:p-4 border shadow-sm ${isAstryx ? "border-white/[0.102] bg-[#1b1b1b] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "border-zinc-800 bg-zinc-900/90 rounded-xl font-sans" : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl font-sans"}`}>
        
        {/* Month Selector */}
        <div className={`flex items-center p-0.5 sm:p-1 border shrink-0 ${isAstryx ? 'bg-[#141414] border-white/[0.102] rounded-full' : isReui ? 'bg-zinc-800 border-zinc-700 rounded-md' : 'bg-slate-100 dark:bg-slate-800 border-transparent rounded-xl'}`}>
          <button 
            onClick={prevMonth} 
            className="p-1 sm:p-2 hover:bg-white dark:hover:bg-slate-700 rounded-lg shadow-sm transition-all text-slate-500"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} className="sm:w-5 sm:h-5" />
          </button>
          
          {/* Compact text on mobile: "Sep '26", full on desktop: "September 2026" */}
          <h2 className="w-16 sm:w-40 text-center font-bold text-xs sm:text-lg text-slate-800 dark:text-white truncate">
            <span className="inline sm:hidden">{MONTHS[month].slice(0, 3)} '{String(year).slice(-2)}</span>
            <span className="hidden sm:inline">{MONTHS[month]} <span className="text-indigo-500">{year}</span></span>
          </h2>
          
          <button 
            onClick={nextMonth} 
            className="p-1 sm:p-2 hover:bg-white dark:hover:bg-slate-700 rounded-lg shadow-sm transition-all text-slate-500"
            aria-label="Next month"
          >
            <ChevronRight size={16} className="sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Stats Strip & Action in a unified horizontal line */}
        <div className="flex items-center gap-2 sm:gap-6 min-w-0">
          {/* Net PnL */}
          <div className="text-right sm:text-center min-w-0">
            <p className="hidden sm:block text-[10px] uppercase font-bold text-slate-400">Net P&L</p>
            <p className={`text-xs sm:text-lg font-black font-mono truncate ${monthStats.totalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {monthStats.totalPnL >= 0 ? '+' : ''}₹{formatCurrency(monthStats.totalPnL)}
            </p>
          </div>

          <div className="h-4 sm:h-8 w-px bg-slate-200 dark:bg-slate-800 shrink-0"></div>

          {/* Win Rate */}
          <div className="text-center shrink-0">
            <p className="hidden sm:block text-[10px] uppercase font-bold text-slate-400">Win Rate</p>
            <p className="text-xs sm:text-lg font-black text-slate-700 dark:text-slate-300">
              {monthStats.tradeCount > 0 ? ((monthStats.wins / monthStats.tradeCount) * 100).toFixed(0) : '0'}%
            </p>
          </div>

          {/* Correlation Overlay Toggle (1:1 square icon on mobile) */}
          <button
            onClick={() => setShowOverlay(!showOverlay)}
            className={`flex items-center justify-center gap-1.5 p-0 sm:px-3 sm:py-2 w-7 h-7 sm:w-auto sm:h-auto aspect-square sm:aspect-auto rounded-lg text-xs font-bold transition-all border shrink-0 ${
              showOverlay 
                ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300' 
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500'
            }`}
            title="Correlation Overlay"
            aria-label="Toggle Correlation Overlay"
          >
            {showOverlay ? <Eye size={14} /> : <EyeOff size={14} />}
            <span className="hidden sm:inline">Correlation Overlay</span>
          </button>
        </div>
      </div>

      {showOverlay && (
        <div className="flex flex-col items-center gap-2 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
            {selectedDate ? `Set Market Condition for ${selectedDate}` : 'Market Correlation Overlay (Select a day to set)'}
          </p>
          <div className="flex flex-wrap gap-4 justify-center text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {(['Trending', 'Choppy', 'Volatile', 'Sideways'] as const).map(condition => {
              const colorClass = MARKET_COLORS[condition];
              const isSelected = selectedDate && dailyReviews.find(r => r.date === selectedDate)?.marketCondition === condition;
              return (
                <button
                  key={condition}
                  disabled={!selectedDate}
                  onClick={() => onSetMarketCondition?.(selectedDate!, condition)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all ${
                    !selectedDate
                      ? 'opacity-60 cursor-not-allowed border-transparent'
                      : isSelected
                      ? 'bg-indigo-500/10 border-indigo-500/30 text-slate-800 dark:text-white ring-1 ring-indigo-500/20'
                      : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${colorClass} ${isSelected ? 'scale-110 shadow-sm' : ''}`}></div>
                  {condition}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Calendar Grid */}
      <div className={`p-4 border shadow-inner ${isAstryx ? "bg-[#141414] border-white/[0.102] rounded-[12px] font-['Figtree',sans-serif]" : isReui ? "bg-zinc-950 border-zinc-800 rounded-xl font-sans" : "bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 rounded-3xl font-sans"}`}>
        <div className="overflow-x-auto table-scroll">
          <div className="min-w-[620px]">
            <div className="grid grid-cols-7 mb-4">
              {DAYS.map(d => (
                <div key={d} className="text-center text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2 md:gap-4">
              {/* Empty slots for previous month */}
              {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                renderDayCell(i, false)
              ))}

              {/* Days of current month */}
              {Array.from({ length: daysInMonth }).map((_, i) => (
                renderDayCell(i + 1, true)
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Premium Floating Tooltip */}
      <CalendarTooltip 
        hoveredDate={hoveredDate}
        data={hoveredDate ? dailyData[hoveredDate] : null}
        mousePos={mousePos}
      />
    </div>
  );
});

// Extracted Tooltip to prevent parent re-renders if optimized correctly
// For now, even just separating the logic helps with readability and potential future optimizations
const CalendarTooltip = ({ hoveredDate, data, mousePos }: { hoveredDate: string | null, data: any, mousePos: { x: number, y: number } }) => {
    if (!hoveredDate || !data) return null;
    if (typeof window === 'undefined') return null;

    const winRate = data.count > 0 ? (data.wins / data.count) * 100 : 0;
    const tradeCount = data.count || 0;
    const feeAmount = Math.abs(data.grossPnl - data.pnl);

    return createPortal(
        <div
            style={{
                position: 'fixed',
                left: mousePos.x + 20,
                top: mousePos.y - 160,
                zIndex: 1000,
                pointerEvents: 'none',
                opacity: 1
            }}
            className="hidden md:block w-60 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700 p-4 rounded-2xl shadow-2xl overflow-hidden"
        >
            <div className={`absolute top-0 left-0 w-1 h-full ${data.pnl >= 0 ? 'bg-gradient-to-b from-emerald-400 to-emerald-600' : 'bg-gradient-to-b from-rose-400 to-rose-600'}`}></div>

            <div className="space-y-3">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                    <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{hoveredDate}</p>
                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${data.pnl >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400'}`}>
                        {data.pnl >= 0 ? 'Profitable' : 'Drawdown'}
                    </div>
                </div>

                {/* Quick stats row: Win Rate + Trade Count */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                        <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Win Rate</p>
                        <p className={`text-sm font-black font-mono ${winRate >= 50 ? 'text-emerald-500' : 'text-rose-500'}`}>{winRate.toFixed(0)}%</p>
                    </div>
                    <div className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-700/50">
                        <p className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Trades</p>
                        <p className="text-sm font-black font-mono text-slate-700 dark:text-slate-200">{tradeCount}</p>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800">
                        <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-tighter">Gross Profit</span>
                        <span className={`text-base font-black ${data.grossPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {data.grossPnl >= 0 ? '+' : ''}{formatCurrency(data.grossPnl)}
                        </span>
                    </div>

                    <div className="pt-1 space-y-1">
                        <div className="flex justify-between">
                            <span className="text-[10px] text-slate-500 font-medium">Platform Charges</span>
                            <span className="text-[10px] font-bold text-rose-500/80">
                                -{formatCurrency(feeAmount)}
                            </span>
                        </div>
                        <div className="flex justify-between items-center opacity-80">
                            <span className="text-[10px] text-slate-500 font-medium">Final Net P&L</span>
                            <span className={`text-[10px] font-bold ${data.pnl >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'}`}>
                                {data.pnl >= 0 ? '+' : ''}{formatCurrency(data.pnl)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default PnLCalendar;
