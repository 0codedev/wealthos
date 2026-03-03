import {
    dhanBrokerService,
    DhanGTTOrderRequest,
    DhanMarginRequest,
    DhanOrderRequest
} from './DhanBrokerService';
import { usePortfolioStore } from '../store/portfolioStore';
import { dhanMarketDataService } from './DhanMarketDataService';
import { inferMarketContext } from './RiskEngine';

export interface OrderPreflightIssue {
    code: string;
    severity: 'high' | 'medium' | 'low';
    title: string;
    message: string;
    blocking: boolean;
}

export interface OrderPreflightResult {
    estimatedPrice: number;
    orderValue: number;
    requiredMargin: number | null;
    availableBalance: number | null;
    currentTickerExposure: number;
    projectedTickerExposure: number;
    projectedTickerExposurePercent: number;
    riskRewardRatio?: number | null;
    issues: OrderPreflightIssue[];
}

interface OrderPreflightInput {
    request: DhanOrderRequest;
    estimatedPrice: number;
    totalAssets: number;
    currentTickerExposure: number;
    availableBalance: number | null;
    requiredMargin: number | null;
    vix: number;
    stopLossPoints?: number;
    targetPoints?: number;
}

const LEVERAGED_PRODUCTS = new Set(['INTRADAY', 'MARGIN', 'MTF', 'BO', 'CO']);

export const buildOrderPreflight = ({
    request,
    estimatedPrice,
    totalAssets,
    currentTickerExposure,
    availableBalance,
    requiredMargin,
    vix,
    stopLossPoints,
    targetPoints,
}: OrderPreflightInput): OrderPreflightResult => {
    const issues: OrderPreflightIssue[] = [];
    const orderValue = Math.max(0, estimatedPrice * (request.quantity || 0));
    const buyExposure = request.transactionType === 'BUY'
        ? currentTickerExposure + orderValue
        : Math.max(0, currentTickerExposure - orderValue);
    const projectedTickerExposurePercent = totalAssets > 0 ? (buyExposure / totalAssets) * 100 : 0;
    const riskRewardRatio = stopLossPoints && targetPoints && stopLossPoints > 0
        ? targetPoints / stopLossPoints
        : null;

    if (!request.securityId) {
        issues.push({
            code: 'missing-security-id',
            severity: 'medium',
            title: 'Missing broker security mapping',
            message: 'This order is missing a Dhan security ID, which makes broker validation less reliable.',
            blocking: false,
        });
    }

    if (availableBalance === null) {
        issues.push({
            code: 'missing-funds',
            severity: 'low',
            title: 'Runway unavailable',
            message: 'Available Dhan balance could not be fetched, so this preview cannot confirm buying power.',
            blocking: false,
        });
    }

    const capitalNeeded = requiredMargin ?? orderValue;
    if (availableBalance !== null && capitalNeeded > availableBalance) {
        issues.push({
            code: 'insufficient-balance',
            severity: 'high',
            title: 'Insufficient buying power',
            message: `This order needs about Rs ${Math.round(capitalNeeded).toLocaleString('en-IN')} but only Rs ${Math.round(availableBalance).toLocaleString('en-IN')} is available.`,
            blocking: true,
        });
    }

    if (projectedTickerExposurePercent >= 50) {
        issues.push({
            code: 'extreme-concentration',
            severity: 'high',
            title: 'Extreme single-stock concentration',
            message: `This trade would push ${request.tradingSymbol} to about ${projectedTickerExposurePercent.toFixed(1)}% of tracked assets.`,
            blocking: true,
        });
    } else if (projectedTickerExposurePercent >= 35) {
        issues.push({
            code: 'high-concentration',
            severity: 'medium',
            title: 'High single-stock concentration',
            message: `This trade would take ${request.tradingSymbol} above ${projectedTickerExposurePercent.toFixed(1)}% of tracked assets.`,
            blocking: false,
        });
    }

    if (LEVERAGED_PRODUCTS.has(request.productType) && vix >= 24) {
        issues.push({
            code: 'leveraged-volatility',
            severity: 'high',
            title: 'Leveraged order in elevated volatility',
            message: `India VIX is around ${vix.toFixed(1)}. Leveraged exposure is riskier in this regime.`,
            blocking: false,
        });
    }

    if (request.orderType === 'MARKET' && vix >= 18) {
        issues.push({
            code: 'market-order-volatility',
            severity: 'medium',
            title: 'Market order in volatile tape',
            message: 'A market order can slip quickly when volatility is elevated. Consider a limit price.',
            blocking: false,
        });
    }

    if (request.transactionType === 'BUY' && totalAssets > 0 && (orderValue / totalAssets) >= 0.2) {
        issues.push({
            code: 'large-order-size',
            severity: 'medium',
            title: 'Large order versus portfolio',
            message: `This order is ${(orderValue / totalAssets * 100).toFixed(1)}% of your tracked assets.`,
            blocking: false,
        });
    }

    if (riskRewardRatio !== null && riskRewardRatio < 1.2) {
        issues.push({
            code: 'weak-risk-reward',
            severity: 'medium',
            title: 'Weak risk-reward profile',
            message: `The projected reward-to-risk ratio is only ${riskRewardRatio.toFixed(2)}.`,
            blocking: false,
        });
    }

    if (request.transactionType === 'BUY' && LEVERAGED_PRODUCTS.has(request.productType) && !stopLossPoints) {
        issues.push({
            code: 'missing-stop-loss',
            severity: 'medium',
            title: 'No explicit stop-loss',
            message: 'Leveraged buy orders should usually have a defined stop-loss before execution.',
            blocking: false,
        });
    }

    try {
        const { psychologyPredictor } = require('./ml/PsychologyPredictor');
        const psychPred = psychologyPredictor.getLatestPrediction?.();
        if (psychPred && psychPred.recommendation === 'STOP_TRADING') {
            issues.push({
                code: 'PSYCHOLOGY_STOP_TRADING',
                severity: 'high',
                title: 'Psychological Risk Guard (Domain 11)',
                message: 'Order execution blocked due to high revenge/tilt risk state. Take a break to reset discipline.',
                blocking: true,
            });
        }
    } catch {}

    return {
        estimatedPrice,
        orderValue,
        requiredMargin,
        availableBalance,
        currentTickerExposure,
        projectedTickerExposure: buyExposure,
        projectedTickerExposurePercent,
        riskRewardRatio,
        issues,
    };
};

interface PreviewOptions {
    currentPrice?: number;
    stopLossPoints?: number;
    targetPoints?: number;
}

interface ExecuteOptions extends PreviewOptions {
    force?: boolean;
}

export const buildOrderPreviewFingerprint = (
    request: DhanOrderRequest,
    options: PreviewOptions = {},
): string => JSON.stringify({
    request,
    currentPrice: options.currentPrice ?? null,
    stopLossPoints: options.stopLossPoints ?? null,
    targetPoints: options.targetPoints ?? null,
});

export const isOrderPreviewFresh = (
    previewFingerprint: string | null | undefined,
    nextFingerprint: string,
    previewedAt: number | null | undefined,
    maxAgeMs: number = 90_000,
): boolean => {
    if (!previewFingerprint || !previewedAt) return false;
    if (previewFingerprint !== nextFingerprint) return false;
    return (Date.now() - previewedAt) <= maxAgeMs;
};

class DhanOrderService {
    async previewOrder(request: DhanOrderRequest, options: PreviewOptions = {}): Promise<OrderPreflightResult> {
        const investments = usePortfolioStore.getState().investments;
        const totalAssets = investments.reduce((sum, investment) => sum + (investment.currentValue || 0), 0);
        const currentTickerExposure = investments
            .filter((investment) => (investment.ticker || investment.name).toUpperCase() === request.tradingSymbol.toUpperCase())
            .reduce((sum, investment) => sum + (investment.currentValue || 0), 0);

        const liveQuote = options.currentPrice
            ? { price: options.currentPrice }
            : await dhanMarketDataService.getStockLTP(request.tradingSymbol).catch(() => null);
        const estimatedPrice = request.orderType === 'MARKET'
            ? (liveQuote?.price || request.price || 0)
            : (request.price || liveQuote?.price || 0);

        let availableBalance: number | null = null;
        try {
            const fundLimit = await dhanMarketDataService.fetchFundLimit();
            availableBalance = fundLimit?.availabelBalance ?? null;
        } catch {
            availableBalance = null;
        }

        let requiredMargin: number | null = null;
        if (request.securityId && estimatedPrice > 0) {
            try {
                const margin = await this.calculateMargin({
                    exchangeSegment: request.exchangeSegment,
                    transactionType: request.transactionType,
                    quantity: request.quantity,
                    productType: request.productType,
                    securityId: request.securityId,
                    price: estimatedPrice,
                    triggerPrice: request.triggerPrice,
                });
                requiredMargin = margin?.totalMargin ?? null;
            } catch {
                requiredMargin = null;
            }
        }

        const vixQuote = await dhanMarketDataService.getIndiaVIX().catch(() => null);
        const vix = vixQuote?.value || inferMarketContext(investments, 16).vix;

        return buildOrderPreflight({
            request,
            estimatedPrice,
            totalAssets,
            currentTickerExposure,
            availableBalance,
            requiredMargin,
            vix,
            stopLossPoints: options.stopLossPoints,
            targetPoints: options.targetPoints,
        });
    }

    async executeGuardedOrder(request: DhanOrderRequest, options: ExecuteOptions = {}) {
        const preview = await this.previewOrder(request, options);
        const blockingIssues = preview.issues.filter((issue) => issue.blocking);

        if (blockingIssues.length > 0 && !options.force) {
            const message = blockingIssues.map((issue) => issue.title).join(', ');
            throw new Error(`Preflight blocked the order: ${message}`);
        }

        const response = await this.placeOrder(request);
        return { response, preview };
    }

    placeOrder(request: DhanOrderRequest) {
        return dhanBrokerService.placeOrder(request);
    }

    placeForeverOrder(request: DhanGTTOrderRequest) {
        return dhanBrokerService.placeForeverOrder(request);
    }

    fetchForeverOrders() {
        return dhanBrokerService.fetchForeverOrders();
    }

    calculateMargin(request: DhanMarginRequest) {
        return dhanBrokerService.calculateMargin(request);
    }

    async getOrders() {
        return dhanBrokerService.fetchOrders();
    }

    async modifyOrder(orderId: string, request: any) {
        return dhanBrokerService.modifyOrder(orderId, request);
    }
}

export const dhanOrderService = new DhanOrderService();
