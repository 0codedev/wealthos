import React from 'react';
import { ToggleGroup } from './toggle-group';

export interface SegmentedControlProps {
    options: string[];
    value: string;
    onChange: (value: string) => void;
    layoutId?: string;
    className?: string;
    /** "snappy" (default) | "smooth" — selects the spring preset. */
    motionPreset?: 'snappy' | 'smooth';
    /** Tailwind classes for the sliding indicator. */
    indicatorClassName?: string;
    /** Optional aria-label for the segmented control. */
    ariaLabel?: string;
    /** Optional size: sm | md | lg. */
    size?: 'sm' | 'md' | 'lg';
    fullWidth?: boolean;
}

export const SegmentedControl: React.FC<SegmentedControlProps> = ({
    options,
    value,
    onChange,
    layoutId,
    className = '',
    ariaLabel,
    size = 'md',
    fullWidth = false,
}) => {
    const autoId = React.useId();
    const effectiveLayoutId = layoutId || `segmented-indicator-${autoId}`;
    return (
        <ToggleGroup
            options={options.map((opt) => ({ value: opt, label: opt }))}
            value={value}
            onChange={onChange}
            layoutId={effectiveLayoutId}
            size={size === 'md' ? 'default' : size}
            className={className}
            fullWidth={fullWidth}
            ariaLabel={ariaLabel}
        />
    );
};

export default SegmentedControl;
