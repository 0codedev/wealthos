import React from 'react';

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export type MoneySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type MoneyTrend = 'positive' | 'negative' | 'neutral';

export interface MoneyProps {
  value: number | string | null | undefined;
  currency?: string;
  className?: string;
  signed?: boolean;
  compact?: boolean;
  size?: MoneySize;
  trend?: MoneyTrend;
  muted?: boolean;
  /** Show no decimal places (default: true for |n| >= 1000, false otherwise) */
  abbreviate?: boolean;
  'aria-label'?: string;
}

const SIZE_CLASS: Record<MoneySize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
};

const TREND_CLASS: Record<MoneyTrend, string> = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-slate-700 dark:text-slate-200',
};

const INDIAN_COMPACT_THRESHOLDS: Array<[number, string]> = [
  [1e7, 'Cr'],
  [1e5, 'L'],
  [1e3, 'K'],
];

function formatIndianCompact(n: number): string {
  const abs = Math.abs(n);
  for (const [threshold, suffix] of INDIAN_COMPACT_THRESHOLDS) {
    if (abs >= threshold) {
      const value = n / threshold;
      const formatted = value % 1 === 0 ? value.toString() : value.toFixed(1).replace(/\.0$/, '');
      return `${formatted}${suffix}`;
    }
  }
  return n.toString();
}

function formatIndianCurrency(value: number, currency: string, opts: { compact?: boolean; abbreviate?: boolean }): string {
  const { compact, abbreviate } = opts;
  if (compact) return formatIndianCompact(value);

  // Sub-1 values: up to 4 decimals
  if (Math.abs(value) > 0 && Math.abs(value) < 1) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  }

  const minFrac = abbreviate ? 0 : 0;
  const maxFrac = abbreviate ? 0 : (Math.abs(value) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(value);
}

function inferTrend(value: number, signed?: boolean, trend?: MoneyTrend): MoneyTrend {
  if (trend) return trend;
  if (signed) {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
  }
  return 'neutral';
}

export const Money: React.FC<MoneyProps> = ({
  value,
  currency = 'INR',
  className,
  signed = false,
  compact = false,
  size = 'md',
  trend,
  muted = false,
  abbreviate,
  'aria-label': ariaLabel,
}) => {
  // null / undefined / NaN → em-dash in muted color
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === null || num === undefined || Number.isNaN(num) || !Number.isFinite(num)) {
    return (
      <span
        className={cn(
          SIZE_CLASS[size],
          'font-medium text-slate-400 dark:text-slate-600',
          'tabular-nums',
          className,
        )}
        aria-label="no data"
        dir="ltr"
      >
        —
      </span>
    );
  }

  const computedTrend = muted ? 'neutral' : inferTrend(num, signed, trend);
  const showSign = signed && num > 0 ? '+' : '';
  const formatted = formatIndianCurrency(num, currency, { compact, abbreviate });
  const text = showSign + formatted;

  return (
    <span
      className={cn(
        SIZE_CLASS[size],
        'tabular-nums font-semibold',
        TREND_CLASS[computedTrend],
        className,
      )}
      style={{ fontFeatureSettings: "'tnum' 1, 'lnum' 1" }}
      aria-label={ariaLabel ?? text.replace(/[   ]/g, ' ')}
      dir="ltr"
    >
      {text}
    </span>
  );
};

export default React.memo(Money);
