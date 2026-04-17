import React from 'react';
import { Menu, TrendingUp, Bell, Eye, EyeOff } from 'lucide-react';

interface MobileHeaderProps {
    onMenuClick: () => void;
    isPrivacyMode: boolean;
    onTogglePrivacy: () => void;
    totalNetWorth: string;
}

/**
 * Mobile-only header that appears at the top of the screen on small devices.
 * Contains hamburger menu, logo, and quick actions.
 * Hidden on desktop (md: and above).
 */
const MobileHeader: React.FC<MobileHeaderProps> = ({
    onMenuClick,
    isPrivacyMode,
    onTogglePrivacy,
    totalNetWorth
}) => {
    return (
        <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-b border-slate-800 px-4 py-3">
            <div className="flex items-center justify-between">
                {/* Hamburger Menu Button */}
                <button
                    onClick={onMenuClick}
                    className="p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors active:scale-95"
                    aria-label="Open menu"
                >
                    <Menu size={24} />
                </button>

                {/* Logo */}
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/30">
                        <TrendingUp className="text-white" size={16} />
                    </div>
                    <span className="font-bold text-white text-sm">WealthAgg</span>
                </div>

                {/* Quick Actions */}
                <div className="flex items-center gap-1">
                    {/* Privacy Toggle */}
                    <button
                        onClick={onTogglePrivacy}
                        className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                        aria-label={isPrivacyMode ? "Show values" : "Hide values"}
                    >
                        {isPrivacyMode ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                </div>
            </div>

            {/* Net Worth Bar (optional, can be toggled) */}
            {!isPrivacyMode && (
                <div className="mt-2 -mx-4 px-4 py-2 bg-slate-900/50 border-t border-slate-800/50">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Gross Worth</span>
                        <span className="text-sm font-mono font-bold text-emerald-400">{totalNetWorth}</span>
                    </div>
                </div>
            )}
        </header>
    );
};

export default MobileHeader;
