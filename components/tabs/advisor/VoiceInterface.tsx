import React from 'react';
import { VoiceOrb } from '../../ai';
import { Mic } from 'lucide-react';
import { SectionHeader, StateSurface } from '../../shared/SurfacePrimitives';

interface VoiceInterfaceProps {
    isLiveSessionActive: boolean;
    onToggleSession: () => void;
    renderHeader: () => React.ReactNode;
}

export const VoiceInterface: React.FC<VoiceInterfaceProps> = ({ isLiveSessionActive, onToggleSession, renderHeader }) => {
    return (
        <div className="h-full flex flex-col items-center p-8 animate-in fade-in slide-in-from-right-4">
            {renderHeader()}
            <div className="flex-1 flex items-center justify-center w-full">
                {/* Voice Interface */}
                <div className={`w-full max-w-2xl bg-gradient-to-br ${isLiveSessionActive ? 'from-slate-900 to-indigo-950 border-indigo-500/50' : 'from-white to-slate-50 dark:from-slate-900 dark:to-slate-950 border-slate-200 dark:border-slate-800'} p-12 rounded-[2rem] border shadow-2xl text-center transition-all duration-500 relative overflow-hidden group`}>

                    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-[100px] transition-opacity duration-1000 ${isLiveSessionActive ? 'opacity-100' : 'opacity-0'}`}></div>

                    <div className="relative z-10 flex flex-col items-center">
                        <div className={`w-full mb-6 text-left ${isLiveSessionActive ? 'dark' : ''}`}>
                            <SectionHeader
                                eyebrow="Voice Desk"
                                title={isLiveSessionActive ? 'Voice Session Active' : 'Voice Session Standby'}
                                description={isLiveSessionActive ? 'Session is listening. Speak naturally and keep prompts concise for faster response.' : 'Tap the orb to start a guarded live advisory session.'}
                                icon={Mic}
                                tone={isLiveSessionActive ? 'success' : 'neutral'}
                                badge={isLiveSessionActive ? 'live' : 'offline'}
                            />
                        </div>

                        <h3 className={`text-3xl font-black mb-3 transition-colors ${isLiveSessionActive ? 'text-white' : 'text-slate-800 dark:text-white'}`}>
                            {isLiveSessionActive ? 'SYSTEM ONLINE' : 'VOICE NEURAL LINK'}
                        </h3>
                        <p className={`text-base mb-10 transition-colors ${isLiveSessionActive ? 'text-indigo-200' : 'text-slate-500 dark:text-slate-400'}`}>
                            {isLiveSessionActive ? 'Listening to your commands...' : 'Tap the orb to initialize voice session'}
                        </p>

                        <div className="cursor-pointer hover:scale-105 transition-transform duration-300" onClick={onToggleSession}>
                            <VoiceOrb isActive={isLiveSessionActive} />
                        </div>

                        <div className={`mt-12 px-6 py-2 rounded-full border text-xs font-bold uppercase tracking-widest transition-all ${isLiveSessionActive ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                            {isLiveSessionActive ? 'Live Session Active' : 'System Standby'}
                        </div>
                        <div className="mt-4 w-full">
                            <StateSurface
                                title={isLiveSessionActive ? 'Connected To Live Advisor' : 'Not Connected'}
                                description={isLiveSessionActive ? 'You can ask about portfolio state, risk, and next actions in real time.' : 'Start session to unlock conversational portfolio guidance.'}
                                tone={isLiveSessionActive ? 'success' : 'warning'}
                                compact
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
