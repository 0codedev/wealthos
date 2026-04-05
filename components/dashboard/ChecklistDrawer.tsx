
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, X } from 'lucide-react';
import { PreTradeChecklist } from '../journal/PreTradeChecklist';

interface ChecklistDrawerProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ChecklistDrawer: React.FC<ChecklistDrawerProps> = ({ isOpen, onClose }) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 cursor-pointer"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: "spring", damping: 30, stiffness: 300 }}
                        className="fixed top-0 right-0 h-screen w-full md:w-[480px] bg-slate-950/90 border-l border-indigo-500/20 z-50 shadow-2xl flex flex-col backdrop-blur-xl"
                    >
                        <div className="p-5 border-b border-indigo-500/10 flex justify-between items-center bg-indigo-500/5">
                            <span className="font-bold text-lg text-white flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/10 rounded-lg">
                                    <CheckSquare size={20} className="text-emerald-400" />
                                </div>
                                <span className="tracking-wide">Pre-Trade Flight Check</span>
                            </span>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-white/5 rounded-lg text-slate-400 hover:text-white transition-colors"
                                aria-label="Close checklist"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar relative">
                            {/* Inner Glow */}
                            <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-b from-indigo-500/5 to-transparent pointer-events-none" />
                            <PreTradeChecklist />
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
