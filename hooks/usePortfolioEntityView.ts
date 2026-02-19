import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AggregatedData, Investment, PortfolioStats } from '../types';
import { usePortfolioStore } from '../store/portfolioStore';
import { useSettingsStore } from '../store/settingsStore';
import { selectInvestmentsForEntity, computePortfolioView } from '../lib/domain/portfolio';

export interface PortfolioEntityView {
    investments: Investment[];
    stats: PortfolioStats;
    allocationData: AggregatedData[];
}

export const usePortfolioEntityView = (
    activeEntity: Investment['owner'] | 'ALL'
): PortfolioEntityView => {
    const allInvestments = usePortfolioStore(useShallow(s => s.investments));
    const globalStats = usePortfolioStore(useShallow(s => s.stats));
    const globalAllocationData = usePortfolioStore(useShallow(s => s.allocationData));

    return useMemo(() => {
        const investments = selectInvestmentsForEntity(allInvestments, activeEntity);

        if (activeEntity === 'ALL') {
            return {
                investments,
                stats: globalStats,
                allocationData: globalAllocationData,
            };
        }

        const loanPrincipal = useSettingsStore.getState().loanPrincipal || 0;
        const computed = computePortfolioView(investments, loanPrincipal, globalStats);
        return {
            investments,
            stats: computed.stats,
            allocationData: computed.allocationData,
        };
    }, [allInvestments, globalStats, globalAllocationData, activeEntity]);
};
