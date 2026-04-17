import React, { useState } from 'react';
import { useFamily, FamilyEntity } from '../../contexts/FamilyContext';
import { useAuth } from '../../contexts/AuthContext';
import { User, Users, Building2, Baby, Heart, LogOut, ChevronDown, Lock, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { showToast } from '../shared/ToastProvider';

interface MenuItemConfig {
    id: FamilyEntity;
    label: string;
    description: string;
    icon: any;
    color: string;
}

const ProfileMenu: React.FC = () => {
    const { activeEntity, setActiveEntity, getEntityName } = useFamily();
    const { logout, lock } = useAuth();
    const [isOpen, setIsOpen] = useState(false);

    const MENU_ITEMS: MenuItemConfig[] = [
        { id: 'SELF', label: 'My Portfolio', description: 'Primary Individual Account', icon: User, color: 'text-indigo-400' },
        { id: 'ALL', label: 'Family Office', description: 'Consolidated 360° Net Worth', icon: Users, color: 'text-emerald-400' },
        { id: 'SPOUSE', label: 'Spouse Account', description: 'Secondary Individual Vault', icon: Heart, color: 'text-rose-400' },
        { id: 'HUF', label: 'HUF Account', description: 'Tax-Optimized Family Entity', icon: Building2, color: 'text-amber-400' },
        { id: 'MOM', label: 'Mom Portfolio', description: 'Senior Citizen Asset Vault', icon: User, color: 'text-purple-400' },
        { id: 'KIDS', label: 'Kids Trust', description: 'Minor Long-Term Trust & SIPs', icon: Baby, color: 'text-sky-400' },
    ];

    const currentItem = MENU_ITEMS.find(m => m.id === activeEntity) || MENU_ITEMS[0];
    const ActiveIcon = currentItem.icon;

    const handleSwitch = (entity: FamilyEntity, label: string) => {
        setActiveEntity(entity);
        setIsOpen(false);
        showToast(`Viewing: ${label}`, 'info');
    };

    return (
        <div className="relative z-50">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2.5 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-full p-1.5 pl-3 transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700/60 focus:outline-none"
                aria-expanded={isOpen}
                aria-label="User Profile & Portfolio Switcher"
            >
                <div className="text-right hidden sm:block">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Viewing</p>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{getEntityName(activeEntity)}</p>
                </div>
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full ring-2 ring-slate-200 dark:ring-slate-700 flex items-center justify-center text-white shadow-md">
                    <ActiveIcon size={15} />
                </div>
                <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <>
                        <div
                            className="fixed inset-0 z-40 bg-transparent"
                            onClick={() => setIsOpen(false)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 8 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden z-[100] p-1.5"
                        >
                            <div className="px-3.5 py-2.5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    Switch Portfolio Profile
                                </span>
                                <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                                    Family Engine
                                </span>
                            </div>

                            <div className="space-y-1 py-1">
                                {MENU_ITEMS.map((item) => {
                                    const isSelected = activeEntity === item.id;
                                    const IconComponent = item.icon;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => handleSwitch(item.id, item.label)}
                                            className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left ${
                                                isSelected
                                                    ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-bold border border-indigo-200/50 dark:border-indigo-500/20'
                                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300 border border-transparent'
                                            }`}
                                        >
                                            <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-indigo-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                                                <IconComponent size={15} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                    {item.label}
                                                </div>
                                                <div className="text-[10px] text-slate-400 truncate">
                                                    {item.description}
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <Check size={14} className="text-indigo-500 shrink-0" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="border-t border-slate-100 dark:border-slate-800/80 mt-1 pt-1.5 space-y-0.5">
                                <button
                                    type="button"
                                    onClick={() => { lock(); setIsOpen(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-colors"
                                >
                                    <Lock size={14} className="text-slate-400" />
                                    <span>Lock Vault</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { logout(); setIsOpen(false); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-500 text-xs font-semibold transition-colors"
                                >
                                    <LogOut size={14} />
                                    <span>Sign Out</span>
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ProfileMenu;
