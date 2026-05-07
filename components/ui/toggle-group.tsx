import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../store/settingsStore";
import { snappyLayout, luxeLayout } from "./motion/variants";

export interface ToggleOption {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface ToggleGroupProps {
  options?: (ToggleOption | string)[];
  value?: string;
  onChange?: (value: string) => void;
  // Radix / shadcn aliases
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  type?: "single";
  size?: "xs" | "sm" | "default" | "md" | "lg";
  className?: string;
  preset?: "astryx" | "reui-nova" | "wealthos-classic" | "shadcn";
  layoutId?: string;
  fullWidth?: boolean;
  ariaLabel?: string;
  children?: React.ReactNode;
}

interface ToggleGroupContextValue {
  selectedValue: string;
  onSelect: (value: string) => void;
  size: "xs" | "sm" | "default" | "md" | "lg";
  preset: "astryx" | "reui-nova" | "wealthos-classic" | "shadcn";
  layoutId: string;
  fullWidth: boolean;
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue | null>(null);

export interface ToggleGroupItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  icon?: React.ReactNode;
  showDivider?: boolean;
}

export const ToggleGroupItem = React.forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  ({ value, icon, showDivider = false, className, children, disabled, ...props }, ref) => {
    const ctx = React.useContext(ToggleGroupContext);
    if (!ctx) {
      throw new Error("ToggleGroupItem must be used within a ToggleGroup");
    }

    const isSelected = ctx.selectedValue === value;
    const isAstryx = ctx.preset === "astryx";
    const isReui = ctx.preset === "reui-nova" || ctx.preset === "shadcn";

    // Size mappings
    const sizeClasses = {
      xs: "text-[10px] px-2 py-0.5 gap-1 min-h-[22px]",
      sm: "text-[11px] px-2.5 py-1 gap-1.5 min-h-[26px]",
      default: "text-xs px-3 py-1.5 gap-1.5 min-h-[30px]",
      md: "text-xs px-3 py-1.5 gap-1.5 min-h-[30px]",
      lg: "text-sm px-4 py-2 gap-2 min-h-[36px]",
    }[ctx.size];

    // Corner radius per preset
    const itemRadius = isAstryx
      ? "rounded-full"
      : isReui
      ? "rounded-[6px]"
      : "rounded-[10px]";

    // Active pill visual per preset
    const activeIndicatorClasses = isAstryx
      ? "bg-white shadow-sm"
      : isReui
      ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/60"
      : "bg-indigo-600 shadow-md";

    // Text color when active vs inactive
    const activeText = isAstryx
      ? "text-[#111111] font-semibold"
      : isReui
      ? "text-zinc-100 font-medium"
      : "text-white font-bold";

    const inactiveText = isAstryx
      ? "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
      : isReui
      ? "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]"
      : "text-slate-400 hover:text-white hover:bg-white/[0.04]";

    return (
      <div className={cn("relative flex items-center", ctx.fullWidth ? "flex-1 min-w-0" : "shrink-0")}>
        {/* Subtle Hairline Segment Divider (NameThatUI authentic) */}
        {showDivider && (
          <span
            aria-hidden="true"
            className={cn(
              "w-px self-center shrink-0 -ml-px transition-opacity duration-150 pointer-events-none",
              ctx.size === "xs" || ctx.size === "sm" ? "h-2.5" : "h-3.5",
              isAstryx
                ? "bg-white/[0.08]"
                : isReui
                ? "bg-zinc-800"
                : "bg-slate-800"
            )}
          />
        )}

        <button
          ref={ref}
          type="button"
          role="radio"
          aria-checked={isSelected}
          tabIndex={isSelected ? 0 : -1}
          disabled={disabled}
          onClick={() => !disabled && ctx.onSelect(value)}
          className={cn(
            "relative z-10 inline-flex items-center justify-center font-medium transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 whitespace-nowrap",
            ctx.fullWidth ? "w-full flex-1 min-w-0" : "shrink-0",
            sizeClasses,
            itemRadius,
            isSelected ? activeText : inactiveText,
            disabled && "opacity-40 cursor-not-allowed pointer-events-none",
            className
          )}
          {...props}
        >
          {isSelected && (
            <motion.span
              layoutId={ctx.layoutId}
              className={cn("absolute inset-0 z-0", itemRadius, activeIndicatorClasses)}
              transition={isAstryx ? snappyLayout : isReui ? snappyLayout : luxeLayout}
            />
          )}
          {icon && (
            <span className="relative z-10 shrink-0 flex items-center justify-center">
              {icon}
            </span>
          )}
          {children && (
            <span className="relative z-10 inline-flex items-center">
              {children}
            </span>
          )}
        </button>
      </div>
    );
  }
);
ToggleGroupItem.displayName = "ToggleGroupItem";

export const ToggleGroup: React.FC<ToggleGroupProps> = ({
  options,
  value: controlledValue,
  onChange,
  defaultValue,
  onValueChange,
  size = "default",
  className,
  preset: presetProp,
  layoutId: customLayoutId,
  fullWidth = false,
  ariaLabel,
  children,
}) => {
  const globalPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";
  const activePreset = presetProp || globalPreset;
  const autoLayoutId = React.useId();
  const activeLayoutId = customLayoutId || `toggle-pill-${autoLayoutId}`;

  const [internalValue, setInternalValue] = React.useState<string>(
    controlledValue ?? defaultValue ?? (options && options.length > 0 ? (typeof options[0] === "string" ? options[0] : options[0].value) : "")
  );

  const currentValue = controlledValue !== undefined ? controlledValue : internalValue;

  const handleSelect = React.useCallback(
    (newVal: string) => {
      if (controlledValue === undefined) {
        setInternalValue(newVal);
      }
      onChange?.(newVal);
      onValueChange?.(newVal);
    },
    [controlledValue, onChange, onValueChange]
  );

  // Normalize options if passed via array
  const normalizedOptions: ToggleOption[] = React.useMemo(() => {
    if (!options) return [];
    return options.map((opt) =>
      typeof opt === "string" ? { value: opt, label: opt } : opt
    );
  }, [options]);

  // Keyboard navigation across options (Left/Right/Up/Down/Home/End)
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (normalizedOptions.length === 0) return;

    const enabledOptions = normalizedOptions.filter((opt) => !opt.disabled);
    const currentIndex = enabledOptions.findIndex((opt) => opt.value === currentValue);

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % enabledOptions.length;
      const nextVal = enabledOptions[nextIndex]?.value;
      if (nextVal) handleSelect(nextVal);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + enabledOptions.length) % enabledOptions.length;
      const prevVal = enabledOptions[prevIndex]?.value;
      if (prevVal) handleSelect(prevVal);
    } else if (e.key === "Home") {
      e.preventDefault();
      const firstVal = enabledOptions[0]?.value;
      if (firstVal) handleSelect(firstVal);
    } else if (e.key === "End") {
      e.preventDefault();
      const lastVal = enabledOptions[enabledOptions.length - 1]?.value;
      if (lastVal) handleSelect(lastVal);
    }
  };

  const isAstryx = activePreset === "astryx";
  const isReui = activePreset === "reui-nova" || activePreset === "shadcn";

  // Container styling per preset
  const containerRadius = isAstryx
    ? "rounded-full"
    : isReui
    ? "rounded-lg"
    : "rounded-xl";

  const containerTrack = isAstryx
    ? "bg-zinc-950/80 border border-white/[0.08] p-0.5 shadow-inner font-sans"
    : isReui
    ? "bg-zinc-900/60 border border-zinc-800 p-0.5 shadow-inner font-sans"
    : "bg-slate-900/60 border border-slate-800 p-1 shadow-inner font-sans";

  const contextValue = React.useMemo<ToggleGroupContextValue>(
    () => ({
      selectedValue: currentValue,
      onSelect: handleSelect,
      size,
      preset: activePreset,
      layoutId: activeLayoutId,
      fullWidth,
    }),
    [currentValue, handleSelect, size, activePreset, activeLayoutId, fullWidth]
  );

  return (
    <ToggleGroupContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
        className={cn(
          "items-center select-none backdrop-blur-sm",
          fullWidth ? "flex w-full" : "inline-flex",
          containerRadius,
          containerTrack,
          className
        )}
      >
        {normalizedOptions.length > 0
          ? normalizedOptions.map((opt, idx) => {
              const isSelected = currentValue === opt.value;
              const prevSelected = idx > 0 && normalizedOptions[idx - 1]?.value === currentValue;
              // Authentic NameThatUI divider rule:
              // Show divider between item (idx-1) and item (idx) if idx > 0 AND neither is selected
              const showDivider = idx > 0 && !isSelected && !prevSelected;

              return (
                <ToggleGroupItem
                  key={opt.value}
                  value={opt.value}
                  icon={opt.icon}
                  title={opt.title}
                  disabled={opt.disabled}
                  showDivider={showDivider}
                >
                  {opt.label}
                </ToggleGroupItem>
              );
            })
          : children}
      </div>
    </ToggleGroupContext.Provider>
  );
};

export default ToggleGroup;
