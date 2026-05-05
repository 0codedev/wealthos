/**
 * CC98 — NumberInput component.
 *
 * A premium number input with:
 *   - Currency prefix (₹ / $ / € / £) on the left
 *   - Percentage suffix (%) on the right
 *   - Increment/decrement buttons (+/-)
 *   - Keyboard support: ↑/↓ arrows nudge by `step`, Shift+arrow nudges by `step*10`
 *   - Format-on-blur: raw text in, locale-formatted text out
 *   - Min/max clamping
 *   - locale-aware thousands separators
 *   - error state + aria-invalid
 *
 * Why a dedicated component:
 *   Production finance apps (Stripe Dashboard, Robinhood, Zerodha Kite) all
 *   treat number inputs as a first-class component. The current app has
 *   ~150 raw `<input type="number">` sites, each reimplementing its own
 *   formatting and validation. This unifies the visual + behavioral spec.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

export type NumberInputVariant = 'default' | 'currency' | 'percent' | 'compact';

export interface NumberInputProps {
    /** Current numeric value (controlled). `null` means empty. */
    value: number | null | undefined;
    /** Called with the new numeric value whenever it changes. */
    onChange: (next: number | null) => void;
    /** Step for +/- buttons and arrow keys. Default 1. */
    step?: number;
    /** Min clamp (inclusive). */
    min?: number;
    /** Max clamp (inclusive). */
    max?: number;
    /** Decimal places for the formatted output. Default 2. */
    decimals?: number;
    /** Visual prefix (default `₹` for currency variant). */
    prefix?: string;
    /** Visual suffix (default `%` for percent variant). */
    suffix?: string;
    /** Visual variant. */
    variant?: NumberInputVariant;
    /** Placeholder text when empty. */
    placeholder?: string;
    /** Disabled state. */
    disabled?: boolean;
    /** Mark as invalid (red border + aria-invalid). */
    invalid?: boolean;
    /** aria-label (required if no visible label). */
    'aria-label'?: string;
    /** id of the element that labels this input. */
    'aria-labelledby'?: string;
    /** id of the element that describes this input (e.g. help text). */
    'aria-describedby'?: string;
    /** Optional className for the wrapper. */
    className?: string;
    /** Hide the increment/decrement buttons. */
    hideSteppers?: boolean;
}

const DEFAULT_PREFIX_BY_VARIANT: Record<NumberInputVariant, { prefix: string; suffix: string }> = {
    default: { prefix: '', suffix: '' },
    currency: { prefix: '₹', suffix: '' },
    percent: { prefix: '', suffix: '%' },
    compact: { prefix: '', suffix: '' },
};

const DECIMALS_BY_VARIANT: Record<NumberInputVariant, number> = {
    default: 2,
    currency: 2,
    percent: 2,
    compact: 0,
};

const isFiniteNumber = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n);

/**
 * Format a number with locale-aware thousands separators.
 * Uses `Intl.NumberFormat` with `en-IN` to match the rest of the app.
 */
function formatNumber(value: number, decimals: number): string {
    if (!isFiniteNumber(value)) return '';
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    }).format(value);
}

export const NumberInput: React.FC<NumberInputProps> = ({
    value,
    onChange,
    step = 1,
    min,
    max,
    decimals,
    prefix: prefixProp,
    suffix: suffixProp,
    variant = 'default',
    placeholder,
    disabled = false,
    invalid = false,
    className = '',
    hideSteppers = false,
    ...aria
}) => {
    const reactId = useId();
    const inputId = `ni-${reactId}`;
    const variantDecor = DEFAULT_PREFIX_BY_VARIANT[variant];
    const prefix = prefixProp ?? variantDecor.prefix;
    const suffix = suffixProp ?? variantDecor.suffix;
    const resolvedDecimals = decimals ?? DECIMALS_BY_VARIANT[variant];

    const [draft, setDraft] = useState<string>(() =>
        isFiniteNumber(value) ? formatNumber(value, resolvedDecimals) : ''
    );
    const [focused, setFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Keep the draft in sync if the parent updates `value` while not focused.
    useEffect(() => {
        if (!focused) {
            setDraft(isFiniteNumber(value) ? formatNumber(value, resolvedDecimals) : '');
        }
    }, [value, focused, resolvedDecimals]);

    const clamp = useCallback(
        (n: number) => {
            let out = n;
            if (typeof min === 'number') out = Math.max(min, out);
            if (typeof max === 'number') out = Math.min(max, out);
            return out;
        },
        [min, max]
    );

    const commit = useCallback(
        (text: string) => {
            // Strip everything that isn't a digit, decimal point, or minus.
            const cleaned = text.replace(/[^\d.\-]/g, '');
            if (cleaned === '' || cleaned === '-' || cleaned === '.') {
                onChange(null);
                return;
            }
            const parsed = Number(cleaned);
            if (!Number.isFinite(parsed)) {
                onChange(null);
                return;
            }
            onChange(clamp(parsed));
        },
        [clamp, onChange]
    );

    const bump = useCallback(
        (direction: 1 | -1) => {
            const current = isFiniteNumber(value) ? value : 0;
            const next = clamp(current + direction * step);
            onChange(next);
        },
        [clamp, onChange, step, value]
    );

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir: 1 | -1 = e.key === 'ArrowUp' ? 1 : -1;
            const multiplier = e.shiftKey ? 10 : 1;
            const current = isFiniteNumber(value) ? value : 0;
            onChange(clamp(current + dir * step * multiplier));
        } else if (e.key === 'Home' && typeof min === 'number') {
            e.preventDefault();
            onChange(min);
        } else if (e.key === 'End' && typeof max === 'number') {
            e.preventDefault();
            onChange(max);
        }
    };

    const inputEl = (
        <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-label={aria['aria-label']}
            aria-labelledby={aria['aria-labelledby']}
            aria-describedby={aria['aria-describedby']}
            onChange={(e) => {
                const text = e.target.value;
                setDraft(text);
                commit(text);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
                setFocused(false);
                // Re-format on blur so the user sees the canonical representation.
                if (isFiniteNumber(value)) {
                    setDraft(formatNumber(value, resolvedDecimals));
                } else if (draft !== '') {
                    setDraft('');
                }
            }}
            onKeyDown={onKeyDown}
            className={`
                w-full bg-transparent outline-none text-sm font-medium tabular-nums
                text-slate-900 dark:text-slate-100
                placeholder:text-slate-400 dark:placeholder:text-slate-500
                disabled:opacity-50 disabled:cursor-not-allowed
                ${prefix ? 'pl-7' : 'pl-3'}
                ${suffix ? 'pr-7' : 'pr-3'}
                ${hideSteppers ? 'py-2.5' : 'py-1.5'}
            `}
        />
    );

    return (
        <div
            className={`
                group relative inline-flex items-center
                rounded-xl border bg-white dark:bg-slate-900
                ${invalid
                    ? 'border-rose-400 dark:border-rose-500 ring-2 ring-rose-100 dark:ring-rose-500/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-500/20'}
                transition-colors
                ${disabled ? 'opacity-60' : ''}
                ${variant === 'compact' ? 'h-8' : 'h-10'}
                ${className}
            `}
        >
            {prefix && (
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500 dark:text-slate-400"
                >
                    {prefix}
                </span>
            )}

            {inputEl}

            {suffix && (
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500 dark:text-slate-400"
                >
                    {suffix}
                </span>
            )}

            {!hideSteppers && (
                <div className="flex flex-col border-l border-slate-200 dark:border-slate-700 h-full">
                    <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Increase value"
                        disabled={disabled || (typeof max === 'number' && isFiniteNumber(value) && value >= max)}
                        onClick={() => bump(1)}
                        className="flex-1 px-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <Plus size={11} />
                    </button>
                    <button
                        type="button"
                        tabIndex={-1}
                        aria-label="Decrease value"
                        disabled={disabled || (typeof min === 'number' && isFiniteNumber(value) && value <= min)}
                        onClick={() => bump(-1)}
                        className="flex-1 px-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800 border-t border-slate-200 dark:border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <Minus size={11} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default NumberInput;
