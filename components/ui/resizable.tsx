import * as React from "react";
import { GripVertical, GripHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ResizableProps {
  direction?: "horizontal" | "vertical";
  defaultSize?: number; // percentage of first panel (e.g. 50)
  minSize?: number;
  maxSize?: number;
  firstPanel: React.ReactNode;
  secondPanel: React.ReactNode;
  className?: string;
}

export const Resizable: React.FC<ResizableProps> = ({
  direction = "horizontal",
  defaultSize = 50,
  minSize = 20,
  maxSize = 80,
  firstPanel,
  secondPanel,
  className,
}) => {
  const [size, setSize] = React.useState(defaultSize);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const isDragging = React.useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    let newSize = defaultSize;
    if (direction === "horizontal") {
      newSize = ((e.clientX - rect.left) / rect.width) * 100;
    } else {
      newSize = ((e.clientY - rect.top) / rect.height) * 100;
    }

    if (newSize >= minSize && newSize <= maxSize) {
      setSize(newSize);
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  const isH = direction === "horizontal";

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex w-full h-full overflow-hidden select-none",
        isH ? "flex-row" : "flex-col",
        className
      )}
    >
      <div
        style={{ [isH ? "width" : "height"]: `${size}%` }}
        className="overflow-auto"
      >
        {firstPanel}
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "flex items-center justify-center bg-white/10 hover:bg-indigo-500 transition-colors z-20",
          isH ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"
        )}
      >
        {isH ? (
          <GripVertical className="h-3 w-3 text-slate-400 pointer-events-none" />
        ) : (
          <GripHorizontal className="h-3 w-3 text-slate-400 pointer-events-none" />
        )}
      </div>

      <div
        style={{ [isH ? "width" : "height"]: `${100 - size}%` }}
        className="overflow-auto"
      >
        {secondPanel}
      </div>
    </div>
  );
};
Resizable.displayName = "Resizable";
