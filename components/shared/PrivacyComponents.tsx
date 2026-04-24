import React from 'react';
import { formatCurrency } from '../../utils/helpers';

export const PrivacyValue: React.FC<{ value: string | number, isPrivacyMode: boolean, className?: string }> = ({ value, isPrivacyMode, className = "" }) => {
    if (isPrivacyMode) {
        return <span className={`font-mono tracking-widest opacity-60 ${className} financial-value`}>••••••</span>;
    }
    return (
        <span className={`${className} financial-value`}>
            {typeof value === 'number' ? formatCurrency(value) : value}
        </span>
    );
};
