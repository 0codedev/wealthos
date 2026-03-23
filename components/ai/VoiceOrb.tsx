import React from 'react';

export interface VoiceOrbProps {
    isActive: boolean;
}

export const VoiceOrb: React.FC<VoiceOrbProps> = React.memo(({ isActive }) => {
    return (
        <div className="relative w-24 h-24 md:w-32 md:h-32 flex items-center justify-center">
            <div className={`absolute w-12 h-12 md:w-16 md:h-16 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 shadow-[0_0_30px_rgba(99,102,241,0.6)] z-20 transition-all duration-500 ${isActive ? 'scale-110 shadow-[0_0_50px_rgba(99,102,241,0.8)]' : 'scale-100'}`}></div>
            <div className={`absolute w-16 h-16 md:w-24 md:h-24 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 z-10 transition-all duration-1000 ${isActive ? 'animate-[spin_3s_linear_infinite]' : ''}`}></div>
            <div className={`absolute w-24 h-24 md:w-32 md:h-32 rounded-full border border-purple-400/20 border-b-purple-400 z-0 transition-all duration-1000 ${isActive ? 'animate-[spin_5s_linear_infinite_reverse]' : ''}`}></div>
            {isActive && (
                <>
                    <div className="absolute w-full h-full rounded-full bg-indigo-500/20 animate-ping"></div>
                    <div className="absolute w-full h-full rounded-full bg-purple-500/20 animate-ping delay-150"></div>
                </>
            )}
        </div>
    );
});

VoiceOrb.displayName = 'VoiceOrb';
