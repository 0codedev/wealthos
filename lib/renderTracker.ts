import React from 'react';

/**
 * Render counter for finding re-render hotspots in dev.
 * Gated behind the `?debug=perf` query param. No-op in production.
 *
 * Usage:
 *   export default withRenderTracker(MyWidget, 'MyWidget');
 *
 * Then open the app with `?debug=perf` and call:
 *   getRenderCounts()       // → { MyWidget: 12, HeaderBar: 3, ... }
 *   resetRenderCounts()     // clear before testing
 *   subscribeToRenderCounts(fn)  // get notified on each tracked render
 */

const ENABLED = (() => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('debug') === 'perf';
})();

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

export function getRenderCounts(): Record<string, number> {
  return Object.fromEntries(counts);
}

export function resetRenderCounts(): void {
  counts.clear();
  listeners.forEach((l) => l());
}

export function subscribeToRenderCounts(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Wraps a component to log its render count. No-op unless ?debug=perf.
 */
export function withRenderTracker<P extends object>(
  Component: React.ComponentType<P>,
  name: string,
): React.ComponentType<P> {
  if (!ENABLED) return Component;

  const Tracked = (props: P): React.ReactElement => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    listeners.forEach((l) => l());
    return React.createElement(Component, props);
  };
  Tracked.displayName = `Tracked(${name})`;
  return Tracked;
}

export default withRenderTracker;
