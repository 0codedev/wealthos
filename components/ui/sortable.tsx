import * as React from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SortableItemData {
  id: string;
  content: React.ReactNode;
}

export interface SortableProps {
  items: SortableItemData[];
  onReorder: (newItems: SortableItemData[]) => void;
  className?: string;
}

export const Sortable: React.FC<SortableProps> = ({
  items,
  onReorder,
  className,
}) => {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const updated = [...items];
    const item = updated.splice(draggedIndex, 1)[0];
    updated.splice(index, 0, item);

    setDraggedIndex(index);
    onReorder(updated);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {items.map((item, idx) => {
        const isDragging = draggedIndex === idx;

        return (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            className={cn(
              "flex items-center gap-2.5 p-3 rounded-xl border border-white/10 bg-[#0E101A] transition-all cursor-grab active:cursor-grabbing",
              isDragging
                ? "opacity-50 border-indigo-500 scale-[0.98]"
                : "hover:border-white/20 hover:bg-white/[0.04]",
              // Presets
              "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
              "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
              "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-lg",
              ""
            )}
          >
            <GripVertical className="h-4 w-4 text-slate-500 shrink-0 pointer-events-none" />
            <div className="flex-1 min-w-0">{item.content}</div>
          </div>
        );
      })}
    </div>
  );
};
Sortable.displayName = "Sortable";
