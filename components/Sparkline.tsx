import React, { useMemo } from 'react';
import {
    CHART_COLORS,
    makePremiumAreaGradient,
    makeGlowFilter,
    makeBloomFilter,
    getProfitLossColor,
} from '../utils/chartEngine';

interface SparklineProps {
    data?: number[];
    color?: string;
    width?: number;
    height?: number;
    trend?: 'UP' | 'DOWN' | 'NEUTRAL';
    seedStr?: string;
    /**
     * Agent CC3 — when true (default) the line picks emerald/rose/slate
     * based on the actual slope of the data, ignoring the `trend` hint.
     */
    autoColor?: boolean;
    /**
     * Agent CC3 — toggle the SVG drop-shadow glow halo.
     */
    glow?: boolean;
    /**
     * Agent CC6 — render a pulsing "live" indicator dot at the last point
     * (the "pulsing glow dot" from the brief). Defaults to `glow`.
     */
    liveDot?: boolean;
}

const Sparkline: React.FC<SparklineProps> = ({
    data,
    color,
    width = 60,
    height = 20,
    trend,
    seedStr = '',
    autoColor = true,
    glow = true,
    liveDot,
}) => {
    // Generate deterministic mock data if none provided
    const points = useMemo(() => {
        if (data && data.length > 0) return data;

        // Pseudo-random deterministic generator based on seed string to prevent re-render jumps
        let seed = 0;
        const inputStr = seedStr || trend || 'DEFAULT';
        for (let i = 0; i < inputStr.length; i++) {
            seed = (seed << 5) - seed + inputStr.charCodeAt(i);
            seed |= 0;
        }

        const deterministicRandom = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };

        const mock = [];
        let val = 50;
        for (let i = 0; i < 10; i++) {
            const change = (deterministicRandom() - 0.5) * 10;
            if (trend === 'UP') val += Math.abs(change);
            else if (trend === 'DOWN') val -= Math.abs(change);
            else val += change;
            mock.push(val);
        }
        return mock;
    }, [data, trend]);

    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;

    const pathD = points.map((p, i) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - ((p - min) / range) * height;
        return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
    }).join(' ');

    // Agent CC3 — Dynamic color: derive from the actual slope of the data
    // (or the explicit `trend` prop) so the sparkline always reads UP/DOWN
    // even when the data is provided externally.
    const derivedTrend: 'UP' | 'DOWN' | 'NEUTRAL' = useMemo(() => {
        if (trend) return trend;
        if (points.length < 2) return 'NEUTRAL';
        const first = points[0];
        const last = points[points.length - 1];
        if (last === undefined || first === undefined) return 'NEUTRAL';
        if (last > first) return 'UP';
        if (last < first) return 'DOWN';
        return 'NEUTRAL';
    }, [points, trend]);

    const strokeColor = color || getProfitLossColor(
        (points[points.length - 1] ?? 0) - (points[0] ?? 0)
    );

    // Stable id derived from data signature so the gradient doesn't re-mount
    // unnecessarily on every re-render. Uses simple hash of length + first/last.
    const stableId = useMemo(() => {
        const len = points.length;
        const first = points[0] ?? 0;
        const last = points[len - 1] ?? 0;
        // cheap deterministic id
        const h = ((len * 73856093) ^ (first * 19349663) ^ (last * 83492791)) >>> 0;
        return `sl-${h.toString(36)}`;
    }, [points]);

    const gradientId = `${stableId}-grad`;
    const filterId = `${stableId}-glow`;
    const bloomId = `${stableId}-bloom`;
    const showLiveDot = liveDot ?? glow;

    // Unused param kept for API parity with previous callers
    void autoColor;

    // Helper: build the gradient + filter defs
    const gradientNode = makePremiumAreaGradient(gradientId, strokeColor, { topOpacity: 0.32, midOpacity: 0.12 });
    const glowNode = glow ? makeGlowFilter(filterId, strokeColor, 0.8) : null;
    const bloomNode = glow ? makeBloomFilter(bloomId, strokeColor) : null;

    // Subtle area fill for premium feel
    const areaPathD = `${pathD} L ${width},${height} L 0,${height} Z`;
    const lastIdx = points.length - 1;
    const lastX = (lastIdx / (points.length - 1)) * width;
    const lastY = height - (((points[lastIdx] ?? 0) - min) / range) * height;

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="overflow-visible"
            aria-hidden="true"
        >
            <defs>
                {gradientNode}
                {glowNode}
                {bloomNode}
            </defs>

            {/* Subtle area fill for premium feel */}
            <path
                d={areaPathD}
                fill={`url(#${gradientId})`}
                stroke="none"
            />

            {/* Glowing trend line */}
            <path
                d={pathD}
                fill="none"
                stroke={strokeColor}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={glow ? `url(#${filterId})` : undefined}
            />

            {/* Pulsing live dot at the last point (Agent CC6 "pulsing glow dot") */}
            {showLiveDot && (
                <g filter={glow ? `url(#${bloomId})` : undefined}>
                    <circle
                        cx={lastX}
                        cy={lastY}
                        r="2.25"
                        fill={strokeColor}
                    />
                    {/* Inner white pip for depth */}
                    <circle
                        cx={lastX}
                        cy={lastY}
                        r="0.9"
                        fill="rgba(255,255,255,0.9)"
                    />
                </g>
            )}

            {/* End Dot fallback (no liveDot) */}
            {!showLiveDot && (
                <circle
                    cx={width}
                    cy={lastY}
                    r="2"
                    fill={strokeColor}
                />
            )}
        </svg>
    );
};

// Re-export CHART_COLORS for legacy callers
export { CHART_COLORS };

export default Sparkline;
