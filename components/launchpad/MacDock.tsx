import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { LaunchpadCategory } from '../../data/launchpadData';

interface MacDockProps {
    categories: LaunchpadCategory[];
    selectedCategoryId: string;
    onSelectCategory: (id: string) => void;
}

export const MacDock: React.FC<MacDockProps> = ({ categories, selectedCategoryId, onSelectCategory }) => {
    // Mouse X position for the magnification effect
    const mouseX = useMotionValue(Infinity);

    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
            <motion.div
                onMouseMove={(e) => mouseX.set(e.pageX)}
                onMouseLeave={() => mouseX.set(Infinity)}
                className="flex items-end gap-2 px-4 py-3 bg-slate-900/60 backdrop-blur-2xl border border-slate-700/50 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
            >
                {categories.map((category) => (
                    <DockIcon
                        key={category.id}
                        category={category}
                        mouseX={mouseX}
                        isSelected={selectedCategoryId === category.id}
                        onClick={() => onSelectCategory(category.id)}
                    />
                ))}
            </motion.div>
        </div>
    );
};

interface DockIconProps {
    category: LaunchpadCategory;
    mouseX: any;
    isSelected: boolean;
    onClick: () => void;
}

const DockIcon: React.FC<DockIconProps> = ({ category, mouseX, isSelected, onClick }) => {
    const ref = useRef<HTMLButtonElement>(null);

    // Calculate distance from mouse to the center of this icon
    const distance = useTransform(mouseX, (val: number) => {
        const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
        return val - bounds.x - bounds.width / 2;
    });

    // Transform distance into width/scale
    const widthSync = useTransform(distance, [-150, 0, 150], [48, 80, 48]);
    const width = useSpring(widthSync, { mass: 0.1, stiffness: 150, damping: 12 });

    const IconComponent = category.icon;

    return (
        <div className="relative group flex flex-col items-center">
            {/* Tooltip */}
            <div className="absolute -top-12 opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-3 py-1 bg-slate-800 text-white text-xs font-medium rounded-lg border border-slate-700 pointer-events-none whitespace-nowrap shadow-lg">
                {category.title}
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 border-b border-r border-slate-700 transform rotate-45" />
            </div>

            <motion.button
                ref={ref}
                onClick={onClick}
                style={{ width, height: width }}
                className={`relative flex items-center justify-center rounded-xl transition-colors ${
                    isSelected 
                        ? 'bg-slate-700/80 shadow-inner border border-slate-600' 
                        : 'bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50'
                }`}
            >
                <IconComponent className={`w-1/2 h-1/2 ${category.color} ${isSelected ? 'opacity-100' : 'opacity-70'}`} />
                
                {/* Active Indicator Dot */}
                {isSelected && (
                    <div className="absolute -bottom-2 w-1 h-1 rounded-full bg-slate-400" />
                )}
            </motion.button>
        </div>
    );
};
