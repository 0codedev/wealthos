import * as React from "react";
import { useSettingsStore } from "../../store/settingsStore";
import {
  Table as ReuiTable,
  TableHeader as ReuiTableHeader,
  TableBody as ReuiTableBody,
  TableRow as ReuiTableRow,
  TableHead as ReuiTableHead,
  TableCell as ReuiTableCell,
} from "./table";
import {
  AstryxTable,
  AstryxTableHeader,
  AstryxTableBody,
  AstryxTableRow,
  AstryxTableHead,
  AstryxTableCell,
} from "./astryx/table";
import { cn } from "../../lib/utils";

export interface UnifiedTableProps extends React.HTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
}

export const UnifiedTable = React.forwardRef<HTMLTableElement, UnifiedTableProps>(
  ({ className, containerClassName, ...props }, ref) => {
    const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

    if (designPreset === "astryx") {
      return (
        <div className={cn("table-scroll w-full overflow-x-auto", containerClassName)}>
          <AstryxTable ref={ref} className={className} {...props} />
        </div>
      );
    }

    if (designPreset === "reui-nova" || designPreset === "shadcn") {
      return (
        <div className={cn("table-scroll w-full overflow-x-auto rounded-xl border bg-card", containerClassName)}>
          <ReuiTable ref={ref} className={className} {...props} />
        </div>
      );
    }

    return (
      <div className={cn("table-scroll relative w-full overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-md", containerClassName)}>
        <table
          ref={ref}
          className={cn("w-full caption-bottom text-xs text-left", className)}
          {...props}
        />
      </div>
    );
  }
);
UnifiedTable.displayName = "UnifiedTable";

export const UnifiedTableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  if (designPreset === "astryx") {
    return <AstryxTableHeader ref={ref} className={className} {...props} />;
  }

  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return <ReuiTableHeader ref={ref} className={className} {...props} />;
  }

  return (
    <thead
      ref={ref}
      className={cn(
        "border-b border-slate-800 bg-slate-900/60 text-[11px] font-bold uppercase tracking-wider text-slate-400",
        className
      )}
      {...props}
    />
  );
});
UnifiedTableHeader.displayName = "UnifiedTableHeader";

export const UnifiedTableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  if (designPreset === "astryx") {
    return <AstryxTableBody ref={ref} className={className} {...props} />;
  }

  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return <ReuiTableBody ref={ref} className={className} {...props} />;
  }

  return (
    <tbody
      ref={ref}
      className={cn("[&_tr:last-child]:border-0 divide-y divide-slate-800/60", className)}
      {...props}
    />
  );
});
UnifiedTableBody.displayName = "UnifiedTableBody";

export const UnifiedTableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  if (designPreset === "astryx") {
    return <AstryxTableRow ref={ref} className={className} {...props} />;
  }

  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return <ReuiTableRow ref={ref} className={className} {...props} />;
  }

  return (
    <tr
      ref={ref}
      className={cn(
        "border-b border-slate-800/40 transition-colors hover:bg-slate-800/30",
        className
      )}
      {...props}
    />
  );
});
UnifiedTableRow.displayName = "UnifiedTableRow";

export const UnifiedTableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  if (designPreset === "astryx") {
    return <AstryxTableHead ref={ref} className={className} {...props} />;
  }

  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return <ReuiTableHead ref={ref} className={className} {...props} />;
  }

  return (
    <th
      ref={ref}
      className={cn(
        "h-9 px-4 text-left align-middle font-bold text-slate-400 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
});
UnifiedTableHead.displayName = "UnifiedTableHead";

export const UnifiedTableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => {
  const designPreset = useSettingsStore((s) => s.designPreset) || "wealthos-classic";

  if (designPreset === "astryx") {
    return <AstryxTableCell ref={ref} className={className} {...props} />;
  }

  if (designPreset === "reui-nova" || designPreset === "shadcn") {
    return <ReuiTableCell ref={ref} className={className} {...props} />;
  }

  return (
    <td
      ref={ref}
      className={cn(
        "p-4 align-middle text-slate-200 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  );
});
UnifiedTableCell.displayName = "UnifiedTableCell";
