import * as React from "react";
import { Search, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AutocompleteOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
}

export interface AutocompleteProps {
  options: AutocompleteOption[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const Autocomplete: React.FC<AutocompleteProps> = ({
  options,
  value = "",
  onChange,
  placeholder = "Search and select...",
  className,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  React.useEffect(() => {
    if (selectedOption) {
      setQuery(selectedOption.label);
    }
  }, [selectedOption]);

  const filteredOptions = React.useMemo(() => {
    if (!query) return options;
    const lower = query.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lower) ||
        opt.value.toLowerCase().includes(lower) ||
        opt.description?.toLowerCase().includes(lower)
    );
  }, [options, query]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <div className="relative flex items-center">
        <Search className="absolute left-3 h-4 w-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          className={cn(
            "h-9 w-full rounded-[8px] bg-[#0E101A] pl-9 pr-8 text-xs text-slate-100 placeholder:text-slate-500 border border-white/10 transition-all outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500",
            // Preset overrides
            "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
            "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
            "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
            ""
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              onChange("");
              inputRef.current?.focus();
            }}
            className="absolute right-2.5 text-slate-400 hover:text-white p-0.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-[8px] border border-white/10 bg-[#0E101A] p-1 text-xs shadow-xl backdrop-blur-md">
          {filteredOptions.length === 0 ? (
            <div className="p-3 text-center text-slate-500 text-[11px]">
              No results found
            </div>
          ) : (
            filteredOptions.map((opt) => (
              <div
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setQuery(opt.label);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex items-center justify-between rounded px-2.5 py-1.5 cursor-pointer text-slate-300 hover:bg-indigo-600/20 hover:text-white transition-colors",
                  opt.value === value && "bg-indigo-600/30 text-indigo-300 font-bold"
                )}
              >
                <div>
                  <div className="font-medium">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[10px] text-slate-500 font-normal">
                      {opt.description}
                    </div>
                  )}
                </div>
                {opt.value === value && <Check className="h-3.5 w-3.5 text-indigo-400 shrink-0 ml-2" />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
Autocomplete.displayName = "Autocomplete";
