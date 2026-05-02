import * as React from 'react';
import { cn } from '../../lib/utils';

export interface AdaptiveListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  emptyState?: React.ReactNode;
  className?: string;
}

export function AdaptiveList<T>({
  items,
  renderItem,
  keyExtractor,
  emptyState,
  className = '',
}: AdaptiveListProps<T>) {
  if (!items || items.length === 0) {
    return emptyState ? (
      <div className="w-full py-8 text-center">{emptyState}</div>
    ) : null;
  }

  return (
    <div className={cn('w-full min-w-0 max-w-full space-y-2.5 sm:space-y-3', className)}>
      {items.map((item, index) => (
        <React.Fragment key={keyExtractor(item, index)}>
          {renderItem(item, index)}
        </React.Fragment>
      ))}
    </div>
  );
}
