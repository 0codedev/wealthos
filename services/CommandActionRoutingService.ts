export interface CommandRoute {
    category: string;
    subTab?: string;
}

export const resolveCommandActionRoute = (action: string): CommandRoute => {
    switch (action) {
        // Broker Sync and Verification
        case 'broker-sync':
        case 'broker-verify':
        // Cash Deployment, Rebalancing & Tax Harvesting
        case 'rebalance':
        case 'portfolio-rebalance':
        case 'deploy-cash':
        case 'cash-deployment':
        case 'idle-cash':
        case 'trim':
        case 'tax-harvest':
        case 'tax-harvesting':
            return { category: 'portfolio', subTab: 'portfolio' };

        // Journal Review & Coaching
        case 'trade-review':
        case 'journal-coach':
        case 'journal-coaching':
            return { category: 'journal', subTab: 'journal' };

        // Alpha Engine & Stock Search
        case 'alpha-screener':
        case 'alpha-shadow':
        case 'search_stock':
        case 'add-from-alpha':
            return { category: 'alpha', subTab: 'screener' };

        // Backtester
        case 'backtest-run':
            return { category: 'backtester', subTab: 'backtester' };

        default:
            return { category: 'dashboard', subTab: 'dashboard' };
    }
};
