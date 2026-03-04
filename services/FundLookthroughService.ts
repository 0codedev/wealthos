import { Investment } from '../types';
import { marketDataService } from './MarketDataService';

export interface StockWeight {
    ticker: string;
    name: string;
    weight: number; // 0-100
    sector: string;
}

export interface FundHoldings {
    fundId: string;
    holdings: StockWeight[];
    lastUpdated: number;
    isEstimated: boolean;
}

// Hardcoded Top Holdings for popular Indian Funds (approximate as of early 2025)
const TOP_FUNDS_DB: Record<string, StockWeight[]> = {
    // Large Cap / Bluechip Proxy
    'HDFC Top 100': [
        { ticker: 'HDFCBANK', name: 'HDFC Bank', weight: 9.5, sector: 'Banking' },
        { ticker: 'ICICIBANK', name: 'ICICI Bank', weight: 9.0, sector: 'Banking' },
        { ticker: 'RELIANCE', name: 'Reliance Industries', weight: 8.5, sector: 'Energy' },
        { ticker: 'INFY', name: 'Infosys', weight: 6.0, sector: 'Technology' },
        { ticker: 'ITC', name: 'ITC Ltd', weight: 4.5, sector: 'FMCG' },
        { ticker: 'LT', name: 'Larsen & Toubro', weight: 4.0, sector: 'Construction' },
        { ticker: 'TCS', name: 'TCS', weight: 3.5, sector: 'Technology' },
        { ticker: 'AXISBANK', name: 'Axis Bank', weight: 3.0, sector: 'Banking' },
        { ticker: 'SBIN', name: 'SBI', weight: 3.0, sector: 'Banking' },
        { ticker: 'BHARTIARTL', name: 'Bharti Airtel', weight: 2.5, sector: 'Telecom' },
    ],
    // Flexi Cap Proxy (like PPFAS)
    'Parag Parikh Flexi Cap': [
        { ticker: 'HDFCBANK', name: 'HDFC Bank', weight: 8.0, sector: 'Banking' },
        { ticker: 'BAJAJFINSV', name: 'Bajaj Finserv', weight: 6.0, sector: 'Finance' },
        { ticker: 'ITC', name: 'ITC', weight: 5.5, sector: 'FMCG' },
        { ticker: 'AXISBANK', name: 'Axis Bank', weight: 5.0, sector: 'Banking' },
        { ticker: 'HCLTECH', name: 'HCL Tech', weight: 4.0, sector: 'Technology' },
        { ticker: 'POWERGRID', name: 'Power Grid', weight: 4.0, sector: 'Utilities' },
        { ticker: 'MARUTI', name: 'Maruti Suzuki', weight: 3.5, sector: 'Auto' },
        // Foreign stocks usually here, effectively "Other" for this simplified view
        { ticker: 'GOOGL', name: 'Alphabet Inc', weight: 3.0, sector: 'Technology' },
        { ticker: 'META', name: 'Meta Platforms', weight: 3.0, sector: 'Technology' },
    ],
    // Mid Cap Proxy
    'HDFC Mid-Cap Opportunities': [
        { ticker: 'INDIANB', name: 'Indian Bank', weight: 4.0, sector: 'Banking' },
        { ticker: 'TATACOMM', name: 'Tata Communications', weight: 3.5, sector: 'Telecom' },
        { ticker: 'PHOENIXLTD', name: 'The Phoenix Mills', weight: 3.0, sector: 'Real Estate' },
        { ticker: 'FEDERALBNK', name: 'Federal Bank', weight: 3.0, sector: 'Banking' },
        { ticker: 'APOLLOTYRE', name: 'Apollo Tyres', weight: 2.5, sector: 'Auto' },
    ]
};

class FundLookthroughService {
    private cache: Map<string, FundHoldings> = new Map();

    async getHoldings(fundName: string): Promise<StockWeight[]> {
        // 1. Check Cache
        if (this.cache.has(fundName)) {
            return this.cache.get(fundName)!.holdings;
        }

        // 2. Check Static DB (Fuzzy Match)
        const dbKey = Object.keys(TOP_FUNDS_DB).find(k => fundName.toLowerCase().includes(k.toLowerCase()));
        if (dbKey) {
            return TOP_FUNDS_DB[dbKey];
        }

        // 3. AI Estimation (Mocked for now, but wired for future)
        // In a real scenario, we would ask Gemini: "What are the top 10 holdings of X fund?"
        return this.estimateHoldingsAI(fundName);
    }

    private async estimateHoldingsAI(fundName: string): Promise<StockWeight[]> {
        console.warn(`Estimating holdings for unknown fund: ${fundName}`);

        // Generic "Market Proxy" if we know nothing
        if (fundName.toLowerCase().includes('mid')) {
            return TOP_FUNDS_DB['HDFC Mid-Cap Opportunities']; // Fallback proxy
        }

        // Default to Nifty 50 Proxy
        return TOP_FUNDS_DB['HDFC Top 100'].map(h => ({ ...h, weight: h.weight * 0.8 })); // Dilute slightly
    }

    /**
     * Calculates the "True Exposure" of a stock by combining direct holdings + fund lookthrough
     */
    async analyzePortfolio(investments: Investment[]): Promise<{
        directExposure: Map<string, number>;
        indirectExposure: Map<string, number>;
        totalExposure: Map<string, number>;
        stockMetadata: Map<string, { name: string, sector: string }>;
    }> {
        const directExposure = new Map<string, number>();
        const indirectExposure = new Map<string, number>();
        const totalExposure = new Map<string, number>();
        const stockMetadata = new Map<string, { name: string, sector: string }>();

        for (const inv of investments) {
            // 1. Direct Stocks
            if (inv.type === 'Stocks' && inv.ticker) {
                const val = inv.currentValue;
                const ticker = inv.ticker.toUpperCase();

                directExposure.set(ticker, (directExposure.get(ticker) || 0) + val);
                totalExposure.set(ticker, (totalExposure.get(ticker) || 0) + val);
                stockMetadata.set(ticker, { name: inv.name, sector: inv.sector || 'Uncategorized' });
            }

            // 2. Mutual Funds (Lookthrough)
            if (inv.type === 'Mutual Fund') {
                const holdings = await this.getHoldings(inv.name);
                const fundValue = inv.currentValue;

                holdings.forEach(stock => {
                    const stockVal = (stock.weight / 100) * fundValue;
                    const ticker = stock.ticker.toUpperCase();

                    indirectExposure.set(ticker, (indirectExposure.get(ticker) || 0) + stockVal);
                    totalExposure.set(ticker, (totalExposure.get(ticker) || 0) + stockVal);

                    if (!stockMetadata.has(ticker)) {
                        stockMetadata.set(ticker, { name: stock.name, sector: stock.sector });
                    }
                });
            }
        }

        return { directExposure, indirectExposure, totalExposure, stockMetadata };
    }
}

export const fundLookthroughService = new FundLookthroughService();
