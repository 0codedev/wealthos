import * as React from "react";
import { cn } from "../../../lib/utils";

export const AstryxTable = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto rounded-[12px] border border-[rgba(255,255,255,0.102)] bg-[#1b1b1b]">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-xs text-left text-white", className)}
      style={{
        fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      {...props}
    />
  </div>
));
AstryxTable.displayName = "AstryxTable";

export const AstryxTableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "border-b border-[rgba(255,255,255,0.102)] bg-[#262626] text-[11px] font-semibold uppercase tracking-wider text-[#9e9e9e]",
      className
    )}
    {...props}
  />
));
AstryxTableHeader.displayName = "AstryxTableHeader";

export const AstryxTableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0 divide-y divide-[rgba(255,255,255,0.06)]", className)}
    {...props}
  />
));
AstryxTableBody.displayName = "AstryxTableBody";

export const AstryxTableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-[rgba(255,255,255,0.06)] transition-colors hover:bg-[#2e2e2e]",
      className
    )}
    {...props}
  />
));
AstryxTableRow.displayName = "AstryxTableRow";

export const AstryxTableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 px-3.5 text-left align-middle font-semibold text-[#9e9e9e] [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
));
AstryxTableHead.displayName = "AstryxTableHead";

export const AstryxTableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3.5 py-2.5 align-middle text-[#eaeaea] [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
));
AstryxTableCell.displayName = "AstryxTableCell";
