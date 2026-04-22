import React, { useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useAccessibility';

/**
 * Accessible UI Components for WCAG 2.1 Compliance
 */

// Visually hidden but accessible to screen readers
export const VisuallyHidden: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span
        className="sr-only"
        style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: 0,
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            border: 0,
        }}
    >
        {children}
    </span>
);

// Skip to main content link
export const SkipLink: React.FC<{ href?: string }> = ({ href = '#main-content' }) => (
    <a
        href={href}
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 
                   focus:px-4 focus:py-2 focus:bg-indigo-600 focus:text-white focus:rounded-lg
                   focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
    >
        Skip to main content
    </a>
);

// Accessible loading spinner
interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    label?: string;
}

export const AccessibleSpinner: React.FC<SpinnerProps> = ({
    size = 'md',
    label = 'Loading...'
}) => {
    const sizeClasses = {
        sm: 'w-4 h-4',
        md: 'w-8 h-8',
        lg: 'w-12 h-12',
    };

    return (
        <div role="status" aria-live="polite">
            <svg
                className={`animate-spin ${sizeClasses[size]} text-indigo-500`}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                />
                <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
            </svg>
            <VisuallyHidden>{label}</VisuallyHidden>
        </div>
    );
};

// Focus trap container for modals
interface FocusTrapProps {
    children: React.ReactNode;
    isActive?: boolean;
    className?: string;
}

export const FocusTrap: React.FC<FocusTrapProps> = ({
    children,
    isActive = true,
    className = ''
}) => {
    const containerRef = useFocusTrap(isActive);
    return (
        <div ref={containerRef} className={className}>
            {children}
        </div>
    );
};

// Accessible modal wrapper
interface AccessibleModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const AccessibleModal: React.FC<AccessibleModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    size = 'md'
}) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        if (isOpen) {
            previousFocus.current = document.activeElement as HTMLElement;
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = '';
            if (previousFocus.current) {
                previousFocus.current.focus();
            }
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const sizeClasses = {
        sm: 'max-w-sm',
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Modal */}
            <FocusTrap isActive={isOpen}>
                <div
                    ref={modalRef}
                    className={`relative ${sizeClasses[size]} w-full mx-4 bg-white dark:bg-slate-900 
                               rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700
                               animate-in zoom-in-95 duration-200`}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                        <h2 id="modal-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                            {title}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white 
                                       rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 
                                       focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            aria-label="Close modal"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-4">
                        {children}
                    </div>
                </div>
            </FocusTrap>
        </div>
    );
};

// Accessible button with loading state
interface AccessibleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isLoading?: boolean;
    loadingText?: string;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export const AccessibleButton: React.FC<AccessibleButtonProps> = ({
    children,
    isLoading = false,
    loadingText = 'Loading...',
    variant = 'primary',
    disabled,
    className = '',
    ...props
}) => {
    const variants = {
        primary: 'px-4 py-2 rounded-lg font-medium bg-indigo-600 hover:bg-indigo-700 text-white',
        secondary: 'px-4 py-2 rounded-lg font-medium bg-slate-200 hover:bg-slate-300 text-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white',
        danger: 'px-4 py-2 rounded-lg font-medium bg-red-600 hover:bg-red-700 text-white',
        ghost: '',
    };

    return (
        <button
            className={`transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       ${variants[variant]} ${className}`}
            disabled={disabled || isLoading}
            aria-busy={isLoading}
            aria-disabled={disabled || isLoading}
            {...props}
        >
            {isLoading ? (
                <span className="flex items-center gap-2">
                    <AccessibleSpinner size="sm" />
                    <span>{loadingText}</span>
                </span>
            ) : (
                children
            )}
        </button>
    );
};

// Live region for screen reader announcements
interface LiveRegionProps {
    message: string;
    mode?: 'polite' | 'assertive';
}

export const LiveRegion: React.FC<LiveRegionProps> = ({ message, mode = 'polite' }) => (
    <div
        role="status"
        aria-live={mode}
        aria-atomic="true"
        className="sr-only"
    >
        {message}
    </div>
);

export default {
    VisuallyHidden,
    SkipLink,
    AccessibleSpinner,
    FocusTrap,
    AccessibleModal,
    AccessibleButton,
    LiveRegion,
};
