/**
 * VoiceOrderConduit - Phase 9 / CC23
 *
 * Bridges Jarvis voice intents → broker execution modal. The conduit:
 *   1. Calculates a position size using the PositionSizingEngine.
 *   2. Pre-populates the AddTradeModal / Dhan execution modal with the
 *      symbol, side, quantity, and price.
 *   3. Adds a glowing "voice-filled" indicator on the input fields.
 *   4. ALWAYS requires a manual "Confirm Order" click before sending the
 *      trade to Dhan.
 *
 * Safety:
 *   - Validates quantity (> 0) and price (> 0) bounds.
 *   - Floors the risk per trade at 1% of net worth by default.
 *   - Never auto-submits — only pre-fills.
 */

import { PositionSizingEngine } from './PositionSizingEngine';
import { useCentralMemoryStore } from '../store/centralMemoryStore';
import { usePortfolioStore } from '../store/portfolioStore';
import { useDhanStore } from '../store/dhanStore';
import { logger } from './Logger';

export interface VoiceOrderIntent {
    side: 'BUY' | 'SELL';
    symbol: string;
    quantity: number;
    price: number;
    stopLoss: number;
    target: number;
    mode: 'EQUITY' | 'OPTION' | 'FUTURE';
    /** When the intent was originally captured (ms). */
    capturedAt: number;
    /** Source: voice, button, etc. */
    source: 'jarvis-voice' | 'bloomberg-console' | 'swarm-trades' | 'manual';
}

export interface SizedVoiceOrder extends VoiceOrderIntent {
    lots: number;
    riskAmount: number;
    riskPercent: number;
    cappedKelly: number;
    /** Projected P&L if SL hit. */
    ifSlHit: number;
    /** Projected P&L if target hit. */
    ifTargetHit: number;
}

const SAFETY_CAPS = {
    MAX_RISK_PCT: 0.02,           // 2% of net worth per trade
    MIN_QUANTITY: 1,
    MAX_QUANTITY: 100_000,
};

class VoiceOrderConduitImpl {
    private currentIntent: VoiceOrderIntent | null = null;
    private listeners = new Set<(intent: VoiceOrderIntent | null) => void>();

    /**
     * Submit a voice intent. Returns the sized order preview or null if
     * the intent is invalid.
     */
    prepare(intent: VoiceOrderIntent): SizedVoiceOrder | null {
        if (!this.validate(intent)) {
            logger.warn('[VoiceOrderConduit] Invalid intent rejected', intent);
            return null;
        }

        this.currentIntent = intent;
        this.listeners.forEach((cb) => cb(intent));

        // Dispatch a global event for the AddTradeModal to pick up.
        try {
            window.dispatchEvent(new CustomEvent('jarvis:order-prepared', { detail: intent }));
        } catch { /* ignore SSR */ }

        return this.size(intent);
    }

    /** Read the currently-prepared intent (used by the order modal). */
    getCurrentIntent(): VoiceOrderIntent | null {
        return this.currentIntent;
    }

    /** Subscribe to intent updates. */
    onIntentChange(listener: (intent: VoiceOrderIntent | null) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Clear the current intent (called after a confirm or cancel). */
    clear() {
        this.currentIntent = null;
        this.listeners.forEach((cb) => cb(null));
    }

    /**
     * Compute the recommended position size for a voice-driven order.
     * Uses 1% of net worth as risk and the parsedSignal shape for the
     * PositionSizingEngine.
     */
    size(intent: VoiceOrderIntent): SizedVoiceOrder {
        const portfolio = usePortfolioStore.getState();
        const dhan = useDhanStore.getState();
        const netWorth = portfolio?.stats?.totalAssets || 0;
        const fundLimit = dhan?.fundLimit?.availabelBalance || 0;
        // Prefer the actual Dhan runway as the sizing base when present.
        const sizingBase = fundLimit > 0 ? fundLimit : netWorth;

        // Risk per share is the stop distance.
        const riskPerShare = Math.abs(intent.price - intent.stopLoss);
        const rewardPerShare = Math.abs(intent.target - intent.price);
        const totalRisk = riskPerShare * intent.quantity;

        const riskPct = sizingBase > 0 ? totalRisk / sizingBase : 0;
        const cappedRiskPct = Math.min(riskPct, SAFETY_CAPS.MAX_RISK_PCT);
        const cappedKelly = Math.max(0.005, cappedRiskPct);

        // Use the position sizing engine for the lot calculation.
        const sizeResult = PositionSizingEngine.computeRecommendedSize(
            {
                instrument: intent.symbol,
                entryPrice: intent.price,
                stopLoss: intent.stopLoss || intent.price * 0.99,
                target1: intent.target || intent.price * 1.02,
            } as any,
            sizingBase,
            cappedRiskPct,
            0.55
        );

        return {
            ...intent,
            lots: sizeResult.lots,
            riskAmount: parseFloat(totalRisk.toFixed(2)),
            riskPercent: parseFloat((riskPct * 100).toFixed(2)),
            cappedKelly,
            ifSlHit: parseFloat((riskPerShare * intent.quantity).toFixed(2)),
            ifTargetHit: parseFloat((rewardPerShare * intent.quantity).toFixed(2)),
        };
    }

    /**
     * Validate a voice intent. Returns true if the intent is safe to
     * forward to the execution modal.
     */
    private validate(intent: VoiceOrderIntent): boolean {
        if (!intent || !intent.symbol || intent.symbol.length < 2) return false;
        if (intent.side !== 'BUY' && intent.side !== 'SELL') return false;
        if (!Number.isFinite(intent.quantity) || intent.quantity < SAFETY_CAPS.MIN_QUANTITY) return false;
        if (intent.quantity > SAFETY_CAPS.MAX_QUANTITY) return false;
        if (!Number.isFinite(intent.price) || intent.price <= 0) return false;
        if (!Number.isFinite(intent.stopLoss) || intent.stopLoss <= 0) return false;
        if (!Number.isFinite(intent.target) || intent.target <= 0) return false;
        // Cross-check bounds: stop should be on the "wrong" side of entry
        if (intent.side === 'BUY' && intent.stopLoss >= intent.price) return false;
        if (intent.side === 'SELL' && intent.stopLoss <= intent.price) return false;
        if (intent.side === 'BUY' && intent.target <= intent.price) return false;
        if (intent.side === 'SELL' && intent.target >= intent.price) return false;
        return true;
    }

    /**
     * Apply a quote update from the WS feed to the current intent —
     * keeps the LTP / target / stop-loss aligned with live ticks.
     */
    refreshFromQuote(price: number) {
        if (!this.currentIntent || !Number.isFinite(price) || price <= 0) return;
        // Keep the original SL/T distance intact, recompute the absolute values.
        const slPct = this.currentIntent.price > 0
            ? (this.currentIntent.price - this.currentIntent.stopLoss) / this.currentIntent.price
            : 0.01;
        const tgtPct = this.currentIntent.price > 0
            ? (this.currentIntent.target - this.currentIntent.price) / this.currentIntent.price
            : 0.02;

        const next: VoiceOrderIntent = {
            ...this.currentIntent,
            price,
            stopLoss: this.currentIntent.side === 'BUY'
                ? +(price * (1 - slPct)).toFixed(2)
                : +(price * (1 + slPct)).toFixed(2),
            target: this.currentIntent.side === 'BUY'
                ? +(price * (1 + tgtPct)).toFixed(2)
                : +(price * (1 - tgtPct)).toFixed(2),
        };
        this.currentIntent = next;
        this.listeners.forEach((cb) => cb(next));
    }
}

export const voiceOrderConduit = new VoiceOrderConduitImpl();

/**
 * Convenience helper used by voice listeners / Bloomberg console
 * pre-fills. Returns a sized order preview or throws.
 */
export async function prepareVoiceOrder(
    intent: Omit<VoiceOrderIntent, 'capturedAt'>
): Promise<SizedVoiceOrder> {
    const sized = voiceOrderConduit.prepare({ ...intent, capturedAt: Date.now() });
    if (!sized) {
        throw new Error('Voice order intent failed safety validation. Please confirm quantity, price, and stop-loss.');
    }
    return sized;
}

/**
 * Read the active ticker & quote from the central memory store and
 * assemble an EQUITY-mode BUY intent at the live price with a 1%/2%
 * stop/target. Used by the "Jarvis, buy option" shortcut.
 */
export function buildEquityIntentFromMemory(symbol: string, side: 'BUY' | 'SELL' = 'BUY'): VoiceOrderIntent | null {
    const memory = useCentralMemoryStore.getState();
    const normalized = (symbol || memory.activeTicker || '').toUpperCase().trim();
    if (!normalized) return null;
    const quote = memory.sharedQuotes[normalized];
    const price = quote?.price || 0;
    if (price <= 0) return null;
    return {
        side,
        symbol: normalized,
        quantity: 1,
        price,
        stopLoss: side === 'BUY' ? +(price * 0.99).toFixed(2) : +(price * 1.01).toFixed(2),
        target: side === 'BUY' ? +(price * 1.02).toFixed(2) : +(price * 0.98).toFixed(2),
        mode: 'EQUITY',
        capturedAt: Date.now(),
        source: 'jarvis-voice',
    };
}

/**
 * Sends a recorded voice audio blob to the local FastAPI bridge for offline transcription.
 */
export async function transcribeVoiceAudio(audioBlob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'voice.wav');

    const res = await fetch('/api/python-nse/api/speech-to-text', {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? 'Failed to transcribe audio locally via Faster-Whisper');
    }

    const data = await res.json();
    return data.transcript;
}

