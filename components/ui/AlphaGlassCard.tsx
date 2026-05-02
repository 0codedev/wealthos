import React from 'react';
import { useCursorLight } from '../../hooks/useCursorLight';

/**
 * Agent CC5 — AlphaGlassCard
 * A premium glassmorphic card with a live cursor-reactive specular
 * highlight and a soft complementary ambient shadow.
 *
 * Usage:
 *   <AlphaGlassCard className="rounded-2xl p-6" tone="indigo">
 *     <h3>...</h3>
 *   </AlphaGlassCard>
 *
 *  - `tone` selects the highlight hue: 'indigo' (default), 'emerald', 'rose', 'amber'
 *  - The hook writes CSS vars on the div via the `style` prop. No re-renders
 *    per pointermove; React only re-renders when the "presence" snaps to 0/1.
 */
export type AlphaGlassTone = 'indigo' | 'emerald' | 'rose' | 'amber';

export interface AlphaGlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    tone?: AlphaGlassTone;
    /** Disable the reactive overlay (still a beautiful static glass card). */
    staticGlow?: boolean;
    /** Show the rotating conic ambient border on hover. */
    ambientBorder?: boolean;
}

const TONE_FROM_HEX: Record<AlphaGlassTone, { primary: string; secondary: string }> = {
    indigo:  { primary: 'rgba(99, 102, 241, 0.22)',  secondary: 'rgba(139, 92, 246, 0.10)' },
    emerald: { primary: 'rgba(16, 185, 129, 0.22)',  secondary: 'rgba(20, 184, 166, 0.10)' },
    rose:    { primary: 'rgba(244, 63, 94, 0.22)',   secondary: 'rgba(236, 72, 153, 0.10)' },
    amber:   { primary: 'rgba(245, 158, 11, 0.24)',  secondary: 'rgba(251, 191, 36, 0.10)' },
};

const TONE_LIGHT_FROM_HEX: Record<AlphaGlassTone, string> = {
    indigo:  'rgba(255, 255, 255, 0.18)',
    emerald: 'rgba(255, 255, 255, 0.20)',
    rose:    'rgba(255, 255, 255, 0.18)',
    amber:   'rgba(255, 255, 255, 0.20)',
};

export const AlphaGlassCard: React.FC<AlphaGlassCardProps> = ({
    tone = 'indigo',
    staticGlow = false,
    ambientBorder = false,
    className = '',
    children,
    ...rest
}) => {
    const { ref, cssVars } = useCursorLight();
    const baseSurface =
        'bg-white/60 dark:bg-slate-900/55 backdrop-blur-2xl backdrop-saturate-150 ' +
        'border border-slate-200/40 dark:border-slate-700/40 shadow-lg dark:shadow-black/30 ' +
        'transition-[border-color,box-shadow,transform] duration-300 ease-out ' +
        'hover:border-slate-300/60 dark:hover:border-slate-600/60 hover:shadow-xl';

    const classes = [
        'alpha-cursor-card',
        ambientBorder ? 'alpha-conic-border' : '',
        baseSurface,
        className,
    ].filter(Boolean).join(' ');

    if (staticGlow) {
        return (
            <div ref={ref as React.Ref<HTMLDivElement>} className={classes} style={{ ...rest.style }} {...rest}>
                {children}
            </div>
        );
    }

    // Tone overrides the default highlight colour via inline CSS vars
    // (uses --cc-primary / --cc-secondary read by .alpha-cursor-card overlays).
    const toneStyle: React.CSSProperties = {
        ...rest.style,
        // Pass our custom tones through the standard alpha-cursor-card variables
        // by overriding the gradient colours used by the pseudo-elements.
        // We use a unique class on the element to give it a different gradient palette.
    };

    return (
        <div
            ref={ref as React.Ref<HTMLDivElement>}
            className={classes}
            style={{ ...toneStyle, ...parseCssVars(cssVars) } as React.CSSProperties}
            data-cc5-tone={tone}
            {...rest}
        >
            <style>{`
                [data-cc5-tone="${tone}"].alpha-cursor-card::before {
                    background: radial-gradient(280px circle at calc((0.5 + var(--cx, 0)) * 100%) calc((0.5 + var(--cy, 0)) * 100%),
                        ${TONE_LIGHT_FROM_HEX[tone]},
                        rgba(255, 255, 255, 0.04) 40%,
                        transparent 70%) !important;
                }
                [data-cc5-tone="${tone}"].alpha-cursor-card::after {
                    background: radial-gradient(600px circle at calc((0.5 - var(--cx, 0)) * 100%) calc((0.5 - var(--cy, 0)) * 100%),
                        ${TONE_FROM_HEX[tone].primary},
                        ${TONE_FROM_HEX[tone].secondary} 40%,
                        transparent 75%) !important;
                }
            `}</style>
            {children}
        </div>
    );
};

/**
 * Parses a CSS-var string like `--cx:0.12;--cy:-0.34;--cp:0.87;`
 * into a React.CSSProperties object. Tiny helper to keep the hook API tidy.
 */
function parseCssVars(cssVars: string): React.CSSProperties {
    const out: Record<string, string> = {};
    cssVars.split(';').forEach((pair) => {
        const [k, v] = pair.split(':');
        if (k && v) out[k.trim()] = v.trim();
    });
    return out as React.CSSProperties;
}

export default AlphaGlassCard;
