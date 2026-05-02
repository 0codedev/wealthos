import React, { createContext, useContext, KeyboardEvent, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springTransition, snappySpring } from './animations';
import { tabContentSwap, luxeContentSwap, useReducedMotion, snappyLayout, layoutShift, luxeLayout } from './motion';
import { useSettingsStore } from '../../store/settingsStore';

// --- Context ---
interface TabsContextType {
    activeTab: string;
    setActiveTab: (id: string) => void;
    layoutId: string;
    motionPreset: 'snappy' | 'smooth' | 'spring' | 'luxe';
    variant?: 'default' | 'solid-indigo' | 'solid-white';
}

const TabsContext = createContext<TabsContextType | null>(null);

function useTabs() {
    const context = useContext(TabsContext);
    if (!context) throw new Error("Tabs components must be used within Tabs.Root");
    return context;
}

// --- Components ---

interface TabsRootProps {
    value: string;
    onValueChange?: (val: string) => void;
    onChange?: (val: string) => void;
    children: React.ReactNode;
    className?: string;
    layoutId?: string;
    /** "snappy" (default) | "smooth" | "spring" | "luxe" — selects the indicator slide curve. */
    motionPreset?: 'snappy' | 'smooth' | 'spring' | 'luxe';
    /** "solid-white" (default Shadcn-style white pill) | "default" | "solid-indigo" */
    variant?: 'default' | 'solid-indigo' | 'solid-white';
}

const Root: React.FC<TabsRootProps> = ({
    value,
    onValueChange,
    onChange,
    children,
    className,
    layoutId,
    motionPreset = "snappy",
    variant = "solid-indigo",
}) => {
    const generatedId = React.useId();
    const effectiveLayoutId = layoutId || `activeTabIndicator-${generatedId}`;
    const handleTabChange = onValueChange || onChange || (() => {});
    return (
        <TabsContext.Provider value={{ activeTab: value, setActiveTab: handleTabChange, layoutId: effectiveLayoutId, motionPreset, variant }}>
            <div className={className}>
                {children}
            </div>
        </TabsContext.Provider>
    );
};

const ListContext = React.createContext<{ fullWidth?: boolean }>({ fullWidth: false });

interface TabsListProps {
    children: React.ReactNode;
    className?: string;
    fullWidth?: boolean;
}

const List: React.FC<TabsListProps> = ({ children, className = "", fullWidth = false }) => {
    const { activeTab, setActiveTab } = useTabs();
    const listRef = useRef<HTMLDivElement>(null);

    // Keyboard Navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!listRef.current) return;
        const triggers = Array.from(listRef.current.querySelectorAll('[role="tab"]')) as HTMLElement[];
        const currentIndex = triggers.findIndex(t => t === document.activeElement);
        if (currentIndex === -1) return;

        let nextIndex = currentIndex;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            nextIndex = (currentIndex + 1) % triggers.length;
            e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;
            e.preventDefault();
        }

        if (nextIndex !== currentIndex) {
            triggers[nextIndex].focus();
        }
    };

    const hasWidthClass = className.includes('w-') || className.includes('max-w-');
    const widthClass = hasWidthClass ? '' : (fullWidth ? 'w-full' : 'w-max');

    const designPreset = useSettingsStore((s) => s.designPreset) || 'wealthos-classic';
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const listThemeClass = isAstryx
        ? 'rounded-[10px] bg-[#262626] border border-[rgba(255,255,255,0.102)]'
        : isReui
        ? 'rounded-lg bg-muted border border-border'
        : 'rounded-xl sm:rounded-2xl bg-slate-900/80 dark:bg-slate-950/80 border border-slate-800/80 shadow-inner';

    const hasMinHeightClass = className.includes('min-h-') || className.includes('h-');
    const minHeightClass = hasMinHeightClass ? '' : 'min-h-[38px]';
    const hasPaddingClass = className.includes('p-');
    const paddingClass = hasPaddingClass ? '' : 'p-1';

    return (
        <ListContext.Provider value={{ fullWidth }}>
            <div
                ref={listRef}
                role="tablist"
                onKeyDown={handleKeyDown}
                className={`flex ${minHeightClass} items-center gap-1 ${paddingClass} ${listThemeClass} relative ${widthClass} ${className}`}
                style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}
            >
                {children}
            </div>
        </ListContext.Provider>
    );
};

interface TabsTriggerProps {
    value: string;
    children?: React.ReactNode;
    icon?: React.ReactNode;
    className?: string;
    title?: string;
    onContextMenu?: (e: React.MouseEvent) => void;
    activeClassName?: string;
    indicatorClassName?: string;
}

const Trigger: React.FC<TabsTriggerProps> = ({
    value,
    children,
    icon,
    className = "",
    title,
    onContextMenu,
    activeClassName = "",
    indicatorClassName = ""
}) => {
    const { activeTab, setActiveTab, layoutId, motionPreset, variant } = useTabs();
    const { fullWidth } = React.useContext(ListContext);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const isActive = activeTab === value;

    useEffect(() => {
        if (isActive && buttonRef.current) {
            const parent = buttonRef.current.parentElement;
            if (parent && parent.scrollWidth > parent.clientWidth) {
                buttonRef.current.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'nearest'
                });
            }
        }
    }, [isActive]);

    const indicatorTransition =
        motionPreset === 'smooth' ? layoutShift :
        motionPreset === 'spring' ? springTransition :
        motionPreset === 'luxe' ? luxeLayout :
        variant === 'solid-indigo' ? snappySpring :
        snappyLayout;

    const designPreset = useSettingsStore((s) => s.designPreset) || 'wealthos-classic';
    const isAstryx = designPreset === 'astryx';
    const isReui = designPreset === 'reui-nova' || designPreset === 'shadcn';

    const triggerRadiusClass = isAstryx ? 'rounded-[6px]' : isReui ? 'rounded-md' : 'rounded-lg sm:rounded-xl';

    const isCustomColoredIndicator = Boolean(indicatorClassName && (indicatorClassName.includes('bg-emerald') || indicatorClassName.includes('bg-rose')));

    const baseIndicatorStyle = indicatorClassName
        ? indicatorClassName
        : isAstryx
        ? 'bg-indigo-600 rounded-[6px] shadow-sm'
        : isReui
        ? 'bg-indigo-600 rounded-md shadow-sm'
        : `bg-indigo-600 dark:bg-indigo-600 text-white ${triggerRadiusClass} shadow-[0_2px_12px_rgba(99,102,241,0.35)]`;

    const indicatorStyle = indicatorClassName || baseIndicatorStyle;

    const baseActiveTextColor = '!text-white dark:!text-white font-bold';

    const activeTextColor = activeClassName || baseActiveTextColor;

    const inactiveTextColor = 'text-slate-400 hover:text-slate-200 dark:text-slate-400 dark:hover:text-slate-100';

    const hasFlexClass = className.includes('flex-') || className.includes('shrink-');
    const flexClass = hasFlexClass ? '' : (fullWidth ? 'flex-1 min-w-0' : 'shrink-0');
    const hasPaddingClass = className.includes('px-') || className.includes('py-');
    const paddingClass = hasPaddingClass ? '' : isAstryx ? 'px-3.5 py-1.5' : 'px-4 py-2';
    const hasMinHeightClass = className.includes('min-h-') || className.includes('h-');
    const minHeightClass = hasMinHeightClass ? '' : 'min-h-[30px]';
    const hasTextSizeClass = className.includes('text-');
    const textSizeClass = hasTextSizeClass ? '' : 'text-[11px]';
    const hasGapClass = className.includes('gap-');
    const gapClass = hasGapClass ? '' : 'gap-1.5';

    return (
        <button
            ref={buttonRef}
            role="tab"
            aria-selected={isActive}
            title={title}
            onClick={() => setActiveTab(value)}
            onContextMenu={onContextMenu}
            className={`group relative flex isolate select-none ${minHeightClass} items-center justify-center ${gapClass} ${triggerRadiusClass} ${textSizeClass} leading-none font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 cta-premium ${flexClass} ${paddingClass} ${className}`}
            style={isAstryx ? { fontFamily: 'Figtree, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' } : undefined}
        >
            {isActive && (
                <motion.div
                    layoutId={layoutId}
                    className={`absolute inset-0 z-0 pointer-events-none ${indicatorStyle}`}
                    transition={indicatorTransition}
                />
            )}
            <span 
                className={`relative z-20 flex items-center justify-center gap-1.5 whitespace-nowrap leading-none transition-transform duration-200 group-hover:scale-[1.04] ${isActive ? activeTextColor : inactiveTextColor}`}
                style={{
                    color: isActive && !activeClassName
                        ? '#ffffff'
                        : undefined
                }}
            >
                {icon}
                {children}
            </span>
        </button>
    );
};

interface TabsContentProps {
    value: string;
    children: React.ReactNode;
    className?: string;
    /** Set true to crossfade content on every tab switch. Defaults to true. */
    animated?: boolean;
}

const Content: React.FC<TabsContentProps> = ({ value, children, className, animated = true }) => {
    const { activeTab } = useTabs();
    const reduced = useReducedMotion();

    if (activeTab !== value) return null;
    if (!animated || reduced) {
        return <div role="tabpanel" className={className}>{children}</div>;
    }

    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={value}
                role="tabpanel"
                className={className}
                variants={tabContentSwap}
                initial="initial"
                animate="animate"
                exit="exit"
            >
                {children}
            </motion.div>
        </AnimatePresence>
    );
};


export const Tabs = {
    Root,
    List,
    Trigger,
    Content
};
