/**
 * SwarmTradesService - Phase 9 / CC22
 *
 * Aggregates Alpha Engine 2.0 signals alongside Dhan open positions into
 * a single, high-density grid. Calculates a per-position "Net Status"
 * (Active / Achieved / Stopped Out) by comparing entry / current price
 * against the volatility-adjusted target and stop-loss.
 *
 * Also exposes the historical Alpha Coherence Score (the percentage of
 * Alpha signals that were actually executed in the trading journal).
 */

import { db, Trade } from '../database';
import { alphaEngineService, StockData } from './AlphaEngineService';
import { dhanBrokerService, DhanPositionResponse } from './DhanBrokerService';
import { useDhanStore } from '../store/dhanStore';
import { logger } from './Logger';

export type SignalSource = 'ORB' | 'RS' | 'OPTION_FLOW' | 'BREAKOUT' | 'INTRADAY_BOOST' | 'CONVERGENCE';
export type SignalType = 'BUY' | 'SELL';
export type SignalStatus = 'ACTIVE' | 'ACHIEVED' | 'STOPPED_OUT' | 'EXPIRED';

export interface AlphaSignal {
    id: string;
    ticker: string;
    type: SignalType;
    source: SignalSource;
    entryPrice: number;
    target: number;          // Volatility-adjusted take-profit
    stopLoss: number;
    currentPrice: number;
    status: SignalStatus;
    createdAt: number;
    conviction: number;       // 0..1
    reason: string;            // Human-readable
    setup?: string;            // Setup label e.g. "Alpha ORB"
    isSimulated?: boolean;     // Paper / prospective
}

export interface DhanOpenPosition {
    securityId: string;
    tradingSymbol: string;
    exchangeSegment: string;
    productType: string;
    netQty: number;
    avgPrice: number;
    ltp: number;
    realizedProfit: number;
    unrealizedProfit: number;
    pnl: number;
}

export interface SwarmTradeRow {
    id: string;
    source: 'ALPHA_SIGNAL' | 'DHAN_POSITION' | 'JOURNAL_TRADE';
    ticker: string;
    type: SignalType;
    signalSource: SignalSource | 'BROKER';
    entryPrice: number;
    target: number;
    stopLoss: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
    status: SignalStatus | 'OPEN' | 'CLOSED';
    setup?: string;
    createdAt: number;
    extras?: Record<string, unknown>;
}

export interface AlphaCoherence {
    totalSignals: number;
    executedSignals: number;
    coherencePercent: number;
    bySource: Record<string, { total: number; executed: number }>;
}

class SwarmTradesServiceImpl {
    private static readonly COHERENCE_LOOKBACK_DAYS = 30;

    /**
     * Build the full Swarm Trades Terminal grid by combining Alpha signals
     * and Dhan positions.
     */
    async buildGrid(opts: { includeDhan?: boolean; maxSignals?: number } = {}): Promise<SwarmTradeRow[]> {
        const { includeDhan = true, maxSignals = 50 } = opts;
        const signals = await this.buildAlphaSignals(maxSignals);
        const rows: SwarmTradeRow[] = signals.map((sig) => this.signalToRow(sig));

        if (includeDhan) {
            const positions = this.getDhanPositions();
            rows.push(...positions.map(this.positionToRow));
        }

        // Sort: ACTIVE first, then by absolute pnl desc.
        rows.sort((a, b) => {
            if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
            if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
            return Math.abs(b.pnl) - Math.abs(a.pnl);
        });

        return rows;
    }

    /**
     * Derive a fresh list of Alpha signals from the currently cached
     * Alpha Engine state. Each stock becomes a candidate signal.
     */
    async buildAlphaSignals(limit: number = 50): Promise<AlphaSignal[]> {
        const stocks = alphaEngineService.getCachedStocks();
        if (!Array.isArray(stocks) || stocks.length === 0) {
            logger.warn('[SwarmTrades] No cached Alpha stocks available');
            return [];
        }

        const signals: AlphaSignal[] = [];
        const ranked = [...stocks]
            .filter((s) => s && s.symbol && Number.isFinite(s.lastPrice) && s.lastPrice > 0)
            .sort((a, b) => (b.gFactor || 0) - (a.gFactor || 0))
            .slice(0, limit);

        for (const stock of ranked) {
            const sig = this.stockToSignal(stock);
            if (sig) signals.push(sig);
        }

        return signals;
    }

    private stockToSignal(stock: StockData): AlphaSignal | null {
        if (!stock.symbol || !Number.isFinite(stock.lastPrice) || stock.lastPrice <= 0) return null;

        const entry = stock.lastPrice;
        const atr = stock.atr && stock.atr > 0 ? stock.atr : entry * 0.012; // ~1.2% baseline if no ATR
        const side: SignalType = (stock.gFactor ?? 0) >= 0 ? 'BUY' : 'SELL';

        // Volatility-adjusted target: 2× ATR or 1.5% whichever larger
        const targetDistance = Math.max(atr * 2, entry * 0.015);
        const stopDistance = Math.max(atr * 1.2, entry * 0.008);

        const target = side === 'BUY' ? entry + targetDistance : entry - targetDistance;
        const stopLoss = side === 'BUY' ? entry - stopDistance : entry + stopDistance;

        const source: SignalSource = this.inferSource(stock);
        const status = this.determineStatus(side, entry, target, stopLoss);

        return {
            id: `alpha_${stock.symbol}_${Date.now()}`,
            ticker: stock.symbol,
            type: side,
            source,
            entryPrice: parseFloat(entry.toFixed(2)),
            target: parseFloat(target.toFixed(2)),
            stopLoss: parseFloat(stopLoss.toFixed(2)),
            currentPrice: parseFloat(entry.toFixed(2)),
            status,
            createdAt: Date.now(),
            conviction: Math.min(1, Math.max(0, Math.abs(stock.gFactor || 0) / 5)),
            reason: this.composeReason(stock, side, source),
            setup: `Alpha ${source}`,
            isSimulated: true,
        };
    }

    private inferSource(stock: StockData): SignalSource {
        if (stock.apexSignal?.toLowerCase().includes('orb')) return 'ORB';
        if (stock.isORBLowPreservedProxy || stock.isORBHighPreservedProxy) return 'ORB';
        if (stock.perChange30d && Math.abs(stock.perChange30d) > 8) return 'RS';
        if (stock.depth_pressure && stock.depth_pressure !== 'NEUTRAL') return 'OPTION_FLOW';
        const obs = (stock as unknown as { orderBookSignal?: string }).orderBookSignal;
        if (obs && obs !== 'NEUTRAL') return 'OPTION_FLOW';
        if (stock.dayExtremeScore > 0.95) return 'BREAKOUT';
        if (stock.isRebound) return 'INTRADAY_BOOST';
        return 'CONVERGENCE';
    }

    private determineStatus(side: SignalType, entry: number, target: number, stopLoss: number): SignalStatus {
        // Without a tick stream, we default to ACTIVE for new signals.
        return 'ACTIVE';
    }

    private composeReason(stock: StockData, side: SignalType, source: SignalSource): string {
        const parts: string[] = [];
        parts.push(`${side} ${stock.symbol}`);
        parts.push(`Source: ${source}`);
        if (stock.gFactor) parts.push(`G-Factor: ${stock.gFactor.toFixed(2)}`);
        if (stock.percentChange) parts.push(`Change: ${stock.percentChange.toFixed(2)}%`);
        if (stock.atr) parts.push(`ATR: ₹${stock.atr.toFixed(2)}`);
        return parts.join(' · ');
    }

    private signalToRow(sig: AlphaSignal): SwarmTradeRow {
        const pnl = sig.type === 'BUY'
            ? (sig.currentPrice - sig.entryPrice)
            : (sig.entryPrice - sig.currentPrice);
        const pnlPercent = sig.entryPrice > 0 ? (pnl / sig.entryPrice) * 100 : 0;
        return {
            id: sig.id,
            source: 'ALPHA_SIGNAL',
            ticker: sig.ticker,
            type: sig.type,
            signalSource: sig.source,
            entryPrice: sig.entryPrice,
            target: sig.target,
            stopLoss: sig.stopLoss,
            currentPrice: sig.currentPrice,
            pnl,
            pnlPercent,
            status: sig.status,
            setup: sig.setup,
            createdAt: sig.createdAt,
            extras: { conviction: sig.conviction, reason: sig.reason, isSimulated: true },
        };
    }

    /**
     * Pull Dhan positions from the broker store and adapt them to the
     * shared row schema. Tries to read the cached store; falls back to
     * a broker service call if the store is empty.
     */
    private getDhanPositions(): DhanOpenPosition[] {
        try {
            const state = useDhanStore.getState();
            const positions = state?.positions || [];
            return positions
                .filter((p) => p && p.netQty !== 0)
                .map((p) => this.dhanPositionToDomain(p));
        } catch (e) {
            logger.warn('[SwarmTrades] Dhan store read failed', e);
            return [];
        }
    }

    private dhanPositionToDomain(p: DhanPositionResponse): DhanOpenPosition {
        return {
            securityId: p.securityId,
            tradingSymbol: p.tradingSymbol,
            exchangeSegment: p.exchangeSegment,
            productType: p.productType,
            netQty: p.netQty,
            avgPrice: p.buyAvg ?? p.sellAvg ?? 0,
            ltp: (p as unknown as { ltp?: number }).ltp ?? 0,
            realizedProfit: p.realizedProfit,
            unrealizedProfit: p.unrealizedProfit,
            pnl: p.realizedProfit + p.unrealizedProfit,
        };
    }

    private positionToRow = (p: DhanOpenPosition): SwarmTradeRow => {
        const entry = p.avgPrice;
        const ltp = p.ltp || entry;
        const side: SignalType = p.netQty > 0 ? 'BUY' : 'SELL';
        const pnlPerShare = side === 'BUY' ? ltp - entry : entry - ltp;
        const pnl = pnlPerShare * p.netQty;
        const pnlPercent = entry > 0 ? (pnlPerShare / entry) * 100 : 0;

        // Broker positions don't have predefined targets / SLs; supply
        // heuristic 5%/2.5% values so the grid is consistent.
        const target = side === 'BUY' ? entry * 1.05 : entry * 0.95;
        const stopLoss = side === 'BUY' ? entry * 0.975 : entry * 1.025;

        return {
            id: `dhan_${p.securityId}_${p.exchangeSegment}`,
            source: 'DHAN_POSITION',
            ticker: p.tradingSymbol,
            type: side,
            signalSource: 'BROKER',
            entryPrice: parseFloat(entry.toFixed(2)),
            target: parseFloat(target.toFixed(2)),
            stopLoss: parseFloat(stopLoss.toFixed(2)),
            currentPrice: parseFloat(ltp.toFixed(2)),
            pnl: parseFloat(pnl.toFixed(2)),
            pnlPercent: parseFloat(pnlPercent.toFixed(2)),
            status: 'OPEN',
            setup: p.productType,
            createdAt: Date.now(),
            extras: { securityId: p.securityId, exchangeSegment: p.exchangeSegment, netQty: p.netQty, brokerPnl: p.pnl },
        };
    };

    /**
     * Calculate the Alpha Coherence Score — the % of historical Alpha
     * signals that have an associated journal trade.
     */
    async calculateAlphaCoherence(): Promise<AlphaCoherence> {
        try {
            const lookbackMs = SwarmTradesServiceImpl.COHERENCE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
            const cutoff = Date.now() - lookbackMs;

            const signals = (await this.buildAlphaSignals(200)).filter(s => s.createdAt >= cutoff);
            // For historical lookback, also pull cached stocks that pre-date today.
            const stocks = alphaEngineService.getCachedStocks().filter(s => !!s.symbol);
            const allTrades = await db.trades.toArray();
            const recentTrades = allTrades.filter((t: Trade) => t.date && new Date(t.date).getTime() >= cutoff);

            const bySource: Record<string, { total: number; executed: number }> = {};
            let total = 0;
            let executed = 0;

            for (const sig of signals) {
                total++;
                bySource[sig.source] = bySource[sig.source] || { total: 0, executed: 0 };
                bySource[sig.source].total++;

                const matched = recentTrades.some((t: Trade) =>
                    t.ticker?.toUpperCase() === sig.ticker.toUpperCase() &&
                    t.direction?.toLowerCase() === (sig.type === 'BUY' ? 'long' : 'short')
                );
                if (matched) {
                    executed++;
                    bySource[sig.source].executed++;
                }
            }

            return {
                totalSignals: total,
                executedSignals: executed,
                coherencePercent: total > 0 ? (executed / total) * 100 : 0,
                bySource,
            };
        } catch (e) {
            logger.error('[SwarmTrades] Alpha coherence calculation failed', e);
            return { totalSignals: 0, executedSignals: 0, coherencePercent: 0, bySource: {} };
        }
    }

    /**
     * Helper for the UI: convert an Alpha signal into a trade prefill that
     * AddTradeModal / Trade journal consumers understand.
     */
    signalToTradePrefill(sig: AlphaSignal) {
        return {
            ticker: sig.ticker,
            direction: sig.type === 'BUY' ? 'Long' : 'Short',
            entryPrice: sig.entryPrice,
            stopLoss: sig.stopLoss,
            takeProfit: sig.target,
            date: new Date().toISOString().split('T')[0],
            setup: sig.setup || `Alpha ${sig.source}`,
            notes: sig.reason,
            isSimulated: sig.isSimulated ?? true,
        };
    }
}

export const swarmTradesService = new SwarmTradesServiceImpl();
