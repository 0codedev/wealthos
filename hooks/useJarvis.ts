import { useState, useEffect, useRef, useCallback } from 'react';
import { jarvisCommandService, JarvisAction } from '../services/JarvisCommandService';
import { logger } from '../services/Logger';

// Browser Speech Recognition Types
interface IWindow extends Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
}

// Define handlers interface
export interface JarvisHandlers {
    onNavigate: (tab: string) => void;
    onSwitchProfile?: (profileId: string) => void;
}

export const useJarvis = (handlers: JarvisHandlers) => {
    const { onNavigate, onSwitchProfile } = handlers;
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [lastResponse, setLastResponse] = useState('');

    const recognitionRef = useRef<any>(null);
    const synthesisRef = useRef<SpeechSynthesis>(window.speechSynthesis);
    const retryCountRef = useRef(0); // Track retries for "no-speech"

    const speak = useCallback((text: string) => {
        if (!synthesisRef.current) return;

        // Cancel existing
        synthesisRef.current.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Try to find a "technological" voice
        const voices = synthesisRef.current.getVoices();
        const techVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Microsoft David'));
        if (techVoice) utterance.voice = techVoice;

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);

        synthesisRef.current.speak(utterance);
        setLastResponse(text);
    }, []);

    const processText = useCallback(async (text: string) => {
        logger.debug('Processing text', { text }, 'Jarvis');
        setTranscript(text); // Show what was typed/heard
        setIsProcessing(true);

        try {
            // Use AI-enhanced parsing
            const action = await jarvisCommandService.processCommandAI(text);

            if (action.response) {
                speak(action.response);
            }

            if (action.type === 'NAVIGATE' && action.payload) {
                onNavigate(action.payload);
            }

            if (action.type === 'SWITCH_PROFILE' && action.payload) {
                if (onSwitchProfile) {
                    onSwitchProfile(action.payload);
                } else {
                    speak("I can't switch profiles right now. Feature unavailable.");
                }
            }
        } catch (err) {
            console.error('Jarvis processing failed:', err);
            speak("I encountered an error processing your command.");
        } finally {
            setIsProcessing(false);
        }

        // Handle other types (REFRESH, QUERY) via callback or extended logic later
    }, [onNavigate, onSwitchProfile, speak]);

    // Initialize Recognition
    useEffect(() => {
        const { webkitSpeechRecognition, SpeechRecognition } = window as unknown as IWindow;
        const SpeechRecognitionApi = SpeechRecognition || webkitSpeechRecognition;

        if (SpeechRecognitionApi) {
            const recognition = new SpeechRecognitionApi();
            recognition.continuous = false; // Stop after one sentence for command processing
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onstart = () => setIsListening(true);

            recognition.onresult = (event: any) => {
                const current = event.resultIndex;
                const result = event.results[current];
                const transcriptText = result[0].transcript;

                setTranscript(transcriptText);

                // Robustness: Process immediately if "Final" flag is set by browser
                if (result.isFinal) {
                    logger.debug('Heard final transcript', { transcriptText }, 'Jarvis');
                    processText(transcriptText); // Use unified processText
                    setIsListening(false);
                    recognition.stop();
                }
            };

            recognition.onerror = (event: any) => {
                logger.warn('Speech error', { error: event.error }, 'Jarvis');

                // AUTO-RETRY LOGIC
                if (event.error === 'no-speech') {
                    if (retryCountRef.current < 1) {
                        logger.debug('No speech detected, retrying once', undefined, 'Jarvis');
                        retryCountRef.current += 1;
                        // Small delay to reset internal state
                        setTimeout(() => {
                            try { recognition.start(); } catch (e) { /* ignore already started */ }
                        }, 100);
                        return; // Don't stop yet
                    } else {
                        setLastResponse("Mic timed out. Try typing.");
                    }
                } else if (event.error === 'not-allowed') {
                    setLastResponse("Mic blocked. Use text input.");
                }

                setIsListening(false);
            };

            recognition.onend = () => {
                if (retryCountRef.current >= 1 || !isListening) {
                    setIsListening(false);
                }
            };

            recognitionRef.current = recognition;
        }
    }, [processText]);

    const toggleListening = () => {
        if (isListening) {
            recognitionRef.current?.stop();
        } else {
            // Reset state
            setTranscript('');
            setLastResponse('');
            retryCountRef.current = 0;
            recognitionRef.current?.start();
        }
    };

    return {
        isListening,
        isSpeaking,
        isProcessing,
        transcript,
        lastResponse,
        toggleListening,
        processText, // Expose for manual input
        speak
    };
};
