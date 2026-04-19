import React, { useState, useEffect, useRef } from 'react';
import { Play, Square, Sun, Volume2, Loader2 } from 'lucide-react';
import * as AIService from '../services/aiService';
import { Investment } from '../types';

interface MorningBriefingProps {
    investments: Investment[];
    totalNetWorth: string;
    userName?: string;
}

const MorningBriefing: React.FC<MorningBriefingProps> = ({ investments, totalNetWorth, userName = "Investor" }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [briefingText, setBriefingText] = useState<string | null>(null);
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
        };
    }, []);

    const generateBriefing = async () => {
        setIsLoading(true);
        try {
            const prompt = `
            Generate a concise "Morning Briefing" for a wealthy investor.
            Context:
            - Name: ${userName}
            - Net Worth: ${totalNetWorth}
            - Top 3 Assets: ${investments.slice(0, 3).map(i => i.name).join(', ')}
            
            Style: Professional, energetic, Bloomberg Radio style.
            Content:
            1. Market sentiment (assume neutral/bullish for now).
            2. Portfolio snapshot.
            3. One actionable tip.
            
            Keep it under 100 words. Plain text only.
            `;

            const text = await AIService.askGemini(prompt);
            setBriefingText(text);
            return text;
        } catch (error) {
            console.error("Briefing Gen Error", error);
            return "Good morning. I am unable to generate your briefing right now. Please check your connection.";
        } finally {
            setIsLoading(false);
        }
    };

    const handlePlay = async () => {
        if (isPlaying) {
            window.speechSynthesis.cancel();
            setIsPlaying(false);
            return;
        }

        let textToRead = briefingText;
        if (!textToRead) {
            textToRead = await generateBriefing();
        }

        if (textToRead) {
            const utterance = new SpeechSynthesisUtterance(textToRead);
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            // Try to find a good voice
            const voices = window.speechSynthesis.getVoices();
            const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha'));
            if (preferredVoice) utterance.voice = preferredVoice;

            utterance.onend = () => setIsPlaying(false);
            utterance.onerror = () => setIsPlaying(false);

            utteranceRef.current = utterance;
            window.speechSynthesis.speak(utterance);
            setIsPlaying(true);
        }
    };

    return (
        <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 border border-orange-100 dark:border-orange-900/30 rounded-2xl p-6 mb-6 flex items-center justify-between relative overflow-hidden">
            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-2 text-orange-600 dark:text-orange-400">
                    <Sun size={18} />
                    <span className="text-xs font-bold uppercase tracking-wider">Morning Briefing</span>
                </div>
                <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">
                    {isPlaying ? "Broadcasting Live..." : "Your Daily Market Pulse"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md">
                    AI-curated audio summary of your portfolio performance and global market trends.
                </p>
            </div>

            <button
                onClick={handlePlay}
                disabled={isLoading}
                className={`relative z-10 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all ${isPlaying
                    ? 'bg-orange-500 text-white animate-pulse'
                    : 'bg-white dark:bg-slate-800 text-orange-500 hover:scale-110'
                    }`}
            >
                {isLoading ? (
                    <Loader2 size={24} className="animate-spin" />
                ) : isPlaying ? (
                    <Square size={20} fill="currentColor" />
                ) : (
                    <Play size={24} fill="currentColor" className="ml-1" />
                )}
            </button>

            {/* Background Decor */}
            <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-orange-500/10 to-transparent pointer-events-none"></div>
            <Volume2 className="absolute right-6 top-1/2 -translate-y-1/2 text-orange-500/10 w-24 h-24 pointer-events-none" />
        </div>
    );
};

export default MorningBriefing;
