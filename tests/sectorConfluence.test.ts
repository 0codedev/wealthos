// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { alphaEngineService, SectorData, StockData } from '../services/AlphaEngineService';

describe('Sector Confluence Score (SCS) Logic', () => {
    beforeEach(() => {
        // Clear caches before each test run
        alphaEngineService['cachedSectors'] = [];
        alphaEngineService['cachedStocks'] = [];
    });

    it('should calculate ELITE BULLISH confluence correctly', () => {
        // Mock sector data
        const sectorsList: SectorData[] = [
            {
                sector: 'METAL',
                lastPrice: 8200,
                percentChange: 2.5,
                previousClose: 8000,
                strengthRatio: 2.0,
                fatigueScore: 4, // 4 consecutive green days
                fatigueState: 'exhaustion',
                openPrice: 8080,
                openChangePct: 1.48, // (8200 - 8080) / 8080 * 100
                highPrice: 8250,
                lowPrice: 8050,
                l2cChangePct: 1.86,  // (8200 - 8050) / 8050 * 100
                h2cChangePct: -0.61  // (8200 - 8250) / 8250 * 100
            }
        ];

        // Mock constituent stocks
        const mockStocks: StockData[] = [
            {
                symbol: 'TATASTEEL',
                sector: 'METAL',
                lastPrice: 155,
                previousClose: 150,
                openPrice: 151,
                high: 156,
                low: 151,
                percentChange: 3.33,
                volume: 100000,
                value: 15000000,
                gFactor: 8.5,
                signal: 'Up',
                openingGapPct: 0.67,
                dayExtremeScore: 0.8,
                isORBLowPreservedProxy: true,
                isORBHighPreservedProxy: false,
                openChangePct: 2.65,
                atr: 4.5,
                grr: 0.22,
                ovr: 1.11,
                isExhausted: false,
                isTrapRisk: false,
                isRebound: false
            },
            {
                symbol: 'HINDALCO',
                sector: 'METAL',
                lastPrice: 620,
                previousClose: 600,
                openPrice: 605,
                high: 622,
                low: 604,
                percentChange: 3.33,
                volume: 50000,
                value: 31000000,
                gFactor: 7.0,
                signal: 'Up',
                openingGapPct: 0.83,
                dayExtremeScore: 0.88,
                isORBLowPreservedProxy: true,
                isORBHighPreservedProxy: false,
                openChangePct: 2.48,
                atr: 15,
                grr: 0.33,
                ovr: 1.2,
                isExhausted: false,
                isTrapRisk: false,
                isRebound: false
            }
        ];

        // Set up cached stocks directly
        alphaEngineService['cachedStocks'] = mockStocks;

        // F&O Sector Booster data showing strong bulls
        const boosterRawData = [
            {
                sector: 'METAL',
                stock_list: [
                    { symbol: 'TATASTEEL', change_per: '3.33' },
                    { symbol: 'HINDALCO', change_per: '3.33' }
                ]
            }
        ];

        // Constituent top 15 list
        const boosterStocksList = [
            { symbol_name: 'TATASTEEL' },
            { symbol_name: 'HINDALCO' }
        ];

        const result = alphaEngineService.calculateSectorConfluence(sectorsList, boosterRawData, boosterStocksList);

        expect(result).toHaveLength(1);
        expect(result[0].confluenceScore).toBeGreaterThanOrEqual(75);
        expect(result[0].confluenceGrade).toBe('ELITE BULLISH');
        expect(result[0].bullsBearsRatio).toBe(1.0); // 2 bulls, 0 bears
        expect(result[0].intradayBoosterCount).toBe(2);
        expect(result[0].topDriverSymbol).toBeDefined();
    });

    it('should calculate ELITE BEARISH confluence correctly', () => {
        // Mock sector data
        const sectorsList: SectorData[] = [
            {
                sector: 'METAL',
                lastPrice: 7800,
                percentChange: -2.5,
                previousClose: 8000,
                strengthRatio: -2.0,
                fatigueScore: -4, // 4 consecutive red days
                fatigueState: 'springboard',
                openPrice: 7920,
                openChangePct: -1.52,
                highPrice: 7950,
                lowPrice: 7780,
                l2cChangePct: 0.26,
                h2cChangePct: -1.89
            }
        ];

        // Mock constituent stocks
        const mockStocks: StockData[] = [
            {
                symbol: 'TATASTEEL',
                sector: 'METAL',
                lastPrice: 145,
                previousClose: 150,
                openPrice: 149,
                high: 149,
                low: 144,
                percentChange: -3.33,
                volume: 100000,
                value: 14500000,
                gFactor: 8.5,
                signal: 'Down',
                openingGapPct: -0.67,
                dayExtremeScore: 0.8,
                isORBLowPreservedProxy: false,
                isORBHighPreservedProxy: true,
                openChangePct: -2.68,
                atr: 4.5,
                grr: 0.22,
                ovr: 1.11,
                isExhausted: false,
                isTrapRisk: false,
                isRebound: false
            },
            {
                symbol: 'HINDALCO',
                sector: 'METAL',
                lastPrice: 580,
                previousClose: 600,
                openPrice: 595,
                high: 596,
                low: 578,
                percentChange: -3.33,
                volume: 50000,
                value: 29000000,
                gFactor: 7.0,
                signal: 'Down',
                openingGapPct: -0.83,
                dayExtremeScore: 0.88,
                isORBLowPreservedProxy: false,
                isORBHighPreservedProxy: true,
                openChangePct: -2.52,
                atr: 15,
                grr: 0.33,
                ovr: 1.2,
                isExhausted: false,
                isTrapRisk: false,
                isRebound: false
            }
        ];

        // Set up cached stocks directly
        alphaEngineService['cachedStocks'] = mockStocks;

        // F&O Sector Booster data showing strong bears
        const boosterRawData = [
            {
                sector: 'METAL',
                stock_list: [
                    { symbol: 'TATASTEEL', change_per: '-3.33' },
                    { symbol: 'HINDALCO', change_per: '-3.33' }
                ]
            }
        ];

        const boosterStocksList = [
            { symbol_name: 'TATASTEEL' },
            { symbol_name: 'HINDALCO' }
        ];

        const result = alphaEngineService.calculateSectorConfluence(sectorsList, boosterRawData, boosterStocksList);

        expect(result).toHaveLength(1);
        expect(result[0].confluenceScore).toBeLessThanOrEqual(-75);
        expect(result[0].confluenceGrade).toBe('ELITE BEARISH');
        expect(result[0].bullsBearsRatio).toBe(-1.0); // 0 bulls, 2 bears
        expect(result[0].intradayBoosterCount).toBe(2);
    });

    it('should calculate NEUTRAL confluence correctly', () => {
        // Mock sector data
        const sectorsList: SectorData[] = [
            {
                sector: 'METAL',
                lastPrice: 8000,
                percentChange: 0.0,
                previousClose: 8000,
                strengthRatio: 0.0,
                fatigueScore: 0,
                fatigueState: 'neutral',
                openPrice: 8000,
                openChangePct: 0.0,
                highPrice: 8020,
                lowPrice: 7980,
                l2cChangePct: 0.25,
                h2cChangePct: -0.25
            }
        ];

        // Mock constituent stocks (1 up, 1 down)
        const mockStocks: StockData[] = [
            {
                symbol: 'TATASTEEL',
                sector: 'METAL',
                lastPrice: 151.5,
                previousClose: 150,
                openPrice: 150,
                high: 152,
                low: 149.5,
                percentChange: 1.0,
                volume: 100000,
                value: 15150000,
                gFactor: 1.5,
                signal: 'Up',
                openingGapPct: 0.0,
                dayExtremeScore: 0.5,
                isORBLowPreservedProxy: false,
                isORBHighPreservedProxy: false,
                openChangePct: 1.0,
                atr: 4.5,
                grr: 0.0,
                ovr: 0.5,
                isExhausted: false,
                isTrapRisk: false,
                isRebound: false
            },
            {
                symbol: 'HINDALCO',
                sector: 'METAL',
                lastPrice: 594,
                previousClose: 600,
                openPrice: 600,
                high: 602,
                low: 592,
                percentChange: -1.0,
                volume: 50000,
                value: 29700000,
                gFactor: 1.5,
                signal: 'Down',
                openingGapPct: 0.0,
                dayExtremeScore: 0.5,
                isORBLowPreservedProxy: false,
                isORBHighPreservedProxy: false,
                openChangePct: -1.0,
                atr: 15,
                grr: 0.0,
                ovr: 0.67,
                isExhausted: false,
                isTrapRisk: false,
                isRebound: false
            }
        ];

        // Set up cached stocks directly
        alphaEngineService['cachedStocks'] = mockStocks;

        const boosterRawData = [
            {
                sector: 'METAL',
                stock_list: [
                    { symbol: 'TATASTEEL', change_per: '1.0' },
                    { symbol: 'HINDALCO', change_per: '-1.0' }
                ]
            }
        ];

        const boosterStocksList: any[] = [];

        const result = alphaEngineService.calculateSectorConfluence(sectorsList, boosterRawData, boosterStocksList);

        expect(result).toHaveLength(1);
        expect(result[0].confluenceScore).toBeGreaterThanOrEqual(-25);
        expect(result[0].confluenceScore).toBeLessThanOrEqual(25);
        expect(result[0].confluenceGrade).toBe('NEUTRAL');
        expect(result[0].bullsBearsRatio).toBe(0.0); // 1 bull, 1 bear
        expect(result[0].intradayBoosterCount).toBe(0);
    });

    it('should reset fatigue score weight during a trend reversal to avoid false bullish bias', () => {
        // Mock sector data: fatigue indicates strong green streak (4 days), but today Nifty Metal drops -2.5%
        const sectorsList: SectorData[] = [
            {
                sector: 'METAL',
                lastPrice: 7800,
                percentChange: -2.5,
                previousClose: 8000,
                strengthRatio: -2.0,
                fatigueScore: 4, // Green streak
                fatigueState: 'exhaustion',
                openPrice: 7920,
                openChangePct: -1.52,
                highPrice: 7950,
                lowPrice: 7780,
                l2cChangePct: 0.26,
                h2cChangePct: -1.89
            }
        ];

        // Mapped constituents (all red)
        const mockStocks: StockData[] = [
            {
                symbol: 'TATASTEEL',
                sector: 'METAL',
                lastPrice: 145,
                previousClose: 150,
                openPrice: 149,
                high: 149,
                low: 144,
                percentChange: -3.33,
                volume: 100000,
                value: 14500000,
                gFactor: 8.5,
                signal: 'Down',
                openingGapPct: -0.67,
                dayExtremeScore: 0.8,
                isORBLowPreservedProxy: false,
                isORBHighPreservedProxy: true,
                openChangePct: -2.68,
                atr: 4.5,
                grr: 0.22,
                ovr: 1.11,
                isExhausted: false,
                isTrapRisk: false,
                isRebound: false
            }
        ];

        alphaEngineService['cachedStocks'] = mockStocks;

        // F&O Sector Booster data showing strong bears
        const boosterRawData = [
            {
                sector: 'METAL',
                stock_list: [
                    { symbol: 'TATASTEEL', change_per: '-3.33' }
                ]
            }
        ];

        const boosterStocksList = [
            { symbol_name: 'TATASTEEL' }
        ];

        const result = alphaEngineService.calculateSectorConfluence(sectorsList, boosterRawData, boosterStocksList);

        // If the positive fatigueScore (+4) was not overridden/reset to 0, the final performance score would be
        // much higher, pulling the SCS upwards and preventing the bearish alignment.
        // With fatigue score reset to 0, it should properly align as bearish.
        expect(result).toHaveLength(1);
        expect(result[0].confluenceScore).toBeLessThanOrEqual(-70);
        expect(result[0].confluenceGrade).toBe('ELITE BEARISH');
    });

    it('should dynamically redistribute weights when breadth or momentum sources are missing', () => {
        // Mock sector data
        const sectorsList: SectorData[] = [
            {
                sector: 'METAL',
                lastPrice: 8200,
                percentChange: 2.5,
                previousClose: 8000,
                strengthRatio: 2.0,
                fatigueScore: 0,
                fatigueState: 'neutral',
                openPrice: 8040,
                openChangePct: 1.48,
                highPrice: 8250,
                lowPrice: 8050,
                l2cChangePct: 1.86,
                h2cChangePct: -0.61
            }
        ];

        // 1. Breadth and Momentum sources completely empty/unavailable for METAL
        alphaEngineService['cachedStocks'] = []; // No stocks -> momentumActive = false
        const boosterRawData: any[] = [];        // No booster -> breadthActive = false
        const boosterStocksList: any[] = [];

        const result = alphaEngineService.calculateSectorConfluence(sectorsList, boosterRawData, boosterStocksList);

        expect(result).toHaveLength(1);
        // Since breadthActive = false and momentumActive = false,
        // Performance weight is redistributed from 0.40 to 1.0 (100%).
        // Performance score = 100 * tanh(0.4 * 1.48 + 0.2 * 2.5 + 0.15 * 1.86 + 0.1 * -0.61 + 0)
        // perfVal = 0.592 + 0.5 + 0.279 - 0.061 = 1.31
        // perfScore = 100 * tanh(1.31) = 86.47
        // Final SCS = 1.0 * 86.47 = 86.47
        expect(result[0].confluenceScore).toBeCloseTo(86.47, 1);
        expect(result[0].confluenceGrade).toBe('ELITE BULLISH');
    });
});
