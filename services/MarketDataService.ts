import { useSettingsStore } from '../store/settingsStore';
import {
    fetchInsiderTrades,
    fetchBulkDeals,
    fetchMacroIndicators,
    fetchGlobalIndices,
    fetchIndianIndices,
    hasAnyApiKey,
    InsiderTrade,
    BulkDeal,
    MacroIndicator,
    MarketQuote,
    FiiDiiData,
    ConsolidatedFiiDii,
    EconomicEvent,
    EarningsEvent,
    SectorHeatmapData,
    fetchFiiDiiData,
    fetchConsolidatedFiiDii,
    fetchEconomicCalendar,
    fetchEarningsCalendar,
    fetchSectorHeatmap,
    fetchAlphaInsight,
    fetchBulkInsight
} from './RealDataService';
import { logger } from './Logger';

class MarketDataService {

    private CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 Hours (Legacy Setting, RealDataService handles its own cache now)

    // Re-export methods from RealDataService for backward compatibility if needed,
    // or just implementation methods.

    async fetchInsiderTrades(forceRefresh = false): Promise<InsiderTrade[]> {
        // Delegate to RealDataService
        logger.debug('MarketDataService: Delegating Insider fetch to RealDataService');
        return fetchInsiderTrades();
    }

    async fetchBulkDeals(forceRefresh = false): Promise<BulkDeal[]> {
        // Delegate to RealDataService
        logger.debug('MarketDataService: Delegating Bulk fetch to RealDataService');
        return fetchBulkDeals();
    }

    async fetchMacroAndGlobal(forceRefresh = false): Promise<{
        macro: MacroIndicator[],
        global: MacroIndicator[]
    }> {
        logger.debug('MarketDataService: Delegating Macro/Global fetch to RealDataService');

        // Parallel fetch
        const [macro, global] = await Promise.all([
            fetchMacroIndicators(forceRefresh),
            fetchGlobalIndices(forceRefresh)
        ]);

        return { macro, global };
    }

    async fetchFiiDiiData(forceRefresh = false): Promise<FiiDiiData[]> {
        logger.debug('MarketDataService: Fetching FII/DII Data');
        return fetchFiiDiiData(forceRefresh);
    }

    async fetchEconomicCalendar(forceRefresh = false): Promise<EconomicEvent[]> {
        logger.debug('MarketDataService: Fetching Economic Calendar');
        return fetchEconomicCalendar(forceRefresh);
    }

    async fetchEarningsCalendar(forceRefresh = false): Promise<EarningsEvent[]> {
        logger.debug('MarketDataService: Fetching Earnings Calendar');
        return fetchEarningsCalendar(forceRefresh);
    }

    async fetchSectorHeatmap(forceRefresh = false): Promise<SectorHeatmapData[]> {
        logger.debug('MarketDataService: Fetching Sector Heatmap');
        return fetchSectorHeatmap(forceRefresh);
    }

    async fetchAlphaInsight(forceRefresh = false): Promise<{ ticker: string, insight: string }> {
        logger.debug('MarketDataService: Fetching Alpha Insight');
        return fetchAlphaInsight(forceRefresh);
    }

    async fetchBulkInsight(forceRefresh = false): Promise<string> {
        logger.debug('MarketDataService: Fetching Bulk Insight');
        return fetchBulkInsight(forceRefresh);
    }

    async fetchConsolidatedFiiDii(limit: number = 30, forceRefresh = false, mode: string = "1D"): Promise<ConsolidatedFiiDii[]> {
        logger.debug('MarketDataService: Fetching Consolidated FII/DII Data');
        return fetchConsolidatedFiiDii(limit, forceRefresh, mode);
    }

    // Helper to check if we are truly live
    isLive(): boolean {
        const { dataMode } = useSettingsStore.getState();
        return dataMode === 'LIVE';
    }
}

export const marketDataService = new MarketDataService();
export type { InsiderTrade, BulkDeal, MacroIndicator, MarketQuote, FiiDiiData, ConsolidatedFiiDii, EconomicEvent, EarningsEvent, SectorHeatmapData };
