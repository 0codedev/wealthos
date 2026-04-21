import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mic, MicOff, Volume2, VolumeX, Send, X, History, Sparkles,
    Activity, Zap, Brain, AlertCircle, ChevronRight, Loader2
} from 'lucide-react';
import { useQuantumStore } from '../../store/quantumStore';
import { useShallow } from 'zustand/react/shallow';
import { interpretCommand, speak, QuantumAction } from '../../services/JarvisVoiceGrammar';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * JarvisVoiceConsole — CC35
 * =====================================================================
 * "Jarvis 4.0" — premium voice + text command console for the Quantum
 * terminal. Uses the browser's SpeechRecognition API for STT, a
 * Canvas-based voice visualizer for the audio waveform, and a small
 * grammar (`JarvisVoiceGrammar`) to translate transcripts into
 * actions on the shared Quantum store.
 *
 * Designed to be toggled via a global hotkey. The console emits a
 * `quantum-jarvis-toggle` custom event so any ancestor (e.g. the
 * `QuantumCategoryPage`) can show/hide it.
 */

interface HistoryItem {
    id: string;
    role: 'user' | 'jarvis';
    text: string;
    at: number;
    action?: QuantumAction;
}

type JarvisState = 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING';

export const JarvisVoiceConsole: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const jarvisMuted = useSettingsStore(useShallow(s => s.jarvisMuted));
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [jarvisState, setJarvisState] = useState<JarvisState>('IDLE');
    const [history, setHistory] = useState<HistoryItem[]>([
        { id: 'welcome', role: 'jarvis', text: 'I am Jarvis 4.0. Try: "open quantum", "focus NIFTY", "iron condor", or "nifty minus 2".', at: Date.now() },
    ]);
    const [error, setError] = useState<string | null>(null);
    const recognitionRef = useRef<any>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);

    const setActiveSymbol = useQuantumStore(useShallow(s => s.setActiveSymbol));
    const setActiveAxis = useQuantumStore(useShallow(s => s.setActiveAxis));
    const setActiveShock = useQuantumStore(useShallow(s => s.setActiveShock));
    const setActiveStrategy = useQuantumStore(useShallow(s => s.setActiveStrategy));
    const setOptimizerUnderlying = useQuantumStore(useShallow(s => s.setOptimizerUnderlying));
    const setFocusedBranch = useQuantumStore(useShallow(s => s.setFocusedBranch));

    // ---------- Audio analyser / voice visualizer ----------

    const ensureAudio = useCallback(async (): Promise<boolean> => {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices) return false;
        if (audioCtxRef.current) return true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioCtxRef.current = ctx;
            const source = ctx.createMediaStreamSource(stream);
            sourceRef.current = source;
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.85;
            source.connect(analyser);
            analyserRef.current = analyser;
            return true;
        } catch (err) {
            setError('Microphone access was denied. Voice input is disabled.');
            return false;
        }
    }, []);

    const drawVisualizer = useCallback(() => {
        const canvas = canvasRef.current;
        const analyser = analyserRef.current;
        if (!canvas || !analyser) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const W = canvas.width;
        const H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buffer);
        const barCount = 48;
        const step = Math.floor(buffer.length / barCount);
        const cx = W / 2;
        const cy = H / 2;
        const radius = Math.min(W, H) * 0.32;
        for (let i = 0; i < barCount; i++) {
            const v = buffer[i * step] ?? 0;
            const h = (v / 255) * (radius * 0.9) + 4;
            const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
            const x1 = cx + Math.cos(angle) * radius;
            const y1 = cy + Math.sin(angle) * radius;
            const x2 = cx + Math.cos(angle) * (radius + h);
            const y2 = cy + Math.sin(angle) * (radius + h);
            const grad = ctx.createLinearGradient(x1, y1, x2, y2);
            grad.addColorStop(0, 'rgba(34, 211, 238, 0.4)');
            grad.addColorStop(1, 'rgba(217, 70, 239, 1)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }
        // Inner orb
        const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        innerGrad.addColorStop(0, 'rgba(34, 211, 238, 0.25)');
        innerGrad.addColorStop(0.6, 'rgba(99, 102, 241, 0.15)');
        innerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = innerGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        rafRef.current = requestAnimationFrame(drawVisualizer);
    }, []);

    const stopVisualizer = useCallback(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    // ---------- Speech recognition ----------

    const startListening = useCallback(async () => {
        setError(null);
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) {
            setError('SpeechRecognition is not available in this browser. Use the text input instead.');
            return;
        }
        const ok = await ensureAudio();
        if (!ok) return;

        const rec = new SR();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = 'en-IN';
        rec.onstart = () => {
            setIsListening(true);
            setJarvisState('LISTENING');
            drawVisualizer();
        };
        rec.onresult = (e: any) => {
            const result = Array.from(e.results)
                .map((r: any) => r[0].transcript)
                .join(' ');
            setTranscript(result);
        };
        rec.onerror = (e: any) => {
            setError(`Voice error: ${e.error}`);
            setIsListening(false);
            setJarvisState('IDLE');
            stopVisualizer();
        };
        rec.onend = () => {
            setIsListening(false);
            if (transcript.trim()) {
                runAction(transcript.trim());
            } else {
                setJarvisState('IDLE');
            }
            stopVisualizer();
        };
        recognitionRef.current = rec;
        rec.start();
    }, [ensureAudio, drawVisualizer, stopVisualizer, transcript]);

    const stopListening = useCallback(() => {
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch { /* ignore */ }
        }
        setIsListening(false);
        stopVisualizer();
    }, [stopVisualizer]);

    // ---------- Action dispatch ----------

    const dispatchAction = useCallback((action: QuantumAction) => {
        switch (action.kind) {
            case 'FOCUS_SYMBOL':
                setActiveSymbol(String(action.payload));
                setOptimizerUnderlying(String(action.payload));
                break;
            case 'SET_AXIS':
                setActiveAxis(action.payload as any);
                break;
            case 'SET_SHOCK':
                setActiveShock(Number(action.payload));
                break;
            case 'SET_STRATEGY':
                setActiveStrategy(action.payload as any);
                break;
            case 'FOCUS_BRANCH':
                setFocusedBranch(action.payload as any);
                break;
            case 'NAVIGATE':
                // Emit a navigate event so AppRouter can switch tabs
                window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: { category: action.payload, subTab: action.payload } }));
                break;
            default:
                break;
        }
    }, [setActiveAxis, setActiveShock, setActiveStrategy, setActiveSymbol, setFocusedBranch, setOptimizerUnderlying]);

    const runAction = useCallback((text: string) => {
        setJarvisState('THINKING');
        const action = interpretCommand(text);
        const id = `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        setHistory(h => [...h, { id, role: 'user', text, at: Date.now(), action }]);
        dispatchAction(action);
        // simulate "thinking" for a beat, then speak
        setTimeout(() => {
            setHistory(h => [...h, { id: `${id}_r`, role: 'jarvis', text: action.spokenReply, at: Date.now() + 1 }]);
            setJarvisState('SPEAKING');
            speak(action.spokenReply, jarvisMuted);
            setTimeout(() => setJarvisState('IDLE'), 1200);
        }, 400);
        setTranscript('');
    }, [dispatchAction, jarvisMuted]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            try { recognitionRef.current?.stop(); } catch { /* ignore */ }
            streamRef.current?.getTracks().forEach(t => t.stop());
            stopVisualizer();
        };
    }, [stopVisualizer]);

    // Keyboard: Esc closes
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const StateBadge: React.FC<{ state: JarvisState }> = ({ state }) => {
        const config: Record<JarvisState, { color: string; label: string; icon: React.ReactNode }> = {
            IDLE:      { color: 'text-slate-400',   label: 'STANDBY',    icon: <Brain size={11} /> },
            LISTENING: { color: 'text-cyan-300',    label: 'LISTENING',  icon: <Mic size={11} /> },
            THINKING:  { color: 'text-amber-300',   label: 'THINKING',   icon: <Loader2 size={11} className="animate-spin" /> },
            SPEAKING:  { color: 'text-fuchsia-300', label: 'SPEAKING',   icon: <Volume2 size={11} /> },
        };
        const c = config[state];
        return (
            <span className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest ${c.color}`}>
                {c.icon} {c.label}
            </span>
        );
    };

    return (
        <AnimatePresence>
            <motion.div
                key="jarvis"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[150] flex items-end md:items-center md:justify-center bg-slate-950/70 backdrop-blur-md p-2 md:p-6"
            >
                <motion.div
                    initial={{ y: 60, scale: 0.96 }}
                    animate={{ y: 0, scale: 1 }}
                    exit={{ y: 60, scale: 0.96 }}
                    className="relative w-full max-w-2xl max-h-[88vh] flex flex-col rounded-3xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl shadow-cyan-500/20 overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-3 border-b border-slate-800 bg-slate-950/50">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-fuchsia-500 flex items-center justify-center">
                                <Sparkles size={16} className="text-white" />
                            </div>
                            <div>
                                <div className="text-xs font-black uppercase tracking-widest text-cyan-300">Jarvis 4.0</div>
                                <StateBadge state={jarvisState} />
                            </div>
                        </div>
                        <button onClick={onClose} className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:bg-slate-700">
                            <X size={14} />
                        </button>
                    </div>

                    {/* Visualizer + controls */}
                    <div className="flex flex-col items-center justify-center py-4 bg-gradient-to-b from-slate-950/40 to-transparent">
                        <div className="relative h-44 w-44">
                            <canvas ref={canvasRef} width={352} height={352} className="absolute inset-0 h-full w-full" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <motion.button
                                    whileTap={{ scale: 0.92 }}
                                    onClick={isListening ? stopListening : startListening}
                                    disabled={jarvisState === 'THINKING'}
                                    className={`h-20 w-20 rounded-full flex items-center justify-center transition-all shadow-2xl ${
                                        isListening
                                            ? 'bg-rose-500 text-white shadow-rose-500/40 animate-pulse'
                                            : 'bg-gradient-to-br from-cyan-500 to-fuchsia-500 text-white shadow-cyan-500/40'
                                    }`}
                                >
                                    {isListening ? <MicOff size={28} /> : <Mic size={28} />}
                                </motion.button>
                            </div>
                        </div>
                        {transcript && (
                            <div className="mt-3 max-w-md text-center text-sm text-slate-200 italic">"{transcript}"</div>
                        )}
                        {error && (
                            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-rose-400">
                                <AlertCircle size={11} /> {error}
                            </div>
                        )}
                        <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
                            <Zap size={10} /> Tap mic to dictate · or type a command below
                        </div>
                    </div>

                    {/* Text input */}
                    <form
                        onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const v = String(fd.get('cmd') || '').trim(); if (v) runAction(v); }}
                        className="flex items-center gap-2 px-4 pb-2"
                    >
                        <input
                            name="cmd"
                            autoComplete="off"
                            placeholder="Try: open quantum, focus NIFTY, iron condor, nifty minus 2"
                            className="flex-1 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                        />
                        <button type="submit" className="h-9 w-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-300 hover:bg-cyan-500/30">
                            <Send size={14} />
                        </button>
                    </form>

                    {/* History */}
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-2 border-t border-slate-800 pt-3">
                        {history.slice(-20).map(h => (
                            <div key={h.id} className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
                                    h.role === 'user'
                                        ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-100'
                                        : 'bg-slate-800/60 border border-slate-700 text-slate-200'
                                }`}>
                                    <div className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-0.5">
                                        {h.role === 'user' ? 'YOU' : 'JARVIS'}
                                        {h.action && h.action.kind !== 'UNKNOWN' && (
                                            <span className="ml-2 px-1 rounded bg-slate-900/60 text-cyan-300">{h.action.kind}</span>
                                        )}
                                    </div>
                                    <div>{h.text}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer hints */}
                    <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-[10px] text-slate-500">
                        <span>Press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">Esc</kbd> to close</span>
                        <span className="flex items-center gap-1">
                            {jarvisMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                            Voice replies {jarvisMuted ? 'muted' : 'on'}
                        </span>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default JarvisVoiceConsole;
