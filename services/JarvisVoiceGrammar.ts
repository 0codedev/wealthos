/**
 * Quantum Phase 12 — Voice command grammar.
 *
 * CC35 maps natural-language voice commands to high-level app actions
 * (NAVIGATE, FOCUS_SYMBOL, SET_AXIS, RUN_OPTIMIZER, etc.). The grammar
 * is intentionally simple — a small library of patterns with priority
 * ordering. The component layer in JarvisVoiceConsole uses the matcher
 * to translate speech into a `QuantumAction`.
 */
import type { StrategyKind, ScenarioAxis, QuestBranchId } from '../types/quantum';

export interface QuantumAction {
    kind: 'NAVIGATE' | 'FOCUS_SYMBOL' | 'SET_AXIS' | 'SET_SHOCK' | 'SET_STRATEGY' | 'FOCUS_BRANCH' | 'PING' | 'UNKNOWN';
    payload?: string | number;
    raw: string;
    confidence: number; // 0..1
    spokenReply: string;
}

const NAV_TARGETS: Array<[RegExp, string, string]> = [
    [/show (the )?dashboard/i,            'dashboard',  'Opening the dashboard.'],
    [/open (the )?portfolio/i,            'portfolio',  'Opening the portfolio hub.'],
    [/go to (the )?alpha/i,               'alpha',      'Opening the alpha engine.'],
    [/open (the )?journal/i,              'journal',    'Opening the trading journal.'],
    [/open (the )?backtester/i,           'backtester', 'Opening the strategy lab.'],
    [/go to (the )?signals/i,             'signals',    'Opening the signal intelligence hub.'],
    [/open (the )?jarvis/i,               'jarvis',     'I am right here.'],
    [/open (the )?telegram/i,             'telegram',   'Opening the telegram intel.'],
    [/open (the )?mastery/i,              'mastery',    'Opening the mastery hub.'],
    [/open (the )?news/i,                 'news',       'Opening the news spike dashboard.'],
    [/open (the )?risk (war ?room|desk)/i,'fortress',  'Opening the risk war room.'],
    [/open (the )?resilience/i,           'quantum',    'Opening the resilience core.'],
    [/open (the )?quantum/i,              'quantum',    'Opening the quantum terminal.'],
    [/open (the )?settings/i,             'settings',   'Opening settings.'],
];

const FOCUS_BRANCHES: Array<[RegExp, QuestBranchId, string]> = [
    [/show (me )?the quant path/i,        'QUANT',    'Showing the path of the quant.'],
    [/show (me )?the sentinel path/i,     'SENTINEL', 'Showing the path of the sentinel.'],
    [/show (me )?the scribe path/i,       'SCRIBE',   'Showing the path of the disciplined scribe.'],
];

const AXES: Array<[RegExp, ScenarioAxis, string]> = [
    [/nifty|nifty 50/i, 'NIFTY',  'NIFTY axis selected.'],
    [/vix|volatility/i, 'VIX',    'VIX axis selected.'],
    [/rate|rbi/i,       'RATES',  'Rates axis selected.'],
    [/usd|dollar|rupee/i,'USDINR', 'USD/INR axis selected.'],
    [/crude|oil/i,      'CRUDE',  'Crude oil axis selected.'],
];

const STRATEGIES: Array<[RegExp, StrategyKind, string]> = [
    [/bull call spread/i,           'BULL_CALL_SPREAD', 'Bull call spread selected.'],
    [/bear put spread/i,            'BEAR_PUT_SPREAD',  'Bear put spread selected.'],
    [/iron condor/i,                'IRON_CONDOR',      'Iron condor selected.'],
    [/butterfly/i,                  'BUTTERFLY',        'Butterfly selected.'],
    [/straddle/i,                   'STRADDLE',         'Straddle selected.'],
    [/strangle/i,                   'STRANGLE',         'Strangle selected.'],
    [/long call/i,                  'LONG_CALL',        'Long call selected.'],
    [/long put/i,                   'LONG_PUT',         'Long put selected.'],
    [/calendar/i,                   'CALENDAR',         'Calendar spread selected.'],
    [/ratio spread/i,               'RATIO_SPREAD',     'Ratio spread selected.'],
    [/short call/i,                 'SHORT_CALL',       'Short call selected.'],
    [/short put/i,                  'SHORT_PUT',        'Short put selected.'],
];

const SYMBOL_HINTS: Array<[RegExp, string, string]> = [
    [/nifty/i,                    'NIFTY',     'NIFTY 50 selected.'],
    [/bank ?nifty/i,              'BANKNIFTY', 'BANKNIFTY selected.'],
    [/fin ?nifty/i,               'FINNIFTY',  'FINNIFTY selected.'],
    [/mid ?cap ?nifty|midscp/i,   'MIDCPNIFTY','MIDCPNIFTY selected.'],
    [/reliance/i,                 'RELIANCE',  'RELIANCE selected.'],
    [/tcs/i,                      'TCS',       'TCS selected.'],
    [/infosys|infy/i,             'INFY',      'INFY selected.'],
    [/hdfc ?bank/i,               'HDFCBANK',  'HDFCBANK selected.'],
    [/icici ?bank/i,              'ICICIBANK', 'ICICIBANK selected.'],
    [/sbi/i,                      'SBIN',      'SBIN selected.'],
    [/tata ?motors/i,             'TATAMOTORS','TATAMOTORS selected.'],
    [/itc/i,                      'ITC',       'ITC selected.'],
    [/l&t|larsen/i,               'LT',        'LARSEN & TOUBRO selected.'],
    [/axis ?bank/i,               'AXISBANK',  'AXISBANK selected.'],
    [/maruti/i,                   'MARUTI',    'MARUTI selected.'],
];

const FILLER_WORDS = [
    /^(please |can you |could you |hey |jarvis |ok |okay |just )/i,
    /^(the )/i,
    /[.!?]+$/g,
];

/** Normalize a transcript: lowercase, strip filler, collapse spaces. */
function normalize(s: string): string {
    let out = s.toLowerCase().trim();
    for (const f of FILLER_WORDS) out = out.replace(f, '');
    return out.replace(/\s+/g, ' ').trim();
}

/** Try a list of patterns and return the first match. */
function tryPatterns<T>(patterns: Array<[RegExp, T, string]>, text: string): [T, string, RegExpMatchArray] | null {
    for (const [pattern, value, reply] of patterns) {
        const m = text.match(pattern);
        if (m) return [value, reply, m];
    }
    return null;
}

export function interpretCommand(rawText: string): QuantumAction {
    const text = normalize(rawText);
    if (!text) {
        return { kind: 'UNKNOWN', raw: rawText, confidence: 0, spokenReply: 'I did not catch that.' };
    }

    // 1) Navigation
    const nav = tryPatterns(NAV_TARGETS, text);
    if (nav) return { kind: 'NAVIGATE', payload: nav[0], raw: rawText, confidence: 0.9, spokenReply: nav[1] };

    // 2) Focus branch
    const br = tryPatterns(FOCUS_BRANCHES, text);
    if (br) return { kind: 'FOCUS_BRANCH', payload: br[0], raw: rawText, confidence: 0.9, spokenReply: br[1] };

    // 3) Set axis
    const ax = tryPatterns(AXES, text);
    if (ax) {
        // Detect numeric shock in the same utterance: "nifty minus 2"
        const m = text.match(/(-?\+?\s?\d+(\.\d+)?)\s*(%|percent)/);
        if (m) {
            const v = parseFloat(m[1]!.replace(/\s/g, ''));
            return { kind: 'SET_SHOCK', payload: v, raw: rawText, confidence: 0.85, spokenReply: `Setting ${ax[0]} shock to ${v}%.` };
        }
        return { kind: 'SET_AXIS', payload: ax[0], raw: rawText, confidence: 0.85, spokenReply: ax[1] };
    }

    // 4) Set strategy
    const st = tryPatterns(STRATEGIES, text);
    if (st) return { kind: 'SET_STRATEGY', payload: st[0], raw: rawText, confidence: 0.9, spokenReply: st[1] };

    // 5) Focus symbol
    const sym = tryPatterns(SYMBOL_HINTS, text);
    if (sym) {
        const reply = sym[1].replace(' selected.', ` ${sym[0]} loaded into the quantum terminal.`);
        return { kind: 'FOCUS_SYMBOL', payload: sym[0], raw: rawText, confidence: 0.85, spokenReply: reply };
    }

    // 6) Pings
    if (/^(hey|hi|hello|yo|hola)\b/.test(text)) {
        return { kind: 'PING', raw: rawText, confidence: 0.95, spokenReply: 'Hello. I am listening.' };
    }
    if (/help|what can you do/.test(text)) {
        return {
            kind: 'PING',
            raw: rawText,
            confidence: 0.9,
            spokenReply: 'Try: open quantum, focus NIFTY, iron condor, nifty minus 2, show me the quant path.',
        };
    }
    if (/stop|cancel|silence/.test(text)) {
        return { kind: 'PING', raw: rawText, confidence: 0.9, spokenReply: 'Standing by.' };
    }

    return {
        kind: 'UNKNOWN',
        raw: rawText,
        confidence: 0.1,
        spokenReply: 'I do not have a handler for that. Try: open quantum, focus NIFTY, or iron condor.',
    };
}

/** Speak a string using SpeechSynthesis, with a curated voice pick. */
export function speak(text: string, muted = false): void {
    if (muted) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.05;
        u.pitch = 1.0;
        u.volume = 0.9;
        const voices = synth.getVoices();
        const preferred = voices.find(v => /en[-_]?(IN|GB|US)/i.test(v.lang)) || voices[0];
        if (preferred) u.voice = preferred;
        synth.speak(u);
    } catch {
        /* ignore */
    }
}
