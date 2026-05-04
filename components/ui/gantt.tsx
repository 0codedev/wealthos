import * as React from "react";
import { cn } from "@/lib/utils";

export interface GanttTask {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  progress?: number; // 0-100
  color?: string;
}

export interface GanttProps {
  tasks: GanttTask[];
  startDate: string; // timeline window start
  endDate: string; // timeline window end
  className?: string;
}

export const Gantt: React.FC<GanttProps> = ({
  tasks,
  startDate,
  endDate,
  className,
}) => {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const totalDuration = endMs - startMs;

  const getPosition = (taskStart: string, taskEnd: string) => {
    const tStart = new Date(taskStart).getTime();
    const tEnd = new Date(taskEnd).getTime();

    const left = Math.max(0, ((tStart - startMs) / totalDuration) * 100);
    const width = Math.min(100 - left, ((tEnd - tStart) / totalDuration) * 100);

    return { left: `${left}%`, width: `${width}%` };
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-[#0E101A] p-4 text-slate-100 shadow-lg overflow-x-auto",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10 text-xs font-mono text-slate-400">
        <span>Timeline Start: {startDate}</span>
        <span>Timeline End: {endDate}</span>
      </div>

      <div className="space-y-3 min-w-[500px]">
        {tasks.map((task) => {
          const { left, width } = getPosition(task.startDate, task.endDate);
          return (
            <div key={task.id} className="space-y-1">
              <div className="flex justify-between text-xs font-medium text-slate-300">
                <span>{task.name}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {task.startDate} → {task.endDate}
                </span>
              </div>
              <div className="relative h-6 w-full rounded-lg bg-white/5 overflow-hidden">
                <div
                  className={cn(
                    "absolute top-0 bottom-0 rounded-md bg-indigo-600 flex items-center px-2 text-[10px] font-bold text-white shadow-sm overflow-hidden",
                    task.color
                  )}
                  style={{ left, width }}
                >
                  {task.progress !== undefined && (
                    <div
                      className="absolute inset-0 bg-white/20"
                      style={{ width: `${task.progress}%` }}
                    />
                  )}
                  <span className="relative z-10 truncate">{task.name}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
Gantt.displayName = "Gantt";
