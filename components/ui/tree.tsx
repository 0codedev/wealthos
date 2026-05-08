import * as React from "react";
import { ChevronRight, Folder, FolderOpen, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TreeNode {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  badge?: string;
}

export interface TreeProps {
  data: TreeNode[];
  selectedId?: string;
  onSelect?: (node: TreeNode) => void;
  className?: string;
}

const TreeItem: React.FC<{
  node: TreeNode;
  selectedId?: string;
  onSelect?: (node: TreeNode) => void;
  level?: number;
}> = ({ node, selectedId, onSelect, level = 0 }) => {
  const hasChildren = node.children && node.children.length > 0;
  const [isOpen, setIsOpen] = React.useState(false);
  const isSelected = selectedId === node.id;

  return (
    <div>
      <div
        onClick={() => {
          if (hasChildren) {
            setIsOpen(!isOpen);
          }
          onSelect?.(node);
        }}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        className={cn(
          "flex items-center justify-between py-1.5 pr-2 rounded-lg cursor-pointer text-xs transition-colors",
          isSelected
            ? "bg-indigo-600/20 text-indigo-300 font-bold"
            : "text-slate-300 hover:bg-white/5 hover:text-white"
        )}
      >
        <div className="flex items-center gap-1.5 truncate">
          {hasChildren ? (
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-slate-500 transition-transform shrink-0",
                isOpen && "rotate-90"
              )}
            />
          ) : (
            <div className="w-3.5" />
          )}

          {node.icon ? (
            node.icon
          ) : hasChildren ? (
            isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
            ) : (
              <Folder className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            )
          ) : (
            <FileText className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          )}

          <span className="truncate">{node.label}</span>
        </div>

        {node.badge && (
          <span className="text-[10px] font-mono font-bold text-slate-500 bg-white/5 px-1.5 py-0.2 rounded">
            {node.badge}
          </span>
        )}
      </div>

      {hasChildren && isOpen && (
        <div className="space-y-0.5">
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const Tree: React.FC<TreeProps> = ({
  data,
  selectedId,
  onSelect,
  className,
}) => {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-[#0E101A] p-2 text-xs select-none space-y-0.5",
        // Presets
        "[data-design-preset=wealthos-classic]_&:bg-[#131625] [data-design-preset=wealthos-classic]_&:border-white/10",
        "[data-design-preset=reui-nova]_&:bg-[#0D0E18] [data-design-preset=reui-nova]_&:border-white/[0.08]",
        "[data-design-preset=shadcn]_&:bg-[#11131A] [data-design-preset=shadcn]_&:border-[#262B38] [data-design-preset=shadcn]_&:rounded-md",
        "",
        className
      )}
    >
      {data.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};
Tree.displayName = "Tree";
