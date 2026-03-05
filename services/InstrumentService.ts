import Papa from 'papaparse';
import { db, DhanInstrument } from '../database';
import { logger } from './Logger';

class InstrumentService {
    // We proxy https://images.dhan.co/api-data/ to /data/dhan/api-data/
    private readonly CSV_URL = '/data/dhan/api-data/api-scrip-master.csv';
    private isSyncing = false;
    private listeners: ((isSyncing: boolean, status?: string) => void)[] = [];

    subscribe(listener: (isSyncing: boolean, status?: string) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify(isSyncing: boolean, status?: string) {
        this.isSyncing = isSyncing;
        this.listeners.forEach(l => l(isSyncing, status));
    }

    /**
     * Initializes the instrument database.
     * If empty, it downloads and parses the Dhan Instrument Master CSV.
     */
    async initialize(forceSync: boolean = false): Promise<void> {
        if (this.isSyncing) return;

        try {
            this.notify(true, 'Connecting...');
            const count = await db.instruments.count();

            if (count > 0 && !forceSync) {
                logger.debug(`InstrumentService: DB already populated with ${count} instruments. Skipping sync.`);
                this.notify(false);
                return;
            }

            logger.info('InstrumentService: Downloading Dhan Instrument Master CSV...');
            this.notify(true, 'Downloading data...');

            const response = await fetch(this.CSV_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch CSV: ${response.status} ${response.statusText}`);
            }

            const csvText = await response.text();
            logger.info(`InstrumentService: Download complete. Parsing ${csvText.length} bytes...`);
            this.notify(true, 'Parsing instruments...');

            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                complete: async (results) => {
                    try {
                        const parsedData = results.data as any[];
                        logger.info(`InstrumentService: Parsed ${parsedData.length} rows. Preparing bulk insert...`);

                        const instruments: DhanInstrument[] = [];
                        const BATCH_SIZE = 5000;

                        for (const row of parsedData) {
                            try {
                                const secId = row['SEM_SMST_SECURITY_ID'];
                                const symbol = row['SEM_TRADING_SYMBOL'];
                                const name = row['SEM_CUSTOM_SYMBOL'];
                                const exchange = row['SEM_EXM_EXCH_ID'];
                                const series = row['SEM_SERIES']; // e.g., EQ

                                // Flexible exchange matching to handle Dhan CSV variations
                                const isEquityOrIndex = exchange && (
                                    exchange.includes('NSE') || 
                                    exchange.includes('BSE') || 
                                    exchange.includes('IDX')
                                );

                                if (isEquityOrIndex) {
                                    // Check if it's an equity series or an index
                                    const isEquitySeries = series === 'EQ' || series === 'BE' || !series;
                                    const isIndex = exchange.includes('IDX');

                                    if (isEquitySeries || isIndex) {
                                        if (secId && symbol && name) {
                                            instruments.push({
                                                securityId: secId.toString().trim(),
                                                symbol: symbol.toString().trim(),
                                                name: name.toString().trim(),
                                                exchangeSegment: exchange.toString().trim()
                                            });
                                        }
                                    }
                                }

                            } catch (e) {
                                // Suppress individual row errors so the whole parse doesn't fail
                            }
                        }

                        if (instruments.length > 0) {
                            if (forceSync) {
                                try {
                                    await db.instruments.clear();
                                } catch (clearErr) {
                                    logger.error('InstrumentService: Failed to clear old instruments table.', clearErr);
                                }
                            }

                            // Bulk put in chunks securely
                            let successCount = 0;
                            this.notify(true, 'Indexing database...');
                            for (let i = 0; i < instruments.length; i += BATCH_SIZE) {
                                try {
                                    const chunk = instruments.slice(i, i + BATCH_SIZE);
                                    await db.instruments.bulkPut(chunk);
                                    successCount += chunk.length;
                                    this.notify(true, `Indexing ${Math.floor((successCount / instruments.length) * 100)}%`);
                                } catch (chunkErr) {
                                    logger.error(`InstrumentService: Failed to bulk insert chunk at index ${i}`, chunkErr);
                                }
                            }
                            logger.info(`InstrumentService: Successfully indexed ${successCount} active Equity/Index instruments.`);
                        } else {
                            logger.warn('InstrumentService: No valid instruments found in CSV. Dhan mapping may have changed.');
                        }
                    } catch (fatalErr) {
                        logger.error('InstrumentService: Fatal error processing CSV parsed data', fatalErr);
                    } finally {
                        this.notify(false);
                    }
                },
                error: (err: any) => {
                    logger.error('InstrumentService: CSV Parsing internally failed:', err);
                    this.notify(false);
                }
            });

        } catch (error) {
            logger.error('InstrumentService: Initialization failed:', error);
            this.notify(false);
        }
    }

    /**
     * Search instruments by symbol or name (Client-side fast search)
     */
    async searchInstruments(query: string, limit: number = 20): Promise<DhanInstrument[]> {
        if (!query || query.trim().length === 0) return [];

        const q = query.trim().toLowerCase();

        try {
            // Priority 1: Exact symbol match (or starts with)
            const exactMatches = await db.instruments
                .where('symbol')
                .startsWithIgnoreCase(q)
                .limit(limit)
                .toArray();

            if (exactMatches.length >= limit) return exactMatches;

            // Priority 2: Contains in name
            const partialMatches = await db.instruments
                .filter(inst => !!inst.name && inst.name.toLowerCase().includes(q))
                .limit(limit - exactMatches.length)
                .toArray();

            // Deduplicate
            const uniqueResults = new Map<string, DhanInstrument>();
            [...exactMatches, ...partialMatches].forEach(inst => uniqueResults.set(inst.securityId, inst));

            const results = Array.from(uniqueResults.values());

            // Prioritize Exact Matches
            results.sort((a, b) => {
                const aExact = a.symbol.toLowerCase() === q;
                const bExact = b.symbol.toLowerCase() === q;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;
                return 0;
            });

            return results;
        } catch (error) {
            logger.error('InstrumentService: Search failed:', error);
            return [];
        }
    }
}

export const instrumentService = new InstrumentService();
