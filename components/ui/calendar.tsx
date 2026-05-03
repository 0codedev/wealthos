import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CalendarProps {
  selectedDate?: Date;
  onSelectDate?: (date: Date) => void;
  className?: string;
  minDate?: Date;
  maxDate?: Date;
}

export const Calendar: React.FC<CalendarProps> = ({
  selectedDate,
  onSelectDate,
  className,
  minDate,
  maxDate,
}) => {
  const [currentMonth, setCurrentMonth] = React.useState(
    selectedDate ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1) : new Date()
  );

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const daysOfWeek = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();

  const prevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const isToday = (d: number) => {
    const today = new Date();
    return (
      today.getDate() === d &&
      today.getMonth() === month &&
      today.getFullYear() === year
    );
  };

  const isSelected = (d: number) => {
    if (!selectedDate) return false;
    return (
      selectedDate.getDate() === d &&
      selectedDate.getMonth() === month &&
      selectedDate.getFullYear() === year
    );
  };

  const isDisabled = (d: number) => {
    const current = new Date(year, month, d);
    if (minDate && current < new Date(minDate.setHours(0, 0, 0, 0))) return true;
    if (maxDate && current > new Date(maxDate.setHours(23, 59, 59, 999))) return true;
    return false;
  };

  return (
    <div
      className={cn(
        "p-3 rounded-xl border border-white/10 bg-[#0E101A] text-slate-100 w-[280px] shadow-lg",
        // Preset overrides
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
        <span className="text-xs font-bold font-mono text-slate-200">
          {monthNames[month]} {year}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {daysOfWeek.map((d) => (
          <span key={d} className="text-[10px] font-bold text-slate-500">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {Array.from({ length: firstDayIndex }).map((_, i) => (
          <div key={`empty-${i}`} className="h-7 w-7" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const selected = isSelected(day);
          const today = isToday(day);
          const disabled = isDisabled(day);

          return (
            <button
              key={day}
              type="button"
              disabled={disabled}
              onClick={() => onSelectDate?.(new Date(year, month, day))}
              className={cn(
                "h-7 w-7 rounded-md text-xs font-mono transition-all flex items-center justify-center",
                today && !selected && "border border-indigo-500/50 text-indigo-400 font-bold",
                selected
                  ? "bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/30"
                  : "text-slate-300 hover:bg-white/10 hover:text-white",
                disabled && "opacity-30 cursor-not-allowed hover:bg-transparent"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};
Calendar.displayName = "Calendar";
