import { dhanBrokerService } from './DhanBrokerService';

class DhanMarketDataService {
    fetchFundLimit() {
        return dhanBrokerService.fetchFundLimit();
    }

    fetchPositions() {
        return dhanBrokerService.fetchPositions();
    }

    getIndexQuotes() {
        return dhanBrokerService.getIndexQuotes();
    }

    getStockLTP(ticker: string) {
        return dhanBrokerService.getStockLTP(ticker);
    }

    getBatchStockLTP(tickers: string[]) {
        return dhanBrokerService.getBatchStockLTP(tickers);
    }

    getIndiaVIX() {
        return dhanBrokerService.getIndiaVIX();
    }
}

export const dhanMarketDataService = new DhanMarketDataService();
