import { UpstoxTick, DepthLevel } from './UpstoxWebSocketService';
import { logger } from './Logger';
import { orderFlowClassifier } from './ml/OrderFlowClassifier';

export interface OrderBookSignal {
  symbol: string;
  bidAskImbalance: number; // -1.0 to +1.0
  largestBidWall: { price: number; qty: number };
  largestAskWall: { price: number; qty: number };
  hasAskWallAbove: boolean;
  hasBidWallBelow: boolean;
  absorptionRate: number; // 0 to 100
  momentumContinuationScore: number; // 0 to 100
  signal: 'CONTINUE' | 'CAUTION' | 'REVERSAL_RISK';
  reason: string;
  tradesPerSecond?: number;
  gravityScore?: number;
  demandZones?: { price: number; qty: number }[];
  supplyZones?: { price: number; qty: number }[];
  bigSharkAlert?: { type: 'BUY' | 'SELL'; qty: number; price: number } | null;
  mlProb?: number;
}

interface SymbolHistory {
  prevBestBidPrice: number | null;
  prevBestBidQty: number | null;
  consumedHistory: { timestamp: number; consumed: number; bidQty: number }[];
  lttHistory?: number[];
}

export class OrderBookIntelligenceService {
  private signals: Map<string, OrderBookSignal> = new Map();
  private histories: Map<string, SymbolHistory> = new Map();
  private callbacks: Map<string, Set<(signal: OrderBookSignal) => void>> = new Map();
  private globalCallbacks: Set<(signal: OrderBookSignal) => void> = new Set();
  private avgLtqs: Map<string, number> = new Map();

  /**
   * Register callback to be notified of any signal changes globally
   */
  onGlobalSignalChange(callback: (signal: OrderBookSignal) => void): () => void {
    this.globalCallbacks.add(callback);
    return () => {
      this.globalCallbacks.delete(callback);
    };
  }

  /**
   * Get the latest computed signal for a symbol
   */
  getSignal(symbol: string): OrderBookSignal | null {
    return this.signals.get(symbol) || null;
  }

  /**
   * Register callback to be notified of signal changes
   */
  onSignalChange(symbol: string, callback: (signal: OrderBookSignal) => void): () => void {
    let set = this.callbacks.get(symbol);
    if (!set) {
      set = new Set();
      this.callbacks.set(symbol, set);
    }
    set.add(callback);
    return () => {
      const currentSet = this.callbacks.get(symbol);
      if (currentSet) {
        currentSet.delete(callback);
        if (currentSet.size === 0) {
          this.callbacks.delete(symbol);
        }
      }
    };
  }

  private getDefaultSignal(symbol: string): OrderBookSignal {
    return {
      symbol,
      bidAskImbalance: 0,
      largestBidWall: { price: 0, qty: 0 },
      largestAskWall: { price: 0, qty: 0 },
      hasAskWallAbove: false,
      hasBidWallBelow: false,
      absorptionRate: 0,
      momentumContinuationScore: 50,
      signal: 'CAUTION',
      reason: 'No order book depth data available.',
      tradesPerSecond: 0,
      gravityScore: 0,
      demandZones: [],
      supplyZones: [],
      bigSharkAlert: null
    };
  }

  /**
   * Process a Level 2 tick and return/store the updated signal
   */
  processDepthTick(
    tick: UpstoxTick,
    relativeVolume: number,
    priceAcceleration: number // 3m price acceleration, expected as 0 to 1 (normalized)
  ): OrderBookSignal {
    const symbol = tick.instrument_key;
    if (!tick.depth || !tick.depth.buy || !tick.depth.sell || tick.depth.buy.length === 0 || tick.depth.sell.length === 0) {
      return this.signals.get(symbol) || this.getDefaultSignal(symbol);
    }

    const depth = tick.depth;
    const ltp = tick.ltp || 0;

    // 1. Compute imbalance
    const imbalance = this.computeBidAskImbalance(depth);

    // 2. Detect walls
    const wallInfo = this.detectWalls(depth, ltp);

    // 3. Compute absorption rate
    const absorptionRate = this.updateAndComputeAbsorption(symbol, depth);

    // Compute Supply & Demand zones via dynamic D30 binning
    const zones = this.detectZones(depth, ltp);

    // Process Last Traded Quantity (LTQ) for "Big Shark" Alerts
    let bigSharkAlert: { type: 'BUY' | 'SELL'; qty: number; price: number } | null = null;
    if (tick.ltq && tick.ltq > 0 && ltp > 0) {
      const prevAvg = this.avgLtqs.get(symbol) || 100;
      const currentLtq = tick.ltq;
      const newAvg = (prevAvg * 0.95) + (currentLtq * 0.05);
      this.avgLtqs.set(symbol, newAvg);

      if (currentLtq > 15 * prevAvg && currentLtq > 2500) {
        const lastSignal = this.signals.get(symbol);
        const prevPrice = lastSignal?.largestBidWall?.price || ltp;
        const type = ltp >= prevPrice ? 'BUY' : 'SELL';
        bigSharkAlert = {
          type,
          qty: currentLtq,
          price: ltp
        };
      }
    }

    // Calculate rolling Trades Per Second (TPS) using exchange ltt (last trade time)
    let tradesPerSecond = 0;
    const history = this.histories.get(symbol);
    if (history && tick.ltt) {
      if (!history.lttHistory) {
        history.lttHistory = [];
      }
      // Add current ltt to history if it's new
      if (history.lttHistory.length === 0 || history.lttHistory[history.lttHistory.length - 1] !== tick.ltt) {
        history.lttHistory.push(tick.ltt);
      }
      // Clean up older than 10 seconds (10000ms)
      const tenSecsAgo = tick.ltt - 10000;
      history.lttHistory = history.lttHistory.filter(t => t >= tenSecsAgo);
      // Compute trades per second
      tradesPerSecond = history.lttHistory.length / 10;
    }

    // 4. Compute momentum score
    const normPriceAccel = priceAcceleration < 0 ? 0 : (priceAcceleration > 1 ? 1 : priceAcceleration);
    
    const momentumScore = this.computeMomentumContinuationScore({
      imbalance,
      relativeVolume,
      priceAcceleration3m: normPriceAccel,
      hasAskWallAbove: wallInfo.hasAskWallAbove,
      hasBidWallBelow: wallInfo.hasBidWallBelow,
      tradesPerSecond,
      gravityScore: wallInfo.gravityScore
    });

    // 5. Classify signal
    const signalType = this.classifySignal(momentumScore, wallInfo.hasAskWallAbove, absorptionRate);

    // 6. Generate human-readable reason
    const reason = this.generateReason(imbalance, relativeVolume, wallInfo, absorptionRate, signalType);

    // Compute ML prediction
    const mlProb = orderFlowClassifier.predict({
      spreadBps: ltp > 0 ? ((wallInfo.largestAskWall.price - wallInfo.largestBidWall.price) / ltp) * 10000 : 0,
      top5BidRatio: 0.5,
      top5AskRatio: 0.5,
      spoofingScore: 0,
      absorptionRateRatio: absorptionRate / 100,
      tradeDirectionImbalance: imbalance,
      vwmpDeviation: 0,
    } as any);

    const updatedSignal: OrderBookSignal = {
      symbol,
      bidAskImbalance: imbalance,
      largestBidWall: wallInfo.largestBidWall,
      largestAskWall: wallInfo.largestAskWall,
      hasAskWallAbove: wallInfo.hasAskWallAbove,
      hasBidWallBelow: wallInfo.hasBidWallBelow,
      absorptionRate,
      momentumContinuationScore: momentumScore,
      signal: signalType,
      reason,
      tradesPerSecond,
      gravityScore: wallInfo.gravityScore,
      demandZones: zones.demandZones,
      supplyZones: zones.supplyZones,
      bigSharkAlert,
      mlProb
    };

    // Store and notify listeners
    this.signals.set(symbol, updatedSignal);
    const set = this.callbacks.get(symbol);
    if (set) {
      set.forEach(cb => cb(updatedSignal));
    }
    this.globalCallbacks.forEach(cb => cb(updatedSignal));

    return updatedSignal;
  }

  /**
   * Sum total buy/sell quantity and calculate imbalance
   */
  computeBidAskImbalance(depth: { buy: DepthLevel[]; sell: DepthLevel[] }): number {
    const totalBid = depth.buy.reduce((sum, level) => sum + level.quantity, 0);
    const totalAsk = depth.sell.reduce((sum, level) => sum + level.quantity, 0);
    if (totalBid + totalAsk === 0) return 0;
    return (totalBid - totalAsk) / (totalBid + totalAsk);
  }

  detectWalls(depth: { buy: DepthLevel[]; sell: DepthLevel[] }, ltp: number): {
    largestBidWall: { price: number; qty: number };
    largestAskWall: { price: number; qty: number };
    hasAskWallAbove: boolean;
    hasBidWallBelow: boolean;
    gravityScore: number;
  } {
    const avgBidQty = depth.buy.reduce((sum, lvl) => sum + lvl.quantity, 0) / depth.buy.length;
    const avgAskQty = depth.sell.reduce((sum, lvl) => sum + lvl.quantity, 0) / depth.sell.length;

    let largestBidWall = { price: 0, qty: 0 };
    let largestAskWall = { price: 0, qty: 0 };
    let hasAskWallAbove = false;
    let hasBidWallBelow = false;

    const checkRange = 0.01; // 1%
    const gravityRange = 0.03; // 3% check range to leverage D30 deep book fully!

    let bidGravity = 0;
    let askGravity = 0;

    depth.buy.forEach(lvl => {
      if (lvl.quantity > largestBidWall.qty) {
        largestBidWall = { price: lvl.price, qty: lvl.quantity };
      }
      const distancePct = ltp > 0 ? Math.abs(ltp - lvl.price) / ltp : 0;
      if (ltp > 0 && distancePct <= checkRange) {
        if (lvl.quantity > 3 * avgBidQty) {
          hasBidWallBelow = true;
        }
      }
      // Proximity-weighted gravity pull (D30 structural benefit)
      if (ltp > 0 && distancePct <= gravityRange) {
        const weight = 1.0 / (distancePct + 0.001);
        bidGravity += lvl.quantity * weight;
      }
    });

    depth.sell.forEach(lvl => {
      if (lvl.quantity > largestAskWall.qty) {
        largestAskWall = { price: lvl.price, qty: lvl.quantity };
      }
      const distancePct = ltp > 0 ? Math.abs(lvl.price - ltp) / ltp : 0;
      if (ltp > 0 && distancePct <= checkRange) {
        if (lvl.quantity > 3 * avgAskQty) {
          hasAskWallAbove = true;
        }
      }
      // Proximity-weighted gravity pull (D30 structural benefit)
      if (ltp > 0 && distancePct <= gravityRange) {
        const weight = 1.0 / (distancePct + 0.001);
        askGravity += lvl.quantity * weight;
      }
    });

    let gravityScore = 0;
    if (bidGravity + askGravity > 0) {
      gravityScore = (bidGravity - askGravity) / (bidGravity + askGravity);
    }

    return {
      largestBidWall,
      largestAskWall,
      hasAskWallAbove,
      hasBidWallBelow,
      gravityScore
    };
  }

  /**
   * Aggregate depth ticks into dynamic price bins and identify key Supply & Demand zones.
   */
  detectZones(depth: { buy: DepthLevel[]; sell: DepthLevel[] }, ltp: number): {
    demandZones: { price: number; qty: number }[];
    supplyZones: { price: number; qty: number }[];
  } {
    if (ltp <= 0) return { demandZones: [], supplyZones: [] };

    // Bins size is dynamic: 0.2% of LTP, rounded to nearest 0.05 ticks (minimum 0.05)
    const binStep = Math.max(0.05, Math.round(ltp * 0.002 * 20) / 20);

    const bidBins: Record<number, number> = {};
    const askBins: Record<number, number> = {};

    let totalBidQty = 0;
    depth.buy.forEach(lvl => {
      const binPrice = Math.floor(lvl.price / binStep) * binStep;
      bidBins[binPrice] = (bidBins[binPrice] || 0) + lvl.quantity;
      totalBidQty += lvl.quantity;
    });

    let totalAskQty = 0;
    depth.sell.forEach(lvl => {
      const binPrice = Math.floor(lvl.price / binStep) * binStep;
      askBins[binPrice] = (askBins[binPrice] || 0) + lvl.quantity;
      totalAskQty += lvl.quantity;
    });

    const avgBidBinQty = Object.keys(bidBins).length > 0 ? totalBidQty / Object.keys(bidBins).length : 0;
    const avgAskBinQty = Object.keys(askBins).length > 0 ? totalAskQty / Object.keys(askBins).length : 0;

    const demandZones: { price: number; qty: number }[] = [];
    const supplyZones: { price: number; qty: number }[] = [];

    // Iceberg criteria: Bin contains > 1.5x the average bin quantity
    Object.entries(bidBins).forEach(([priceStr, qty]) => {
      const price = parseFloat(priceStr);
      if (qty > 1.5 * avgBidBinQty) {
        demandZones.push({ price, qty });
      }
    });

    Object.entries(askBins).forEach(([priceStr, qty]) => {
      const price = parseFloat(priceStr);
      if (qty > 1.5 * avgAskBinQty) {
        supplyZones.push({ price, qty });
      }
    });

    // Sort zones by quantity descending
    demandZones.sort((a, b) => b.qty - a.qty);
    supplyZones.sort((a, b) => b.qty - a.qty);

    // Fallback: If no bins exceeded the threshold, seed with the top 2 largest bins to guarantee UI rendering
    if (demandZones.length === 0) {
      const sortedBids = Object.entries(bidBins)
        .map(([priceStr, qty]) => ({ price: parseFloat(priceStr), qty }))
        .sort((a, b) => b.qty - a.qty);
      demandZones.push(...sortedBids.slice(0, 2));
    }

    if (supplyZones.length === 0) {
      const sortedAsks = Object.entries(askBins)
        .map(([priceStr, qty]) => ({ price: parseFloat(priceStr), qty }))
        .sort((a, b) => b.qty - a.qty);
      supplyZones.push(...sortedAsks.slice(0, 2));
    }

    return {
      demandZones: demandZones.slice(0, 3), // Top 3 demand zones
      supplyZones: supplyZones.slice(0, 3)  // Top 3 supply zones
    };
  }

  /**
   * Track tick history and calculate absorption rate (% per minute)
   */
  private updateAndComputeAbsorption(symbol: string, depth: { buy: DepthLevel[]; sell: DepthLevel[] }): number {
    let history = this.histories.get(symbol);
    if (!history) {
      history = {
        prevBestBidPrice: null,
        prevBestBidQty: null,
        consumedHistory: []
      };
      this.histories.set(symbol, history);
    }

    const currentBestBid = depth.buy[0];
    if (!currentBestBid) return 0;

    const now = Date.now();
    let consumed = 0;

    if (history.prevBestBidPrice !== null && history.prevBestBidQty !== null) {
      if (currentBestBid.price === history.prevBestBidPrice) {
        consumed = Math.max(0, history.prevBestBidQty - currentBestBid.quantity);
      } else if (currentBestBid.price < history.prevBestBidPrice) {
        consumed = history.prevBestBidQty;
      }
    }

    if (consumed > 0 || history.consumedHistory.length === 0 || now - history.consumedHistory[history.consumedHistory.length - 1].timestamp > 5000) {
      history.consumedHistory.push({
        timestamp: now,
        consumed,
        bidQty: currentBestBid.quantity
      });
    }

    history.prevBestBidPrice = currentBestBid.price;
    history.prevBestBidQty = currentBestBid.quantity;

    const oneMinuteAgo = now - 60000;
    history.consumedHistory = history.consumedHistory.filter(h => h.timestamp >= oneMinuteAgo);

    const sumConsumed = history.consumedHistory.reduce((sum, h) => sum + h.consumed, 0);
    const avgBidQty = history.consumedHistory.length > 0
      ? history.consumedHistory.reduce((sum, h) => sum + h.bidQty, 0) / history.consumedHistory.length
      : currentBestBid.quantity;

    if (avgBidQty === 0) return 0;
    const rate = (sumConsumed / avgBidQty) * 100;
    return Math.max(0, Math.min(Math.round(rate), 100));
  }

  /**
   * Score momentum continuation from 0 to 100
   */
  computeMomentumContinuationScore(params: {
    imbalance: number;
    relativeVolume: number;
    priceAcceleration3m: number;
    hasAskWallAbove: boolean;
    hasBidWallBelow: boolean;
    tradesPerSecond?: number;
    gravityScore?: number;
  }): number {
    const { imbalance, relativeVolume, priceAcceleration3m, hasAskWallAbove, tradesPerSecond = 0, gravityScore = 0 } = params;

    // Weight allocation: 100 points total
    // 1. Order book depth imbalance blended with Proximity-Weighted Gravity: 30 pts (was 35)
    const blendedImbalance = (imbalance * 0.4) + (gravityScore * 0.6);
    const depthScore = ((blendedImbalance + 1) / 2) * 30;

    // 2. Relative volume velocity: 20 pts (was 25)
    const volumeScore = Math.min(relativeVolume / 3, 1) * 20;

    // 3. Price acceleration (3m): 20 pts (was 25)
    const accelScore = priceAcceleration3m * 20;

    // 4. Resistance walls: 15 pts
    const wallScore = !hasAskWallAbove ? 15 : 0;

    // 5. Execution trade velocity (intensity): 15 pts
    // Normalised: 5 trades/sec or more yields max velocity score
    const velocityScore = Math.min(tradesPerSecond / 5.0, 1.0) * 15;

    const total = depthScore + volumeScore + accelScore + wallScore + velocityScore;
    return Math.max(0, Math.min(Math.round(total), 100));
  }

  /**
   * Classify the signal type based on score, ask wall and absorption rate
   */
  classifySignal(score: number, hasAskWallAbove: boolean, absorptionRate: number): 'CONTINUE' | 'CAUTION' | 'REVERSAL_RISK' {
    if (score >= 70 && !hasAskWallAbove && absorptionRate < 40) {
      return 'CONTINUE';
    }
    if (score < 40 || (hasAskWallAbove && score < 60) || absorptionRate > 60) {
      return 'REVERSAL_RISK';
    }
    return 'CAUTION';
  }

  private generateReason(
    imbalance: number,
    relativeVolume: number,
    wallInfo: { largestBidWall: { price: number; qty: number }; largestAskWall: { price: number; qty: number }; hasAskWallAbove: boolean; hasBidWallBelow: boolean },
    absorptionRate: number,
    signal: 'CONTINUE' | 'CAUTION' | 'REVERSAL_RISK'
  ): string {
    const imbalancePct = Math.round(imbalance * 100);
    const imbalanceDirection = imbalancePct >= 0 ? `+${imbalancePct}% (Bids dominant)` : `${imbalancePct}% (Asks dominant)`;
    
    if (signal === 'CONTINUE') {
      return `Strong bid pressure (${imbalanceDirection}). No ask walls above. Volume ${relativeVolume.toFixed(1)}x. Absorption rate low (${absorptionRate}%).`;
    }
    if (signal === 'REVERSAL_RISK') {
      if (wallInfo.hasAskWallAbove) {
        return `Ask wall detected at ₹${wallInfo.largestAskWall.price.toLocaleString()} (${wallInfo.largestAskWall.qty.toLocaleString()} qty). Score: Weak.`;
      }
      if (absorptionRate > 60) {
        return `Heavy bid absorption (${absorptionRate}%/min). Bids being aggressively consumed without upward movement.`;
      }
      return `Weak order book profile. Imbalance: ${imbalanceDirection}.`;
    }
    
    const wallAlert = wallInfo.hasAskWallAbove ? ' Ask wall above.' : '';
    return `Balanced order book profile. Imbalance: ${imbalanceDirection}.${wallAlert} Absorption rate: ${absorptionRate}%.`;
  }
}

export const orderBookIntelligenceService = new OrderBookIntelligenceService();
