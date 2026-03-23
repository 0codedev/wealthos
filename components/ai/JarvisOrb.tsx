import React, { useEffect, useState, useRef } from 'react';
import { Mic, MicOff, Activity, Send, Keyboard } from 'lucide-react';
import { useJarvis } from '../../hooks/useJarvis';
import { usePageVisibility } from '../../contexts/PageVisibilityContext';

interface JarvisOrbProps {
    onNavigate: (tab: string) => void;
    onSwitchProfile?: (id: string) => void;
}

/**
 * JarvisOrb — the floating mic button + transcript bubble.
 *
 * CC11 enhancements:
 *   1. Premium audio wave visualizer (5-bar SVG with sinusoidal heights
 *      and gradient bars) replaces the previous `Math.random` bars.
 *   2. The wave bars are real-time — sampled via `AnalyserNode.getByteTimeDomainData`
 *      from the actual microphone stream when available, falling back to a
 *      smooth simulated wave when the browser has not granted mic access yet
 *      (text-input mode, or before the first `toggleListening()` click).
 *   3. Web Audio API initialisation is deferred — no `AudioContext` is
 *      created until the user actually clicks the mic. This avoids the
 *      "AudioContext was not allowed to start" warning that Chrome prints
 *      when a tab is in the background.
 */
const JarvisOrb: React.FC<JarvisOrbProps> = ({ onNavigate, onSwitchProfile }) => {
    const { isListening, isSpeaking, transcript, lastResponse, toggleListening, processText } = useJarvis({
        onNavigate,
        onSwitchProfile
    });

    const [visualizerHeight, setVisualizerHeight] = useState<number[]>([5, 5, 5, 5, 5]);
    const [showInput, setShowInput] = useState(false);
    const [manualInput, setManualInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const isVisible = usePageVisibility();

    // Real-time audio analyser — only when listening
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);

    // Premium 5-bar visualizer. When the mic is live, sample the
    // AnalyserNode at 60 fps and project onto 5 buckets. When the mic
    // is silent (or in text-input mode), animate a smooth sine wave
    // so the orb feels alive even when nothing is being said.
    useEffect(() => {
        if (!isVisible) return;

        if (isListening) {
            const tick = () => {
                const analyser = analyserRef.current;
                if (analyser) {
                    const data = new Uint8Array(analyser.fftSize);
                    analyser.getByteTimeDomainData(data);
                    // Split the time-domain buffer into 5 buckets and
                    // compute the peak-to-peak amplitude in each.
                    const bucket = Math.floor(data.length / 5);
                    const heights: number[] = [];
                    for (let i = 0; i < 5; i++) {
                        let min = 128, max = 128;
                        for (let j = i * bucket; j < (i + 1) * bucket; j++) {
                            const v = data[j];
                            if (v < min) min = v;
                            if (v > max) max = v;
                        }
                        const amp = Math.min(1, (max - min) / 128);
                        heights.push(8 + amp * 22);
                    }
                    setVisualizerHeight(heights);
                } else {
                    // Mic permission not granted — fall back to a sine wave
                    const t = Date.now() / 200;
                    setVisualizerHeight(
                        Array.from({ length: 5 }, (_, i) =>
                            10 + 8 * Math.abs(Math.sin(t + i * 0.7))
                        )
                    );
                }
                rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
        } else if (isSpeaking) {
            // TTS — fake the wave with a slow sine
            const tick = () => {
                const t = Date.now() / 150;
                setVisualizerHeight(
                    Array.from({ length: 5 }, (_, i) =>
                        8 + 14 * Math.abs(Math.sin(t + i * 0.5))
                    )
                );
                rafRef.current = requestAnimationFrame(tick);
            };
            rafRef.current = requestAnimationFrame(tick);
        } else {
            setVisualizerHeight([5, 5, 5, 5, 5]);
        }
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [isListening, isSpeaking, isVisible]);

    // Attach the AnalyserNode when the user grants mic access.
    useEffect(() => {
        if (!isListening) return;
        // Lazy-init AudioContext (Chrome blocks if created in background)
        const setupAudio = async () => {
            try {
                if (!audioContextRef.current) {
                    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
                    audioContextRef.current = new Ctor();
                }
                const ctx = audioContextRef.current!;
                if (ctx.state === 'suspended') await ctx.resume();

                if (!streamRef.current) {
                    streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
                }
                if (!sourceRef.current) {
                    sourceRef.current = ctx.createMediaStreamSource(streamRef.current);
                    analyserRef.current = ctx.createAnalyser();
                    analyserRef.current.fftSize = 256;
                    sourceRef.current.connect(analyserRef.current);
                }
            } catch (e) {
                // Mic denied or unavailable — fallback to simulated wave
                logger.debug('Mic analyser not available, using simulated wave', { e });
            }
        };
        setupAudio();

        return () => {
            // We deliberately do NOT close the AudioContext on every
            // listening toggle — the user might toggle back on within
            // seconds. The cleanup happens on unmount.
        };
    }, [isListening]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            try { sourceRef.current?.disconnect(); } catch {}
            try { analyserRef.current?.disconnect(); } catch {}
            streamRef.current?.getTracks().forEach(t => t.stop());
            audioContextRef.current?.close().catch(() => {});
        };
    }, []);

    // Focus input when shown
    useEffect(() => {
        if (showInput && inputRef.current) {
            inputRef.current.focus();
        }
    }, [showInput]);

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (manualInput.trim()) {
            processText(manualInput);
            setManualInput('');
        }
    };

    return (
        <div className="fixed bottom-24 md:bottom-6 right-4 md:right-6 z-50 flex flex-col items-end gap-2">

            {/* Transcript/Response Bubble */}
            {(transcript || lastResponse || showInput) && (
                <div className="mb-2 w-[calc(100vw-2rem)] md:w-80 bg-slate-900/95 border border-indigo-500/50 p-4 rounded-2xl rounded-tr-none backdrop-blur-md shadow-2xl transition-all duration-300 animate-in slide-in-from-right-10 fade-in">

                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-xs text-indigo-300 font-mono uppercase tracking-widest flex items-center gap-2">
                            {isListening ? <span className="flex h-2 w-2 rounded-full bg-red-500 animate-ping" /> : <Activity size={12} />}
                            {isListening ? 'Listening…' : isSpeaking ? 'Speaking…' : 'Jarvis System'}
                        </p>
                        <button
                            onClick={() => setShowInput(!showInput)}
                            className="text-slate-500 hover:text-white transition-colors"
                            title="Toggle Keyboard Input"
                            aria-label="Toggle keyboard input"
                        >
                            <Keyboard size={14} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="space-y-3">
                        {(transcript || lastResponse) && !showInput && (
                            <div className="min-h-[20px]">
                                <p className="text-sm text-slate-300 font-medium leading-relaxed">
                                    {isListening ? `“${transcript}”` : lastResponse}
                                </p>
                            </div>
                        )}

                        {showInput && (
                            <form onSubmit={handleManualSubmit} className="relative">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={manualInput}
                                    onChange={e => setManualInput(e.target.value)}
                                    placeholder="Type a command (e.g. 'show me Nifty options for tomorrow')…"
                                    className="w-full bg-black/50 border border-slate-700 rounded-lg py-2 pl-3 pr-10 text-sm text-white focus:border-indigo-500 outline-none placeholder:text-slate-600 font-mono"
                                />
                                <button
                                    type="submit"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-500 hover:text-indigo-400 disabled:opacity-50"
                                    disabled={!manualInput.trim()}
                                    aria-label="Send command"
                                >
                                    <Send size={14} />
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* The Orb Button */}
            <button
                onClick={toggleListening}
                aria-label={isListening ? 'Stop listening' : 'Start voice input'}
                aria-pressed={isListening}
                className={`relative group flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full transition-all duration-500 shadow-2xl z-50 ${
                    isListening
                        ? 'bg-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.4)] border border-red-500/50'
                        : isSpeaking
                            ? 'bg-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.4)] border border-emerald-500/50'
                            : 'bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/50 hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]'
                }`}
            >
                {/* Pulse ping when actively listening */}
                <div className={`absolute inset-0 rounded-full opacity-50 ${isListening && isVisible ? 'animate-ping bg-red-500' : ''}`} aria-hidden="true" />

                {/* Waveform bars OR mic icon */}
                <div className="relative z-10 text-white" aria-hidden="true">
                    {isListening ? (
                        <div className="flex items-end gap-0.5 h-7" role="presentation">
                            {visualizerHeight.map((h, i) => (
                                <div
                                    key={i}
                                    style={{ height: `${h}px` }}
                                    className="w-1 bg-gradient-to-t from-red-400 to-rose-200 rounded-full transition-all duration-75 shadow-[0_0_6px_rgba(239,68,68,0.5)]"
                                />
                            ))}
                        </div>
                    ) : isSpeaking ? (
                        <div className="flex items-end gap-0.5 h-7" role="presentation">
                            {visualizerHeight.map((h, i) => (
                                <div
                                    key={i}
                                    style={{ height: `${h}px` }}
                                    className="w-1 bg-gradient-to-t from-emerald-400 to-emerald-200 rounded-full transition-all duration-75"
                                />
                            ))}
                        </div>
                    ) : (
                        <Mic size={26} className="text-indigo-400 group-hover:scale-110 transition-transform" />
                    )}
                </div>
            </button>
        </div>
    );
};

import { logger } from '../../services/Logger';
export default JarvisOrb;
