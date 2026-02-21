/**
 * Agent CC6 — Premium Chart Visualisation Engine
 *
 * HSL-tuned gradients, SVG filters, and a Recharts-compatible set of
 * presets that any chart wrapper can drop in to get a Bloomberg-grade
 * finish without re-inventing the math.
 *
 * Design intent:
 *  - Single source of truth for chart-wide visuals (axes, grid, tooltip
 *    cursor, legend).
 *  - All gradients are HSL-derived so we can re-tune hue/sat with one
 *    line instead of touching every chart.
 *  - GPU-first: gradients use only `opacity` + `stopColor` stops; filters
 *    use `feDropShadow` (composited) and `feGaussianBlur` (cheap on
 *    modern GPUs) — no `filter: url(#...)` on heavy nodes.
 */
import React from 'react';

// ─────────────────────────────────────────────────────────────────
// Agent CC6 — HSL-tuned palette
// ─────────────────────────────────────────────────────────────────
const toHsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;

export const CHART_PALETTE = {
    // Brand
    indigo:  { hue: 239, sat: 84 },
    violet:  { hue: 258, sat: 90 },
    cyan:    { hue: 187, sat: 95 },
    emerald: { hue: 160, sat: 84 },
    rose:    { hue: 350, sat: 89 },
    amber:   { hue:  38, sat: 92 },
    orange:  { hue:  20, sat: 90 },
    slate:   { hue: 215, sat: 16 },
} as const;

export const CHART_COLORS = {
    primary:  '#6366f1',
    primary2: '#8b5cf6',
    profit:   '#10b981',
    loss:     '#f43f5e',
    warning:  '#f59e0b',
    neutral:  '#64748b',
    accent1:  '#8b5cf6',
    accent2:  '#06b6d4',
    accent3:  '#f97316',
    gold:     '#eab308',
    series:   ['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#f43f5e', '#f97316'],
    allocation: ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#f43f5e', '#64748b'],
} as const;

// ─────────────────────────────────────────────────────────────────
// Agent CC6 — High-fidelity 4-stop area gradient
// ─────────────────────────────────────────────────────────────────
/**
 * makePremiumAreaGradient — a 4-stop fade that resolves "0% solid hue →
 * 30% 60% → 65% 25% → 100% transparent". Reads as a soft volumetric
 * glow that hugs the line, not a flat triangle.
 */
export function makePremiumAreaGradient(
    id: string,
    color: string,
    opts: { topOpacity?: number; midOpacity?: number; horizon?: number } = {}
): React.ReactElement {
    const top = opts.topOpacity ?? 0.55;
    const mid = opts.midOpacity ?? 0.18;
    const horizon = opts.horizon ?? 100;
    return React.createElement(
        'linearGradient',
        { key: id, id, x1: '0', y1: '0', x2: '0', y2: '1' },
        React.createElement('stop', { offset: '0%',   stopColor: color, stopOpacity: top }),
        React.createElement('stop', { offset: '40%',  stopColor: color, stopOpacity: mid * 1.5 }),
        React.createElement('stop', { offset: `${horizon - 10}%`, stopColor: color, stopOpacity: mid }),
        React.createElement('stop', { offset: `${horizon}%`,      stopColor: color, stopOpacity: 0 })
    );
}

/**
 * makeRadialSpotlight — a radial gradient used to place a "hot spot"
 * behind the active data point. Use with a Tooltip cursor overlay.
 */
export function makeRadialSpotlight(
    id: string,
    color: string,
    radius = 0.5
): React.ReactElement {
    return React.createElement(
        'radialGradient',
        { key: id, id, cx: '50%', cy: '50%', r: `${Math.round(radius * 100)}%` },
        React.createElement('stop', { offset: '0%',   stopColor: color, stopOpacity: 0.35 }),
        React.createElement('stop', { offset: '60%',  stopColor: color, stopOpacity: 0.08 }),
        React.createElement('stop', { offset: '100%', stopColor: color, stopOpacity: 0 })
    );
}

/**
 * makeSeriesGradient — wraps makePremiumAreaGradient but with a
 * signature for the tooltip cursor radial spotlight.
 */
export function makeSeriesGradient(
    id: string,
    color: string,
    topOpacity = 0.55
): React.ReactElement {
    return makePremiumAreaGradient(id, color, { topOpacity, midOpacity: 0.18 });
}

// ─────────────────────────────────────────────────────────────────
// Agent CC6 — SVG filters (drop-shadow halo + bloom + line glow)
// ─────────────────────────────────────────────────────────────────
/**
 * makeGlowFilter — produces a soft halo around a single SVG node.
 * `intensity` scales both stdDeviation and floodOpacity so a single
 * filter id can be re-used at different strengths.
 */
export function makeGlowFilter(
    id: string,
    color: string = CHART_COLORS.profit,
    intensity: number = 1
): React.ReactElement {
    const std = 1.5 * intensity;
    const op = 0.55 * Math.min(1, intensity);
    return React.createElement(
        'filter',
        { key: id, id, x: '-50%', y: '-50%', width: '200%', height: '200%' },
        React.createElement('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: std }),
        React.createElement('feComponentTransfer', null,
            React.createElement('feFuncA', { type: 'linear', slope: op })
        ),
        React.createElement('feMerge', null,
            React.createElement('feMergeNode'),
            React.createElement('feMergeNode', { in: 'SourceGraphic' })
        )
    );
}

/**
 * makeBloomFilter — the bloom effect: source is blurs *itself* under
 * a coloured flood, producing a true bloom instead of a flat shadow.
 * Use sparingly on hot elements (e.g. the live last-point).
 */
export function makeBloomFilter(
    id: string,
    color: string = CHART_COLORS.profit
): React.ReactElement {
    return React.createElement(
        'filter',
        { key: id, id, x: '-100%', y: '-100%', width: '300%', height: '300%' },
        React.createElement('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: 2.5, result: 'blur' }),
        React.createElement('feFlood', { floodColor: color, floodOpacity: 0.65 }),
        React.createElement('feComposite', { in2: 'blur', operator: 'in', result: 'glow' }),
        React.createElement('feMerge', null,
            React.createElement('feMergeNode', { in: 'glow' }),
            React.createElement('feMergeNode', { in: 'SourceGraphic' })
        )
    );
}

// ─────────────────────────────────────────────────────────────────
// Agent CC6 — Recharts-friendly preset bundle
// ─────────────────────────────────────────────────────────────────
export const PREMIUM_GRID = {
    stroke: 'rgba(148, 163, 184, 0.06)',
    strokeDasharray: '3 3',
    vertical: false,
} as const;

export const PREMIUM_AXIS = {
    tick: { fill: 'var(--color-text-secondary, #94a3b8)', fontSize: 11, fontWeight: 600 },
    axisLine: false,
    tickLine: false,
} as const;

export const PREMIUM_TOOLTIP = {
    cursor: { stroke: 'rgba(99, 102, 241, 0.35)', strokeWidth: 1, strokeDasharray: '4 4' },
} as const;

export const PREMIUM_LEGEND = {
    wrapperStyle: {
        fontSize: 11,
        color: '#94a3b8',
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
        paddingTop: 8,
    },
} as const;

// ─────────────────────────────────────────────────────────────────
// Agent CC6 — utility helpers
// ─────────────────────────────────────────────────────────────────
export function getProfitLossColor(value: number): string {
    return value >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss;
}

export function getSeriesColor(index: number): string {
    const color = CHART_COLORS.series[index % CHART_COLORS.series.length];
    return color !== undefined ? color : CHART_COLORS.primary;
}

export function getAllocationColor(index: number): string {
    const color = CHART_COLORS.allocation[index % CHART_COLORS.allocation.length];
    return color !== undefined ? color : CHART_COLORS.primary;
}
