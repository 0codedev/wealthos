import * as React from 'react';
import { cn } from '../../lib/utils';

export interface AdaptiveTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional custom card renderer for phone viewports (<640px). If omitted, table scrolls horizontally. */
  mobileCardView?: React.ReactNode;
}

export const AdaptiveTable = React.forwardRef<HTMLDivElement, AdaptiveTableProps>(
  ({ className, mobileCardView, children, ...props }, ref) => {
    if (mobileCardView) {
      return (
        <div ref={ref} className={cn('w-full min-w-0 max-w-full', className)} {...props}>
          {/* Phone Card Representation */}
          <div className="block sm:hidden w-full space-y-2.5">
            {mobileCardView}
          </div>
          {/* Desktop Table View */}
          <div className="hidden sm:block w-full overflow-x-auto no-scrollbar">
            {children}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          'w-full min-w-0 max-w-full overflow-x-auto no-scrollbar rounded-xl border border-slate-800/80 bg-slate-900/40',
          className
        )}
        {...props}
      >
        <div className="min-w-full inline-block align-middle">
          {children}
        </div>
      </div>
    );
  }
);
AdaptiveTable.displayName = 'AdaptiveTable';
