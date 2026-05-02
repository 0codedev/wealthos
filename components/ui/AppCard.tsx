import * as React from 'react';
import { cn } from '../../lib/utils';

export interface AppCardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  noPadding?: boolean;
}

export const AppCard = React.forwardRef<HTMLDivElement, AppCardProps>(
  ({ className, elevated = false, noPadding = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'w-full min-w-0 max-w-full rounded-xl sm:rounded-2xl border border-slate-800/80 bg-slate-900/70 text-slate-100 shadow-lg backdrop-blur-md transition-all duration-200 overflow-hidden',
          !noPadding && 'p-3.5 sm:p-5',
          elevated && 'bg-slate-900/90 shadow-2xl border-slate-700/80',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
AppCard.displayName = 'AppCard';

export const AppCardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center justify-between gap-2 mb-3 min-w-0', className)}
    {...props}
  />
));
AppCardHeader.displayName = 'AppCardHeader';

export const AppCardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-sm sm:text-base font-bold text-white tracking-wide truncate min-w-0', className)}
    {...props}
  />
));
AppCardTitle.displayName = 'AppCardTitle';

export const AppCardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('min-w-0', className)} {...props} />
));
AppCardContent.displayName = 'AppCardContent';
