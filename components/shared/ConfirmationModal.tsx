import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Info } from 'lucide-react';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'info';
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger'
}) => {
    if (typeof window === 'undefined') return null;

    return createPortal(
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                    />

                    {/* Modal Container */}
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.9, opacity: 0, y: 20 }}
                        className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
                    >
                        {/* Header Decoration */}
                        <div className={`h-1.5 w-full ${variant === 'danger' ? 'bg-rose-500' : 'bg-indigo-500'}`} />
                        
                        <div className="p-8">
                            <div className="flex items-start gap-5">
                                <div className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center ${
                                    variant === 'danger' 
                                        ? 'bg-rose-500/10 text-rose-500' 
                                        : 'bg-indigo-500/10 text-indigo-500'
                                }`}>
                                    {variant === 'danger' ? <AlertTriangle size={24} /> : <Info size={24} />}
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
                                        {title}
                                    </h3>
                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                                        {message}
                                    </p>
                                </div>
                                <button 
                                    onClick={onClose}
                                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="mt-8 flex items-center gap-3">
                                <button
                                    onClick={onClose}
                                    className="flex-1 py-3.5 px-4 rounded-2xl text-sm font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-755 transition-all"
                                >
                                    {cancelText}
                                </button>
                                <button
                                    onClick={() => {
                                        onConfirm();
                                        onClose();
                                    }}
                                    className={`flex-1 py-3.5 px-4 rounded-2xl text-sm font-black text-white shadow-lg transition-all active:scale-95 ${
                                        variant === 'danger'
                                            ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20'
                                            : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20'
                                    }`}
                                >
                                    {confirmText}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body
    );
};

export default ConfirmationModal;
