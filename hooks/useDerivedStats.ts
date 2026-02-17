import { useMemo } from 'react';
import { Investment, PortfolioStats } from '../types';
import { computePortfolioView } from '../lib/domain/portfolio';
import { useSettingsStore } from '../store/settingsStore';

export const useDerivedStats = (investments: Investment[], globalStats: PortfolioStats) => {
    return useMemo(() => {
        const loanPrincipal = useSettingsStore.getState().loanPrincipal || 0;
        const computed = computePortfolioView(investments, loanPrincipal, globalStats);
        return {
            stats: computed.stats,
            allocationData: computed.allocationData,
            assetClassData: computed.assetClassData,
            platformData: computed.platformData,
        };
    }, [investments, globalStats]);
};
