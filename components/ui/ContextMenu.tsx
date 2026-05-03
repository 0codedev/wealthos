import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ContextMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    // Prevent scrolling when menu is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    // Adjust position to prevent overflow (simplistic)
    const adjustedX = Math.min(x, window.innerWidth - 200);
    const adjustedY = Math.min(y, window.innerHeight - (items.length * 40));

    return (
        <div className="fixed inset-0 z-[100] cursor-default" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
            <motion.div
                ref={menuRef}
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="absolute bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.2)] rounded-xl p-1.5 min-w-[180px] overflow-hidden"
                style={{ top: adjustedY, left: adjustedX }}
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                {items.map((item, index) => (
                    <button
                        key={index}
                        onClick={() => {
                            item.onClick();
                            onClose();
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${item.danger
                                ? 'text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20'
                                : 'text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-300'
                            }`}
                    >
                        {item.icon && <span className="opacity-70">{item.icon}</span>}
                        {item.label}
                    </button>
                ))}
            </motion.div>
        </div>
    );
};
