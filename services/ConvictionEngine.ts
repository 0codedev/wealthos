import { logger } from './Logger';

export type ConvictionLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'MEGA';

interface SignalEntry {
    symbol: string;
    channelId: string;
    timestamp: number;
}

export class ConvictionEngine {
    private static signals: SignalEntry[] = [];
    private static WINDOW_MS = 10 * 60 * 1000; // 10 minute correlation window

    /**
     * Records a new signal and returns the current conviction level for that asset.
     */
    static processSignal(symbol: string, channelId: string): { level: ConvictionLevel, count: number } {
        const now = Date.now();
        
        // 1. Clean up old signals
        this.signals = this.signals.filter(s => now - s.timestamp < this.WINDOW_MS);

        // 2. Add new signal
        this.signals.push({ symbol, channelId, timestamp: now });

        // 3. Count unique channels for this symbol (fuzzy match)
        const uniqueChannels = new Set(
            this.signals
                .filter(s => this.isSameAsset(s.symbol, symbol))
                .map(s => s.channelId)
        );

        const count = uniqueChannels.size;
        let level: ConvictionLevel = 'LOW';

        if (count >= 4) level = 'MEGA';
        else if (count >= 3) level = 'HIGH';
        else if (count >= 2) level = 'MODERATE';

        if (count > 1) {
            logger.info(`ConvictionEngine: ${symbol} has ${count} matching channels. Level: ${level}`);
        }

        return { level, count };
    }

    /**
     * Fuzzy matching to see if two symbols refer to the same trade idea.
     * e.g., "NIFTY 22500 CE" matches "Nifty 22500 Call"
     */
    private static isSameAsset(sym1: string, sym2: string): boolean {
        const clean = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/CALL/g, 'CE').replace(/PUT/g, 'PE');
        const c1 = clean(sym1);
        const c2 = clean(sym2);
        return c1.includes(c2) || c2.includes(c1);
    }
}
