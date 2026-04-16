import React from 'react';
import { LaunchpadTool } from '../../data/launchpadData';
import { ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface ToolCardProps {
    tool: LaunchpadTool;
}

export const ToolCard: React.FC<ToolCardProps> = ({ tool }) => {
    const [isHovered, setIsHovered] = React.useState(false);
    const [imageLoaded, setImageLoaded] = React.useState(false);
    const cardRef = React.useRef<HTMLDivElement>(null);
    const [tooltipStyle, setTooltipStyle] = React.useState<{ left: string, transform: string, arrowLeft: string }>({
        left: '50%', transform: 'translateX(-50%)', arrowLeft: '50%'
    });
    const [tooltipPosition, setTooltipPosition] = React.useState<'top' | 'bottom'>('top');

    const logoUrl = `https://www.google.com/s2/favicons?domain=${tool.domain}&sz=128`;

    const handleMouseEnter = () => {
        setIsHovered(true);
        if (cardRef.current) {
            const rect = cardRef.current.getBoundingClientRect();
            // Default center
            let left = '50%';
            let transform = 'translateX(-50%)';
            let arrowLeft = '50%';

            // Tooltip width is 256px (w-64 = 16rem = 256px)
            const tooltipWidth = 256;
            const halfWidth = tooltipWidth / 2;

            if (rect.left + (rect.width / 2) - halfWidth < 10) {
                // Too far left
                left = '0%';
                transform = 'translateX(0)';
                arrowLeft = '20px';
            } else if (rect.left + (rect.width / 2) + halfWidth > window.innerWidth - 10) {
                // Too far right
                left = '100%';
                transform = 'translateX(-100%)';
                arrowLeft = 'calc(100% - 20px)';
            }

            // Flip tooltip to bottom if card is near the top of the viewport (less than 230px clearance)
            const position = rect.top < 230 ? 'bottom' : 'top';
            setTooltipPosition(position);
            setTooltipStyle({ left, transform, arrowLeft });
        }
    };

    return (
        <div
            ref={cardRef}
            className="relative flex flex-col items-center justify-center w-full mx-auto aspect-square z-10 hover:z-50"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* The Actual Clickable Card */}
            <motion.a
                href={tool.url}
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.05, y: -4 }}
                whileTap={{ scale: 0.98 }}
                className="luxury-card group relative flex flex-col items-center justify-center p-4 bg-white/80 dark:bg-slate-900/50 backdrop-blur-xl border border-slate-200/80 dark:border-white/[0.08] hover:border-indigo-500/40 dark:hover:border-white/[0.16] rounded-2xl transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer w-full h-full hover:-translate-y-1"
            >
                {/* Main Content (Always Visible & Clean) */}
                <div className="flex flex-col items-center">
                    {/* Squircle Logo Container */}
                    <div className="relative w-12 h-12 rounded-xl bg-white p-2 shadow-inner flex items-center justify-center overflow-hidden mb-3 transition-all duration-500 group-hover:shadow-[0_0_25px_rgba(255,255,255,0.2)]">
                        {!imageLoaded && (
                            <div className="absolute inset-0 bg-slate-200 animate-pulse rounded-xl" />
                        )}
                        <img
                            src={logoUrl}
                            alt={`${tool.name} logo`}
                            className={`w-full h-full object-contain relative z-10 transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                            onLoad={() => setImageLoaded(true)}
                            onError={(e) => {
                                setImageLoaded(true);
                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(tool.name)}&background=random&color=fff&rounded=true&bold=true`;
                            }}
                        />
                    </div>

                    <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 text-center line-clamp-1 px-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {tool.name}
                    </h3>
                </div>

                {/* Subtle External Link Icon */}
                <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <ExternalLink className="w-4 h-4 text-indigo-400" />
                </div>
            </motion.a>

            {/* Premium Floating Tooltip */}
            <AnimatePresence>
                {isHovered && (
                    <div
                        className={`absolute ${
                            tooltipPosition === 'top' ? 'bottom-[calc(100%+16px)]' : 'top-[calc(100%+16px)]'
                        } z-50 pointer-events-none transition-all duration-200`}
                        style={{ left: tooltipStyle.left, transform: tooltipStyle.transform }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: tooltipPosition === 'top' ? 15 : -15, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: tooltipPosition === 'top' ? 10 : -10, scale: 0.95 }}
                            transition={{ duration: 0.2, type: "spring", stiffness: 500, damping: 30 }}
                            className={`w-64 relative p-4 bg-slate-900/95 backdrop-blur-xl border border-slate-700/60 rounded-[20px] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.8)] flex flex-col gap-2 ${
                                tooltipPosition === 'top' ? 'origin-bottom' : 'origin-top'
                            }`}
                        >
                            {/* Arrow */}
                            <div
                                className={`absolute w-4 h-4 bg-slate-900/95 transition-all duration-200 ${
                                    tooltipPosition === 'top' 
                                        ? '-bottom-2 border-b border-r border-slate-700/60' 
                                        : '-top-2 border-t border-l border-slate-700/60'
                                } rounded-sm`}
                                style={{ left: tooltipStyle.arrowLeft, transform: 'translateX(-50%) rotate(45deg)' }}
                            />

                            {/* Tooltip Header */}
                            <div className="flex justify-between items-start gap-3">
                                <h4 className="text-sm font-bold text-white leading-tight">{tool.name}</h4>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${tool.pricing === 'Free' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' :
                                        tool.pricing === 'Paid' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/20' :
                                            tool.pricing === 'Enterprise' ? 'bg-violet-500/20 text-violet-400 border border-violet-500/20' :
                                                'bg-amber-500/20 text-amber-400 border border-amber-500/20'
                                    }`}>
                                    {tool.pricing}
                                </span>
                            </div>

                            {/* Description Line */}
                            <p className="text-[12px] text-slate-300 leading-relaxed font-medium">
                                {tool.description}
                            </p>

                            {/* Tags */}
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {tool.tags.map(tag => (
                                    <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700/50">
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

