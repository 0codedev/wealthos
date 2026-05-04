import * as React from "react";
import { Calendar as CalendarIcon, Clock, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  category?: "sip" | "ipo" | "dividend" | "earnings" | "other";
  badge?: string;
}

export interface EventCalendarProps {
  events: CalendarEvent[];
  onEventClick?: (event: CalendarEvent) => void;
  className?: string;
}

export const EventCalendar: React.FC<EventCalendarProps> = ({
  events,
  onEventClick,
  className,
}) => {
  const [selectedDate, setSelectedDate] = React.useState<string>(
    new Date().toISOString().split("T")[0]
  );

  const categoryColors = {
    sip: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    ipo: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    dividend: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    earnings: "bg-sky-500/20 text-sky-300 border-sky-500/30",
    other: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-[#0E101A] p-4 text-slate-100 shadow-lg",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-indigo-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Market Event Calendar
          </h4>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          {events.length} Upcoming Events
        </span>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto">
        {events.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No events scheduled
          </div>
        ) : (
          events.map((evt) => {
            const cat = evt.category || "other";
            return (
              <div
                key={evt.id}
                onClick={() => onEventClick?.(evt)}
                className={cn(
                  "flex items-center justify-between p-2.5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] transition-all cursor-pointer",
                  onEventClick && "hover:border-indigo-500/30"
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border",
                      categoryColors[cat]
                    )}
                  >
                    {cat}
                  </span>
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      {evt.title}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 font-mono">
                      <span>{evt.date}</span>
                      {evt.time && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          {evt.time}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {evt.badge && (
                  <span className="text-[10px] font-mono font-bold text-indigo-400 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-800/40">
                    {evt.badge}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
EventCalendar.displayName = "EventCalendar";
