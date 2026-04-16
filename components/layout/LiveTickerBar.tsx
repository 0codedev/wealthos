import React, { useState } from 'react';
import { useGlobalTickStore } from '../../store/globalTickStore';
import { Pause, Play } from 'lucide-react';
import { AccessibleButton } from '../shared/AccessibleComponents';
import { upstoxMarketDataService } from '../../services/UpstoxMarketDataService';
import { upstoxWebSocketService } from '../../services/UpstoxWebSocketService';
import { LiveConnectionBadge } from '../shared/LiveConnectionBadge';

interface TickerEntry {
    symbol: string;
    name: string;
    key: string;
    last: number | null;
    changePct: number | null;
}

const TICKER_SYMBOLS: Omit<TickerEntry, 'last' | 'changePct'>[] = [
    { symbol: 'NIFTY',        name: 'NIFTY 50',     key: 'NSE_INDEX|Nifty 50' },
    { symbol: 'BANKNIFTY',    name: 'NIFTY BANK',   key: 'NSE_INDEX|Nifty Bank' },
    { symbol: 'SENSEX',       name: 'SENSEX',       key: 'BSE_INDEX|SENSEX' },
    { symbol: 'INDIA VIX',    name: 'INDIA VIX',    key: 'NSE_INDEX|India VIX' },
    { symbol: 'MIDCPNIFTY',   name: 'NIFTY MIDCAP', key: 'NSE_INDEX|NIFTY MID SELECT' },
    { symbol: 'FINNIFTY',     name: 'FIN SERVICE',  key: 'NSE_INDEX|Nifty Fin Service' },
    { symbol: 'NIFTY IT',     name: 'NIFTY IT',     key: 'NSE_INDEX|Nifty IT' },
    { symbol: 'NIFTY AUTO',   name: 'NIFTY AUTO',   key: 'NSE_INDEX|Nifty Auto' },
    { symbol: 'DEFENSE',      name: 'DEFENSE',      key: 'NSE_INDEX|Nifty Ind Defence' },
    { symbol: 'NIFTY METAL',  name: 'NIFTY METAL',  key: 'NSE_INDEX|Nifty Metal' },
    { symbol: 'NIFTY PHARMA', name: 'NIFTY PHARMA', key: 'NSE_INDEX|Nifty Pharma' },
    { symbol: 'NIFTY FMCG',   name: 'NIFTY FMCG',   key: 'NSE_INDEX|Nifty FMCG' },
    { symbol: 'NIFTY REALTY', name: 'NIFTY REALTY', key: 'NSE_INDEX|Nifty Realty' },
    { symbol: 'OIL & GAS',    name: 'OIL & GAS',    key: 'NSE_INDEX|NIFTY OIL AND GAS' },
    { symbol: 'PSU BANK',     name: 'PSU BANK',     key: 'NSE_INDEX|Nifty PSU Bank' },
];

const getTradingViewUrl = (key: string): string => {
    const symbolMap: Record<string, string> = {
        'NSE_INDEX|Nifty 50': 'NSE:NIFTY',
        'NSE_INDEX|Nifty Bank': 'NSE:BANKNIFTY',
        'BSE_INDEX|SENSEX': 'BSE:SENSEX',
        'NSE_INDEX|India VIX': 'NSE:INDIAVIX',
        'NSE_INDEX|NIFTY MID SELECT': 'NSE:MIDCPNIFTY',
        'NSE_INDEX|Nifty Fin Service': 'NSE:CNXFIN',
        'NSE_INDEX|Nifty Auto': 'NSE:CNXAUTO',
        'NSE_INDEX|Nifty Metal': 'NSE:CNXMETAL',
        'NSE_INDEX|Nifty IT': 'NSE:CNXIT',
        'NSE_INDEX|Nifty Pharma': 'NSE:CNXPHARMA',
        'NSE_INDEX|Nifty FMCG': 'NSE:CNXFMCG',
        'NSE_INDEX|Nifty Realty': 'NSE:CNXREALTY',
        'NSE_INDEX|Nifty Ind Defence': 'NSE:NIFTY_IND_DEFENCE',
        'NSE_INDEX|NIFTY OIL AND GAS': 'NSE:NIFTY_OIL_AND_GAS',
        'NSE_INDEX|Nifty PSU Bank': 'NSE:CNXPSUBANK',
    };
    const tvSymbol = symbolMap[key] || 'NSE:NIFTY';
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
};

/**
 * LiveTickerBar
 * -----------
 * Subscribes to the Upstox WebSocket for the major sector indices and
 * renders a scrolling ticker with real-time LTP and %change.
 *
 * Falls back to a REST snapshot from /api/upstox/quotes on first paint so
 * the bar is never blank during the WS handshake.
 */
export const LiveTickerBar: React.FC = () => {
    const [isPaused, setIsPaused] = useState(false);
    const ticks = useGlobalTickStore((s) => s.ticks);

    const TICKER_CACHE_KEY = 'wealthos_live_ticker_seed_cache';

    // 1. Seed snapshot from localStorage first (0ms Frame-0) then REST so the bar is NEVER blank/0.00% on refresh.
    const [seed, setSeed] = React.useState<Record<string, { last: number; close: number; changePct: number }>>(() => {
        if (typeof window !== 'undefined') {
            try {
                const raw = localStorage.getItem(TICKER_CACHE_KEY);
                return raw ? JSON.parse(raw) : {};
            } catch {
                return {};
            }
        }
        return {};
    });

    React.useEffect(() => {
        let mounted = true;
        const keys = TICKER_SYMBOLS.map(t => t.key);

        // Explicitly subscribe to index symbols in ltpc mode
        const onTick = () => {};
        upstoxWebSocketService.subscribe(keys, onTick, 'ltpc');

        (async () => {
            try {
                const quotes = await upstoxMarketDataService.getFullQuotes(keys);
                if (!mounted || !quotes) return;
                const next: Record<string, { last: number; close: number; changePct: number }> = {};
                for (const t of TICKER_SYMBOLS) {
                    const q = quotes[t.key] || quotes[t.symbol] || quotes[t.key.replace('|', ':')] || quotes[t.key.replace('NSE_INDEX|', '')];
                    if (!q) continue;
                    const last = Number(q.last_price);
                    const close = q?.ohlc?.close && q.ohlc.close > 0 ? q.ohlc.close : (q.average_price && q.average_price > 0 ? q.average_price : last);
                    const changePct = close > 0 ? ((last - close) / close) * 100 : (q.net_change && close > 0 ? (q.net_change / close) * 100 : 0);
                    next[t.symbol] = { last, close, changePct };
                }
                if (Object.keys(next).length > 0) {
                    setSeed(prev => ({ ...prev, ...next }));
                    if (typeof window !== 'undefined') {
                        try {
                            localStorage.setItem(TICKER_CACHE_KEY, JSON.stringify(next));
                        } catch { /* ignore quota */ }
                    }
                }
            } catch {
                /* ignore — bar will populate as WS ticks arrive */
            }
        })();

        return () => { 
            mounted = false; 
            upstoxWebSocketService.unsubscribe(keys, onTick);
        };
    }, []);

    const entries: TickerEntry[] = TICKER_SYMBOLS.map(t => {
        const altKey1 = t.key.replace('|', ':');
        const altKey2 = t.key.replace('NSE_INDEX|', '');
        const tick = ticks[t.key] || ticks[altKey1] || ticks[altKey2] || ticks[t.symbol];
        const s = seed[t.symbol];

        if (tick && tick.ltp != null) {
            // Official closing baseline must come from tick.close or seed baseline, NEVER tick.ltp
            const close = (tick.close && tick.close > 0)
                ? tick.close
                : (tick.ohlc?.close && tick.ohlc.close > 0)
                    ? tick.ohlc.close
                    : (s?.close && s.close > 0)
                        ? s.close
                        : null;

            const changePct = (close && close > 0)
                ? ((tick.ltp - close) / close) * 100
                : (s?.changePct ?? null);

            return { ...t, last: tick.ltp, changePct };
        }
        if (s) return { ...t, last: s.last, changePct: s.changePct };
        return { ...t, last: null, changePct: null };
    });

    // Repeat 3x for seamless marquee loop
    const looped = [...entries, ...entries, ...entries];

    return (
        <div className="relative h-[34px] bg-white/75 dark:bg-slate-900/60 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.08] overflow-hidden flex items-center shrink-0 w-full select-none z-ticker group transition-colors">
            {/* Edge gradient mask for seamless fade on left edge */}
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white/90 dark:from-slate-900/90 to-transparent z-10" />

            <div className={`flex whitespace-nowrap font-mono text-[11px] text-ticker-text py-1.5 ${isPaused ? '' : 'animate-ticker'}`}>
                {looped.map((e, idx) => {
                    const isUp = (e.changePct ?? 0) >= 0;
                    const valueClass = e.changePct == null
                        ? 'text-slate-400'
                        : isUp ? 'text-ticker-up' : 'text-ticker-down';
                    const formatted = e.last == null
                        ? '-'
                        : e.last.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const pct = e.changePct == null
                        ? ''
                        : `${isUp ? '+' : ''}${e.changePct.toFixed(2)}%`;
                    return (
                        <span className="mx-4 relative inline-flex items-center group/item cursor-pointer" key={`${e.key}-${idx}`}>
                            <span className="mr-2">{e.name}</span>
                            <span className={valueClass}>
                                {formatted}
                                {pct && <span className="ml-1">({pct})</span>}
                            </span>
                            
                            {/* Floating overlay buttons - desktop hover shortcut only */}
                            <div className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-all duration-150 scale-95 group-hover/item:scale-100 pointer-events-none group-hover/item:pointer-events-auto z-10">
                                <a
                                    href={getTradingViewUrl(e.key)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="tv-shortcut-btn w-[20px] h-[20px] rounded-[4px] shadow-lg cursor-pointer"
                                    title={`View ${e.name} Chart on TradingView`}
                                >
                                    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className="w-[12px] h-[12px]">
                                        <path d="M15.8654 8.2789c0 1.3541-1.0978 2.4519-2.452 2.4519-1.354 0-2.4519-1.0978-2.4519-2.452 0-1.354 1.0978-2.4518 2.452-2.4518 1.3541 0 2.4519 1.0977 2.4519 2.4519zM9.75 6H0v4.9038h4.8462v7.2692H9.75Zm8.5962 0H24l-5.1058 12.173h-5.6538z"/>
                                    </svg>
                                </a>
                            </div>
                        </span>
                    );
                })}
            </div>
            <div className="px-2 shrink-0 border-r border-white/[0.05] flex items-center">
                <LiveConnectionBadge size="xs" showMetrics={false} />
            </div>
            <AccessibleButton
                type="button"
                variant="ghost"
                onClick={() => setIsPaused(!isPaused)}
                className="absolute right-2 p-1 bg-slate-900/50 hover:bg-slate-800 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10"
                aria-label={isPaused ? 'Play market ticker' : 'Pause market ticker'}
            >
                {isPaused ? <Play size={12} className="text-ticker-text" /> : <Pause size={12} className="text-ticker-text" />}
            </AccessibleButton>
        </div>
    );
};

export default LiveTickerBar;
