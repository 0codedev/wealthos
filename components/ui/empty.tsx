import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const Empty: React.FC<EmptyProps> = ({
  icon,
  title,
  description,
  action,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center rounded-[12px] border border-dashed border-white/10 bg-black/20 my-4",
        className
      )}
      {...props}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-3">
        {icon || <Inbox className="h-6 w-6" />}
      </div>
      <h4 className="text-sm font-bold text-white mb-1">{title}</h4>
      {description && (
        <p className="max-w-xs text-xs text-slate-400 mb-4 leading-relaxed font-normal">
          {description}
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
};
