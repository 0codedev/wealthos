/**
 * Seed script to import MOM's Zerodha Holdings into the Portfolio
 * Data extracted from holdings-WY7198.xlsx (Zerodha Console Export)
 * 
 * Run this once to populate the database with MOM's holdings.
 * After running, this data will be visible in the Portfolio tab filtered by owner="MOM"
 */

import { db } from '../database';
import { Investment, InvestmentType } from '../types';

// Helper to generate unique IDs
const generateId = (prefix: string, ticker: string) =>
    `${prefix}_${ticker.toLowerCase()}_${Date.now()}`;

// MOM's Equity Holdings from Zerodha Console (WY7198)
// Data as on 2026-01-29
const MOM_EQUITY_HOLDINGS: Omit<Investment, 'id'>[] = [
    {
        name: 'Nippon India ETF Nifty BeES',
        ticker: 'BSLNIFTY',
        type: InvestmentType.ETF,
        platform: 'Zerodha',
        sector: 'Index ETF',
        quantity: 1,
        investedAmount: 30.35,
        currentValue: 29.55 * 1, // LTP * Qty
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Gokul Agro Resources Ltd',
        ticker: 'GOKUL',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'FMCG',
        quantity: 50,
        investedAmount: 48.22 * 50, // Avg * Qty = 2411
        currentValue: 36.57 * 50, // LTP * Qty = 1828.5
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Nippon India ETF Gold BeES',
        ticker: 'GOLDBEES',
        type: InvestmentType.ETF,
        platform: 'Zerodha',
        sector: 'Commodities',
        quantity: 11,
        investedAmount: 122.1627 * 11, // Avg * Qty = 1343.79
        currentValue: 193.52 * 11, // LTP * Qty = 2128.72
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'HDFC Mutual Fund - Nifty Private Bank ETF',
        ticker: 'HDFCPVTBAN',
        type: InvestmentType.ETF,
        platform: 'Zerodha',
        sector: 'Financial Services',
        quantity: 10,
        investedAmount: 28.34 * 10, // Avg * Qty = 283.4
        currentValue: 28.87 * 10, // LTP * Qty = 288.7
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Hindustan Petroleum Corporation Ltd',
        ticker: 'HINDPETRO',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Energy',
        quantity: 1,
        investedAmount: 267.3 * 1, // Avg * Qty
        currentValue: 413.45 * 1, // LTP * Qty
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Indian Railway Finance Corporation Ltd',
        ticker: 'IRFC',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Infrastructure',
        quantity: 3,
        investedAmount: 86.1 * 3, // Avg * Qty = 258.3
        currentValue: 162.85 * 3, // LTP * Qty = 488.55
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Motilal Oswal Momentum 100 ETF',
        ticker: 'MOM100',
        type: InvestmentType.ETF,
        platform: 'Zerodha',
        sector: 'Index ETF',
        quantity: 0, // Qty is 0 in screenshot
        investedAmount: 65.91 * 0,
        currentValue: 63.01 * 0,
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Mangalore Refinery & Petrochemicals Ltd',
        ticker: 'MRPL',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Energy',
        quantity: 0, // Qty is 0 in screenshot
        investedAmount: 58.89 * 0,
        currentValue: 165.07 * 0,
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Oil & Natural Gas Corporation Ltd',
        ticker: 'ONGC',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Energy',
        quantity: 2,
        investedAmount: 133.1 * 2, // Avg * Qty = 266.2
        currentValue: 268.65 * 2, // LTP * Qty = 537.3
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Power Grid Corporation of India Ltd',
        ticker: 'POWERGRID',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Energy',
        quantity: 2,
        investedAmount: 21.7 * 2, // Avg * Qty = 43.4 (pre-split adjusted?)
        currentValue: 293.50 * 2, // LTP * Qty = 587
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Rail Vikas Nigam Ltd',
        ticker: 'RVNL',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Financial Services',
        quantity: 10,
        investedAmount: 5.35 * 10, // Avg * Qty = 53.5
        currentValue: 2.80 * 10, // LTP * Qty = 28
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Steel Authority of India Ltd',
        ticker: 'SAIL',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Metals',
        quantity: 4,
        investedAmount: 78.45 * 4, // Avg * Qty = 313.8
        currentValue: 155.70 * 4, // LTP * Qty = 622.8
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'SBI ETF Private Bank',
        ticker: 'SBIPI8',
        type: InvestmentType.ETF,
        platform: 'Zerodha',
        sector: 'Financial Services',
        quantity: 10,
        investedAmount: 51.32 * 10, // Avg * Qty = 513.2
        currentValue: 33.11 * 10, // LTP * Qty = 331.1
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Nippon India ETF Silver BeES',
        ticker: 'SILVERBEES',
        type: InvestmentType.ETF,
        platform: 'Zerodha',
        sector: 'Commodities',
        quantity: 161,
        investedAmount: 13.8066 * 161, // Avg * Qty = 2222.86
        currentValue: 132.1 * 161, // LTP * Qty = 21268.1 (values might have been split/adjusted)
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Tata Steel Ltd',
        ticker: 'TATASTEEL',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Metals',
        quantity: 3,
        investedAmount: 103.25 * 3, // Avg * Qty = 309.75
        currentValue: 147.73 * 3, // LTP * Qty = 443.19
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    },
    {
        name: 'Vedanta Ltd',
        ticker: 'VEDL',
        type: InvestmentType.STOCKS,
        platform: 'Zerodha',
        sector: 'Metals',
        quantity: 3,
        investedAmount: 245.8187 * 3, // Avg * Qty = 737.46
        currentValue: 473.05 * 3, // LTP * Qty = 1419.15
        lastUpdated: new Date().toISOString(),
        owner: 'MOM'
    }
];

/**
 * Import all MOM holdings into the database
 * This will add entries to the investments table with owner='MOM'
 */
export async function seedMomPortfolio(): Promise<{ success: boolean; count: number; message: string }> {
    try {
        // Check if MOM portfolio already exists to avoid duplicates
        const existingMomAssets = await db.investments.where('owner').equals('MOM').count();

        if (existingMomAssets > 0) {
            return {
                success: false,
                count: existingMomAssets,
                message: `MOM portfolio already has ${existingMomAssets} assets. Clear existing data first to re-import.`
            };
        }

        // Prepare investments with generated IDs
        const investmentsToAdd: Investment[] = MOM_EQUITY_HOLDINGS
            .filter(h => h.quantity && h.quantity > 0) // Only add holdings with quantity > 0
            .map(holding => ({
                ...holding,
                id: generateId('mom', holding.ticker || holding.name)
            }));

        // Bulk add to database
        await db.investments.bulkAdd(investmentsToAdd);

        return {
            success: true,
            count: investmentsToAdd.length,
            message: `Successfully imported ${investmentsToAdd.length} holdings for MOM portfolio.`
        };
    } catch (error) {
        console.error('Error seeding MOM portfolio:', error);
        return {
            success: false,
            count: 0,
            message: `Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}

/**
 * Clear all MOM portfolio holdings (for re-import)
 */
export async function clearMomPortfolio(): Promise<{ success: boolean; count: number }> {
    try {
        const momAssets = await db.investments.where('owner').equals('MOM').toArray();
        const ids = momAssets.map(a => a.id);
        await db.investments.bulkDelete(ids);
        return { success: true, count: ids.length };
    } catch (error) {
        console.error('Error clearing MOM portfolio:', error);
        return { success: false, count: 0 };
    }
}

/**
 * Get summary of MOM portfolio
 */
export async function getMomPortfolioSummary() {
    const momAssets = await db.investments.where('owner').equals('MOM').toArray();

    const totalInvested = momAssets.reduce((sum, a) => sum + a.investedAmount, 0);
    const totalCurrent = momAssets.reduce((sum, a) => sum + a.currentValue, 0);
    const totalPnL = totalCurrent - totalInvested;
    const pnlPercentage = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

    return {
        assetCount: momAssets.length,
        totalInvested,
        totalCurrent,
        totalPnL,
        pnlPercentage,
        assets: momAssets
    };
}
