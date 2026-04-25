import React, { Component, ErrorInfo, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, RefreshCw, Home, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * CC46 #5 — Top-level resilience layer.
 *
 * Catches any uncaught render error from the app tree and renders a
 * premium fallback (with recovery actions) instead of letting the
 * dashboard white-screen. Production apps NEVER show a stack trace to
 * the user; they always offer a recovery path.
 *
 * Mounted once at the outermost JSX in `App.tsx`.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  showDetails: boolean;
  resetCount: number;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  state: State = {
    error: null,
    componentStack: null,
    showDetails: false,
    resetCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Structured, single-line log so it doesn't get lost in devtools.
    // eslint-disable-next-line no-console
    console.error('[GlobalErrorBoundary] caught render error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private handleReset = (): void => {
    this.setState(prev => ({
      error: null,
      componentStack: null,
      showDetails: false,
      resetCount: prev.resetCount + 1,
    }));
  };

  private handleGoHome = (): void => {
    // Hash-based reset — works regardless of router.
    window.location.hash = '#/';
    this.handleReset();
    // Belt-and-suspenders: also clear any localStorage caches that might be
    // contributing to a corrupted boot (NOT touch user data).
    try {
      const safe = new Set<string>([
        'wa:boot-coordinator',
      ]);
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && safe.has(key)) localStorage.removeItem(key);
      }
    } catch {
      /* localStorage may be unavailable; safe to ignore */
    }
  };

  render(): ReactNode {
    const { error, componentStack, showDetails, resetCount } = this.state;
    const { children } = this.props;
    const isDev = import.meta.env.DEV;

    if (!error) return <>{children}</>;

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950 text-slate-100"
      >
        {/* Static aurora gradient — matches AuroraBackdrop tone but doesn't
            animate, so it costs nothing per frame. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 20%, rgba(99,102,241,0.35) 0%, transparent 60%),' +
              'radial-gradient(50% 50% at 80% 30%, rgba(139,92,246,0.30) 0%, transparent 60%),' +
              'radial-gradient(60% 50% at 50% 90%, rgba(244,63,94,0.25) 0%, transparent 60%)',
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/85 p-8 shadow-2xl backdrop-blur-xl"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30">
            <ShieldAlert size={28} />
          </div>
          <h1 className="text-center text-lg font-bold tracking-wide">Something went sideways</h1>
          <p className="mt-2 text-center text-sm leading-relaxed text-slate-400">
            We've logged the error. You can try again, or jump back to the dashboard.
            {resetCount > 0 && (
              <span className="mt-1 block text-xs text-slate-500">
                Retry attempt #{resetCount}
              </span>
            )}
          </p>

          <div className="mt-6 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-sky-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all hover:opacity-90 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <RefreshCw size={16} />
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleGoHome}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:bg-white/[0.08] active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              <Home size={15} />
              Back to dashboard
            </button>
          </div>

          {isDev && (error || componentStack) && (
            <div className="mt-5 rounded-xl border border-white/10 bg-black/40">
              <button
                type="button"
                onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 transition-colors hover:text-slate-200"
              >
                <span>Dev details</span>
                {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {showDetails && (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-rose-200/80">
                  {error?.message}
                  {'\n\n'}
                  {componentStack}
                </pre>
              )}
            </div>
          )}
        </motion.div>
      </div>
    );
  }
}

export default GlobalErrorBoundary;
