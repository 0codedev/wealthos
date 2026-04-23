import React, { useState, useRef, useEffect } from 'react';
import { Info, X } from 'lucide-react';

export interface JargonEntry {
    /** Short, plain-English explanation (1–2 lines). */
    short: string;
    /** Optional longer detail shown below the short text. */
    long?: string;
    /** Optional formula or example line, rendered monospace. */
    example?: string;
}

const GLOSSARY: Record<string, JargonEntry> = {
    CAGR: {
        short: 'Compound Annual Growth Rate — your smoothed yearly return.',
        long: 'If your investment grew from ₹1L to ₹1.21L in 2 years, the CAGR is 10% per year, the same rate a fixed deposit would need to match.',
        example: '(Final / Initial)^(1/years) − 1',
    },
    XIRR: {
        short: 'Annualised return that respects the exact date and size of every cash flow.',
        long: 'Best for SIPs and staggered lump sums. A ₹5,000 SIP for 3 years and a one-time ₹1,80,000 in year 1 can have very different XIRRs even if both end at the same value.',
    },
    'Sharpe Ratio': {
        short: 'Risk-adjusted return — how much excess return you earn per unit of volatility.',
        long: 'Above 1 is good, above 2 is institutional-grade. A high return with wild swings can have a worse Sharpe than a steady, lower return.',
    },
    'Sortino Ratio': {
        short: 'Like Sharpe, but only penalises downside volatility.',
        long: 'Useful if upside surprises don\'t bother you but drawdowns do.',
    },
    'Monte Carlo': {
        short: 'A simulation that runs your strategy thousands of times against random market paths.',
        long: 'The shaded band you see is the range of outcomes — usually 5th to 95th percentile. The middle line is the median path.',
    },
    Drawdown: {
        short: 'How far your portfolio is below its previous peak.',
        long: 'A 20% drawdown means you need a 25% gain just to break even. Recoveries are mathematically harder than the fall.',
    },
    'Max Drawdown': {
        short: 'The worst peak-to-trough fall your strategy has ever suffered.',
        long: 'Used to size positions so that even a worst-case historical loss is survivable.',
    },
    'XIRR Time-Machine': {
        short: 'A rolling XIRR chart that shows your annualised return over 1M, 3M, 6M, 1Y, 3Y, 5Y and ALL windows.',
    },
    Calmar: {
        short: 'CAGR divided by Max Drawdown — reward per unit of pain.',
        long: 'Above 1.0 means the strategy more than pays for its worst fall each year.',
    },
    'Win Rate': {
        short: 'Percentage of trades that closed in profit.',
        long: 'A 40% win rate can still be very profitable if average wins are far larger than average losses.',
    },
    'Risk-Reward': {
        short: 'The ratio of potential loss to potential gain on a trade.',
        long: '1:3 means you risk ₹1 to make ₹3. Even with a 40% win rate, that\'s profitable in expectation.',
    },
    'PCR (Put-Call Ratio)': {
        short: 'Number of put options traded for every call. Above 1 is bearish hedging, below 1 is bullish speculation.',
    },
    'FII / DII': {
        short: 'Foreign Institutional Investors and Domestic Institutional Investors — their net buying/selling moves the market.',
    },
    'ORB (Opening Range Breakout)': {
        short: 'A trade placed when price breaks above or below the first 5/15 minutes\' high/low.',
    },
    'Behavioral Tax': {
        short: 'The phantom PnL you lost to revenge trades, oversizing, and FOMO entries.',
    },
    'Wealth Multiple': {
        short: 'Final value ÷ amount invested. 2.5x means every ₹1 you put in is now worth ₹2.50.',
    },
    'Freedom Number': {
        short: 'The corpus at which your safe withdrawals cover your annual expenses forever.',
        long: 'With the standard 4% rule: annual expenses × 25.',
    },
    'Safe Withdrawal Rate': {
        short: 'The % of your corpus you can spend each year with a high chance of not running out.',
        long: 'The "4% rule" comes from US retirement studies. For India, 3.5–4% is a common conservative starting point.',
    },
    SIP: {
        short: 'Systematic Investment Plan — a fixed amount auto-invested on a date each month.',
        long: 'Rupee-cost averaging: you buy more units when prices are low, fewer when high.',
    },
    LTP: {
        short: 'Last Traded Price — the most recent price at which the stock changed hands.',
    },
    'Bid / Ask': {
        short: 'Bid is the highest price a buyer will pay; Ask is the lowest price a seller will accept. The gap is the spread.',
    },
    'Volume': {
        short: 'Number of shares traded in a given period. High volume confirms a move; low volume makes moves suspect.',
    },
    'Lakh': {
        short: '1 Lakh = 1,00,000 (one hundred thousand).',
    },
    Crore: {
        short: '1 Crore = 1,00,00,000 (ten million).',
    },
    SEBI: {
        short: 'Securities and Exchange Board of India — the market regulator.',
    },
    'SEBI Compliance': {
        short: 'Rules that advisors/research providers must follow to avoid giving personalised, unregistered advice.',
    },
    'Wash Sale': {
        short: 'Buying back the same security within 30 days of selling it at a loss — disallowed under Indian tax law for harvesting losses.',
    },
};

interface JargonTooltipProps {
    /** Term to look up. Case-insensitive. Falls back to customChildren. */
    term: keyof typeof GLOSSARY | string;
    /** Override the default glossary lookup for ad-hoc help text. */
    custom?: JargonEntry;
    /** Optional side to prefer for the popover. */
    side?: 'top' | 'bottom';
    /** Render as an inline pill (default) or a plain inline icon. */
    variant?: 'pill' | 'icon';
    className?: string;
}

export const JargonTooltip: React.FC<JargonTooltipProps> = ({
    term,
    custom,
    side = 'top',
    variant = 'pill',
    className = '',
}) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);
    const entry: JargonEntry =
        custom || GLOSSARY[term] || { short: 'No description available.' };

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open]);

    return (
        <span ref={ref} className={`relative inline-flex items-center ${className}`}>
            <button
                type="button"
                aria-label={`What is ${term}?`}
                aria-expanded={open}
                aria-describedby={open ? `jargon-${term.replace(/\s+/g, '-')}` : undefined}
                onClick={() => setOpen((v) => !v)}
                className={
                    variant === 'pill'
                        ? 'jargon-pill'
                        : 'inline-flex items-center justify-center w-4 h-4 text-slate-400 hover:text-indigo-500 dark:text-slate-500 dark:hover:text-indigo-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 rounded-full'
                }
            >
                {variant === 'pill' ? '?' : <Info size={12} strokeWidth={2.5} />}
            </button>
            {open && (
                <span
                    id={`jargon-${term.replace(/\s+/g, '-')}`}
                    role="tooltip"
                    className={`absolute z-[200] ${side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} left-1/2 -translate-x-1/2 w-64 max-w-[80vw] p-3 rounded-xl bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-md text-slate-100 border border-indigo-500/30 shadow-2xl shadow-indigo-500/10 text-left`}
                >
                    <span className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] font-black uppercase tracking-widest text-indigo-300">
                            {term}
                        </span>
                        <button
                            type="button"
                            aria-label="Close tooltip"
                            onClick={() => setOpen(false)}
                            className="text-slate-500 hover:text-slate-200 transition-colors"
                        >
                            <X size={11} />
                        </button>
                    </span>
                    <span className="block text-[11px] font-semibold leading-relaxed">
                        {entry.short}
                    </span>
                    {entry.long && (
                        <span className="block text-[10px] text-slate-300 leading-relaxed mt-1.5">
                            {entry.long}
                        </span>
                    )}
                    {entry.example && (
                        <span className="block text-[10px] text-indigo-300/80 font-mono mt-1.5 bg-slate-800/50 rounded px-1.5 py-1">
                            {entry.example}
                        </span>
                    )}
                    <span
                        aria-hidden="true"
                        className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-slate-900 dark:bg-slate-950 border-indigo-500/30 ${side === 'top' ? 'bottom-[-5px] border-b border-r' : 'top-[-5px] border-t border-l'}`}
                    />
                </span>
            )}
        </span>
    );
};

export default JargonTooltip;
