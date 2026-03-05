/**
 * Jarvis2Service — Voice-First AI Command Center (Jarvis 2.0)
 *
 * Non-disruptive: this is a completely new service that lives alongside
 * the existing `JarvisCommandService` (V1). It is not imported by V1
 * code paths.
 *
 * Capabilities
 * ------------
 *  a) Web Speech API — voice recognition with wake-word ("Hey Jarvis" / "Jarvis")
 *     and 3-second silence auto-stop.
 *  b) Web Speech Synthesis API — TTS with Indian English voice preference
 *     (en-IN) and adjustable rate/pitch/volume.
 *  c) Proactive Alert System — 5-minute interval checks for:
 *       - holding down >5% today
 *       - portfolio milestone crossings (every ₹5L)
 *       - SIP due tomorrow
 *       - market open / close
 *     Each alert can be dismissed by voice ("dismiss" / "okay jarvis").
 *  d) Extended command routing — adds commands from the brief
 *     (read portfolio, how am I doing, show XIRR, add trade, biggest risk,
 *     should I add to Nifty 50, run Monte Carlo, mute / unmute).
 *  e) Session memory — last 5 exchanges kept in memory; prompts Gemini with
 *     this context for follow-up questions.
 *  f) React subscription model — components subscribe to state changes
 *     (listening / speaking / transcript / response / alerts).
 *
 * Browser API dependencies
 * ------------------------
 *  - SpeechRecognition (window.SpeechRecognition || window.webkitSpeechRecognition)
 *      Chromium/Edge: full support
 *      Firefox: NOT supported (gracefully degraded)
 *      Safari: limited (uses webkitSpeechRecognition)
 *  - speechSynthesis
 *      Universal support
 *  - Web Audio API
 *      Universal support
 */

import { logger } from './Logger';
import { jarvisCommandService, JarvisAction } from './JarvisCommandService';
import { SEBI_COMPLIANCE_CORE } from './aiService';
import { askGemini, quickAsk } from './aiService';
import { Investment } from '../types';
import { formatCurrency, formatCurrencyCompact } from '../utils/helpers';
import { useSettingsStore } from '../store/settingsStore';
import { marketSentinel } from './jarvis3/MarketSentinel';
import { jarvisBrain } from './jarvis3/JarvisBrain';
import { actionExecutor } from './jarvis3/ActionExecutor';
import { alphaDecayService } from './AlphaDecayService';


// =====================================================================
// Public Types
// =====================================================================

export type Jarvis2State = 'idle' | 'listening' | 'thinking' | 'speaking' | 'muted';

export interface Jarvis2Alert {
    id: string;
    text: string;
    speakText: string;
    timestamp: number;
    category: 'market' | 'holding' | 'milestone' | 'sip' | 'system';
    dismissed: boolean;
}

export interface Jarvis2Exchange {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    timestamp: number;
}

export interface Jarvis2Options {
    /** Mute the assistant entirely (TTS and proactive alerts). */
    muted?: boolean;
    /** Custom rate for TTS (default 0.9). */
    rate?: number;
    /** Custom pitch for TTS (default 1.0). */
    pitch?: number;
    /** Custom volume for TTS (default 0.95). */
    volume?: number;
    /** Get the live investment list when the alert loop needs it. */
    getInvestments?: () => Investment[];
}

type Subscriber = (snapshot: Jarvis2Snapshot) => void;

export interface Jarvis2Snapshot {
    state: Jarvis2State;
    transcript: string;
    response: string;
    interimTranscript: string;
    alerts: Jarvis2Alert[];
    history: Jarvis2Exchange[];
    lastError: string | null;
    audioLevel: number;
    isOpen: boolean;
    isSupported: boolean;
    isAutonomousActive: boolean;
    autonomousBrief: string | null;
    pendingConfirmation: boolean;
}

// =====================================================================
// Helpers
// =====================================================================

const SESSION_MEMORY_LIMIT = 5;
const PROACTIVE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const WAKE_WORDS = ['jarvis', 'hey jarvis', 'hi jarvis', 'okay jarvis', 'ok jarvis'];
const SILENCE_TIMEOUT_MS = 3000;

const fuzzyContains = (haystack: string, needles: string[]): boolean => {
    const lower = haystack.toLowerCase();
    return needles.some(n => lower.includes(n));
};

// Number-to-words for Indian currency (lightweight, not exhaustive)
const numberToApproxWords = (n: number): string => {
    const abs = Math.abs(n);
    if (abs >= 10000000) return `${(n / 10000000).toFixed(1)} crore`;
    if (abs >= 100000) return `${(n / 100000).toFixed(1)} lakh`;
    if (abs >= 1000) return `${Math.round(n / 1000)} thousand`;
    return Math.round(n).toString();
};

// =====================================================================
// Service
// =====================================================================

class Jarvis2Service {
    // Subscribers --------------------------------------------------------
    private subscribers = new Set<Subscriber>();

    // State -------------------------------------------------------------
    private state: Jarvis2State = 'idle';
    private transcript = '';
    private interimTranscript = '';
    private response = '';
    private lastError: string | null = null;
    private audioLevel = 0;
    private isOpen = false;
    private isMuted = false;

    // Jarvis 3.0 Autonomous Fields
    private isAutonomousActive = false;
    private autonomousBrief: string | null = null;
    private pendingConfirmation = false;
    private unsubscribeSentinel: (() => void) | null = null;

    // Session Memory ----------------------------------------------------
    private history: Jarvis2Exchange[] = [];
    private alerts: Jarvis2Alert[] = [];

    // Browser API refs --------------------------------------------------
    private recognition: any = null;
    private synthesis: SpeechSynthesis | null = null;
    private selectedVoice: SpeechSynthesisVoice | null = null;
    private currentUtterance: SpeechSynthesisUtterance | null = null;

    // Proactive loop ----------------------------------------------------
    private proactiveTimer: number | null = null;
    private lastPortfolioValue = 0;
    private lastMilestone = 0;
    private lastMarketStatus: 'open' | 'closed' | 'pre' | 'unknown' = 'unknown';

    // Configurable options ---------------------------------------------
    private opts: Jarvis2Options = {};
    private getInvestments: () => Investment[] = () => [];

    // Silence detection -------------------------------------------------
    private silenceTimer: number | null = null;
    private hasCapturedCommand = false;

    // Audio analysis for visualizer ------------------------------------
    private audioContext: AudioContext | null = null;
    private audioAnalyser: AnalyserNode | null = null;
    private audioStream: MediaStream | null = null;
    private audioRAF: number | null = null;

    // -------------------------------------------------------------------
    // Construction / configuration
    // -------------------------------------------------------------------
    constructor() {
        if (typeof window !== 'undefined') {
            this.synthesis = window.speechSynthesis || null;
            this.prepareVoices();
            if (this.synthesis) {
                this.synthesis.onvoiceschanged = () => this.prepareVoices();
            }

            // Sync with settings store
            try {
                const state = useSettingsStore.getState();
                this.isMuted = state.jarvisMuted ?? true;
                this.isAutonomousActive = state.jarvisAutonomousMode ?? false;
                this.toggleAutonomousSentinel(this.isAutonomousActive);
                
                useSettingsStore.subscribe((state) => {
                    this.isMuted = state.jarvisMuted ?? true;
                    const nextAuto = state.jarvisAutonomousMode ?? false;
                    if (nextAuto !== this.isAutonomousActive) {
                        this.isAutonomousActive = nextAuto;
                        this.toggleAutonomousSentinel(nextAuto);
                    }
                });
            } catch (e) {
                logger.error('Failed to sync Jarvis with settings store', e);
            }

            // Load alerts from localStorage
            try {
                const stored = localStorage.getItem('jarvis_alerts_history');
                if (stored) {
                    this.alerts = JSON.parse(stored);
                }
            } catch (e) {
                logger.error('Failed to load jarvis alerts', e);
            }
        }
    }

    configure(opts: Jarvis2Options, getInvestments: () => Investment[]) {
        this.opts = opts;
        this.getInvestments = getInvestments;
        if (opts.muted !== undefined) {
            this.isMuted = opts.muted;
        }
    }

    isApiSupported(): boolean {
        if (typeof window === 'undefined') return false;
        return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    }

    // -------------------------------------------------------------------
    // Subscriptions
    // -------------------------------------------------------------------
    subscribe(fn: Subscriber): () => void {
        this.subscribers.add(fn);
        fn(this.snapshot());
        return () => { this.subscribers.delete(fn); };
    }

    snapshot(): Jarvis2Snapshot {
        return {
            state: this.state,
            transcript: this.transcript,
            response: this.response,
            interimTranscript: this.interimTranscript,
            alerts: [...this.alerts],
            history: [...this.history],
            lastError: this.lastError,
            audioLevel: this.audioLevel,
            isOpen: this.isOpen,
            isSupported: this.isApiSupported(),
            isAutonomousActive: this.isAutonomousActive,
            autonomousBrief: this.autonomousBrief,
            pendingConfirmation: this.pendingConfirmation,
        };
    }

    private emit() {
        const snap = this.snapshot();
        this.subscribers.forEach(fn => {
            try { fn(snap); } catch (e) { logger.error('Jarvis2 subscriber threw', e); }
        });
    }

    private setState(next: Jarvis2State) {
        this.state = next;
        this.emit();
    }

    // -------------------------------------------------------------------
    // Command Center visibility
    // -------------------------------------------------------------------
    open() {
        this.isOpen = true;
        this.emit();
    }

    close() {
        this.isOpen = false;
        this.stopListening();
        this.stopSpeaking();
        this.emit();
    }

    toggleOpen() {
        this.isOpen ? this.close() : this.open();
    }

    // -------------------------------------------------------------------
    // Voice recognition
    // -------------------------------------------------------------------
    private prepareVoices() {
        if (!this.synthesis) return;
        const voices = this.synthesis.getVoices();
        if (!voices || voices.length === 0) return;

        // Prefer Indian English female voice; fall back to any en-IN; then any en-GB/en-US.
        const preferred =
            voices.find(v => /en[-_]IN/i.test(v.lang) && /female|zira|swara|veena/i.test(v.name)) ||
            voices.find(v => /en[-_]IN/i.test(v.lang)) ||
            voices.find(v => /en[-_]GB/i.test(v.lang) && /female/i.test(v.name)) ||
            voices.find(v => /en[-_]US/i.test(v.lang) && /female/i.test(v.name)) ||
            voices.find(v => /en/i.test(v.lang));
        this.selectedVoice = preferred || voices[0];
    }

    startListening() {
        if (this.state === 'listening') return;
        if (this.isMuted) {
            this.lastError = 'Jarvis is muted. Say "Jarvis, unmute" to enable.';
            this.emit();
            return;
        }
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) {
            this.lastError = 'Voice recognition is not supported in this browser. Use Chrome or Edge.';
            this.emit();
            return;
        }

        try {
            this.recognition = new SR();
            this.recognition.lang = 'en-IN';
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.maxAlternatives = 1;

            this.recognition.onstart = () => {
                this.transcript = '';
                this.interimTranscript = '';
                this.lastError = null;
                this.hasCapturedCommand = false;
                this.setState('listening');
                this.attachAudioAnalyser();
            };

            this.recognition.onresult = (event: any) => {
                let interim = '';
                let finalText = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) finalText += result[0].transcript;
                    else interim += result[0].transcript;
                }

                this.interimTranscript = interim;
                this.transcript = (this.transcript + ' ' + finalText).trim();

                // Wake-word detection
                if (!this.hasCapturedCommand) {
                    if (WAKE_WORDS.some(w => this.transcript.toLowerCase().includes(w))) {
                        this.hasCapturedCommand = true;
                        // Strip the wake word from the captured text
                        let stripped = this.transcript;
                        for (const w of WAKE_WORDS) {
                            stripped = stripped.replace(new RegExp(w, 'i'), '');
                        }
                        this.transcript = stripped.trim();
                        this.speak('Yes?', { interrupt: true });
                    }
                }

                this.emit();
                this.resetSilenceTimer();
            };

            this.recognition.onerror = (event: any) => {
                this.lastError = `Mic error: ${event.error || 'unknown'}`;
                this.detachAudioAnalyser();
                this.setState('idle');
            };

            this.recognition.onend = () => {
                this.detachAudioAnalyser();
                if (this.state === 'listening') {
                    // Auto-restart for continuous wake-word listening
                    // unless we've already captured a command (in which case we wait for silence)
                    if (!this.hasCapturedCommand) {
                        try { this.recognition.start(); } catch (e) { this.setState('idle'); }
                    } else {
                        this.setState('idle');
                    }
                }
            };

            this.recognition.start();
        } catch (e) {
            logger.error('Jarvis2: failed to start recognition', e);
            this.lastError = 'Could not start voice recognition. Check microphone permissions.';
            this.emit();
        }
    }

    stopListening() {
        this.clearSilenceTimer();
        this.detachAudioAnalyser();
        if (this.recognition) {
            try { this.recognition.stop(); } catch (e) { /* noop */ }
            this.recognition = null;
        }
        if (this.state === 'listening') this.setState('idle');
    }

    private resetSilenceTimer() {
        this.clearSilenceTimer();
        this.silenceTimer = window.setTimeout(() => {
            if (this.hasCapturedCommand && this.transcript.trim().length > 0) {
                const command = this.transcript.trim();
                this.transcript = '';
                this.interimTranscript = '';
                this.stopListening();
                this.handleUserCommand(command);
            }
        }, SILENCE_TIMEOUT_MS);
    }

    private clearSilenceTimer() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }

    // -------------------------------------------------------------------
    // Audio analyser (for visualizer)
    // -------------------------------------------------------------------
    private attachAudioAnalyser() {
        if (this.audioAnalyser) return;
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC || !navigator.mediaDevices?.getUserMedia) return;
        try {
            this.audioContext = new AC();
            navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
                this.audioStream = stream;
                const source = this.audioContext!.createMediaStreamSource(stream);
                this.audioAnalyser = this.audioContext!.createAnalyser();
                this.audioAnalyser.fftSize = 256;
                source.connect(this.audioAnalyser);
                const buf = new Uint8Array(this.audioAnalyser.frequencyBinCount);
                const tick = () => {
                    if (!this.audioAnalyser) return;
                    this.audioAnalyser.getByteFrequencyData(buf);
                    let sum = 0;
                    for (let i = 0; i < buf.length; i++) sum += buf[i];
                    this.audioLevel = sum / (buf.length * 255);
                    this.emit();
                    this.audioRAF = requestAnimationFrame(tick);
                };
                tick();
            }).catch(() => { /* permission denied — visualizer stays at 0 */ });
        } catch (e) { /* noop */ }
    }

    private detachAudioAnalyser() {
        if (this.audioRAF) cancelAnimationFrame(this.audioRAF);
        this.audioRAF = null;
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(t => t.stop());
            this.audioStream = null;
        }
        if (this.audioContext) {
            try { this.audioContext.close(); } catch (e) { /* noop */ }
            this.audioContext = null;
        }
        this.audioAnalyser = null;
        this.audioLevel = 0;
    }

    // -------------------------------------------------------------------
    // Text-to-Speech
    // -------------------------------------------------------------------
    speak(text: string, opts: { interrupt?: boolean } = { interrupt: true }) {
        if (this.isMuted) {
            // still surface visually
            this.response = text;
            this.emit();
            return;
        }
        if (!this.synthesis) {
            this.response = text;
            this.emit();
            return;
        }
        if (opts.interrupt !== false) this.stopSpeaking();

        if (!this.selectedVoice) this.prepareVoices();

        const utter = new SpeechSynthesisUtterance(text);
        if (this.selectedVoice) utter.voice = this.selectedVoice;
        utter.rate = this.opts.rate ?? 0.9;
        utter.pitch = this.opts.pitch ?? 1.0;
        utter.volume = this.opts.volume ?? 0.95;
        utter.lang = 'en-IN';

        utter.onstart = () => this.setState('speaking');
        utter.onend = () => {
            this.currentUtterance = null;
            if (this.state === 'speaking') this.setState('idle');
        };
        utter.onerror = () => {
            this.currentUtterance = null;
            if (this.state === 'speaking') this.setState('idle');
        };

        this.response = text;
        this.currentUtterance = utter;
        try { this.synthesis.speak(utter); } catch (e) { logger.error('Jarvis2: speak failed', e); }
        this.emit();
    }

    stopSpeaking() {
        if (this.synthesis) {
            try { this.synthesis.cancel(); } catch (e) { /* noop */ }
        }
        this.currentUtterance = null;
        if (this.state === 'speaking') this.setState('idle');
    }

    /**
     * Interrupt speech when the user starts speaking.
     */
    interruptForUser() {
        this.stopSpeaking();
        this.startListening();
    }

    // -------------------------------------------------------------------
    // Command routing
    // -------------------------------------------------------------------
    async handleUserCommand(raw: string) {
        const text = raw.trim();
        if (!text) return;

        // Confirming autonomous trade recommendation
        if (this.pendingConfirmation && /^(yes|confirm|execute|approve|go ahead|do it)$/i.test(text)) {
            this.pendingConfirmation = false;
            this.speak('Confirming. Executing paper trade now...');
            if (this.autonomousBrief) {
                actionExecutor.executePaperTrade(this.autonomousBrief).then((tradeId) => {
                    if (tradeId) {
                        this.speak('Paper trade executed successfully and logged to your journal.');
                    } else {
                        this.speak('I was unable to place that trade. Please review manually.');
                    }
                    this.emit();
                });
            }
            this.emit();
            return;
        }

        if (this.pendingConfirmation && /^(no|cancel|reject|don't do it|stop)$/i.test(text)) {
            this.pendingConfirmation = false;
            this.speak('Order cancelled.');
            this.emit();
            return;
        }

        // 1. Dismiss / mute / unmute / help short-circuits
        if (/^(dismiss|ok(ay)? jarvis|got it)$/i.test(text)) {
            this.dismissLatestAlert();
            this.speak('Dismissed.');
            this.addExchange('user', text);
            this.addExchange('assistant', 'Dismissed.');
            return;
        }
        if (/^(jarvis,?\s*)?(unmute|enable voice)$/i.test(text)) {
            this.isMuted = false;
            this.speak('Voice enabled.');
            return;
        }
        if (/^(jarvis,?\s*)?(mute|disable voice)$/i.test(text)) {
            this.isMuted = true;
            this.stopSpeaking();
            this.speak('Muted. Say Jarvis unmute when you need me.');
            return;
        }
        if (/^help$|what can you do|commands/i.test(text)) {
            const help = 'I can read your portfolio, switch profiles, navigate the app, add trades, run a Monte Carlo, and answer questions about your money. Try "Jarvis, read my portfolio" or "Jarvis, what is my biggest risk".';
            this.speak(help);
            this.addExchange('user', text);
            this.addExchange('assistant', help);
            return;
        }

        this.addExchange('user', text);
        this.setState('thinking');

        // 2. V1 routing (navigation, profile switch, simple actions)
        let action: JarvisAction;
        try {
            const v1 = jarvisCommandService as unknown as { processCommandAI?: (text: string) => Promise<JarvisAction> };
            action = v1.processCommandAI ? await v1.processCommandAI(text) : jarvisCommandService.processCommand(text);
        } catch (e) { action = { type: 'NONE', response: 'I had trouble processing that.' }; }

        // 3. V2 specific intents (extended)
        const lower = text.toLowerCase();
        if (fuzzyContains(lower, ['read my portfolio', 'portfolio status', 'read portfolio'])) {
            await this.speakPortfolioStatus();
            return;
        }
        if (fuzzyContains(lower, ['how am i doing', 'how am i doing today', 'how is it going'])) {
            this.speakTodaysPnL();
            return;
        }
        if (fuzzyContains(lower, ['show me my xirr', 'what is my xirr', 'xirr please'])) {
            this.speakXIRR();
            return;
        }
        if (fuzzyContains(lower, ['add a trade', 'bought', 'sold', 'add trade', 'prepare order', 'place order', 'buy order', 'sell order'])) {
            const parsed = this.parseTradeCommand(text);
            if (parsed) {
                this.dispatchEvent('jarvis2:prefill-trade', parsed);
                this.speak(`Opening the trade form. ${parsed.side} ${parsed.quantity} shares of ${parsed.symbol} at ₹${parsed.price}.`);
            } else {
                this.speak('I could not parse that trade. Please say the quantity, symbol, and price clearly.');
            }
            return;
        }

        // CC23 — V1 trading intents (PREPARE_ORDER, CLOSE_POSITION) handled
        // by the V1 service. Forward them through the order conduit and open
        // the AddTradeModal pre-populated.
        const actionType = (action as { type?: string }).type;
        const actionWithExtras = action as JarvisAction & { orderIntent?: any };
        if (actionType === 'PREPARE_ORDER' && actionWithExtras.orderIntent) {
            const intent = actionWithExtras.orderIntent;
            try {
                const { voiceOrderConduit, prepareVoiceOrder } = await import('./VoiceOrderConduit');
                const sized = await prepareVoiceOrder({
                    side: intent.side,
                    symbol: intent.symbol,
                    quantity: intent.quantity,
                    price: intent.price,
                    stopLoss: intent.stopLoss,
                    target: intent.target,
                    mode: intent.mode,
                    source: 'jarvis-voice',
                });
                this.dispatchEvent('jarvis2:prefill-trade', {
                    symbol: sized.symbol,
                    quantity: sized.quantity,
                    price: sized.price,
                    side: sized.side,
                });
                this.speak(action.response || `Order prepared. Confirm to execute.`);
            } catch (err) {
                this.speak('Order intent failed safety validation. Please double-check the inputs.');
            }
            this.setState('idle');
            return;
        }
        if (actionType === 'CLOSE_POSITION' && action.payload) {
            this.dispatchEvent('jarvis2:prefill-trade', {
                symbol: action.payload,
                side: 'SELL',
                quantity: 0,
                price: 0,
            });
            this.speak(action.response || `Preparing close for ${action.payload}.`);
            this.setState('idle');
            return;
        }
        if (fuzzyContains(lower, ['biggest risk', 'my biggest risk', 'largest risk', 'top risk'])) {
            await this.speakBiggestRisk();
            return;
        }
        if (fuzzyContains(lower, ['should i add', 'add more to', 'should i buy more', 'is it a good time to buy'])) {
            await this.speakAIAnalysis(text);
            return;
        }
        if (fuzzyContains(lower, ['run monte carlo', 'monte carlo', 'simulation', 'simulate'])) {
            await this.speakMonteCarlo();
            return;
        }
        if (fuzzyContains(lower, ['mute', 'unmute', 'silence'])) {
            // handled above; ignore fallback
        }

        // 4. Fallback: V1 action or Gemini free-form answer
        if (action.type !== 'NONE') {
            this.dispatchEvent('jarvis2:execute-action', action);
            this.speak(action.response || 'Done.');
            this.addExchange('assistant', action.response || 'Done.');
            this.setState('idle');
            return;
        }

        // 5. Generic Gemini response with session context
        await this.speakAIAnalysis(text);
    }

    // -------------------------------------------------------------------
    // Specific speech responses
    // -------------------------------------------------------------------
    private speakPortfolioStatus() {
        const investments = this.getInvestments();
        if (!investments || investments.length === 0) {
            this.speak('Your portfolio is currently empty. Try adding your first investment.');
            this.setState('idle');
            return;
        }
        const total = investments.reduce((s, i) => s + (i.currentValue || 0), 0);
        const invested = investments.reduce((s, i) => s + (i.investedAmount || 0), 0);
        const pnl = total - invested;
        const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

        const sorted = [...investments].sort(
            (a, b) => (b.currentValue - b.investedAmount) - (a.currentValue - a.investedAmount)
        );
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];

        const lines: string[] = [];
        lines.push(`Your portfolio is worth ${numberToApproxWords(total)} rupees, ${pnl >= 0 ? 'up' : 'down'} ${numberToApproxWords(Math.abs(pnl))} or ${pnlPct.toFixed(1)} percent overall.`);
        if (best) {
            const bAbs = (best.currentValue - best.investedAmount);
            lines.push(`Your top performer is ${best.name}, contributing ${numberToApproxWords(Math.abs(bAbs))} ${bAbs >= 0 ? 'in gains' : 'in losses'}.`);
        }
        if (worst && worst !== best) {
            const wAbs = (worst.currentValue - worst.investedAmount);
            lines.push(`Your weakest position is ${worst.name}, at ${numberToApproxWords(Math.abs(wAbs))} ${wAbs >= 0 ? 'in gains' : 'in losses'}.`);
        }
        const text = lines.join(' ');
        this.speak(text);
        this.addExchange('assistant', text);
        this.setState('idle');
    }

    private speakTodaysPnL() {
        const investments = this.getInvestments();
        if (!investments || investments.length === 0) {
            this.speak('No positions to report on today.');
            this.setState('idle');
            return;
        }
        // Use unrealizedPnL when available; otherwise fallback to totalPnL approximation
        const todayPnL = investments.reduce((s, i) => s + (i.unrealizedPnL || 0), 0);
        const text = todayPnL >= 0
            ? `You are up ${numberToApproxWords(todayPnL)} rupees today. Stay the course, and do not let a good day make you overconfident.`
            : `You are down ${numberToApproxWords(Math.abs(todayPnL))} rupees today. Breathe. Review only after the close.`;
        this.speak(text);
        this.addExchange('assistant', text);
        this.setState('idle');
    }

    private speakXIRR() {
        this.dispatchEvent('jarvis2:execute-action', {
            type: 'NAVIGATE',
            payload: 'portfolio',
            response: 'Opening your portfolio analytics.'
        });
        this.speak('Opening your XIRR panel. The figure is computed from the exact dates and sizes of every cash flow, so it is the most accurate return metric available to you.');
        this.addExchange('assistant', 'Opening XIRR panel.');
        this.setState('idle');
    }

    /**
     * Parse a spoken trade like "bought 10 shares of INFY at 1450"
     * or "sold 5 reliance at 2450".
     */
    parseTradeCommand(text: string): { side: 'BUY' | 'SELL'; symbol: string; quantity: number; price: number } | null {
        const side = /\bbought|buy\b/i.test(text) ? 'BUY' : /\bsold|sell\b/i.test(text) ? 'SELL' : null;
        if (!side) return null;

        const qtyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:shares?|qty|quantity|units?)/i);
        const priceMatch = text.match(/(?:at|@|for)\s*(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i);
        const symbolMatch = text.match(/(?:of|in)\s+([A-Za-z][A-Za-z0-9&\-\.]{1,15})/i);
        if (!qtyMatch || !priceMatch || !symbolMatch) return null;
        return {
            side,
            symbol: symbolMatch[1].toUpperCase(),
            quantity: parseFloat(qtyMatch[1]),
            price: parseFloat(priceMatch[1]),
        };
    }

    private async speakBiggestRisk() {
        const investments = this.getInvestments();
        if (!investments || investments.length === 0) {
            this.speak('Your portfolio is empty. There is no risk to discuss.');
            this.setState('idle');
            return;
        }
        // Top concentration by current value
        const total = investments.reduce((s, i) => s + (i.currentValue || 0), 0);
        const sorted = [...investments].sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
        const top = sorted[0];
        const topPct = total > 0 ? ((top.currentValue || 0) / total) * 100 : 0;

        // Drawdown candidates: holdings with biggest unrealized loss
        const losers = [...investments]
            .filter(i => (i.unrealizedPnL || 0) < 0)
            .sort((a, b) => (a.unrealizedPnL || 0) - (b.unrealizedPnL || 0));
        const biggestLoser = losers[0];

        let text = `Your largest concentration is ${top.name} at ${topPct.toFixed(1)} percent of your portfolio.`;
        if (topPct > 25) text += ` That is above the 25 percent prudent cap. Consider rebalancing.`;
        if (biggestLoser) {
            text += ` Your deepest unrealized loss is in ${biggestLoser.name}, down ${numberToApproxWords(Math.abs(biggestLoser.unrealizedPnL || 0))} rupees.`;
        }
        this.speak(text);
        this.addExchange('assistant', text);
        this.setState('idle');
    }

    private async speakAIAnalysis(query: string) {
        try {
            const contextSnippet = this.buildContextSnippet();
            const memorySnippet = this.buildMemorySnippet();

            const prompt = `${SEBI_COMPLIANCE_CORE}

${contextSnippet}

${memorySnippet}

USER: ${query}

Respond in 2-3 spoken sentences. Avoid markdown, bullet points, or numerical tables. Use Indian English. Always end with a SEBI disclaimer if advice-like.`;

            const text = await quickAsk(prompt);
            const clean = (text || 'I could not reach the AI engine.').replace(/[*#`_]/g, '').trim();
            this.speak(clean);
            this.addExchange('assistant', clean);
        } catch (e) {
            this.speak('The AI engine is currently unavailable. Please try again in a moment.');
            this.addExchange('assistant', 'AI engine unavailable.');
        } finally {
            this.setState('idle');
        }
    }

    private async speakMonteCarlo() {
        this.speak('Running a Monte Carlo projection. This usually takes ten to twenty seconds.');
        this.dispatchEvent('jarvis2:execute-action', {
            type: 'NAVIGATE',
            payload: 'planning',
            response: 'Running Monte Carlo simulation.'
        });
        try {
            const inv = this.getInvestments();
            const total = inv.reduce((s, i) => s + (i.currentValue || 0), 0);
            const invested = inv.reduce((s, i) => s + (i.investedAmount || 0), 0);
            const prompt = `${SEBI_COMPLIANCE_CORE}
Given a current portfolio of ${formatCurrencyCompact(total)} on an invested base of ${formatCurrencyCompact(invested)},
estimate the median (P50) portfolio value 10 years from now assuming a 12 percent annualised return
with a 18 percent annualised volatility. Reply in one short spoken sentence.`;
            const text = await quickAsk(prompt);
            const clean = (text || 'Simulation complete. Open the planning tab for the full projection.').replace(/[*#`_]/g, '').trim();
            this.speak(clean);
            this.addExchange('assistant', clean);
        } catch (e) {
            this.speak('Simulation service is offline. Please try again shortly.');
        } finally {
            this.setState('idle');
        }
    }

    private buildContextSnippet(): string {
        const inv = this.getInvestments();
        const total = inv.reduce((s, i) => s + (i.currentValue || 0), 0);
        const invested = inv.reduce((s, i) => s + (i.investedAmount || 0), 0);
        const top3 = [...inv]
            .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0))
            .slice(0, 3)
            .map(i => `${i.name}: ${formatCurrencyCompact(i.currentValue || 0)}`)
            .join('; ');
        return `PORTFOLIO CONTEXT: total ${formatCurrencyCompact(total)}, invested ${formatCurrencyCompact(invested)}, top 3: ${top3 || 'n/a'}.`;
    }

    private buildMemorySnippet(): string {
        if (this.history.length === 0) return 'NO PRIOR CONVERSATION.';
        const last = this.history.slice(-SESSION_MEMORY_LIMIT);
        return 'RECENT EXCHANGE:\n' + last.map(e => `${e.role === 'user' ? 'User' : 'Jarvis'}: ${e.text}`).join('\n');
    }

    private addExchange(role: 'user' | 'assistant', text: string) {
        this.history.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role,
            text,
            timestamp: Date.now(),
        });
        if (this.history.length > SESSION_MEMORY_LIMIT * 2) {
            this.history = this.history.slice(-SESSION_MEMORY_LIMIT * 2);
        }
        this.emit();
    }

    // -------------------------------------------------------------------
    // Proactive alerts
    // -------------------------------------------------------------------
    startProactiveLoop(intervalMs: number = PROACTIVE_INTERVAL_MS) {
        this.stopProactiveLoop();
        // Run once immediately, then on interval
        this.tickProactive();
        this.proactiveTimer = window.setInterval(() => this.tickProactive(), intervalMs);
    }

    stopProactiveLoop() {
        if (this.proactiveTimer) {
            clearInterval(this.proactiveTimer);
            this.proactiveTimer = null;
        }
    }

    private tickProactive() {
        if (this.isMuted) return;

        // Check once a day only (prevent speaking on every reload / frequent runs)
        if (typeof window !== 'undefined') {
            const todayStr = new Date().toDateString();
            const lastCheck = localStorage.getItem('jarvis_last_proactive_check_date');
            if (lastCheck === todayStr) {
                return; // Already checked today
            }
            localStorage.setItem('jarvis_last_proactive_check_date', todayStr);
        }

        const inv = this.getInvestments();
        if (!inv) return;

        // a) Holding down > 15% today (approximation via unrealizedPnL drift)
        for (const i of inv) {
            const todayDriftPct = i.investedAmount > 0
                ? ((i.unrealizedPnL || 0) / i.investedAmount) * 100
                : 0;
            if (todayDriftPct < -15) {
                this.pushAlert({
                    text: `${i.name} is down ${Math.abs(todayDriftPct).toFixed(1)}% today.`,
                    speakText: `Alert: ${i.name} is down ${Math.abs(todayDriftPct).toFixed(1)} percent today. Do you want to review your position?`,
                    category: 'holding',
                });
            }
        }

        // b) Portfolio milestone (every ₹5L)
        const total = inv.reduce((s, i) => s + (i.currentValue || 0), 0);
        if (this.lastPortfolioValue > 0 && total > 0) {
            const prevMilestone = Math.floor(this.lastPortfolioValue / 500000) * 500000;
            const newMilestone = Math.floor(total / 500000) * 500000;
            if (newMilestone > prevMilestone && newMilestone !== this.lastMilestone) {
                this.lastMilestone = newMilestone;
                this.pushAlert({
                    text: `Portfolio crossed ₹${(newMilestone / 100000).toFixed(0)}L.`,
                    speakText: `Your portfolio has crossed ${numberToApproxWords(newMilestone)} rupees. Congratulations.`,
                    category: 'milestone',
                });
            }
        }
        this.lastPortfolioValue = total;

        // c) SIP due tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowDay = tomorrow.getDate();
        for (const i of inv) {
            if (i.recurring && i.recurring.sipDay === tomorrowDay && i.recurring.amount > 0) {
                this.pushAlert({
                    text: `SIP of ${formatCurrencyCompact(i.recurring.amount)} due for ${i.name} tomorrow.`,
                    speakText: `You have a SIP of ${numberToApproxWords(i.recurring.amount)} rupees due for ${i.name} tomorrow.`,
                    category: 'sip',
                });
            }
        }

        // d) Market open/close transition
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        let status: 'open' | 'closed' | 'pre' | 'unknown' = 'unknown';
        if (minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30) status = 'open';
        else if (minutes < 9 * 60 + 15 && minutes >= 9 * 60) status = 'pre';
        else status = 'closed';

        if (this.lastMarketStatus !== 'unknown' && status !== this.lastMarketStatus) {
            if (status === 'open') {
                const todayPnL = inv.reduce((s, i) => s + (i.unrealizedPnL || 0), 0);
                this.pushAlert({
                    text: `Market opened. P&L: ${formatCurrencyCompact(todayPnL)}.`,
                    speakText: `Market has opened. Your portfolio is ${todayPnL >= 0 ? 'up' : 'down'} ${numberToApproxWords(Math.abs(todayPnL))} rupees so far today.`,
                    category: 'market',
                });
            } else if (status === 'closed' && this.lastMarketStatus === 'open') {
                this.pushAlert({
                    text: 'Market has closed for the day.',
                    speakText: 'Market has closed. Review your day when you are ready.',
                    category: 'market',
                });
            }
        }
        this.lastMarketStatus = status;

        // e) Check Alpha Decay
        void alphaDecayService.getDecayReport().then((decay) => {
            if (decay.hasDecay) {
                this.pushAlert({
                    text: 'Alpha decay detected in trading edge!',
                    speakText: 'Warning: I have detected statistical win-rate degradation in your trading journal. Please review the Alpha Decay tab and consider reducing position sizes.',
                    category: 'system',
                });
            }
        });
    }

    private pushAlert(alert: { text: string; speakText: string; category: Jarvis2Alert['category'] }) {
        // dedupe: same text within the last 5 minutes is ignored
        const FIVE_MIN = 5 * 60 * 1000;
        if (this.alerts.some(a => a.text === alert.text && Date.now() - a.timestamp < FIVE_MIN)) {
            return;
        }
        const a: Jarvis2Alert = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text: alert.text,
            speakText: alert.speakText,
            category: alert.category,
            timestamp: Date.now(),
            dismissed: false,
        };
        this.alerts = [a, ...this.alerts].slice(0, 10);
        this.speak(a.speakText);
        this.emit();

        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem('jarvis_alerts_history', JSON.stringify(this.alerts));
            } catch (e) {
                // ignore
            }
        }
    }

    dismissAlert(id: string) {
        this.alerts = this.alerts.map(a => a.id === id ? { ...a, dismissed: true } : a);
        this.emit();

        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem('jarvis_alerts_history', JSON.stringify(this.alerts));
            } catch (e) {
                // ignore
            }
        }
    }

    dismissLatestAlert() {
        const next = this.alerts.find(a => !a.dismissed);
        if (next) this.dismissAlert(next.id);
    }

    clearDismissed() {
        this.alerts = this.alerts.filter(a => !a.dismissed);
        this.emit();

        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem('jarvis_alerts_history', JSON.stringify(this.alerts));
            } catch (e) {
                // ignore
            }
        }
    }

    // -------------------------------------------------------------------
    // Voice-input keyboard path
    // -------------------------------------------------------------------
    submitTyped(text: string) {
        if (!text.trim()) return;
        this.transcript = text;
        this.interimTranscript = '';
        this.emit();
        this.handleUserCommand(text);
    }

    // -------------------------------------------------------------------
    // Event dispatching (cross-component wiring)
    // -------------------------------------------------------------------
    private dispatchEvent(type: string, detail: any) {
        if (typeof window === 'undefined') return;
        try {
            window.dispatchEvent(new CustomEvent(type, { detail }));
        } catch (e) { /* noop */ }
    }

    // -------------------------------------------------------------------
    // Jarvis 3.0 Sentinel Connection
    // -------------------------------------------------------------------
    private toggleAutonomousSentinel(active: boolean) {
        if (active) {
            marketSentinel.start();
            if (!this.unsubscribeSentinel) {
                this.unsubscribeSentinel = marketSentinel.subscribe((telemetry) => {
                    this.handleSentinelTick(telemetry);
                });
            }
        } else {
            marketSentinel.stop();
            if (this.unsubscribeSentinel) {
                this.unsubscribeSentinel();
                this.unsubscribeSentinel = null;
            }
        }
    }

    private async handleSentinelTick(telemetry: any) {
        if (this.isMuted) return;

        const brief = await jarvisBrain.generateBrief(telemetry);
        if (brief) {
            this.autonomousBrief = brief;
            
            // Check if brief contains a trade advice
            const hasTradeSuggestion = /buy|sell|long|short/i.test(brief);
            this.pendingConfirmation = hasTradeSuggestion;
            
            this.speak(brief);
            this.addSentinelAlert(brief, telemetry.confluenceScore);
            this.emit();
        }
    }

    private addSentinelAlert(briefText: string, score: number) {
        const alert: Jarvis2Alert = {
            id: `sentinel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text: briefText,
            speakText: briefText,
            timestamp: Date.now(),
            category: 'market',
            dismissed: false
        };
        this.alerts = [alert, ...this.alerts].slice(0, 100);
        this.emit();
        
        try {
            localStorage.setItem('jarvis_alerts_history', JSON.stringify(this.alerts));
        } catch (e) {
            // ignore
        }
    }
}

export const jarvis2Service = new Jarvis2Service();
export type { Jarvis2Service };
