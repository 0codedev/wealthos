// utils/format.ts — CC49 design tokens tabular helper
//
// Tiny utility module that exposes the `tabular(n, fractionDigits)` helper.
// We use it for *new* numeric displays so digits always line up vertically in
// tables and KPI strips. The helper is opt-in: existing call sites that use
// `formatCurrency` / `formatPercent` / `formatNumber` keep their string return
// type, so this addition is non-breaking.

/**
 * Format a number into a fixed-width, tabular-numeric string.
 *
 * Returns an HTML string wrapped in a `<span class="font-mono tabular-nums">`
 * element so the digits line up vertically inside tables, KPI strips, and
 * ticker cells. The `font-mono` class is registered in `tailwind.config.js`
 * to JetBrains Mono; the `tabular-nums` utility enables OpenType tabular
 * figures.
 *
 * @param n                the number to format
 * @param fractionDigits   how many fraction digits to render (default 0)
 * @returns                a string of HTML
 *
 * @pure
 */
export const tabular = (n: number, fractionDigits = 0): string => {
  if (!Number.isFinite(n)) {
    return '<span class="font-mono tabular-nums">NaN</span>';
  }
  const safe = n;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  }).format(safe);
  return `<span class="font-mono tabular-nums">${formatted}</span>`;
};

/**
 * Tabular variant for currency. Renders an Indian-locale currency string in
 * a tabular `<span>` so columns of money line up perfectly.
 */
export const tabularCurrency = (n: number, fractionDigits = 0): string => {
  if (!Number.isFinite(n)) {
    return '<span class="font-mono tabular-nums">NaN</span>';
  }
  const safe = n;
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  }).format(safe);
  return `<span class="font-mono tabular-nums">${formatted}</span>`;
};

/**
 * Tabular variant for percentages. `0.123` with `fractionDigits=2` → "12.30%".
 */
export const tabularPercent = (n: number, fractionDigits = 2): string => {
  if (!Number.isFinite(n)) {
    return '<span class="font-mono tabular-nums">NaN</span>';
  }
  const formatted = `${(n * 100).toFixed(fractionDigits)}%`;
  return `<span class="font-mono tabular-nums">${formatted}</span>`;
};
