import * as React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColumnDef<T> {
  key: keyof T | string;
  header: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  className?: string;
  render?: (item: T, index: number) => React.ReactNode;
}

export interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (item: T, index: number) => string;
  defaultSortKey?: string;
  defaultSortAsc?: boolean;
  onRowClick?: (item: T) => void;
  className?: string;
  stickyHeader?: boolean;
  emptyMessage?: string;
}

export function DataGrid<T>({
  data,
  columns,
  keyExtractor,
  defaultSortKey,
  defaultSortAsc = true,
  onRowClick,
  className,
  stickyHeader = true,
  emptyMessage = "No records found.",
}: DataGridProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | undefined>(defaultSortKey);
  const [sortAsc, setSortAsc] = React.useState<boolean>(defaultSortAsc);

  const handleSort = (key: string, sortable?: boolean) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortedData = React.useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a: any, b: any) => {
      const valA = a[sortKey];
      const valB = b[sortKey];
      if (valA === valB) return 0;
      if (valA === undefined || valA === null) return 1;
      if (valB === undefined || valB === null) return -1;

      if (typeof valA === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });
  }, [data, sortKey, sortAsc]);

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-[var(--card-radius,12px)] border border-white/[0.08] bg-[#0D0E18] [data-design-preset=wealthos-classic]_&:bg-[#10121E] [data-design-preset=shadcn]_&:bg-[#11131A]",
        className
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs text-slate-300">
          <thead
            className={cn(
              "border-b border-white/[0.08] bg-black/40 text-[11px] font-bold uppercase tracking-wider text-slate-400 select-none",
              stickyHeader && "sticky top-0 z-10 backdrop-blur-md"
            )}
          >
            <tr>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={String(col.key)}
                    onClick={() => handleSort(String(col.key), col.sortable)}
                    className={cn(
                      "py-3 px-3.5 transition-colors",
                      col.align === "right" && "text-right",
                      col.align === "center" && "text-center",
                      col.sortable && "cursor-pointer hover:text-white",
                      col.className
                    )}
                  >
                    <div
                      className={cn(
                        "inline-flex items-center gap-1.5",
                        col.align === "right" && "justify-end w-full",
                        col.align === "center" && "justify-center w-full"
                      )}
                    >
                      <span>{col.header}</span>
                      {col.sortable && (
                        <span className="shrink-0 text-slate-500">
                          {isSorted ? (
                            sortAsc ? (
                              <ArrowUp className="w-3 h-3 text-indigo-400" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-indigo-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40 hover:opacity-100" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-8 text-center text-slate-500 font-medium"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((item, index) => (
                <tr
                  key={keyExtractor(item, index)}
                  onClick={() => onRowClick && onRowClick(item)}
                  className={cn(
                    "hover:bg-white/[0.02] transition-colors group",
                    onRowClick && "cursor-pointer"
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={String(col.key)}
                      className={cn(
                        "py-3 px-3.5",
                        col.align === "right" && "text-right",
                        col.align === "center" && "text-center",
                        col.className
                      )}
                    >
                      {col.render
                        ? col.render(item, index)
                        : String((item as any)[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
