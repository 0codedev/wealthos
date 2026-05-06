import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ResponsiveSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const ResponsiveSheet: React.FC<ResponsiveSheetProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  className = '',
}) => {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet panel: bottom sheet on phone, centered modal on tablet/desktop */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 w-full max-w-full sm:max-w-lg bg-slate-900 border border-slate-800 text-slate-100 shadow-2xl',
          'rounded-t-2xl sm:rounded-2xl',
          'max-h-[88dvh] sm:max-h-[85vh] flex flex-col',
          'animate-in slide-in-from-bottom duration-200',
          'pb-[max(16px,env(safe-area-inset-bottom))] sm:pb-5',
          className
        )}
      >
        {/* Pull handle indicator on phone */}
        <div className="flex sm:hidden justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* Header */}
        {(title || description) && (
          <div className="flex items-center justify-between px-4 sm:px-6 pt-2 sm:pt-5 pb-3 border-b border-slate-800/80 shrink-0">
            <div className="min-w-0 pr-2">
              {title && (
                <h2 className="text-sm sm:text-base font-bold text-white tracking-wide truncate">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors shrink-0"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Content Body with internal scroll */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 no-scrollbar min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
};
