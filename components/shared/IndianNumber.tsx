import React from 'react';
import { formatCurrencyCompact, formatCurrency } from '../../utils/helpers';

export type IndianNotation = 'full' | 'compact' | 'auto';

/**
 * IndianNumber — renders a number using Indian-locale formatting.
 * - 'full'    → uses `formatCurrency` (₹1,23,456)
 * - 'compact' → uses `formatCurrencyCompact` (₹1.23L, ₹4.56Cr)
 * - 'auto'    → auto-switches at the dashboard-wide threshold
 */
interface IndianNumberProps {
    value: number;
    notation?: IndianNotation;
    /** Threshold above which 'auto' switches to compact form. Default 1L. */
    autoThreshold?: number;
    /** Show the `₹` prefix. */
    showRupee?: boolean;
    /** Optional suffix like "/mo" or "%". */
    suffix?: string;
    /** Add .font-mono and .font-tabular for aligned numerics. */
    tabular?: boolean;
    className?: string;
    /** Render with privacy masking. */
    isPrivacyMode?: boolean;
}

export const IndianNumber: React.FC<IndianNumberProps> = ({
    value,
    notation = 'auto',
    autoThreshold = 100000,
    showRupee = true,
    suffix,
    tabular = true,
    className = '',
    isPrivacyMode = false,
}) => {
    if (isPrivacyMode) {
        return (
            <span className={`${tabular ? 'font-mono font-tabular' : ''} ${className}`}>
                ••••••
            </span>
        );
    }

    let display: string;
    if (notation === 'auto') {
        const abs = Math.abs(value);
        display = abs >= autoThreshold && abs % 1 === 0
            ? formatCurrencyCompact(value)
            : formatCurrency(value);
    } else if (notation === 'compact') {
        display = formatCurrencyCompact(value);
    } else {
        display = formatCurrency(value);
    }

    if (!showRupee) {
        display = display.replace(/^[-]?₹\s?/, m => (m.startsWith('-') ? '-' : ''));
    }

    return (
        <span className={`${tabular ? 'font-mono font-tabular' : ''} ${className}`}>
            {display}
            {suffix && <span className="opacity-70">{suffix}</span>}
        </span>
    );
};

export default IndianNumber;
