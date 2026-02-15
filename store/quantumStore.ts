/**
 * Quantum Phase 12 — Shared Zustand store.
 *
 * The store is the central nervous system of the new "Quantum" surface.
 * Every widget (QuantumConfluenceDeck, JarvisVoiceConsole, StrategyOptimizer,
 * WealthQuestMatrix, ResilienceCore) reads from it; every meaningful
 * user action (clicking a position, picking a shock, opening a signal)
 * is written to it. Zustand's selectors give sub-millisecond updates and
 * cross-component reactivity for free.
 */
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { logger } from '../services/Logger';
import type {
    QuantumState,
    ScenarioAxis,
    StrategyKind,
    QuestBranchId,
    TelemetrySource,
    ConfluenceSignal,
    QuantumAsset,
} from '../types/quantum';

const STORAGE_KEY = 'wealth_quantum_state_v1';

const initialState = {
    activeSymbol: null as string | null,
    activeAxis: 'NIFTY' as ScenarioAxis,
    activeShock: 0,
    activeStrategy: 'LONG_CALL' as StrategyKind,
    optimizerUnderlying: 'NIFTY',
    focusedBranch: 'QUANT' as QuestBranchId,
    focusedSignalId: null as string | null,
    closedTrades: [] as QuantumState['closedTrades'],
    profitability: null,
    risk: null,
    questMatrix: null,
    optimizerResult: null,
    telemetry: [] as TelemetrySource[],
    signals: [] as ConfluenceSignal[],
    assets: [] as QuantumAsset[],
};

export const useQuantumStore = create<QuantumState>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        setActiveSymbol: (symbol) => {
            if (get().activeSymbol === symbol) return;
            set({ activeSymbol: symbol });
            logger.info(`[Quantum] activeSymbol = ${symbol}`);
        },
        setActiveAxis: (axis) => set({ activeAxis: axis }),
        setActiveShock: (shock) => set({ activeShock: shock }),
        setActiveStrategy: (strategy) => set({ activeStrategy: strategy }),
        setOptimizerUnderlying: (symbol) => set({ optimizerUnderlying: symbol }),
        setFocusedBranch: (branch) => set({ focusedBranch: branch }),
        setFocusedSignalId: (id) => set({ focusedSignalId: id }),
        setClosedTrades: (trades) => set({ closedTrades: trades }),
        setProfitability: (p) => set({ profitability: p }),
        setRisk: (r) => set({ risk: r }),
        setQuestMatrix: (q) => set({ questMatrix: q }),
        setOptimizerResult: (r) => set({ optimizerResult: r }),
        setTelemetry: (t) => set({ telemetry: t }),
        setSignals: (s) => set({ signals: s }),
        upsertSignal: (s) => set((state) => {
            const idx = state.signals.findIndex(x => x.id === s.id);
            if (idx >= 0) {
                const next = [...state.signals];
                next[idx] = s;
                return { signals: next };
            }
            return { signals: [s, ...state.signals].slice(0, 100) };
        }),
        setAssets: (assets) => set({ assets }),
    }))
);

// Lightweight localStorage hydration for non-serialisable runtime state.
if (typeof window !== 'undefined') {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<QuantumState>;
            // Only restore the simple, persistent fields — never trades/assets/telemetry.
            useQuantumStore.setState((prev) => ({
                ...prev,
                activeSymbol: parsed.activeSymbol ?? prev.activeSymbol,
                activeAxis: parsed.activeAxis ?? prev.activeAxis,
                activeStrategy: parsed.activeStrategy ?? prev.activeStrategy,
                optimizerUnderlying: parsed.optimizerUnderlying ?? prev.optimizerUnderlying,
                focusedBranch: parsed.focusedBranch ?? prev.focusedBranch,
            }));
        }
    } catch (err) {
        logger.warn('[Quantum] localStorage hydration skipped', err);
    }

    useQuantumStore.subscribe(
        (state) => ({
            activeSymbol: state.activeSymbol,
            activeAxis: state.activeAxis,
            activeStrategy: state.activeStrategy,
            optimizerUnderlying: state.optimizerUnderlying,
            focusedBranch: state.focusedBranch,
        }),
        (slice) => {
            try {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
            } catch {
                /* ignore quota errors */
            }
        },
        {
            equalityFn: (a, b) =>
                a.activeSymbol === b.activeSymbol &&
                a.activeAxis === b.activeAxis &&
                a.activeStrategy === b.activeStrategy &&
                a.optimizerUnderlying === b.optimizerUnderlying &&
                a.focusedBranch === b.focusedBranch,
        }
    );
}
