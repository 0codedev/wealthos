import React, { Suspense } from 'react';
// @ts-ignore - Activity is React 19+; may be undefined in older type defs
import { Activity } from 'react';

interface RouteActivityBoundaryProps {
  isActive: boolean;
  fallback: React.ReactNode;
  children: React.ReactNode;
}

// Activity is a React 19+ feature. Detect once at module load.
const SUPPORTS_ACTIVITY = typeof Activity !== 'undefined';

/**
 * Wraps a route in React 19's <Activity> so the subtree stays mounted
 * (state, caches, refs persist) but is visually hidden when not active.
 * Falls back to a plain conditional render if Activity is not available.
 */
export const RouteActivityBoundary: React.FC<RouteActivityBoundaryProps> = ({
  isActive,
  fallback,
  children,
}) => {
  if (!SUPPORTS_ACTIVITY) {
    return isActive ? <Suspense fallback={fallback}>{children}</Suspense> : null;
  }

  return (
    <Activity mode={isActive ? 'visible' : 'hidden'}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </Activity>
  );
};

export default RouteActivityBoundary;
