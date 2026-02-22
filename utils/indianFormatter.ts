/**
 * Indian Number Formatter Utility
 */

export interface INRFormatOptions {
    compact?: boolean;
    showSign?: boolean;
    decimals?: number;
}

export function formatINR(value: number, options: INRFormatOptions = {}): string {
    const { compact = false, showSign = false, decimals = 2 } = options;
    const absValue = Math.abs(value);
    let result = '';

    if (compact) {
        if (absValue >= 1000000000) { result = `₹${(absValue / 1000000000).toFixed(decimals)} Ar`; }
        else if (absValue >= 10000000) { result = `₹${(absValue / 10000000).toFixed(decimals)} Cr`; }
        else if (absValue >= 100000) { result = `₹${(absValue / 100000).toFixed(decimals)} L`; }
        else { result = `₹${formatIndianCommas(absValue, decimals)}`; }
    } else {
        result = `₹${formatIndianCommas(absValue, decimals)}`;
    }

    if (showSign && value !== 0) {
        result = (value > 0 ? '+' : '-') + result;
    } else if (value < 0 && !compact) {
        result = '-' + result;
    }

    return result;
}

export function formatLakhCrore(value: number): string {
    const abs = Math.abs(value);
    if (abs < 100000) return formatINR(value, { compact: false });
    return formatINR(value, { compact: true });
}

export function formatPercentage(value: number, options: { showSign?: boolean, decimals?: number } = {}): string {
    const { showSign = true, decimals = 2 } = options;
    const sign = showSign && value > 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * formatQuantity - Formats share quantities
 */
export function formatQuantity(value: number): string {
    const isInteger = Number.isInteger(value);
    const formatted = formatIndianCommas(value, isInteger ? 0 : 2);
    return `${formatted} ${isInteger ? 'shares' : 'units'}`;
}

function formatIndianCommas(num: number, decimals: number): string {
    const parts = num.toFixed(decimals).split('.');
    const firstPart = parts[0];
    if (firstPart === undefined) return '';
    const x = firstPart;
    let lastThree = x.substring(x.length - 3);
    const otherNumbers = x.substring(0, x.length - 3);
    if (otherNumbers !== '') { lastThree = ',' + lastThree; }
    const res = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
    const secondPart = parts[1];
    return secondPart !== undefined ? res + "." + secondPart : res;
}
