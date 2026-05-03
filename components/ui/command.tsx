import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CommandProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Command = React.forwardRef<HTMLDivElement, CommandProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0E101A] text-slate-100",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08] [data-design-preset=reui-nova]_&:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
      {...props}
    />
  )
);
Command.displayName = "Command";

export interface CommandInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(
  ({ className, ...props }, ref) => (
    <div className="flex items-center border-b border-white/10 px-3">
      <Search className="mr-2 h-4 w-4 shrink-0 text-slate-400" />
      <input
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-xs outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50 text-slate-100",
          className
        )}
        {...props}
      />
    </div>
  )
);
CommandInput.displayName = "CommandInput";

export const CommandList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden p-1", className)}
    {...props}
  />
));
CommandList.displayName = "CommandList";

export const CommandEmpty = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>((props, ref) => (
  <div
    ref={ref}
    className="py-6 text-center text-xs text-slate-500"
    {...props}
  />
));
CommandEmpty.displayName = "CommandEmpty";

export const CommandGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { heading?: React.ReactNode }
>(({ className, heading, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("overflow-hidden p-1 text-slate-100", className)}
    {...props}
  >
    {heading && (
      <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {heading}
      </div>
    )}
    {children}
  </div>
));
CommandGroup.displayName = "CommandGroup";

export const CommandItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean }
>(({ className, disabled, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs outline-none text-slate-300 hover:bg-indigo-600/20 hover:text-white transition-colors",
      disabled && "pointer-events-none opacity-50",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = "CommandItem";
