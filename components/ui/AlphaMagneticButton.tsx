import React from 'react';
import { useMagneticButton } from '../../hooks/useMagneticButton';

/**
 * Agent CC5 — AlphaMagneticButton
 * A primary CTA that magnetically pulls toward the cursor when the pointer
 * is within ~80px of its center, and spring-snaps back on release.
 *
 *   <AlphaMagneticButton onClick={...} className="bg-indigo-600 text-white px-4 py-2 rounded-xl">
 *     Confirm Order
 *   </AlphaMagneticButton>
 *
 *  - The translation is written directly to the DOM via the hook (no re-renders
 *    on every mousemove). Only the "isOver" / "intensity" state is exposed to
 *    React for cases where a child wants to scale a glow ring in sync.
 *  - Respects prefers-reduced-motion via the hook's release transition.
 */
export interface AlphaMagneticButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Activation radius in pixels. */
    radius?: number;
    /** Max translation as a fraction of the radius. */
    strength?: number;
    /** Element type override (e.g. render as <a> by wrapping a Link). */
    asChild?: boolean;
}

export const AlphaMagneticButton: React.FC<AlphaMagneticButtonProps> = ({
    radius = 80,
    strength = 0.35,
    className = '',
    children,
    ...rest
}) => {
    const { ref, state } = useMagneticButton({ radius, strength });
    return (
        <button
            ref={ref as React.Ref<HTMLButtonElement>}
            className={`alpha-magnetic cta-premium btn-violet ${className}`}
            data-magnetic-over={state.isOver ? '1' : '0'}
            data-magnetic-intensity={state.intensity.toFixed(2)}
            {...rest}
        >
            {children}
        </button>
    );
};

export default AlphaMagneticButton;
