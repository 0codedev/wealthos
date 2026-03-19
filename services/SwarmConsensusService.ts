import { db, ParsedSignal, SignalProvider } from '../database';
import { logger } from './Logger';

export interface SwarmConsensusGroup {
  instrument: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  convictionScore: number; // 0 - 100
  totalSignals: number;
  providers: {
    name: string;
    action: 'BUY' | 'SELL' | 'SHORT' | 'COVER';
    entryPrice: number;
    winRate: number;
    timestamp: string;
  }[];
  avgRR: number;
  entryPriceRange: { min: number; max: number };
  stopLossRange?: { min: number; max: number };
  targetRange?: { min: number; max: number };
}

export class SwarmConsensusService {
  private static instance: SwarmConsensusService;

  private constructor() {}

  static getInstance(): SwarmConsensusService {
    if (!SwarmConsensusService.instance) {
      SwarmConsensusService.instance = new SwarmConsensusService();
    }
    return SwarmConsensusService.instance;
  }

  // Fuzzy match similar to ConvictionEngine
  private isSameAsset(sym1: string, sym2: string): boolean {
    const clean = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/CALL/g, 'CE').replace(/PUT/g, 'PE');
    const c1 = clean(sym1);
    const c2 = clean(sym2);
    return c1.includes(c2) || c2.includes(c1);
  }

  async getConsensus(windowHours: number = 24): Promise<SwarmConsensusGroup[]> {
    try {
      const now = Date.now();
      const cutoff = new Date(now - windowHours * 60 * 60 * 1000).toISOString();

      // Fetch signals and providers
      const signals = await db.parsed_signals
        .filter(s => s.timestamp >= cutoff)
        .toArray();

      const providers = await db.signal_providers.toArray();
      const providerMap = new Map<string, SignalProvider>();
      providers.forEach(p => providerMap.set(p.name, p));

      if (signals.length === 0) return [];

      // Group signals by asset
      const groups: { instrument: string; signals: ParsedSignal[] }[] = [];

      for (const sig of signals) {
        let matchedGroup = groups.find(g => this.isSameAsset(g.instrument, sig.instrument));
        if (matchedGroup) {
          matchedGroup.signals.push(sig);
        } else {
          groups.push({ instrument: sig.instrument, signals: [sig] });
        }
      }

      const consensusGroups: SwarmConsensusGroup[] = [];

      for (const group of groups) {
        let buyWeight = 0;
        let sellWeight = 0;
        const groupProviders: SwarmConsensusGroup['providers'] = [];
        
        let rrSum = 0;
        let rrCount = 0;
        const entryPrices: number[] = [];
        const stopLosses: number[] = [];
        const targets: number[] = [];

        // Calculate adaptive time decay constant based on window hours
        // If window is wide (e.g. 1 week), keep signals active longer (decay constant = window / 4)
        const decayConstant = windowHours >= 8760 ? 720 : Math.max(6, windowHours / 4);

        for (const sig of group.signals) {
          const provider = providerMap.get(sig.provider);
          const winRate = provider ? provider.winRate : 0.5;
          const avgRR = provider ? provider.avgRR : 1.5;

          // Time decay weight: e^(-age_hours / decayConstant)
          const ageMs = now - new Date(sig.timestamp).getTime();
          const ageHours = ageMs / (1000 * 60 * 60);
          const recencyDecay = Math.exp(-ageHours / decayConstant);

          // Signal weight
          const weight = winRate * avgRR * recencyDecay;

          if (sig.action === 'BUY' || sig.action === 'COVER') {
            buyWeight += weight;
          } else if (sig.action === 'SELL' || sig.action === 'SHORT') {
            sellWeight += weight;
          }

          groupProviders.push({
            name: sig.provider,
            action: sig.action,
            entryPrice: sig.entryPrice,
            winRate,
            timestamp: sig.timestamp
          });

          if (sig.riskRewardRatio) {
            rrSum += sig.riskRewardRatio;
            rrCount++;
          }
          entryPrices.push(sig.entryPrice);
          if (sig.stopLoss) stopLosses.push(sig.stopLoss);
          if (sig.target1) targets.push(sig.target1);
          if (sig.target2) targets.push(sig.target2);
          if (sig.target3) targets.push(sig.target3);
        }

        const totalWeight = buyWeight + sellWeight;
        let convictionScore = 0;
        let direction: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';

        if (totalWeight > 0) {
          const maxWeight = Math.max(buyWeight, sellWeight);
          
          // Calculate basic ratio-based conviction
          let baseConviction = (maxWeight / totalWeight) * 100;

          // Scale score by Consensus Participation Factor (unique providers)
          const uniqueProvidersCount = new Set(groupProviders.map(p => p.name)).size;
          let participationFactor = 1.0;
          if (uniqueProvidersCount === 1) {
            participationFactor = 0.60; // Max 60% if only one channel sends it
          } else if (uniqueProvidersCount === 2) {
            participationFactor = 0.85; // Max 85% if only two channels agree
          }
          
          convictionScore = Math.min(100, Math.round(baseConviction * participationFactor));

          if (buyWeight > sellWeight * 1.2) {
            direction = 'BULL';
          } else if (sellWeight > buyWeight * 1.2) {
            direction = 'BEAR';
          } else {
            direction = 'NEUTRAL';
          }
        }

        const avgRR = rrCount > 0 ? Number((rrSum / rrCount).toFixed(2)) : 1.5;

        consensusGroups.push({
          instrument: group.instrument,
          direction,
          convictionScore,
          totalSignals: group.signals.length,
          providers: groupProviders,
          avgRR,
          entryPriceRange: {
            min: Math.min(...entryPrices),
            max: Math.max(...entryPrices)
          },
          stopLossRange: stopLosses.length > 0 ? {
            min: Math.min(...stopLosses),
            max: Math.max(...stopLosses)
          } : undefined,
          targetRange: targets.length > 0 ? {
            min: Math.min(...targets),
            max: Math.max(...targets)
          } : undefined
        });
      }

      // Sort by conviction score desc
      return consensusGroups.sort((a, b) => b.convictionScore - a.convictionScore);
    } catch (e) {
      logger.error('[SwarmConsensusService] Error computing consensus', e);
      return [];
    }
  }
}

export const swarmConsensusService = SwarmConsensusService.getInstance();
