// Test comment
import { logger } from './Logger';

interface ScripMap {
    [key: string]: string; // "CRUDEOIL24MAY8700CE" -> "12345"
}

export const DhanScripResolver = {
    _scripMap: {} as ScripMap,
    _isLoaded: false,

    async initialize() {
        if (this._isLoaded) return;
        
        try {
            logger.info('DhanScripResolver: Downloading Scrip Master...');
            // Fetch the daily CSV
            const response = await fetch('https://images.dhan.co/api-data/api-scrip-master.csv');
            const text = await response.text();
            
            const lines = text.split('\n');
            const headers = lines[0].split(',');
            
            // Find column indices
            const securityIdIdx = headers.indexOf('SEM_SMST_SECURITY_ID');
            const tradingSymbolIdx = headers.indexOf('SEM_TRADING_SYMBOL');
            const customSymbolIdx = headers.indexOf('SEM_CUSTOM_SYMBOL');
            
            if (securityIdIdx === -1 || tradingSymbolIdx === -1) {
                logger.error('DhanScripResolver: CSV format changed, could not find columns');
                return;
            }

            // Build dictionary
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length > securityIdIdx) {
                    const secId = cols[securityIdIdx];
                    const tradSym = cols[tradingSymbolIdx];
                    const custSym = cols[customSymbolIdx];
                    
                    if (tradSym && secId) {
                        this._scripMap[tradSym.trim().toUpperCase()] = secId;
                    }
                    if (custSym && secId) {
                        this._scripMap[custSym.trim().toUpperCase()] = secId;
                    }
                }
            }

            this._isLoaded = true;
            logger.info(`DhanScripResolver: Loaded ${Object.keys(this._scripMap).length} scrips.`);
        } catch (error) {
            logger.error('DhanScripResolver: Failed to download scrip master', error);
        }
    },

    /**
     * Resolves a human-readable trading symbol to a Dhan Security ID.
     * Uses fuzzy matching if exact match fails.
     */
    resolveSecurityId(symbol: string): string | null {
        if (!this._isLoaded) {
            logger.warn('DhanScripResolver: Not initialized yet');
            return null;
        }

        const cleanSymbol = symbol.trim().toUpperCase().replace(/\s+/g, '');
        
        // 1. Try Exact Match on keys (ignoring spaces)
        for (const [key, id] of Object.entries(this._scripMap)) {
            if (key.replace(/\s+/g, '') === cleanSymbol) {
                return id;
            }
        }

        // 2. Try Partial/Fuzzy Match (e.g., matching "CRUDEOIL" and "8700" and "CE")
        const parts = symbol.trim().toUpperCase().split(' ');
        for (const [key, id] of Object.entries(this._scripMap)) {
            // Very basic heuristic: if all parts of the requested symbol are in the CSV key
            const isMatch = parts.every(part => key.includes(part));
            if (isMatch) {
                return id;
            }
        }

        return null;
    }
};
