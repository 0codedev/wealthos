/**
 * BrokerService - Abstract interface for broker integrations
 * Currently supports mock data; ready for Zerodha/Groww API integration
 */

import { Investment, InvestmentType } from '../types';
import { adaptivePollerService } from './adaptivePollerService';

// Broker types
export type BrokerType = 'mock' | 'zerodha' | 'groww' | 'upstox' | 'angel';

export interface BrokerCredentials {
    apiKey: string;
    apiSecret: string;
    accessToken?: string;
    refreshToken?: string;
    userId?: string;
}

export interface Position {
    symbol: string;
    exchange: 'NSE' | 'BSE' | 'NFO';
    quantity: number;
    averagePrice: number;
    lastPrice: number;
    pnl: number;
    pnlPercent: number;
    value: number;
}

export interface LiveQuote {
    symbol: string;
    lastPrice: number;
    change: number;
    changePercent: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: Date;
}

export interface OrderParams {
    symbol: string;
    exchange: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    price?: number;
    orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL-M';
    product: 'CNC' | 'MIS' | 'NRML';
}

export interface Order {
    orderId: string;
    status: 'PENDING' | 'OPEN' | 'EXECUTED' | 'CANCELLED' | 'REJECTED';
    symbol: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    executedQuantity: number;
    averagePrice: number;
    timestamp: Date;
}

// Abstract broker interface
export interface IBroker {
    type: BrokerType;
    isConnected: boolean;

    // Connection
    connect(credentials: BrokerCredentials): Promise<boolean>;
    disconnect(): Promise<void>;

    // Portfolio
    getPositions(): Promise<Position[]>;
    getHoldings(): Promise<Investment[]>;

    // Market Data
    getQuote(symbol: string): Promise<LiveQuote>;
    subscribeQuotes(symbols: string[], callback: (quote: LiveQuote) => void): void;
    unsubscribeQuotes(): void;

    // Orders (future implementation)
    placeOrder?(params: OrderParams): Promise<Order>;
    cancelOrder?(orderId: string): Promise<boolean>;
    getOrders?(): Promise<Order[]>;
}

/**
 * Mock Broker Implementation
 * Provides realistic demo data for development and testing
 */
class MockBroker implements IBroker {
    type: BrokerType = 'mock';
    isConnected = false;
    private quoteInterval: NodeJS.Timeout | null = null;

    async connect(_credentials: BrokerCredentials): Promise<boolean> {
        // Simulate connection delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.isConnected = true;
        // console.log('[MockBroker] Connected successfully');
        return true;
    }

    async disconnect(): Promise<void> {
        this.isConnected = false;
        this.unsubscribeQuotes();
        // console.log('[MockBroker] Disconnected');
    }

    async getPositions(): Promise<Position[]> {
        if (!this.isConnected) throw new Error('Not connected');

        // Mock intraday positions
        return [
            {
                symbol: 'RELIANCE',
                exchange: 'NSE',
                quantity: 10,
                averagePrice: 2850,
                lastPrice: 2872.50,
                pnl: 225,
                pnlPercent: 0.79,
                value: 28725
            },
            {
                symbol: 'TCS',
                exchange: 'NSE',
                quantity: 5,
                averagePrice: 4100,
                lastPrice: 4085,
                pnl: -75,
                pnlPercent: -0.37,
                value: 20425
            }
        ];
    }

    async getHoldings(): Promise<Investment[]> {
        if (!this.isConnected) throw new Error('Not connected');

        // Convert mock positions to Investment format
        const positions = await this.getPositions();
        return positions.map((pos, index) => ({
            id: `mock-${pos.symbol}-${index}`,
            name: pos.symbol,
            type: 'Stocks' as InvestmentType,
            platform: 'Mock Broker',
            investedAmount: pos.averagePrice * pos.quantity,
            currentValue: pos.lastPrice * pos.quantity,
            lastUpdated: new Date().toISOString(),
            currency: 'INR',
            riskLevel: 'Medium' as const,
        }));
    }

    async getQuote(symbol: string): Promise<LiveQuote> {
        // Generate realistic-looking mock quote
        const basePrice = this.getBasePrice(symbol);
        const change = (Math.random() - 0.5) * basePrice * 0.02;

        return {
            symbol,
            lastPrice: basePrice + change,
            change,
            changePercent: (change / basePrice) * 100,
            open: basePrice,
            high: basePrice + Math.abs(change) * 1.5,
            low: basePrice - Math.abs(change) * 1.2,
            close: basePrice,
            volume: Math.floor(Math.random() * 1000000) + 100000,
            timestamp: new Date()
        };
    }

    private pollerUnsub: (() => void) | null = null;

    subscribeQuotes(symbols: string[], callback: (quote: LiveQuote) => void): void {
        this.unsubscribeQuotes();

        const emitQuotes = async () => {
            for (const symbol of symbols) {
                const quote = await this.getQuote(symbol);
                callback(quote);
            }
        };

        // Emit immediate initial batch
        void emitQuotes();

        const scheduleInterval = (intervalMs: number) => {
            if (this.quoteInterval) {
                clearInterval(this.quoteInterval);
            }
            this.quoteInterval = setInterval(emitQuotes, intervalMs);
        };

        // Listen for market state and document visibility changes
        this.pollerUnsub = adaptivePollerService.subscribe((cfg) => {
            // When market is closed (or tab is backgrounded), scale back quote polling
            scheduleInterval(cfg.intervalMs);
        });
    }

    unsubscribeQuotes(): void {
        if (this.quoteInterval) {
            clearInterval(this.quoteInterval);
            this.quoteInterval = null;
        }
        if (this.pollerUnsub) {
            this.pollerUnsub();
            this.pollerUnsub = null;
        }
    }

    private getBasePrice(symbol: string): number {
        // Return typical prices for popular stocks
        const prices: Record<string, number> = {
            'RELIANCE': 2850,
            'TCS': 4100,
            'INFY': 1850,
            'HDFCBANK': 1650,
            'ICICIBANK': 1150,
            'SBIN': 780,
            'TATAMOTORS': 950,
            'WIPRO': 560,
            'ITC': 480,
            'BHARTIARTL': 1550,
        };
        return prices[symbol] || 1000 + Math.random() * 2000;
    }
}

/**
 * Zerodha Kite Broker Implementation (Stub)
 * Ready for API integration when user provides credentials
 */
class ZerodhaKite implements IBroker {
    type: BrokerType = 'zerodha';
    isConnected = false;

    async connect(_credentials: BrokerCredentials): Promise<boolean> {
        // TODO: Implement actual Kite Connect API
        // 1. Exchange code for access token
        // 2. Set up WebSocket for live data
        // console.log('[Zerodha] API integration pending - use mock for now');
        throw new Error('Zerodha integration requires API credentials. Use mock broker for demo.');
    }

    async disconnect(): Promise<void> {
        this.isConnected = false;
    }

    async getPositions(): Promise<Position[]> {
        throw new Error('Not implemented');
    }

    async getHoldings(): Promise<Investment[]> {
        throw new Error('Not implemented');
    }

    async getQuote(_symbol: string): Promise<LiveQuote> {
        throw new Error('Not implemented');
    }

    subscribeQuotes(_symbols: string[], _callback: (quote: LiveQuote) => void): void {
        throw new Error('Not implemented');
    }

    unsubscribeQuotes(): void { }
}

/**
 * Broker Factory - Creates appropriate broker instance
 */
export function createBroker(type: BrokerType): IBroker {
    switch (type) {
        case 'mock':
            return new MockBroker();
        case 'zerodha':
            return new ZerodhaKite();
        default:
            console.warn(`Broker type ${type} not implemented, using mock`);
            return new MockBroker();
    }
}

// Default broker instance
export const defaultBroker = createBroker('mock');

export default createBroker;
