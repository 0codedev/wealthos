import { useState, useEffect, useMemo, useCallback } from 'react';
import { liveQuery } from 'dexie';
import { db, LifeEvent } from '../database';
import { Investment, AggregatedData, InvestmentType } from '../types';
import { useSettingsStore } from '../store/settingsStore';
import { logger } from '../services/Logger';

export interface PortfolioStats {
    totalValue: number;
    totalCurrent: number;
    totalInvested: number;
    totalAssets: number;
    totalGain: number;
    totalPL: number;
    totalGainPercent: string;
    totalPLPercent: string;
    dayChange: number;
    dayChangePercent: number;
    diversityScore: number;
    topAsset: { name: string; percent: number };
    totalLiability?: number; // Added to match usage
}

export function usePortfolio() {
    const [investments, setInvestments] = useState<Investment[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [lifeEvents, setLifeEvents] = useState<LifeEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const subInv = liveQuery(() => db.investments.toArray()).subscribe(data => {
            setInvestments(data);
            setIsLoading(false);
        });
        const subHist = liveQuery(() => db.history.toArray()).subscribe(setHistory);
        const subEvents = liveQuery(() => db.life_events.toArray()).subscribe(setLifeEvents);

        return () => {
            subInv.unsubscribe();
            subHist.unsubscribe();
            subEvents.unsubscribe();
        };
    }, []);

    const { loanPrincipal } = useSettingsStore();

    // Calculate stats
    const stats: PortfolioStats = useMemo(() => {
        // Filter out hidden assets for calculations
        const activeInvestments = investments.filter(inv => !inv.isHiddenFromTotals);

        // Audit Fix: Implement paise math to prevent floating point drift during aggregation
        const totalValue = activeInvestments.reduce((sum, inv) => sum + Math.round((inv.currentValue || 0) * 100), 0) / 100;
        const totalInvested = activeInvestments.reduce((sum, inv) => sum + Math.round((inv.investedAmount || 0) * 100), 0) / 100;

        // Liability Logic
        const liabilityValue = Number(loanPrincipal) || 0;

        // Net Worth = Assets - Liabilities
        const netWorth = totalValue - liabilityValue;

        const totalGain = totalValue - totalInvested;
        const totalGainPercent = totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(2) : '0.00';

        // Diversity score based on unique asset types
        const uniqueTypes = new Set(activeInvestments.map(i => i.type));
        const diversityScore = Math.min(100, uniqueTypes.size * 15);

        // Find top performing asset
        let topAsset = { name: 'None', percent: 0 };
        if (activeInvestments.length > 0) {
            const sortedByGain = [...activeInvestments].sort((a, b) => {
                const gainA = ((a.currentValue || 0) - (a.investedAmount || 0)) / (a.investedAmount || 1) * 100;
                const gainB = ((b.currentValue || 0) - (b.investedAmount || 0)) / (b.investedAmount || 1) * 100;
                return gainB - gainA;
            });
            const top = sortedByGain[0];
            const topGain = ((top.currentValue || 0) - (top.investedAmount || 0)) / (top.investedAmount || 1) * 100;
            topAsset = { name: top.name, percent: topGain };
        }

        return {
            totalValue: netWorth, // Used as main display value (Net Worth)
            totalCurrent: netWorth,
            totalAssets: totalValue, // Gross Assets
            totalLiability: liabilityValue, // Active Liability
            totalInvested,
            totalGain,
            totalPL: totalGain,
            totalGainPercent,
            totalPLPercent: totalGainPercent,
            dayChange: 0,
            dayChangePercent: 0,
            diversityScore,
            topAsset
        };
    }, [investments, loanPrincipal]);

    // Aggregated data by type
    const allocationData: AggregatedData[] = useMemo(() => {
        const map = new Map<string, number>();
        investments.filter(inv => !inv.isHiddenFromTotals).forEach(inv => {
            const current = map.get(inv.name) || 0;
            map.set(inv.name, current + (inv.currentValue || 0));
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
    }, [investments]);

    const assetClassData: AggregatedData[] = useMemo(() => {
        const map = new Map<string, number>();
        investments.filter(inv => !inv.isHiddenFromTotals).forEach(inv => {
            const current = map.get(inv.type) || 0;
            map.set(inv.type, current + (inv.currentValue || 0));
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
    }, [investments]);

    const platformData: AggregatedData[] = useMemo(() => {
        const map = new Map<string, number>();
        investments.filter(inv => !inv.isHiddenFromTotals).forEach(inv => {
            const platform = inv.platform || 'Unknown';
            const current = map.get(platform) || 0;
            map.set(platform, current + (inv.currentValue || 0));
        });
        return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
    }, [investments]);

    // Projection data (simple linear projection)
    // Projection data (Monte Carlo Approximation)
    const projectionData = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const startValue = stats.totalValue || 0;

        // Generate 10 years of data
        return Array.from({ length: 11 }, (_, i) => {
            const year = currentYear + i;
            // Base: 12% | Bull: 18% | Bear: 6% CAGR
            return {
                date: year.toString(),
                base: Math.round(startValue * Math.pow(1.12, i)),
                bull: Math.round(startValue * Math.pow(1.18, i)),
                bear: Math.round(startValue * Math.pow(1.06, i)),
                eventMarker: i === 3 || i === 7 // Mock markers for visual test
            };
        });
    }, [stats.totalValue]);

    // CRUD Operations
    const addInvestment = useCallback(async (investment: Investment) => {
        try {
            // Generate ID if not provided (Dexie investments table uses 'id' not '++id')
            const investmentToAdd = {
                ...investment,
                id: investment.id || `inv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
            };
            await db.investments.add(investmentToAdd);
            logger.debug('Investment added successfully', { id: investmentToAdd.id, name: investment.name }, 'usePortfolio');
        } catch (error) {
            logger.error('Failed to add investment', error, 'usePortfolio');
            throw error; // Re-throw for caller to handle
        }
    }, []);

    const updateInvestment = useCallback(async (id: string, updates: Partial<Investment>) => {
        try {
            await db.investments.update(id, updates);
            logger.debug('Investment updated successfully', { id, updates: Object.keys(updates) }, 'usePortfolio');
        } catch (error) {
            logger.error('Failed to update investment', error, 'usePortfolio');
            throw error;
        }
    }, []);

    const deleteInvestment = useCallback(async (id: string) => {
        try {
            await db.investments.delete(id);
            logger.debug('Investment deleted successfully', { id }, 'usePortfolio');
        } catch (error) {
            logger.error('Failed to delete investment', error, 'usePortfolio');
            throw error;
        }
    }, []);

    const addLifeEvent = useCallback(async (event: Omit<LifeEvent, 'id'>) => {
        try {
            await db.life_events.add(event as LifeEvent);
            logger.debug('Life event added successfully', { name: event.name }, 'usePortfolio');
        } catch (error) {
            logger.error('Failed to add life event', error, 'usePortfolio');
            throw error;
        }
    }, []);

    const deleteLifeEvent = useCallback(async (id: number) => {
        try {
            await db.life_events.delete(id);
            logger.debug('Life event deleted successfully', { id }, 'usePortfolio');
        } catch (error) {
            logger.error('Failed to delete life event', error, 'usePortfolio');
            throw error;
        }
    }, []);

    const refreshRecurringInvestments = useCallback(async () => {
        logger.debug('Refreshing recurring investments', undefined, 'usePortfolio');
        // Placeholder for recurring investment logic
    }, []);

    const refreshData = useCallback(async () => {
        logger.debug('Refreshing data', undefined, 'usePortfolio');
        // Force re-query
    }, []);

    return {
        investments,
        stats,
        allocationData,
        assetClassData,
        platformData,
        projectionData,
        history,
        lifeEvents,
        isLoading,
        addInvestment,
        updateInvestment,
        deleteInvestment,
        addLifeEvent,
        deleteLifeEvent,
        refreshRecurringInvestments,
        refreshData
    };
}

export default usePortfolio;
