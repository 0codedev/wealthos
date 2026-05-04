import * as React from "react";
import { Filter, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
  id: string;
  label: string;
  count?: number;
}

export interface FilterGroup {
  id: string;
  label: string;
  options: FilterOption[];
}

export interface FiltersProps {
  groups: FilterGroup[];
  selectedFilters: Record<string, string[]>; // groupId -> optionIds
  onChange: (selected: Record<string, string[]>) => void;
  className?: string;
}

export const Filters: React.FC<FiltersProps> = ({
  groups,
  selectedFilters,
  onChange,
  className,
}) => {
  const [activeGroup, setActiveGroup] = React.useState<string | null>(null);

  const totalActive = Object.values(selectedFilters).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  const toggleOption = (groupId: string, optionId: string) => {
    const current = selectedFilters[groupId] || [];
    const updated = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId];

    onChange({
      ...selectedFilters,
      [groupId]: updated,
    });
  };

  const clearAll = () => {
    onChange({});
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold uppercase tracking-wider px-2 py-1 bg-white/5 rounded-lg border border-white/5">
        <Filter className="h-3.5 w-3.5 text-indigo-400" />
        <span>Filters</span>
        {totalActive > 0 && (
          <span className="ml-1 px-1.5 py-0.2 rounded-full bg-indigo-600 text-white text-[10px] font-mono">
            {totalActive}
          </span>
        )}
      </div>

      {groups.map((group) => {
        const activeInGroup = selectedFilters[group.id] || [];
        const isSelected = activeInGroup.length > 0;

        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              onClick={() =>
                setActiveGroup(activeGroup === group.id ? null : group.id)
              }
              className={cn(
                "h-7 px-2.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5",
                isSelected
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-200"
                  : "bg-white/5 border-white/10 text-slate-300 hover:border-white/20 hover:text-white"
              )}
            >
              <span>{group.label}</span>
              {activeInGroup.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-indigo-500 text-white text-[9px] font-mono">
                  {activeInGroup.length}
                </span>
              )}
            </button>

            {activeGroup === group.id && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setActiveGroup(null)}
                />
                <div className="absolute left-0 top-full mt-1.5 z-50 min-w-[180px] rounded-xl border border-white/10 bg-[#0E101A] p-2 shadow-2xl backdrop-blur-xl text-xs space-y-1">
                  {group.options.map((opt) => {
                    const checked = activeInGroup.includes(opt.id);
                    return (
                      <div
                        key={opt.id}
                        onClick={() => toggleOption(group.id, opt.id)}
                        className={cn(
                          "flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors",
                          checked
                            ? "bg-indigo-600/20 text-indigo-300 font-semibold"
                            : "text-slate-300 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "h-3.5 w-3.5 rounded border flex items-center justify-center transition-all",
                              checked
                                ? "bg-indigo-600 border-indigo-600"
                                : "border-slate-500"
                            )}
                          >
                            {checked && <Check className="h-2.5 w-2.5 text-white" />}
                          </div>
                          <span>{opt.label}</span>
                        </div>
                        {opt.count !== undefined && (
                          <span className="text-[10px] font-mono text-slate-500">
                            {opt.count}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}

      {totalActive > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="h-7 px-2 text-[11px] font-bold text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors"
        >
          <X className="h-3 w-3" />
          Clear all
        </button>
      )}
    </div>
  );
};
Filters.displayName = "Filters";
