import React from 'react';

export interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  label?: React.ReactNode;
  /** When true, the label is hidden on mobile screens (<640px) and only shown on desktop/tablet */
  responsiveLabel?: boolean;
  isActive?: boolean;
  activeVariant?: 'indigo' | 'rose' | 'emerald' | 'amber';
  isLoading?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'default' | 'subtle' | 'ghost' | 'glass';
}

export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  (
    {
      icon,
      label,
      responsiveLabel,
      isActive = false,
      activeVariant = 'indigo',
      isLoading = false,
      size = 'md',
      variant = 'default',
      className = '',
      children,
      disabled,
      title,
      ...props
    },
    ref
  ) => {
    const hasLabel = Boolean(label || children);
    const isIconOnly = !hasLabel;
    const isResponsive = responsiveLabel ?? (Boolean(icon) && (size === 'xs' || size === 'sm'));
    const accessibleLabel = props['aria-label'] || (typeof label === 'string' ? label : undefined);
    const buttonTitle = title || accessibleLabel;

    // Size mappings - proportional scaling across mobile and desktop
    const sizeConfig = {
      xs: {
        height: 'h-7',
        square: 'w-7 aspect-square',
        padding: 'px-2',
        desktopPadding: 'sm:px-2',
        text: 'text-[9px]',
        radius: 'rounded-lg',
      },
      sm: {
        height: 'h-8',
        square: 'w-8 aspect-square',
        padding: 'px-2.5',
        desktopPadding: 'sm:px-2.5',
        text: 'text-[10px]',
        radius: 'rounded-xl',
      },
      md: {
        height: 'h-8 sm:h-9',
        square: 'w-8 sm:w-9 aspect-square',
        padding: 'px-2.5 sm:px-3.5',
        desktopPadding: 'sm:px-3.5',
        text: 'text-[10px] sm:text-[11px]',
        radius: 'rounded-xl',
      },
      lg: {
        height: 'h-9 sm:h-11',
        square: 'w-9 sm:w-11 aspect-square',
        padding: 'px-3 sm:px-4',
        desktopPadding: 'sm:px-4',
        text: 'text-xs',
        radius: 'rounded-xl',
      },
    }[size];

    // Dimensional sizing:
    // If icon-only or responsiveLabel on mobile, ensure exact square aspect ratio with zero padding
    // to guarantee 100% pixel-perfect centering
    const dimensionClasses = isIconOnly
      ? `${sizeConfig.height} ${sizeConfig.square} p-0`
      : isResponsive
      ? `${sizeConfig.height} ${sizeConfig.square} p-0 sm:w-auto ${sizeConfig.desktopPadding}`
      : `${sizeConfig.height} ${sizeConfig.padding}`;

    // Active state styles
    const activeClasses = {
      indigo: 'bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-500/30',
      rose: 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-md shadow-rose-500/20',
      emerald: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-md shadow-emerald-500/20',
      amber: 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-md shadow-amber-500/20',
    }[activeVariant];

    // Inactive variant styles
    const variantClasses = {
      default:
        'bg-white dark:bg-slate-900/80 hover:bg-slate-50 dark:hover:bg-slate-850 border-slate-250/80 dark:border-slate-800/80 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
      subtle:
        'bg-slate-100/70 dark:bg-slate-900/50 hover:bg-slate-200/70 dark:hover:bg-slate-800 border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white',
      ghost:
        'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60 border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white',
      glass:
        'bg-slate-900/60 backdrop-blur-md hover:bg-slate-800/80 border-slate-800 text-slate-400 hover:text-white',
    }[variant];

    // Gap class:
    // If responsiveLabel is true, gap is 0 on mobile so hidden text produces 0 offset,
    // and expands to gap-1.5 when text becomes visible on desktop (sm:gap-1.5)
    const gapClass = isIconOnly
      ? ''
      : isResponsive
      ? 'gap-0 sm:gap-1.5'
      : 'gap-1.5';

    return (
      <button
        ref={ref}
        type="button"
        title={buttonTitle}
        aria-label={accessibleLabel}
        disabled={disabled || isLoading}
        className={`inline-flex items-center justify-center ${dimensionClasses} ${sizeConfig.radius} ${sizeConfig.text} font-bold uppercase tracking-wider border transition-all duration-150 shadow-sm shrink-0 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 active:scale-95 disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100 ${gapClass} ${
          isActive ? activeClasses : variantClasses
        } ${className}`}
        {...props}
      >
        {icon && (
          <span
            className={`inline-flex items-center justify-center shrink-0 leading-none ${
              isLoading ? 'animate-spin' : ''
            }`}
          >
            {icon}
          </span>
        )}
        {hasLabel && (
          <span
            className={`inline-flex items-center leading-none whitespace-nowrap ${
              isResponsive ? 'hidden sm:inline-flex' : ''
            }`}
          >
            {label || children}
          </span>
        )}
      </button>
    );
  }
);

ActionButton.displayName = 'ActionButton';
