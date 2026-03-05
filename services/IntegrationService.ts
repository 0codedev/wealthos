import { fetchStockFundamentals } from './RealDataService';

// ==================== CDSL/NSDL INTEGRATION ====================

export interface DepositorHolding {
    isin: string;
    securityName: string;
    quantity: number;
    freeBalance: number;
    lockedBalance: number;
    pledgedQuantity: number;
    lastUpdated: string;
}

export interface ConsolidatedAccountStatement {
    dpId: string;
    clientId: string;
    name: string;
    pan: string;
    holdings: DepositorHolding[];
    asOnDate: string;
}

/**
 * Parse CDSL CAS statement (mock implementation)
 * In production, this would parse PDF or integrate with CDSL API
 */
export function parseCDSLStatement(pdfContent: string): ConsolidatedAccountStatement {
    // Mock data - in production, parse actual PDF
    return {
        dpId: '12345678',
        clientId: '12345678901234',
        name: 'User Name',
        pan: 'ABCDE1234F',
        asOnDate: new Date().toISOString().split('T')[0],
        holdings: [
            { isin: 'INE002A01018', securityName: 'RELIANCE INDUSTRIES', quantity: 50, freeBalance: 50, lockedBalance: 0, pledgedQuantity: 0, lastUpdated: new Date().toISOString() },
            { isin: 'INE467B01029', securityName: 'TATA CONSULTANCY SERVICES', quantity: 25, freeBalance: 25, lockedBalance: 0, pledgedQuantity: 0, lastUpdated: new Date().toISOString() },
            { isin: 'INE009A01021', securityName: 'INFOSYS LIMITED', quantity: 100, freeBalance: 100, lockedBalance: 0, pledgedQuantity: 0, lastUpdated: new Date().toISOString() },
        ]
    };
}

// ==================== TRADING VIEW INTEGRATION ====================

export interface TradingViewWidgetConfig {
    symbol: string;
    interval: string;
    theme: 'light' | 'dark';
    width: string;
    height: string;
    studies: string[];
}

export function getTradingViewChartUrl(
    symbol: string,
    interval: string = 'D'
): string {
    // NSE symbol format for TradingView
    const tvSymbol = `NSE:${symbol.toUpperCase()}`;
    return `https://www.tradingview.com/chart/?symbol=${tvSymbol}&interval=${interval}`;
}

export function generateTradingViewEmbed(config: TradingViewWidgetConfig): string {
    return `
<!-- TradingView Widget BEGIN -->
<div class="tradingview-widget-container">
    <div id="tradingview_chart"></div>
    <script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
    <script type="text/javascript">
    new TradingView.widget({
        "width": "${config.width}",
        "height": "${config.height}",
        "symbol": "NSE:${config.symbol}",
        "interval": "${config.interval}",
        "timezone": "Asia/Kolkata",
        "theme": "${config.theme}",
        "style": "1",
        "locale": "en",
        "toolbar_bg": "#f1f3f6",
        "enable_publishing": false,
        "allow_symbol_change": true,
        "container_id": "tradingview_chart",
        "studies": ${JSON.stringify(config.studies)}
    });
    </script>
</div>
<!-- TradingView Widget END -->
    `;
}

// ==================== STOCK SCREENER INTEGRATION ====================

export interface ScreenerData {
    ticker: string;
    name: string;
    marketCap: number;
    pe: number;
    pb: number;
    dividendYield: number;
    roe: number;
    roce: number;
    debtToEquity: number;
    promoterHolding: number;
    piotroskiScore: number;
    intrinsicValue: number;
    cmp: number;
}

export function getScreenerUrl(ticker: string): string {
    return `https://www.screener.in/company/${ticker}/`;
}

export function getTrendlyneUrl(ticker: string): string {
    return `https://trendlyne.com/equity/${ticker}/`;
}

/**
 * Fetch stock data from Screener.in (mock implementation)
 */
export async function fetchScreenerData(ticker: string): Promise<ScreenerData> {
    const liveData = await fetchStockFundamentals(ticker);
    if (liveData) return liveData;
    // Mock data - in production, scrape or use API
    const mockData: Record<string, ScreenerData> = {
        'RELIANCE': {
            ticker: 'RELIANCE',
            name: 'Reliance Industries Ltd',
            marketCap: 1789000,
            pe: 26.5,
            pb: 2.3,
            dividendYield: 0.35,
            roe: 8.9,
            roce: 9.2,
            debtToEquity: 0.42,
            promoterHolding: 50.3,
            piotroskiScore: 6,
            intrinsicValue: 2450,
            cmp: 2850
        },
        'TCS': {
            ticker: 'TCS',
            name: 'Tata Consultancy Services Ltd',
            marketCap: 1456000,
            pe: 32.1,
            pb: 14.5,
            dividendYield: 1.2,
            roe: 48.5,
            roce: 62.3,
            debtToEquity: 0.04,
            promoterHolding: 72.3,
            piotroskiScore: 8,
            intrinsicValue: 3200,
            cmp: 4100
        },
        'INFY': {
            ticker: 'INFY',
            name: 'Infosys Ltd',
            marketCap: 625000,
            pe: 28.5,
            pb: 8.2,
            dividendYield: 2.1,
            roe: 31.2,
            roce: 39.5,
            debtToEquity: 0.08,
            promoterHolding: 14.8,
            piotroskiScore: 7,
            intrinsicValue: 1650,
            cmp: 1850
        }
    };

    return mockData[ticker.toUpperCase()] || {
        ticker,
        name: ticker,
        marketCap: 10000,
        pe: 20,
        pb: 3,
        dividendYield: 1,
        roe: 15,
        roce: 18,
        debtToEquity: 0.5,
        promoterHolding: 50,
        piotroskiScore: 5,
        intrinsicValue: 100,
        cmp: 100
    };
}

// ==================== BROKER EMAIL IMPORT ====================

export interface BrokerEmail {
    from: string;
    subject: string;
    date: string;
    type: 'contract_note' | 'ipo_allotment' | 'dividend' | 'corporate_action';
    parsed: Record<string, any>;
}

export interface ContractNote {
    broker: string;
    tradeDate: string;
    settlementDate: string;
    trades: Array<{
        symbol: string;
        type: 'BUY' | 'SELL';
        quantity: number;
        price: number;
        amount: number;
    }>;
    charges: {
        brokerage: number;
        stt: number;
        exchangeCharges: number;
        sebiCharges: number;
        stampDuty: number;
        gst: number;
        total: number;
    };
    netAmount: number;
}

/**
 * Parse broker contract note email (mock)
 */
export function parseContractNoteEmail(emailContent: string): ContractNote {
    // Mock - in production, parse actual email HTML/PDF
    return {
        broker: 'Zerodha',
        tradeDate: new Date().toISOString().split('T')[0],
        settlementDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        trades: [
            { symbol: 'RELIANCE', type: 'BUY', quantity: 10, price: 2850, amount: 28500 }
        ],
        charges: {
            brokerage: 0,
            stt: 2.85,
            exchangeCharges: 0.95,
            sebiCharges: 0.03,
            stampDuty: 4.28,
            gst: 0.17,
            total: 8.28
        },
        netAmount: 28508.28
    };
}

/**
 * Parse IPO allotment email
 */
export function parseIPOAllotmentEmail(emailContent: string): {
    ipoName: string;
    status: 'Allotted' | 'Not Allotted';
    sharesAllotted: number;
    amountBlocked: number;
    refundAmount: number;
} {
    // Mock implementation
    return {
        ipoName: 'Sample IPO Ltd',
        status: 'Allotted',
        sharesAllotted: 13,
        amountBlocked: 14560,
        refundAmount: 0
    };
}

// ==================== BANK STATEMENT PARSER ====================

export interface BankTransaction {
    date: string;
    description: string;
    amount: number;
    type: 'credit' | 'debit';
    balance: number;
    category?: string;
    tags?: string[];
}

export interface BankStatement {
    accountNumber: string;
    bankName: string;
    periodStart: string;
    periodEnd: string;
    openingBalance: number;
    closingBalance: number;
    transactions: BankTransaction[];
}

// Transaction categories
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /UPI.*SWIGGY|ZOMATO|DOMINOS/i, category: 'Food & Dining' },
    { pattern: /UPI.*AMAZON|FLIPKART|MYNTRA/i, category: 'Shopping' },
    { pattern: /UPI.*UBER|OLA|RAPIDO/i, category: 'Transport' },
    { pattern: /UPI.*NETFLIX|HOTSTAR|PRIME/i, category: 'Entertainment' },
    { pattern: /UPI.*JIO|AIRTEL|VODAFONE/i, category: 'Utilities' },
    { pattern: /NEFT.*GROWW|ZERODHA|UPSTOX/i, category: 'Investments' },
    { pattern: /SIP|MUTUAL FUND|MF/i, category: 'Investments' },
    { pattern: /SALARY|SAL\s/i, category: 'Income' },
    { pattern: /RENT|SOCIETY/i, category: 'Housing' },
    { pattern: /EMI|LOAN/i, category: 'Loans' },
    { pattern: /INSURANCE|LIC|HDFC LIFE/i, category: 'Insurance' },
    { pattern: /ATM/i, category: 'Cash Withdrawal' },
    { pattern: /INTEREST/i, category: 'Interest' },
];

/**
 * Categorize a bank transaction
 */
export function categorizeTransaction(description: string): string {
    for (const { pattern, category } of CATEGORY_PATTERNS) {
        if (pattern.test(description)) {
            return category;
        }
    }
    return 'Miscellaneous';
}

/**
 * Parse bank statement (mock implementation)
 * In production, use PDF parsing libraries
 */
export function parseBankStatement(pdfContent: string): BankStatement {
    // Mock data
    const transactions: BankTransaction[] = [
        { date: '2024-12-01', description: 'SALARY DEC 2024', amount: 85000, type: 'credit', balance: 125000, category: 'Income' },
        { date: '2024-12-02', description: 'UPI-SWIGGY-FOOD', amount: 450, type: 'debit', balance: 124550, category: 'Food & Dining' },
        { date: '2024-12-03', description: 'NEFT-GROWW-SIP', amount: 10000, type: 'debit', balance: 114550, category: 'Investments' },
        { date: '2024-12-04', description: 'UPI-AMAZON-SHOPPING', amount: 2500, type: 'debit', balance: 112050, category: 'Shopping' },
        { date: '2024-12-05', description: 'EMI-HOME LOAN', amount: 25000, type: 'debit', balance: 87050, category: 'Loans' },
    ];

    transactions.forEach(t => {
        if (!t.category) {
            t.category = categorizeTransaction(t.description);
        }
    });

    return {
        accountNumber: 'XXXX1234',
        bankName: 'HDFC Bank',
        periodStart: '2024-12-01',
        periodEnd: '2024-12-31',
        openingBalance: 40000,
        closingBalance: 87050,
        transactions
    };
}

/**
 * Analyze spending patterns from bank statement
 */
export function analyzeSpending(statement: BankStatement): {
    totalIncome: number;
    totalExpenses: number;
    savingsRate: number;
    byCategory: Record<string, number>;
    topExpenses: Array<{ category: string; amount: number; percentage: number }>;
} {
    const byCategory: Record<string, number> = {};
    let totalIncome = 0;
    let totalExpenses = 0;

    statement.transactions.forEach(t => {
        const category = t.category || 'Miscellaneous';
        if (t.type === 'credit') {
            totalIncome += t.amount;
        } else {
            totalExpenses += t.amount;
            byCategory[category] = (byCategory[category] || 0) + t.amount;
        }
    });

    const topExpenses = Object.entries(byCategory)
        .map(([category, amount]) => ({
            category,
            amount,
            percentage: (amount / totalExpenses) * 100
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

    return {
        totalIncome,
        totalExpenses,
        savingsRate: ((totalIncome - totalExpenses) / totalIncome) * 100,
        byCategory,
        topExpenses
    };
}

// ==================== ASBA BANK BALANCE ====================

export interface ASBABalance {
    bankName: string;
    accountNumber: string;
    availableBalance: number;
    blockedForIPO: number;
    freeBalance: number;
    pendingIPOs: Array<{ name: string; amount: number; status: string }>;
}

export function getASBABalance(accountNumber: string): ASBABalance {
    // Mock implementation
    return {
        bankName: 'HDFC Bank',
        accountNumber,
        availableBalance: 150000,
        blockedForIPO: 45000,
        freeBalance: 105000,
        pendingIPOs: [
            { name: 'Sample IPO 1', amount: 15000, status: 'Pending' },
            { name: 'Sample IPO 2', amount: 30000, status: 'Processing' }
        ]
    };
}

export default {
    parseCDSLStatement,
    getTradingViewChartUrl,
    generateTradingViewEmbed,
    getScreenerUrl,
    getTrendlyneUrl,
    fetchScreenerData,
    parseContractNoteEmail,
    parseIPOAllotmentEmail,
    parseBankStatement,
    analyzeSpending,
    categorizeTransaction,
    getASBABalance
};
