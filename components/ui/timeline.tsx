import * as React from "react";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  time: string;
  status?: "completed" | "current" | "upcoming";
  icon?: React.ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

export const Timeline: React.FC<TimelineProps> = ({ items, className }) => {
  return (
    <div className={cn("space-y-6 relative pl-6", className)}>
      {/* Connector Line */}
      <div className="absolute left-2.5 top-2 bottom-2 w-px bg-white/10" />

      {items.map((item) => {
        const isCompleted = item.status === "completed";
        const isCurrent = item.status === "current";

        return (
          <div key={item.id} className="relative group">
            {/* Status Dot */}
            <div
              className={cn(
                "absolute -left-6 top-0.5 h-5 w-5 rounded-full border-2 border-[#0E101A] flex items-center justify-center transition-all",
                isCompleted && "bg-emerald-500 text-white",
                isCurrent && "bg-indigo-600 text-white ring-4 ring-indigo-500/20",
                !isCompleted && !isCurrent && "bg-slate-800 border-white/20"
              )}
            >
              {item.icon ? (
                item.icon
              ) : (
                <div
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isCompleted && "bg-white",
                    isCurrent && "bg-white",
                    !isCompleted && !isCurrent && "bg-slate-500"
                  )}
                />
              )}
            </div>

            {/* Content */}
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-100">
                  {item.title}
                </span>
                <span className="font-mono text-[10px] text-slate-500 shrink-0">
                  {item.time}
                </span>
              </div>
              {item.description && (
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  {item.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
Timeline.displayName = "Timeline";
