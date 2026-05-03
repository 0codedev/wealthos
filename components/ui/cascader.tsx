import * as React from "react";
import { ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CascaderOption {
  value: string;
  label: string;
  children?: CascaderOption[];
}

export interface CascaderProps {
  options: CascaderOption[];
  value?: string[];
  onChange: (value: string[], selectedOptions: CascaderOption[]) => void;
  placeholder?: string;
  className?: string;
}

export const Cascader: React.FC<CascaderProps> = ({
  options,
  value = [],
  onChange,
  placeholder = "Select cascading path...",
  className,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState<CascaderOption[]>([]);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (option: CascaderOption, level: number) => {
    const newPath = [...selectedPath.slice(0, level), option];
    setSelectedPath(newPath);

    if (!option.children || option.children.length === 0) {
      onChange(
        newPath.map((o) => o.value),
        newPath
      );
      setIsOpen(false);
    }
  };

  const columns: CascaderOption[][] = [options];
  selectedPath.forEach((item) => {
    if (item.children && item.children.length > 0) {
      columns.push(item.children);
    }
  });

  const displayText =
    value.length > 0
      ? value.join(" / ")
      : placeholder;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "h-9 w-full rounded-[8px] border border-white/10 bg-[#0E101A] px-3 text-left text-xs text-slate-200 transition-all flex items-center justify-between",
          // Presets
          "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
          "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
          "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
          ""
        )}
      >
        <span className={cn("truncate", value.length === 0 && "text-slate-500")}>
          {displayText}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0 ml-2" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 flex max-h-64 rounded-xl border border-white/10 bg-[#0E101A] shadow-2xl backdrop-blur-xl overflow-hidden divide-x divide-white/10">
          {columns.map((colOptions, colIdx) => (
            <div key={colIdx} className="w-44 max-h-60 overflow-y-auto p-1 text-xs">
              {colOptions.map((opt) => {
                const isSelected = selectedPath[colIdx]?.value === opt.value;
                const hasChildren = opt.children && opt.children.length > 0;

                return (
                  <div
                    key={opt.value}
                    onClick={() => handleSelect(opt, colIdx)}
                    className={cn(
                      "flex items-center justify-between rounded px-2.5 py-1.5 cursor-pointer text-slate-300 hover:bg-indigo-600/20 hover:text-white transition-colors",
                      isSelected && "bg-indigo-600/30 text-indigo-300 font-bold"
                    )}
                  >
                    <span className="truncate">{opt.label}</span>
                    {hasChildren ? (
                      <ChevronRight className="h-3 w-3 text-slate-500 shrink-0 ml-1" />
                    ) : isSelected ? (
                      <Check className="h-3 w-3 text-indigo-400 shrink-0 ml-1" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
Cascader.displayName = "Cascader";
