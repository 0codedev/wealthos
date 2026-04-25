import React from 'react';
import { LucideIcon } from 'lucide-react';

interface SummaryCardProps {
  title: string;
  value: string;
  subValue?: string;
  subValueColor?: string; // text-green-600, etc.
  icon: LucideIcon;
  iconColor: string; // bg-blue-100 text-blue-600
  isPrivacyMode?: boolean;
  valueClassName?: string;
}

const SummaryCard: React.FC<SummaryCardProps & { onClick?: () => void }> = ({
  title,
  value,
  subValue,
  subValueColor = 'text-slate-500 dark:text-slate-400',
  icon: Icon,
  iconColor,
  isPrivacyMode = false,
  valueClassName = '',
  onClick,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`glass-card p-6 flex items-start justify-between ${onClick ? 'cursor-pointer hover:shadow-md hover:scale-[1.01] focus:outline-none' : ''}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1 font-ui">{title}</p>
        <h3 className={`text-2xl font-bold text-slate-900 dark:text-white tracking-tight font-display tabular-nums ${valueClassName}`}>
          {isPrivacyMode ? '••••••' : value}
        </h3>
        {subValue && (
          <p className={`text-sm font-medium mt-2 font-ui ${isPrivacyMode ? 'opacity-0' : ''} ${subValueColor}`}>
            {subValue}
          </p>
        )}
      </div>
      <div className={`p-3 rounded-lg ${iconColor} bg-opacity-20 dark:bg-opacity-20`}>
        <Icon size={24} />
      </div>
    </div>
  );
};

export default SummaryCard;