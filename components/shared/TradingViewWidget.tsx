/**
 * TradingView Free Advanced Chart widget wrapper (2026-06-19).
 *
 * - Zero new deps (just loads tv.js from CDN).
 * - Lazy-loads the script once per page session.
 * - Auto-resizes on theme change so dark/light surfaces both look right.
 *
 * Source: https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

let _tvScriptPromise: Promise<void> | null = null;

function loadTradingViewScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).TradingView) return Promise.resolve();
  if (_tvScriptPromise) return _tvScriptPromise;

  _tvScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-tv-widget-loader="1"]',
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('tv.js failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://s3.tradingview.com/tv.js';
    s.async = true;
    s.dataset.tvWidgetLoader = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('tv.js failed to load'));
    document.head.appendChild(s);
  });
  return _tvScriptPromise;
}

interface TradingViewWidgetProps {
  /** Plain NSE/BSE ticker e.g. "RELIANCE". We prefix with the correct exchange. */
  symbol: string;
  /** Candle interval: 1, 5, 15, 60, 240, D, W. Default D. */
  interval?: string;
  /** Pixel height of the embedded chart. */
  height?: number;
  /** Force light or dark theme. Defaults to auto (driven by `isDarkMode`). */
  theme?: 'light' | 'dark';
  /** Optional list of study IDs to overlay (e.g. "MASimple@tv-basicstudies"). */
  studies?: string[];
}

const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({
  symbol,
  interval = 'D',
  height = 420,
  theme,
  studies = ['MASimple@tv-basicstudies'],
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Pick exchange by symbol suffix heuristic. Default to NSE for plain tickers.
  const tvSymbol = React.useMemo(() => {
    const s = symbol.trim().toUpperCase();
    if (s.includes(':')) return s; // already prefixed
    if (s.endsWith('.BO')) return `BSE:${s.slice(0, -3)}`;
    return `NSE:${s}`;
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    const containerId = `tv_container_${Math.random().toString(36).slice(2, 10)}`;

    if (containerRef.current) {
      containerRef.current.id = containerId;
      containerRef.current.innerHTML = '';
    }

    const detectedTheme =
      theme ??
      (typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light');

    loadTradingViewScript()
      .then(() => {
        if (cancelled) return;
        if (!containerRef.current) return;
        const TV: any = (window as any).TradingView;
        if (!TV?.widget) throw new Error('TradingView global missing');
        new TV.widget({
          autosize: true,
          symbol: tvSymbol,
          interval,
          timezone: 'Asia/Kolkata',
          theme: detectedTheme,
          style: '1',
          locale: 'en',
          toolbar_bg: detectedTheme === 'dark' ? '#0f172a' : '#f1f3f6',
          enable_publishing: false,
          allow_symbol_change: true,
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: containerId,
          studies,
        });
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Failed to load TradingView');
      });

    return () => {
      cancelled = true;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
    // studies is allowed to be a fresh array each render; that's safe — the
    // widget only reads it once during construction.
  }, [tvSymbol, interval, theme, studies]);

  return (
    <div className="relative w-full" style={{ height }}>
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 dark:bg-slate-900/60 text-xs text-slate-400">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading chart…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-500 dark:text-rose-300">
          TradingView unavailable ({error}). The chart will appear when the browser can reach s3.tradingview.com.
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      <p className="absolute bottom-1 right-2 text-[9px] text-slate-400/70 select-none pointer-events-none">
        Powered by TradingView
      </p>
    </div>
  );
};

export default TradingViewWidget;
