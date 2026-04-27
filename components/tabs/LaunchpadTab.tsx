import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { launchpadCategories, launchpadTools } from '../../data/launchpadData';
import { MacDock } from '../launchpad/MacDock';
import { ToolCard } from '../launchpad/ToolCard';

const LaunchpadTab: React.FC = () => {
    // Default to the first category
    const [selectedCategoryId, setSelectedCategoryId] = useState<string>(launchpadCategories[0].id);
    const [searchQuery, setSearchQuery] = useState('');
    const [pricingFilter, setPricingFilter] = useState<'All' | 'Free' | 'Freemium' | 'Paid'>('All');
    
    const topRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Wire up ⌘K and / hotkeys
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInputRef.current?.focus();
            } else if (e.key === '/' && document.activeElement !== searchInputRef.current && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                e.preventDefault();
                searchInputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Filter tools based on search OR selected category + Pricing
    const filteredTools = useMemo(() => {
        let tools = launchpadTools;

        if (searchQuery.trim().length > 0) {
            const query = searchQuery.toLowerCase();
            tools = tools.filter(tool => 
                tool.name.toLowerCase().includes(query) ||
                tool.description.toLowerCase().includes(query) ||
                tool.tags.some(tag => tag.toLowerCase().includes(query))
            );
        } else {
            tools = tools.filter(tool => tool.categoryId === selectedCategoryId);
        }

        if (pricingFilter !== 'All') {
            tools = tools.filter(tool => {
                if (pricingFilter === 'Free') return tool.pricing === 'Free';
                if (pricingFilter === 'Freemium') return tool.pricing === 'Free + Pro';
                if (pricingFilter === 'Paid') return tool.pricing === 'Paid' || tool.pricing === 'Enterprise';
                return true;
            });
        }

        return tools;
    }, [searchQuery, selectedCategoryId, pricingFilter]);

    // Current category details for the header
    const currentCategory = launchpadCategories.find(c => c.id === selectedCategoryId);

    return (
        <div className="relative flex flex-col min-h-screen" ref={topRef}>
            
            {/* Compact Control Bar */}
            <div className="flex-none py-4 flex items-center justify-between gap-6 border-b border-slate-200/80 dark:border-white/[0.08] sticky top-0 z-40 bg-white/80 dark:bg-slate-900/60 backdrop-blur-2xl">
                <div className="flex items-center gap-6">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        {searchQuery.trim().length > 0 ? (
                            <>Results <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-white/[0.06] px-2 py-0.5 rounded-md">({filteredTools.length})</span></>
                        ) : (
                            <>
                                {currentCategory?.title} 
                                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-white/[0.06] px-2 py-0.5 rounded-md ml-1">({filteredTools.length})</span>
                            </>
                        )}
                    </h2>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        {['All', 'Free', 'Freemium', 'Paid'].map((f: any) => (
                            <button
                                key={f}
                                onClick={() => setPricingFilter(f)}
                                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                                    pricingFilter === f 
                                        ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)]' 
                                        : 'bg-slate-100 dark:bg-white/[0.05] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200/80 dark:border-white/[0.06]'
                                }`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>

                    <div className="h-4 w-[1px] bg-slate-200 dark:bg-white/10" />

                    <div className="relative group w-64">
                        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                            <Search className="h-3.5 w-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                        </div>
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search tools..."
                            className="w-full bg-slate-100 dark:bg-white/[0.05] border border-slate-200/80 dark:border-white/[0.08] text-slate-900 dark:text-white rounded-xl py-1.5 pl-9 pr-3 focus:outline-none focus:border-indigo-500/50 transition-all text-xs"
                        />
                    </div>
                </div>
            </div>


            {/* Main App Grid Area - No internal scroll */}
            <div className="pb-40">
                <AnimatePresence mode="popLayout">
                    {filteredTools.length > 0 ? (
                        <motion.div 
                            key={searchQuery ? 'search' : selectedCategoryId + pricingFilter}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-5 pt-6 pb-10 max-w-[1800px] mx-auto"
                        >
                            {filteredTools.map((tool, idx) => (
                                <ToolCard key={`${tool.id}-${idx}`} tool={tool} />
                            ))}
                        </motion.div>
                    ) : (
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex flex-col items-center justify-center h-64 text-slate-600"
                        >
                            <Search className="w-10 h-10 opacity-30 mb-3" />
                            <p className="text-sm font-medium">No {pricingFilter !== 'All' ? pricingFilter : ''} tools found</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* MacOS Dock Area */}
            <div className={`transition-all duration-500 ${searchQuery ? 'opacity-30 blur-sm scale-95' : 'opacity-100'}`}>
                <MacDock 
                    categories={launchpadCategories} 
                    selectedCategoryId={selectedCategoryId} 
                    onSelectCategory={(id) => {
                        setSelectedCategoryId(id);
                        setSearchQuery(''); 
                        // Scroll to top when category changes
                        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }} 
                />
            </div>
            
        </div>
    );
};

export default LaunchpadTab;
