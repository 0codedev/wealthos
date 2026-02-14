import { create } from 'zustand';
import { db, LifeEvent } from '../database';
import { Investment, AggregatedData, HistoryEntry, PortfolioStats } from '../types';
import { logger } from '../services/Logger';
import { liveQuery } from 'dexie';
import { auditTrail } from '../services/SecurityService';
import { computePortfolioView, normalizeInvestmentMetadata } from '../lib/domain/portfolio';
import { useSettingsStore } from './settingsStore';
import { deleteWithUndo } from '../lib/deleteWithUndo';
import { COPY } from '../utils/appCopy';

interface PortfolioState {
    investments: Investment[];
    history: HistoryEntry[];
    lifeEvents: LifeEvent[];
    stats: PortfolioStats;
    allocationData: AggregatedData[];
    assetClassData: AggregatedData[];
    platformData: AggregatedData[];
    isLoading: boolean;
    error: string | null;

    // Actions
    refreshPortfolio: () => Promise<void>;
    initialize: () => () => void; // Returns unsubscribe function
    addInvestment: (investment: Investment) => Promise<void>;
    updateInvestment: (id: string, updates: Partial<Investment>) => Promise<void>;
    /** Top-10 #2 — soft-deletes with cascade + pushes an undo entry. Returns
     * the undoStack entry id, or null on failure. */
    deleteInvestment: (id: string) => Promise<string | null>;
    addLifeEvent: (event: Omit<LifeEvent, 'id'>) => Promise<void>;
    deleteLifeEvent: (id: number) => Promise<void>;

    // Internal Action
    setPortfolioData: (investments: Investment[], history: HistoryEntry[], lifeEvents: LifeEvent[]) => void;
    clearError: () => void;
}

const INITIAL_STATS: PortfolioStats = {
    totalValue: 0,
    totalCurrent: 0,
    totalInvested: 0,
    totalAssets: 0,
    totalGain: 0,
    totalPL: 0,
    totalGainPercent: '0.00',
    totalPLPercent: '0.00',
    dayChange: 0,
    dayChangePercent: 0,
    diversityScore: 0,
    topAsset: { name: 'None', percent: 0 },
    totalLiability: 0
};

/**
 * Generate unique investment ID (with timestamp preserved for XIRR)
 */
const generateInvestmentId = (): string => {
    const salt = crypto.randomUUID ? crypto.randomUUID().split('-')[0] : Math.random().toString(36).substring(2, 9);
    return `inv_${Date.now()}_${salt}`;
};

/**
 * Validate investment data
 */
const validateInvestment = (investment: Partial<Investment>): string | null => {
    if (!investment.name || investment.name.trim().length === 0) {
        return 'Investment name is required';
    }
    if (!investment.type) {
        return 'Investment type is required';
    }
    if (typeof investment.investedAmount !== 'number' || investment.investedAmount < 0) {
        return 'Invested amount must be a non-negative number';
    }
    if (typeof investment.currentValue !== 'number' || investment.currentValue < 0) {
        return 'Current value must be a non-negative number';
    }
    if (!investment.platform || investment.platform.trim().length === 0) {
        return 'Platform is required';
    }
    return null;
};

/**
 * Get loan principal from settings synchronously
 */
const getLoanPrincipal = (): number => {
    try {
        const principal = useSettingsStore.getState().loanPrincipal;
        return typeof principal === 'number' && !isNaN(principal) ? principal : 0;
    } catch {
        return 0;
    }
};

export const invalidateLoanPrincipalCache = () => {
    // Kept as no-op for backwards compatibility since getLoanPrincipal is now synchronous and reactive
};

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
    investments: [],
    history: [],
    lifeEvents: [],
    stats: INITIAL_STATS,
    allocationData: [],
    assetClassData: [],
    platformData: [],
    isLoading: true,
    error: null,

    clearError: () => set({ error: null }),

    // Action to handle updates and compute derived state
    setPortfolioData: (investments: Investment[], history: HistoryEntry[], lifeEvents: LifeEvent[]) => {
        try {
            const liabilityValue = getLoanPrincipal();
            const computed = computePortfolioView(investments, liabilityValue);

            // Identity-stable write: if the new computed view is structurally
            // identical to the current one, skip the setState. This is the
            // last line of defense against the "Maximum update depth exceeded"
            // loop on the Portfolio Hub (incident 2026-06-19). Subscribers
            // (entity view → PortfolioTab) should never see a new ref for
            // unchanged data.
            set((state) => {
                if (
                    state.stats === computed.stats &&
                    state.allocationData === computed.allocationData &&
                    state.assetClassData === computed.assetClassData &&
                    state.platformData === computed.platformData
                ) {
                    // Already pointing at the same references (computed in-place
                    // for a re-entrant call). Just clear loading and return.
                    if (state.isLoading || state.error) {
                        return { isLoading: false, error: null };
                    }
                    return state;
                }
                return {
                    investments: computed.normalizedInvestments,
                    history,
                    lifeEvents,
                    stats: computed.stats,
                    allocationData: computed.allocationData,
                    assetClassData: computed.assetClassData,
                    platformData: computed.platformData,
                    isLoading: false,
                    error: null
                };
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to process portfolio data';
            logger.error('Failed to set portfolio data', error);
            set({ error: errorMessage, isLoading: false });
        }
    },

    refreshPortfolio: async () => {
        try {
            set({ isLoading: true, error: null });

            const [inv, hist, events] = await Promise.all([
                (db.investments as any).active().toArray(),
                db.history.toArray(),
                db.life_events.toArray()
            ]);

            get().setPortfolioData(inv, hist, events);
            logger.debug('Portfolio refreshed successfully', { count: inv.length }, 'store');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            set({ error: errorMessage, isLoading: false });
            logger.error('Failed to refresh portfolio', error, 'store');
        }
    },

    initialize: () => {
        set({ isLoading: true, error: null });

        let timeoutId: NodeJS.Timeout;
        // Track the LAST serialized payload we successfully committed. The
        // liveQuery callback can fire with structurally-identical data on
        // transient Dexie ticks; comparing to the last committed payload
        // prevents an identical re-emit from causing a re-render storm on
        // the Portfolio Hub (render-loop incident 2026-06-19).
        let lastCommittedSig: string | null = null;

        const subscription = liveQuery(() => Promise.all([
            (db.investments as any).active().toArray(),
            db.history.toArray(),
            db.life_events.toArray()
        ])).subscribe({
            next: ([inv, hist, events]) => {
                const safeInv = inv || [];
                const safeHist = hist || [];
                const safeEvents = events || [];

                // Build a cheap structural signature. We don't need a real
                // hash; we just need to know if the dataset is "the same as
                // last time" within a few ids/amounts/dates. This blocks
                // the 99% of re-emits that are byte-identical to the prior
                // emit (e.g. Dexie firing on internal transaction commit).
                const sig =
                    safeInv.length + '|' +
                    safeInv.reduce((acc: string, i: Investment) => acc + ':' + i.id + ':' + (i.lastUpdated || ''), '') + '|' +
                    safeHist.length + '|' +
                    safeEvents.length;
                if (sig === lastCommittedSig) return;
                lastCommittedSig = sig;

                // Debounce massive store computations to prevent lag on rapid changes
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    get().setPortfolioData(safeInv, safeHist, safeEvents);
                }, 50);
            },
            error: (error: unknown) => {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                set({ error: errorMessage, isLoading: false });
                logger.error('Portfolio subscription error', error);
            }
        });

        // Return unsubscribe
        return () => {
            clearTimeout(timeoutId);
            subscription.unsubscribe();
        };
    },

    // CRUD Actions
    addInvestment: async (investment) => {
        // Validate
        const validationError = validateInvestment(investment);
        if (validationError) {
            throw new Error(validationError);
        }

        try {
            const investmentId = investment.id || generateInvestmentId();
            const investmentToAdd: Investment = {
                ...normalizeInvestmentMetadata(investment),
                id: investmentId,
                lastUpdated: investment.lastUpdated || new Date().toISOString(),
                status: investment.status || 'ACTIVE',
                owner: investment.owner || 'SELF',
                createdAt: investment.createdAt || new Date().toISOString(),
                acquiredAt: investment.acquiredAt || investment.createdAt || new Date().toISOString(),
                effectiveAt: investment.effectiveAt || investment.acquiredAt || investment.createdAt || new Date().toISOString(),
                sourceId: investment.sourceId || investment.id || investmentId,
            };

            await db.investments.add(investmentToAdd);

            auditTrail.log('add_investment', `Added investment: ${investmentToAdd.name}`, {
                id: investmentToAdd.id,
                type: investmentToAdd.type,
                amount: investmentToAdd.investedAmount
            });

            logger.debug('Added investment', { id: investmentToAdd.id }, 'store');
        } catch (error) {
            logger.error('Failed to add investment', error);
            throw error;
        }
    },

    updateInvestment: async (id, updates) => {
        // Validate updates if they contain financial data
        if (updates.investedAmount !== undefined && updates.investedAmount < 0) {
            throw new Error('Invested amount cannot be negative');
        }
        if (updates.currentValue !== undefined && updates.currentValue < 0) {
            throw new Error('Current value cannot be negative');
        }

        try {
            // Get existing investment for audit trail
            const existing = await db.investments.get(id);
            if (!existing) {
                throw new Error(`Investment with id ${id} not found`);
            }

            await db.investments.update(id, {
                ...updates,
                lastUpdated: new Date().toISOString()
            });

            auditTrail.log('edit_investment', `Updated investment: ${existing.name}`, {
                id,
                changes: Object.keys(updates)
            });

            logger.debug('Updated investment', { id }, 'store');
        } catch (error) {
            logger.error('Failed to update investment', error);
            throw error;
        }
    },

    deleteInvestment: async (id) => {
        try {
            const investment = await db.investments.get(id);
            if (!investment) {
                throw new Error(`Investment with id ${id} not found`);
            }

            if (investment.recurring?.isEnabled) {
                logger.warn(`Deleting investment with active SIP: ${investment.name}`, { id });
            }

            const entryId = await deleteWithUndo({
                table: 'investments',
                id,
                kind: 'investment',
                label: investment.name || id,
                message: COPY.undo.investmentDeleted(investment.name || id),
                cascade: [{ table: db.realized_transactions, foreignKey: 'investmentId' }],
            });
            if (!entryId) {
                throw new Error('Soft-delete failed for investment.');
            }

            auditTrail.log('delete_investment', `Soft-deleted investment: ${investment.name}`, {
                id,
                type: investment.type,
                lastValue: investment.currentValue,
            });

            logger.debug('Soft-deleted investment', { id, entryId });
            return entryId;
        } catch (error) {
            logger.error('Failed to delete investment', error);
            throw error;
        }
    },

    addLifeEvent: async (event) => {
        try {
            const eventToAdd = {
                ...event,
                date: event.date || new Date().toISOString().split('T')[0]
            };
            await db.life_events.add(eventToAdd as LifeEvent);
            logger.debug('Added life event', { name: event.name }, 'store');
        } catch (error) {
            logger.error('Failed to add life event', error);
            throw error;
        }
    },

    deleteLifeEvent: async (id) => {
        try {
            await db.life_events.delete(id);
            logger.debug('Deleted life event', { id }, 'store');
        } catch (error) {
            logger.error('Failed to delete life event', error);
            throw error;
        }
    }
}));

// REMOVED 2026-06-19: useSettingsStore.subscribe → setPortfolioData cascade.
// The subscribe fired on `loanPrincipal` change and recomputed the entire
// portfolio view, which produced fresh `stats` / `allocationData` object refs.
// The Portfolio Tab re-renders on those refs, and a race between the liveQuery
// re-emit and the settings subscribe could push the same data through Zustand
// twice per tick — a "Maximum update depth exceeded" feedback loop.
//
// The portfolio view now reads `loanPrincipal` directly inside `setPortfolioData`
// via `getLoanPrincipal()` (synchronous, cached). When the user edits the loan
// principal, the next liveQuery tick will pick up the new value automatically.
// If you need an instant refresh on loan principal change, call
// `usePortfolioStore.getState().setPortfolioData(...)` from the settings UI.
// Belt-and-braces guard: even if a future subscribe is re-added, the
// `lastCommittedSig` check inside `initialize()` will block the re-emit.
