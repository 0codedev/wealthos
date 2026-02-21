
/**
 * Unified Chart Color & Theme Engine
 * Optimized for dark financial terminal aesthetics.
 * Agent CC3 polish: added gradient defs + premium grid/axis defaults.
 */

import React from 'react';

// Primary palette — a cohesive, dark-terminal-optimized set
export const CHART_COLORS = {
  primary: '#6366f1',       // Indigo — main portfolio line
  profit: '#10b981',        // Emerald green — gains
  loss: '#ef4444',          // Red — losses
  warning: '#f59e0b',       // Amber — caution/SL zones
  neutral: '#64748b',       // Slate — neutral/benchmark
  accent1: '#8b5cf6',       // Violet — secondary metric
  accent2: '#06b6d4',       // Cyan — tertiary metric
  accent3: '#f97316',       // Orange — alerts
  gold: '#eab308',          // Gold — achievements/milestones

  // Series colors for multi-line charts (portfolio comparison, scenarios)
  series: ['#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#f97316'],

  // Allocation pie/donut charts
  allocation: ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#64748b'],
};

// Shared Recharts component defaults
export const CHART_DEFAULTS = {
  // CartesianGrid
  grid: {
    strokeDasharray: '3 3',
    stroke: 'rgba(148, 163, 184, 0.08)',
    vertical: false,
  },

  // XAxis and YAxis
  axis: {
    tick: { fill: '#94a3b8', fontSize: 11, fontWeight: 600 },
    axisLine: { stroke: 'rgba(148, 163, 184, 0.2)' },
    tickLine: false,
  },

  // Tooltip
  tooltip: {
    contentStyle: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      borderRadius: '12px',
      color: '#e2e8f0',
      fontSize: '12px',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      padding: '12px'
    },
    cursor: { stroke: 'rgba(99, 102, 241, 0.3)', strokeWidth: 1 },
  },

  // Legend
  legend: {
    wrapperStyle: { fontSize: '11px', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' },
  }
};

/**
 * Returns CHART_COLORS.profit or CHART_COLORS.loss based on value sign
 */
export function getProfitLossColor(value: number): string {
    return value >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss;
}

/**
 * Returns color from the series palette
 */
export function getSeriesColor(index: number): string {
    const color = CHART_COLORS.series[index % CHART_COLORS.series.length];
    return color !== undefined ? CHART_COLORS.primary : color;
}

/**
 * Returns color from the allocation palette
 */
export function getAllocationColor(index: number): string {
    const color = CHART_COLORS.allocation[index % CHART_COLORS.allocation.length];
    return color !== undefined ? CHART_COLORS.primary : color;
}

/**
 * Agent CC3 — Premium gradient <defs> for Area / Line charts.
 * Returns a <linearGradient> element to be inlined inside <defs>.
 *
 *   <defs>
 *     {makeChartGradient('gainGradient', CHART_COLORS.profit)}
 *     {makeChartGradient('lossGradient', CHART_COLORS.loss)}
 *   </defs>
 *   <Area fill="url(#gainGradient)" stroke={CHART_COLORS.profit} dataKey="value" />
 */
export function makeChartGradient(id: string, color: string, topOpacity: number = 0.45): React.ReactElement {
    return React.createElement(
        'linearGradient',
        { key: id, id, x1: '0', y1: '0', x2: '0', y2: '1' },
        React.createElement('stop', { offset: '0%', stopColor: color, stopOpacity: topOpacity }),
        React.createElement('stop', { offset: '60%', stopColor: color, stopOpacity: topOpacity * 0.35 }),
        React.createElement('stop', { offset: '100%', stopColor: color, stopOpacity: 0 })
    );
}

/**
 * Agent CC3 — Drop-shadow filter for premium sparkline glow.
 * Returns a <filter> element to be inlined inside <defs>.
 */
export function makeGlowFilter(id: string = 'sparkline-glow', color: string = CHART_COLORS.profit): React.ReactElement {
    return React.createElement(
        'filter',
        { key: id, id, x: '-50%', y: '-50%', width: '200%', height: '200%' },
        React.createElement('feDropShadow', {
            dx: 0,
            dy: 0,
            stdDeviation: 1.5,
            floodColor: color,
            floodOpacity: 0.55,
        })
    );
}

/**
 * Agent CC3 — Subtle dashed grid preset aligned with --color-text-secondary.
 */
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
