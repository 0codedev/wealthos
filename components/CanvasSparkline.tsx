/**
 * Agent CC6 — Canvas Sparkline
 *
 * A lightweight, hardware-accelerated canvas sparkline that:
 *  - Renders a glowing trace with a per-pixel fade.
 *  - Auto-colours emerald/rose based on the *current* slope (last tick
 *    vs first tick) — not a stale `trend` prop.
 *  - Re-renders only when `data` actually changes (shallow length + last
 *    value), so a 60Hz price feed does not thrash the canvas.
 *  - Uses `requestAnimationFrame` to keep draw loops on the GPU thread
 *    and avoid CPU spikes during fast data updates.
 */
import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { CHART_COLORS } from '../utils/chartEngine';

export interface CanvasSparklineProps {
    data: number[];
    width?: number;
    height?: number;
    /** Optional override colour (otherwise auto: emerald/rose/neutral). */
    color?: string;
    /** How many trailing frames to keep on screen for the bloom trail. */
    trail?: number;
    /** Show the trailing fade path? */
    showTrail?: boolean;
    /** Re-render only when data length changes or last value changes. */
    className?: string;
    'aria-label'?: string;
}

const DEFAULTS = {
    width: 100,
    height: 32,
    trail: 6,
};

export const CanvasSparkline: React.FC<CanvasSparklineProps> = ({
    data,
    width = DEFAULTS.width,
    height = DEFAULTS.height,
    color,
    trail = DEFAULTS.trail,
    showTrail = true,
    className,
    ...rest
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    // Stable signature: only redraw if length OR last value OR first value
    // actually changes. Prevents per-tick thrash on fast feeds.
    const sig = useMemo(() => {
        const last = data[data.length - 1];
        const first = data[0];
        return `${data.length}:${first ?? 'x'}:${last ?? 'x'}`;
    }, [data]);
    const lastSigRef = useRef<string>('');

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || data.length < 2) return;

        // 1. Choose colour
        let stroke = color;
        if (!stroke) {
            const first = data[0];
            const last = data[data.length - 1];
            if (typeof first === 'number' && typeof last === 'number') {
                if (last > first) stroke = CHART_COLORS.profit;
                else if (last < first) stroke = CHART_COLORS.loss;
                else stroke = CHART_COLORS.neutral;
            } else {
                stroke = CHART_COLORS.neutral;
            }
        }

        // 2. Compute path
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const w = width;
        const h = height;
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = (max - min) || 1;
        const stepX = w / (data.length - 1);

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // 3. Trail (older frames in lower alpha)
        if (showTrail && trail > 0) {
            for (let t = trail; t >= 1; t -= 1) {
                const alpha = 0.08 * (1 - t / (trail + 1));
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = stroke;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                data.forEach((p, i) => {
                    const x = i * stepX;
                    const y = h - ((p - min) / range) * h;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
            }
        }

        // 4. Live trace (full alpha + glow)
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = stroke;
        ctx.shadowBlur = 4;
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        data.forEach((p, i) => {
            const x = i * stepX;
            const y = h - ((p - min) / range) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // 5. Live end-dot (glowing)
        const lastX = (data.length - 1) * stepX;
        const lastV = data[data.length - 1]!;
        const lastY = h - ((lastV - min) / range) * h;
        ctx.shadowBlur = 8;
        ctx.fillStyle = stroke;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 2.25, 0, Math.PI * 2);
        ctx.fill();

        // 6. White inner pip for depth
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 0.9, 0, Math.PI * 2);
        ctx.fill();
    }, [data, width, height, color, trail, showTrail]);

    useEffect(() => {
        if (lastSigRef.current === sig) return;
        lastSigRef.current = sig;
        let raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [sig, draw]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            aria-hidden="true"
            {...rest}
        />
    );
};

export default CanvasSparkline;
