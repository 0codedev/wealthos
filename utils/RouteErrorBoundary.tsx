/**
 * CC108 — Per-route error boundary.
 *
 * React error boundaries catch render-phase errors and surface them
 * without unmounting the entire app. The current `App.tsx` has a single
 * top-level `ErrorBoundary` that wraps the whole tree. If *any*
 * component throws, the user is bounced to a full-screen fallback and
 * loses the navigation, sidebar, and any unsaved input.
 *
 * Production apps use **per-route** boundaries: a render error in the
 * Alpha Engine page does NOT unmount the Trading Journal. The user can
 * navigate to a different hub and the broken route is just one tab that
 * shows "Something went wrong — Reload this tab".
 *
 * This module ships a ready-to-use `RouteErrorBoundary` component plus
 * a `withErrorBoundary` HOC for use with route-level lazy imports.
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface RouteErrorBoundaryProps {
    children: ReactNode;
    /** Display name for the route (used in the error message and aria-label). */
    routeName?: string;
    /** Optional fallback. If omitted, the default fallback is used. */
    fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface RouteErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
    constructor(props: RouteErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Log to console so dev sees the full stack. Production logger
        // capture (e.g. Sentry) can hook in here.
        if (typeof console !== 'undefined') {
            console.error(`[RouteErrorBoundary${this.props.routeName ? `:${this.props.routeName}` : ''}]`, error, info.componentStack);
        }
    }

    reset = (): void => {
        this.setState({ hasError: false, error: null });
    };

    render(): ReactNode {
        const { hasError, error } = this.state;
        const { children, routeName, fallback } = this.props;

        if (hasError && error) {
            if (fallback) return fallback(error, this.reset);

            return (
                <div
                    role="alert"
                    aria-live="assertive"
                    className="flex flex-col items-center justify-center min-h-[280px] p-8 text-center bg-white/60 dark:bg-slate-900/60 rounded-3xl border border-rose-200 dark:border-rose-500/30 backdrop-blur-md"
                >
                    <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-500/15 mb-4">
                        <AlertTriangle size={28} className="text-rose-600 dark:text-rose-400" />
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                        {routeName ? `${routeName} failed to load` : 'This view failed to load'}
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mb-6">
                        {error.message || 'An unexpected error occurred. The rest of the app is still working — try reloading just this view.'}
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={this.reset}
                            className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors inline-flex items-center gap-2 shadow-sm"
                        >
                            <RefreshCw size={14} /> Reload this view
                        </button>
                        <a
                            href="#dashboard"
                            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-2"
                        >
                            <Home size={14} /> Back to Dashboard
                        </a>
                    </div>
                    {typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' && error.stack && (
                        <details className="mt-6 text-left max-w-2xl w-full">
                            <summary className="text-xs text-slate-500 cursor-pointer">Stack trace (dev only)</summary>
                            <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 text-[10px] overflow-x-auto">
                                {error.stack}
                            </pre>
                        </details>
                    )}
                </div>
            );
        }

        return children;
    }
}

/**
 * HOC that wraps a component in a `RouteErrorBoundary`. Use with lazy
 * route imports:
 *
 *   const TradingJournal = lazy(() => import('./TradingJournal'));
 *   export default withErrorBoundary(TradingJournal, 'Trading Journal');
 */
export function withErrorBoundary<P extends object>(
    Component: React.ComponentType<P>,
    routeName: string
): React.FC<P> {
    const Wrapped: React.FC<P> = (props) => (
        <RouteErrorBoundary routeName={routeName}>
            <Component {...props} />
        </RouteErrorBoundary>
    );
    Wrapped.displayName = `withErrorBoundary(${routeName})`;
    return Wrapped;
}

export default RouteErrorBoundary;
