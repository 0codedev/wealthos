import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useSettingsStore } from "../../store/settingsStore";
import { cn } from "../../lib/utils";

const UnifiedTabsRoot = TabsPrimitive.Root;

const UnifiedTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  if (designPreset === "astryx") {
    return (
      <div className="w-full overflow-x-auto no-scrollbar py-1">
        <TabsPrimitive.List
          ref={ref}
          className={cn(
            "inline-flex h-9 items-center justify-start rounded-[10px] bg-[#262626] p-1 text-[#9e9e9e] border border-[rgba(255,255,255,0.102)] gap-1 select-none",
            className
          )}
          style={{
            fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
          {...props}
        />
      </div>
    );
  }

  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return (
      <div className="w-full overflow-x-auto no-scrollbar py-1">
        <TabsPrimitive.List
          ref={ref}
          className={cn(
            "inline-flex h-9 items-center justify-start rounded-lg bg-muted p-1 text-muted-foreground border border-border gap-1 select-none",
            className
          )}
          {...props}
        />
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto no-scrollbar py-1">
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          "inline-flex h-10 items-center justify-start rounded-xl bg-slate-950/70 p-1 text-slate-400 border border-slate-800/80 gap-1 select-none backdrop-blur-md",
          className
        )}
        {...props}
      />
    </div>
  );
});
UnifiedTabsList.displayName = "UnifiedTabsList";

const UnifiedTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  if (designPreset === "astryx") {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-[6px] px-3.5 py-1 text-xs font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 text-[#9e9e9e] hover:text-white data-[state=active]:bg-white data-[state=active]:text-[#111111] data-[state=active]:font-semibold data-[state=active]:shadow-sm",
          className
        )}
        style={{
          fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
        {...props}
      />
    );
  }

  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
          className
        )}
        {...props}
      />
    );
  }

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-semibold ring-offset-slate-900 transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 text-slate-400 hover:text-slate-200 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-indigo-600/30",
        className
      )}
      {...props}
    />
  );
});
UnifiedTabsTrigger.displayName = "UnifiedTabsTrigger";

const UnifiedTabsContent = TabsPrimitive.Content;

export {
  UnifiedTabsRoot as UnifiedTabs,
  UnifiedTabsList,
  UnifiedTabsTrigger,
  UnifiedTabsContent,
};
