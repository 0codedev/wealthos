import React, { useState, useRef, useEffect } from 'react';

interface EditableValueProps {
    value: number;
    onChange: (val: number) => void;
    prefix?: string;
    suffix?: string;
    className?: string;
    min?: number;
    max?: number;
    step?: number;
    displayValue?: string; // Pre-formatted string
}

export const EditableValue: React.FC<EditableValueProps> = ({
    value,
    onChange,
    prefix = '',
    suffix = '',
    className = 'text-sm font-bold text-emerald-400',
    min = 0,
    max,
    step = 1,
    displayValue
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value.toString());
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setLocalValue(value.toString());
    }, [value]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleBlur = () => {
        commitValue();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            commitValue();
        } else if (e.key === 'Escape') {
            setIsEditing(false);
            setLocalValue(value.toString());
        }
    };

    const commitValue = () => {
        let num = parseFloat(localValue);
        if (isNaN(num)) {
            num = value;
        } else {
            if (min !== undefined && num < min) num = min;
            if (max !== undefined && num > max) num = max;
        }
        onChange(num);
        setIsEditing(false);
        setLocalValue(num.toString());
    };

    if (isEditing) {
        return (
            <div className="flex items-center gap-1">
                {prefix && <span className={className}>{prefix}</span>}
                <input
                    ref={inputRef}
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={localValue}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    className={`bg-slate-900 border border-slate-700 outline-none rounded px-1 py-0.5 w-20 text-right ${className}`}
                />
                {suffix && <span className={className}>{suffix}</span>}
            </div>
        );
    }

    return (
        <span
            className={`cursor-pointer hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors border border-transparent hover:border-white/20 ${className}`}
            onClick={() => setIsEditing(true)}
            title="Click to edit value"
        >
            {displayValue ? displayValue : `${prefix}${value}${suffix}`}
        </span>
    );
};
