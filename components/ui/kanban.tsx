import * as React from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KanbanItem {
  id: string;
  title: string;
  description?: string;
  tag?: string;
  priority?: "low" | "medium" | "high";
}

export interface KanbanColumnData {
  id: string;
  title: string;
  items: KanbanItem[];
}

export interface KanbanProps {
  columns: KanbanColumnData[];
  onItemMove?: (itemId: string, sourceColId: string, destColId: string) => void;
  className?: string;
}

export const Kanban: React.FC<KanbanProps> = ({
  columns,
  onItemMove,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex gap-4 overflow-x-auto pb-4 pt-1",
        className
      )}
    >
      {columns.map((col) => (
        <div
          key={col.id}
          className={cn(
            "w-72 shrink-0 rounded-2xl border border-white/10 bg-[#0E101A] p-3 flex flex-col max-h-[75vh]",
            // Presets
            "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
            "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
            "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-lg",
            ""
          )}
        >
          {/* Column Header */}
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                {col.title}
              </span>
              <span className="px-1.5 py-0.2 rounded-full bg-white/10 text-slate-400 text-[10px] font-mono">
                {col.items.length}
              </span>
            </div>
            <button
              type="button"
              className="text-slate-500 hover:text-white p-1 rounded hover:bg-white/5"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Card List */}
          <div className="flex-1 overflow-y-auto space-y-2 p-0.5">
            {col.items.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-xl border border-white/5 bg-white/[0.03] hover:border-indigo-500/40 hover:bg-white/[0.06] transition-all cursor-pointer shadow-sm group"
              >
                <div className="text-xs font-bold text-slate-100 group-hover:text-indigo-300 transition-colors">
                  {item.title}
                </div>
                {item.description && (
                  <div className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {item.description}
                  </div>
                )}
                <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-white/5">
                  {item.tag && (
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                      {item.tag}
                    </span>
                  )}
                  {item.priority && (
                    <span
                      className={cn(
                        "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                        item.priority === "high" && "bg-rose-500/20 text-rose-300",
                        item.priority === "medium" && "bg-amber-500/20 text-amber-300",
                        item.priority === "low" && "bg-emerald-500/20 text-emerald-300"
                      )}
                    >
                      {item.priority}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
Kanban.displayName = "Kanban";
