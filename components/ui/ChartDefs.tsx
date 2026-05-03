/**
 * Agent CC6 — Premium Chart <defs> bundle
 *
 * Drop-in component that renders ALL the SVG <defs> a chart needs in
 * one place: HSL-tuned area gradients, glow filters, bloom filters,
 * and the active-point spotlight gradient.
 *
 * Usage:
 *   <ResponsiveContainer>
 *     <AreaChart data={...}>
 *       <ChartDefs
 *         series={[
 *           { id: 'pnl', color: CHART_COLORS.profit, glow: true },
 *           { id: 'bench', color: CHART_COLORS.neutral, topOpacity: 0.2 },
 *         ]}
 *         cursorColor="rgba(99,102,241,0.35)"
 *       />
 *       <CartesianGrid {...PREMIUM_GRID} />
 *       <Area dataKey="pnl"    stroke={CHART_COLORS.profit} fill="url(#grad-pnl)" />
 *       <Area dataKey="bench"  stroke={CHART_COLORS.neutral} fill="url(#grad-bench)" />
 *     </AreaChart>
 *   </ResponsiveContainer>
 */
import React from 'react';
import {
    makePremiumAreaGradient,
    makeRadialSpotlight,
    makeGlowFilter,
    makeBloomFilter,
    CHART_COLORS,
} from '../../utils/chartEngine';

export interface ChartDefSeries {
    /** Stable id used for the gradient + filter ids. */
    id: string;
    /** Stroke/fill colour (hex/rgb). */
    color: string;
    /** Top-of-area opacity. Defaults to 0.55. */
    topOpacity?: number;
    /** Add a glow filter? */
    glow?: boolean;
    /** Add a bloom filter (heavier — use for the live indicator only). */
    bloom?: boolean;
}

export interface ChartDefsProps {
    series: ChartDefSeries[];
    /** Spot colour for the cursor pointer gradient. */
    cursorColor?: string;
}

export const ChartDefs: React.FC<ChartDefsProps> = ({
    series,
    cursorColor = CHART_COLORS.primary,
}) => {
    return (
        <defs>
            {/* Per-series premium area gradients */}
            {series.map((s) =>
                makePremiumAreaGradient(`grad-${s.id}`, s.color, { topOpacity: s.topOpacity ?? 0.55, midOpacity: 0.18 })
            )}

            {/* Optional glow filters */}
            {series.filter((s) => s.glow).map((s) => makeGlowFilter(`glow-${s.id}`, s.color, 1))}

            {/* Optional bloom filters (heavier — last-point / live indicator) */}
            {series.filter((s) => s.bloom).map((s) => makeBloomFilter(`bloom-${s.id}`, s.color))}

            {/* Cursor radial spotlight (used by the guideline) */}
            {makeRadialSpotlight('cursor-spotlight', cursorColor, 0.5)}
        </defs>
    );
};

export default ChartDefs;
