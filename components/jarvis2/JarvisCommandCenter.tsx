import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Mic, MicOff, Send, X, Volume2, VolumeX, Sparkles, Activity,
    ChevronUp, ChevronDown, AlertCircle, HelpCircle, History
} from 'lucide-react';
import { useJarvis2 } from '../../hooks/useJarvis2';
import { jarvis2Service } from '../../services/Jarvis2Service';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * JarvisCommandCenter — full-screen voice + text command surface.
 * Activated by Ctrl+Space (Cmd+Space on Mac) globally.
 * Designed to supersede (not replace) the existing JarvisOrb.tsx.
 */
const JarvisCommandCenter: React.FC = () => {
    const { snapshot, close, startListening, stopListening, stopSpeaking, submitTyped } = useJarvis2();
    const [input, setInput] = useState('');
    const [historyIndex, setHistoryIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const jarvisMuted = useSettingsStore(state => state.jarvisMuted);
    const isMutedSetting = jarvisMuted;
    const jarvisAutonomousMode = useSettingsStore(state => state.jarvisAutonomousMode);
    const updateSetting = useSettingsStore(state => state.updateSetting);

    const isOpen = snapshot.isOpen;
    const state = snapshot.state;

    // Focus the input whenever the panel opens
    useEffect(() => {
        if (isOpen) {
            const t = setTimeout(() => inputRef.current?.focus(), 80);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    // Close on ESC
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, close]);

    // Auto-scroll transcript feed
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [snapshot.history, snapshot.response, snapshot.transcript]);

    // Submit a typed command
    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const text = input.trim();
        if (!text) return;
        submitTyped(text);
        setInput('');
        setHistoryIndex(-1);
    }, [input, submitTyped]);

    // Up/Down arrow keys: navigate command history
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (snapshot.history.length === 0) return;
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHistoryIndex(prev => {
                const next = prev < snapshot.history.length - 1 ? prev + 1 : prev;
                const userMessages = snapshot.history.filter((h: { role: string }) => h.role === 'user').map((h: { text: string }) => h.text);
                if (userMessages.length > 0) {
                    const idx = userMessages.length - 1 - next;
                    if (idx >= 0) setInput(userMessages[idx]);
                }
                return next;
            });
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHistoryIndex(prev => {
                const next = prev > 0 ? prev - 1 : -1;
                if (next === -1) setInput('');
                else {
                    const userMessages = snapshot.history.filter((h: { role: string }) => h.role === 'user').map((h: { text: string }) => h.text);
                    const idx = userMessages.length - 1 - next;
                    if (idx >= 0) setInput(userMessages[idx]);
                }
                return next;
            });
        }
    }, [snapshot.history]);

    const toggleListening = () => {
        if (state === 'listening') stopListening();
        else startListening();
    };

    const toggleMute = () => {
        if (state === 'speaking') stopSpeaking();
        updateSetting('jarvisMuted', !isMutedSetting);
    };

    return (
        <>
            {/* Static backdrop — renders outside AnimatePresence so backdrop-filter never recalculates during panel movement */}
            <div
                className="fixed inset-0 z-[299] bg-slate-950/70"
                style={{
                    opacity: isOpen ? 1 : 0,
                    pointerEvents: isOpen ? 'auto' : 'none',
                    transition: 'opacity 0.2s ease',
                }}
                onClick={close}
                aria-hidden="true"
            />

            <AnimatePresence>
            {isOpen && (
                <div
                    className="fixed inset-0 z-[300] flex items-center justify-center px-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Jarvis 2.0 command center"
                >
                    {/* Animating panel only — no backdrop-blur, GPU composites transform + opacity only */}
                    <motion.div
                        key="jarvis2-panel"
                        initial={{ scale: 0.94, y: -16, opacity: 0 }}
                        animate={{ scale: 1, y: 0, opacity: 1 }}
                        exit={{ scale: 0.94, y: -16, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
                        style={{ willChange: 'transform, opacity' }}
                        className="relative w-full max-w-6xl h-[85vh] md:h-[80vh] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-indigo-500/30 rounded-3xl shadow-2xl shadow-indigo-500/20 overflow-hidden"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/50">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                                    <Sparkles size={16} className="text-white" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white">
                                        Jarvis 2.0
                                    </h2>
                                    <p className="text-[10px] text-indigo-600 dark:text-indigo-300/80 font-mono flex items-center gap-1.5">
                                        Voice-First Command Center
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold border border-emerald-500/30">
                                            ⚡ ML Intent Classifier (&lt;15ms)
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => updateSetting('jarvisAutonomousMode', !jarvisAutonomousMode)}
                                    className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
                                        jarvisAutonomousMode
                                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700/50'
                                    }`}
                                    title="Toggle Jarvis 3.0 Autonomous Sentinel Loop"
                                >
                                    <Activity size={10} className={jarvisAutonomousMode ? 'animate-pulse' : ''} />
                                    Sentinel {jarvisAutonomousMode ? 'ON' : 'OFF'}
                                </button>
                                <button
                                    type="button"
                                    aria-label="Toggle voice"
                                    onClick={toggleMute}
                                    className={`p-2 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
                                        isMutedSetting ? 'text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300' : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                    title={isMutedSetting ? "Unmute Jarvis voice" : "Mute Jarvis voice"}
                                >
                                    {isMutedSetting ? <VolumeX size={16} /> : <Volume2 size={16} />}
                                </button>
                                <button
                                    type="button"
                                    aria-label="Close Jarvis 2.0"
                                    onClick={close}
                                    className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Split Columns Grid Body */}
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
                            {/* Left Panel: Neural Avatar, Input & Suggestions */}
                            <div className="col-span-12 md:col-span-5 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800/80 flex flex-col justify-between p-6 bg-slate-50/50 dark:bg-slate-950/20 overflow-y-auto">
                                {/* Animated avatar */}
                                <div className="flex flex-col items-center justify-center flex-1 py-4">
                                    <NeuralOrb
                                        state={state}
                                        audioLevel={snapshot.audioLevel}
                                    />
                                    <div className="mt-4 text-center">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-300">
                                            {state === 'listening' && 'Listening'}
                                            {state === 'thinking' && 'Thinking'}
                                            {state === 'speaking' && 'Speaking'}
                                            {state === 'idle' && (snapshot.transcript ? 'Heard you' : 'Standby')}
                                            {state === 'muted' && 'Muted'}
                                        </p>
                                    </div>
                                </div>

                                {/* Quick suggestion chips */}
                                {state === 'idle' && !snapshot.response && snapshot.history.length === 0 && (
                                    <div className="w-full py-4 border-t border-slate-200 dark:border-slate-800/60">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
                                            Try asking
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {[
                                                'Read my portfolio',
                                                'How am I doing today?',
                                                'Show me my XIRR',
                                                'Biggest risk?',
                                                'Run Monte Carlo',
                                            ].map(s => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onClick={() => submitTyped(s)}
                                                    className="text-[11px] px-2.5 py-1.5 rounded-full bg-white dark:bg-slate-800/60 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-200 border border-slate-200 dark:border-slate-700/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 shadow-sm"
                                                >
                                                    {s}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Pending confirmation banner */}
                                {snapshot.pendingConfirmation && (
                                    <div className="w-full mb-4 bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/30 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
                                        <div className="flex gap-2.5">
                                            <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                                            <div>
                                                <h4 className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                                                    Jarvis Autonomous Signal
                                                </h4>
                                                <p className="text-[11px] text-indigo-700/90 dark:text-indigo-300/80 mt-1 leading-relaxed">
                                                    Verify and confirm this paper trade execution. Speak &ldquo;Yes&rdquo; or click below to proceed.
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 self-end">
                                            <button
                                                type="button"
                                                onClick={() => submitTyped('yes')}
                                                className="text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer shadow-sm shadow-emerald-600/10"
                                            >
                                                Confirm Trade
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => submitTyped('no')}
                                                className="text-[10px] font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Input bar */}
                                <form onSubmit={handleSubmit} className="w-full border-t border-slate-200 dark:border-slate-800/80 pt-4 bg-transparent">
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={toggleListening}
                                            aria-label={state === 'listening' ? 'Stop listening' : 'Start listening'}
                                            aria-pressed={state === 'listening'}
                                            disabled={!snapshot.isSupported}
                                            className={`relative p-2.5 rounded-xl transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 ${
                                                state === 'listening'
                                                    ? 'bg-rose-500/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20 dark:hover:bg-rose-500/30 border border-rose-500/30 dark:border-rose-500/40 shadow-sm shadow-rose-500/10'
                                                    : 'bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/20 dark:hover:bg-indigo-500/30 border border-indigo-500/30 dark:border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                                            } ${!snapshot.isSupported ? 'opacity-40 cursor-not-allowed' : ''}`}
                                            title={snapshot.isSupported ? 'Toggle microphone' : 'Voice not supported in this browser'}
                                        >
                                            {state === 'listening' ? <MicOff size={16} /> : <Mic size={16} />}
                                            {state === 'listening' && (
                                                <span className="absolute inset-0 rounded-xl bg-rose-500/30 animate-ping pointer-events-none" />
                                            )}
                                        </button>

                                        <div className="flex-1 relative">
                                            <input
                                                ref={inputRef}
                                                type="text"
                                                value={input}
                                                onChange={(e) => setInput(e.target.value)}
                                                onKeyDown={handleKeyDown}
                                                placeholder={
                                                    snapshot.isSupported
                                                        ? state === 'listening'
                                                            ? 'Listening… speak now or type'
                                                            : 'Type a command, or press the mic to speak…'
                                                        : 'Type a command (voice not supported in this browser)'
                                                }
                                                aria-label="Jarvis command input"
                                                autoComplete="off"
                                                className="w-full bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/60 rounded-xl py-2.5 pl-3 pr-9 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:focus:ring-indigo-500/50 focus:border-indigo-500 transition-all shadow-inner"
                                            />
                                            <button
                                                type="submit"
                                                aria-label="Send command"
                                                disabled={!input.trim()}
                                                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-100 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                                            >
                                                <Send size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                                        <span className="inline-flex items-center gap-3">
                                            <span className="inline-flex items-center gap-1">
                                                <ChevronUp size={10} /><ChevronDown size={10} /> history
                                            </span>
                                        </span>
                                        <span>ESC to close</span>
                                    </div>
                                </form>
                            </div>

                            {/* Right Panel: Feed Transcript, Alerts & History */}
                            <div className="col-span-12 md:col-span-7 flex flex-col justify-between overflow-hidden bg-slate-50/30 dark:bg-slate-950/40">
                                <div ref={scrollRef} className="flex-1 p-6 overflow-y-auto space-y-5">
                                    {/* Fallback Welcome Message */}
                                    {snapshot.history.length === 0 && !snapshot.response && !snapshot.transcript && (
                                        <div className="flex flex-col items-center justify-center h-full text-center py-12 px-6">
                                            <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 mb-4 animate-pulse">
                                                <Sparkles size={20} className="text-indigo-600 dark:text-indigo-400" />
                                            </div>
                                            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">AI Financial Command Center</h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
                                                Press the microphone button or type a directive on the left to analyze portfolios, check risks, or execute trade setups.
                                            </p>
                                        </div>
                                    )}

                                    {/* Transcript & Response Area */}
                                    {(snapshot.transcript || snapshot.interimTranscript || snapshot.response || snapshot.lastError) && (
                                        <div className="bg-white/80 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-2xl p-5 space-y-3 shadow-sm">
                                            {(snapshot.transcript || snapshot.interimTranscript) && (
                                                <div className="space-y-1">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Speech input</span>
                                                    <p className="text-sm text-slate-600 dark:text-slate-300 italic">
                                                        &ldquo;{snapshot.transcript}{snapshot.interimTranscript ? ' ' + snapshot.interimTranscript : ''}&rdquo;
                                                    </p>
                                                </div>
                                            )}
                                            {snapshot.response && (
                                                <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800/40">
                                                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Response</span>
                                                    <p className="text-base text-slate-900 dark:text-white font-medium leading-relaxed">
                                                        {snapshot.response}
                                                        {(state === 'speaking') && <span className="inline-block w-1.5 h-4 bg-indigo-500 dark:bg-indigo-400 ml-1 align-middle animate-pulse" />}
                                                    </p>
                                                </div>
                                            )}
                                            {snapshot.lastError && (
                                                <p className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 pt-2 border-t border-slate-100 dark:border-slate-800/40">
                                                    <AlertCircle size={12} /> {snapshot.lastError}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {/* Proactive Alerts inside right column */}
                                    {snapshot.alerts && snapshot.alerts.filter((a: any) => !a.dismissed).length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                                Active Alerts
                                            </p>
                                            <div className="space-y-2">
                                                {snapshot.alerts.filter((a: any) => !a.dismissed).map((alert: any) => (
                                                    <div key={alert.id} className="flex items-start justify-between gap-3 bg-indigo-50 dark:bg-indigo-955/20 border border-indigo-200 dark:border-indigo-500/20 rounded-xl p-3">
                                                        <div className="flex gap-2">
                                                            <AlertCircle size={16} className="text-indigo-600 dark:text-indigo-400 mt-0.5" />
                                                            <p className="text-xs text-slate-700 dark:text-slate-200">{alert.text}</p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => jarvis2Service.dismissAlert(alert.id)}
                                                            className="text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
                                                        >
                                                            Dismiss
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Historical feed list */}
                                    {snapshot.history.length > 0 && (
                                        <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800/40">
                                            <div className="flex items-center gap-1.5">
                                                <History size={11} className="text-slate-400 dark:text-slate-500" />
                                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                                    Session Feed History
                                                </p>
                                            </div>
                                            <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                                                {snapshot.history.map((h: { id?: string; role: string; text: string }, idx: number) => (
                                                    <div
                                                        key={h.id || idx}
                                                        className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                                    >
                                                        <div
                                                            className={`max-w-[85%] text-xs px-3.5 py-2.5 rounded-2xl shadow-sm ${
                                                                h.role === 'user'
                                                                    ? 'bg-indigo-600 text-white rounded-tr-none'
                                                                    : 'bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50 text-slate-800 dark:text-slate-200 rounded-tl-none'
                                                            }`}
                                                        >
                                                            <span className={`block text-[8px] font-black uppercase tracking-widest mb-1 ${h.role === 'user' ? 'text-indigo-100' : 'text-slate-400'}`}>
                                                                {h.role === 'user' ? 'You' : 'Jarvis'}
                                                            </span>
                                                            <p className="leading-relaxed whitespace-pre-wrap">{h.text}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer info label */}
                                <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/20 flex items-center justify-between text-[9px] text-slate-400 dark:text-slate-500 font-mono">
                                    <span>SEBI Compliance Layer: Active</span>
                                    <span>Intelligence Engine V3.0</span>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
            </AnimatePresence>
        </>
    );
};

/**
 * NeuralOrb — a geometric neural pattern that reacts to:
 * - audioLevel (mic amplitude) when state === 'listening'
 * - rotation when state === 'thinking'
 * - waveform animation when state === 'speaking'
 * - idle breathing otherwise
 */
const NeuralOrb: React.FC<{ state: string; audioLevel: number }> = ({ state, audioLevel }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number | null>(null);
    const tRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const SIZE = 240;
        canvas.width = SIZE * window.devicePixelRatio;
        canvas.height = SIZE * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        const draw = () => {
            tRef.current += 0.016;
            const t = tRef.current;
            ctx.clearRect(0, 0, SIZE, SIZE);
            const cx = SIZE / 2;
            const cy = SIZE / 2;

            // Background pulsing ring
            const baseR = 72 + (state === 'listening' ? audioLevel * 32 : Math.sin(t * 1.5) * 3);
            const grad = ctx.createRadialGradient(cx, cy, baseR * 0.4, cx, cy, baseR);
            if (state === 'listening') {
                grad.addColorStop(0, 'rgba(244, 63, 94, 0.6)');
                grad.addColorStop(0.6, 'rgba(244, 63, 94, 0.15)');
                grad.addColorStop(1, 'rgba(244, 63, 94, 0)');
            } else if (state === 'speaking') {
                grad.addColorStop(0, 'rgba(16, 185, 129, 0.6)');
                grad.addColorStop(0.6, 'rgba(16, 185, 129, 0.15)');
                grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
            } else if (state === 'thinking') {
                grad.addColorStop(0, 'rgba(99, 102, 241, 0.7)');
                grad.addColorStop(0.6, 'rgba(99, 102, 241, 0.15)');
                grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
            } else {
                grad.addColorStop(0, 'rgba(99, 102, 241, 0.45)');
                grad.addColorStop(0.6, 'rgba(139, 92, 246, 0.12)');
                grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
            }
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, baseR * 1.4, 0, Math.PI * 2);
            ctx.fill();

            // Rotating geometric layer
            const sides = 6;
            const rot = state === 'thinking' ? t * 1.6 : t * 0.4;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rot);
            ctx.strokeStyle = state === 'speaking' ? 'rgba(16, 185, 129, 0.8)' : 'rgba(99, 102, 241, 0.8)';
            ctx.lineWidth = 1.5;
            for (let i = 0; i < sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                const next = ((i + 1) / sides) * Math.PI * 2;
                const r1 = baseR * (state === 'listening' ? 1 + audioLevel * 0.5 : 1);
                const r2 = baseR * (state === 'listening' ? 1 + audioLevel * 0.3 : 0.95);
                ctx.beginPath();
                ctx.moveTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
                ctx.lineTo(Math.cos(next) * r2, Math.sin(next) * r2);
                ctx.stroke();
            }
            // Inner ring
            ctx.strokeStyle = state === 'speaking' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(139, 92, 246, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(0, 0, baseR * 0.55, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            // Waveform when speaking
            if (state === 'speaking') {
                ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                const N = 64;
                for (let i = 0; i < N; i++) {
                    const x = cx - baseR * 1.1 + (i / N) * (baseR * 2.2);
                    const y = cy + Math.sin(i * 0.5 + t * 8) * 10 * (0.5 + 0.5 * Math.sin(t * 3 + i));
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            rafRef.current = requestAnimationFrame(draw);
        };
        draw();
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [state, audioLevel]);

    return (
        <div className="relative w-64 h-64 flex items-center justify-center">
            <canvas
                ref={canvasRef}
                style={{ width: 240, height: 240 }}
                aria-hidden="true"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className={`w-3.5 h-3.5 rounded-full ${
                    state === 'listening' ? 'bg-rose-400' :
                    state === 'speaking' ? 'bg-emerald-400' :
                    state === 'thinking' ? 'bg-indigo-400' :
                    'bg-slate-500'
                } ${state === 'listening' ? 'animate-pulse' : ''}`} />
            </div>
        </div>
    );
};

export default JarvisCommandCenter;
