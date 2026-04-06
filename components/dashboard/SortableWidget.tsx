import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ContextMenu, ContextMenuItem } from '../ui/ContextMenu';
import { Maximize2, Minimize2, EyeOff, Trash2 } from 'lucide-react';
import { useToast } from '../shared/ToastProvider';

interface SortableWidgetProps {
    id: string;
    children: React.ReactNode;
    className?: string; // Additional classes
    dragHandle?: boolean;
    onRemove?: () => void;
}

export const SortableWidget: React.FC<SortableWidgetProps> = ({ id, children, className = '', dragHandle = false, onRemove }) => {
    const { toast } = useToast();
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number } | null>(null);
    const [isFocused, setIsFocused] = useState(false);

    // Context Menu Handlers
    const handleContextMenu = (e: React.MouseEvent) => {
        // e.preventDefault(); // Optional: decided to allow default context menu for now unless specifically requested
        // setContextMenu({ x: e.clientX, y: e.clientY });
    };

    return (
        <>
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{
                    opacity: 1,
                    scale: isFocused ? 1.02 : 1,
                    boxShadow: isFocused ? "0 25px 50px -12px rgba(0, 0, 0, 0.25)" : "0 4px 6px -1px rgba(0, 0, 0, 0.1)"
                }}
                whileHover={{ y: -4, scale: 1.01, transition: { duration: 0.2, ease: "easeOut" } }}
                className={`
                    bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl 
                    rounded-3xl border border-white/20 dark:border-white/10 
                    shadow-[0_8px_32px_rgba(0,0,0,0.05)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]
                    overflow-hidden transition-colors duration-200 h-full hover:shadow-xl
                    ${isFocused ? 'fixed inset-4 md:inset-10 z-[100] !transform-none !w-auto !h-auto' : className}
                `}
            >
                {/* Focus Mode Overlay Background */}
                {isFocused && (
                    <div className="absolute top-4 right-4 z-50">
                        <button onClick={() => setIsFocused(false)} className="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-full transition-colors">
                            <Minimize2 size={20} />
                        </button>
                    </div>
                )}

                {/* Content Overlay while dragging for safety (Removed) */}

                {children}
            </motion.div>

            {/* Context Menu Portal (Simplified/Removed for now or kept if needed) */}

            {/* Backdrop for Focus Mode */}
            {isFocused && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]"
                    onClick={() => setIsFocused(false)}
                />
            )}
        </>
    );
};
