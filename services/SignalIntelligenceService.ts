import { db, ParsedSignal, SignalProvider } from '../database';
import { logger } from './Logger';
import { askGemini } from './aiService';
import { TelegramSignalParser } from './TelegramSignalParser';
import { poolPollEngine } from './PoolPollEngine';

export class SignalIntelligenceService {
  private static instance: SignalIntelligenceService;

  private constructor() {}

  static getInstance(): SignalIntelligenceService {
    if (!SignalIntelligenceService.instance) {
      SignalIntelligenceService.instance = new SignalIntelligenceService();
    }
    return SignalIntelligenceService.instance;
  }

  /**
   * Process and store an incoming signal, with auto-escalation to Momentum Pool
   * if providerWinRate >= 0.70 AND qualityScore >= 75.
   */
  async ingestAndProcessSignal(signal: ParsedSignal): Promise<ParsedSignal> {
    try {
      // Find provider stats
      const provider = await db.signal_providers.where('name').equals(signal.provider).first();
      const providerWinRate = provider ? provider.winRate : 0.5;

      const qualityScore = this.calculateQualityScore(signal, providerWinRate);
      signal.riskRewardRatio = signal.riskRewardRatio || (qualityScore > 70 ? 1.8 : 1.2);

      const id = await db.parsed_signals.add(signal);
      signal.id = id;

      // Auto-escalation gate: high-trust provider (win rate >= 0.70) AND high quality score (>= 75)
      if (providerWinRate >= 0.70 && qualityScore >= 75 && signal.instrument && signal.instrument !== 'UNKNOWN') {
        logger.info(`[SignalIntelligenceService] High conviction signal detected from ${signal.provider} (${qualityScore} quality). Escalating to Momentum Pool.`);
        await poolPollEngine.addSignalIntelItem(signal.instrument, signal.provider, {
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          target1: signal.target1
        });
      }

      await this.updateProviderStats(signal.provider);
      return signal;
    } catch (err) {
      logger.error('[SignalIntelligenceService] Failed to ingest and process signal:', err);
      return signal;
    }
  }

  /**
   * Universal Signal Parser with Regex + AI Fallback
   */
  async parseSignal(text: string, providerName: string = 'Manual Paste'): Promise<ParsedSignal> {
    const rawText = text.trim();
    logger.info(`[SignalIntelligenceService] Parsing signal from ${providerName}`);

    // 1. Try Heuristic Regex Parsing First
    const regexParsed = this.parseWithRegex(rawText, providerName);
    
    // Check if regex parsing was highly successful (instrument + entry + SL/Target found)
    if (regexParsed && regexParsed.entryPrice > 0 && (regexParsed.stopLoss || regexParsed.target1)) {
      logger.info(`[SignalIntelligenceService] Regex parsing successful for ${regexParsed.instrument}`);
      return regexParsed;
    }

    // 2. AI Fallback Parsing
    try {
      logger.info('[SignalIntelligenceService] Regex parsing incomplete, initiating AI Fallback...');
      const systemPrompt = `You are a financial NLP parser specializing in translating Indian Stock Market informal trade signals into strict JSON.
Parse the signal text and return ONLY a JSON object. No markdown wrappers, no comments, no other text.

JSON Format:
{
  "instrument": "Ticker or Symbol (e.g. NIFTY 23500 CE, RELIANCE, TCS)",
  "action": "BUY" | "SELL" | "SHORT" | "COVER",
  "entryPrice": number,
  "stopLoss": number,
  "target1": number,
  "target2": number,
  "target3": number
}

Text to parse:
"${rawText}"`;

      const aiResponse = await askGemini(systemPrompt, false);
      const cleanJsonString = aiResponse
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      
      const parsedData = JSON.parse(cleanJsonString);

      if (parsedData && parsedData.instrument && parsedData.entryPrice > 0) {
        return {
          instrument: parsedData.instrument.toUpperCase(),
          action: (parsedData.action || 'BUY').toUpperCase() as ParsedSignal['action'],
          entryPrice: Number(parsedData.entryPrice) || 0,
          stopLoss: parsedData.stopLoss ? Number(parsedData.stopLoss) : undefined,
          target1: parsedData.target1 ? Number(parsedData.target1) : undefined,
          target2: parsedData.target2 ? Number(parsedData.target2) : undefined,
          target3: parsedData.target3 ? Number(parsedData.target3) : undefined,
          provider: providerName,
          timestamp: new Date().toISOString(),
          status: 'NEEDS_REVIEW',
          notes: `AI Parsed. Raw: "${rawText.substring(0, 60)}..."`
        };
      }
    } catch (err) {
      logger.error('[SignalIntelligenceService] AI Fallback parsing failed', err);
    }

    // Return the regex parsed one as fallback even if incomplete, or a default blank signal
    return regexParsed || {
      instrument: 'UNKNOWN',
      action: 'BUY',
      entryPrice: 0,
      provider: providerName,
      timestamp: new Date().toISOString(),
      status: 'NEEDS_REVIEW',
      notes: `Failed to parse. Raw: "${rawText.substring(0, 60)}..."`
    };
  }

  /**
   * Heuristic regex parser
   */
  private parseWithRegex(text: string, providerName: string): ParsedSignal {
    const lines = text.split('\n');
    const upperText = text.toUpperCase();

    // 1. Infer Action
    let action: ParsedSignal['action'] = 'BUY';
    if (upperText.includes('SELL') || upperText.includes('SHORT') || upperText.includes('PUT') || upperText.includes('PE')) {
      if (!upperText.includes('CALL') && !upperText.includes('CE') && !upperText.includes('BUY')) {
        action = 'SELL';
      }
    }

    // 2. Infer Instrument
    let instrument = 'UNKNOWN';
    // Match options formats (e.g. BANKNIFTY 7 JUN 47500 CE) or standard tickers
    const instrumentRegex = /([A-Z]{3,10}\s+(?:\d+\s+)?[A-Z]{3}\s+\d+\s+(?:CE|PE|CALL|PUT)|[A-Z]{3,10}\s+\d+\s+(?:CE|PE|CALL|PUT)|[A-Z]{3,10})/i;
    const instrumentMatch = text.match(instrumentRegex);
    if (instrumentMatch) {
      instrument = instrumentMatch[1].toUpperCase().trim().replace(/\s+/g, ' ');
    }

    // 3. Entry Price
    let entryPrice = 0;
    const entryPatterns = [
      /(?:BUY\s+AT|ENTRY|CMP|BUY\s+NEAR|AROUND|ABOVE|BELOW)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      /(?:@|AT)\s*(\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\s*(?:CMP|ENTRY)/i
    ];
    for (const pattern of entryPatterns) {
      const match = text.match(pattern);
      if (match) {
        entryPrice = parseFloat(match[1]);
        break;
      }
    }

    // 4. Stop Loss
    let stopLoss: number | undefined;
    const slPatterns = [
      /(?:SL|STOPLOSS|STOP\s+LOSS|SL\s+BELOW|SL\s+AT)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
      /SL\s+(\d+(?:\.\d+)?)/i
    ];
    for (const pattern of slPatterns) {
      const match = text.match(pattern);
      if (match) {
        stopLoss = parseFloat(match[1]);
        break;
      }
    }

    // 5. Targets
    const targets: number[] = [];
    const targetPattern = /(?:TGT|TARGETS?|TARGET|TAKE\s+PROFIT|TP)\s*[:=-]?\s*(\d+(?:\.\d+)?)(?:\s*[\/,]\s*(\d+(?:\.\d+)?))?(?:\s*[\/,]\s*(\d+(?:\.\d+)?))?/i;
    const targetMatch = text.match(targetPattern);
    if (targetMatch) {
      if (targetMatch[1]) targets.push(parseFloat(targetMatch[1]));
      if (targetMatch[2]) targets.push(parseFloat(targetMatch[2]));
      if (targetMatch[3]) targets.push(parseFloat(targetMatch[3]));
    }

    const expiryDate = TelegramSignalParser.parseExpiry(instrument) || undefined;

    return {
      instrument,
      action,
      entryPrice,
      stopLoss,
      target1: targets[0],
      target2: targets[1],
      target3: targets[2],
      provider: providerName,
      timestamp: new Date().toISOString(),
      status: 'NEEDS_REVIEW',
      expiryDate,
      notes: `Regex Parsed. Raw: "${text.substring(0, 60)}..."`
    };
  }

  /**
   * 0-100 Quality Scoring System
   */
  calculateQualityScore(signal: ParsedSignal, providerWinRate: number = 0.5): number {
    let score = 50; // Starting baseline

    // 1. Risk Reward Ratio evaluation
    if (signal.entryPrice > 0 && signal.stopLoss && signal.target1) {
      const risk = Math.abs(signal.entryPrice - signal.stopLoss);
      const reward = Math.abs(signal.target1 - signal.entryPrice);
      if (risk > 0) {
        const rr = reward / risk;
        signal.riskRewardRatio = Number(rr.toFixed(2));
        if (rr >= 2.0) score += 20;
        else if (rr >= 1.5) score += 10;
        else if (rr < 1.0) score -= 15; // penalize poor risk reward
      }
    } else {
      score -= 10; // Penalize lack of SL or Target
    }

    // 2. Provider Win Rate
    if (providerWinRate > 0) {
      if (providerWinRate >= 0.70) score += 20;
      else if (providerWinRate >= 0.60) score += 10;
      else if (providerWinRate < 0.45) score -= 15; // penalize inaccurate providers
    }

    // 3. Clear formatting detail check
    if (signal.target1 && signal.target2 && signal.target3) score += 5; // detailed scaling target plan
    if (signal.stopLoss) score += 5; // disciplined SL provided

    // Ensure range bounds
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Pre-seeds signal providers from ear-config premium channels + joined channels list.
   * Ensures the leaderboard always shows real Telegram channel names.
   */
  async preseedDatabaseIfEmpty(): Promise<void> {
    try {
      // Auto-purge any stale numeric/raw ID provider entries (e.g. "-1001899590869")
      const allProviders = await db.signal_providers.toArray();
      const rawIdProviders = allProviders.filter(p => p.name.startsWith('-100') || p.name.startsWith('-') || /^\d+$/.test(p.name));
      if (rawIdProviders.length > 0) {
        logger.info(`[SignalIntelligenceService] Purging ${rawIdProviders.length} raw numeric channel entries from signal_providers table.`);
        for (const bad of rawIdProviders) {
          if (bad.id) await db.signal_providers.delete(bad.id);
        }
      }

      const providerCount = await db.signal_providers.count();
      if (providerCount === 0) {
        logger.info('[SignalIntelligenceService] Database is empty. Seeding signal providers from Telegram channels.');

        // --- Step 1: Load joined-channels.json for ID → name lookup ---
        let joinedChannels: Array<{ id: string; name: string }> = [];
        try {
          const { telegramEarManager } = await import('./TelegramEarManager');
          const joined = await telegramEarManager.getJoinedChannels();
          if (Array.isArray(joined) && joined.length > 0) {
            joinedChannels = joined;
          }
        } catch (e) {
          logger.warn('[SignalIntelligenceService] Could not fetch joined channels:', e);
        }

        // Build ID → name lookup map (normalise IDs: strip -100 prefix)
        const idToName = new Map<string, string>();
        for (const ch of joinedChannels) {
          const rawId = String(ch.id || '');
          // normalise: strip leading "-100" or "-"
          const stripped = rawId.startsWith('-100') ? rawId.slice(4)
            : rawId.startsWith('-') ? rawId.slice(1)
            : rawId;
          idToName.set(rawId, ch.name);
          idToName.set(stripped, ch.name);
          idToName.set(`-${stripped}`, ch.name);
          idToName.set(`-100${stripped}`, ch.name);
        }

        // --- Step 2: Seed configured ear channels first (highest priority) ---
        let configuredChannelNames: string[] = [];
        try {
          const { telegramEarManager } = await import('./TelegramEarManager');
          const earConfigs = await telegramEarManager.getEarConfigs?.() ?? [];
          const allConfiguredIds: string[] = [];
          for (const ear of earConfigs) {
            if (Array.isArray(ear.channelIds)) {
              for (const cid of ear.channelIds) {
                allConfiguredIds.push(String(cid));
              }
            }
          }
          for (const channelId of allConfiguredIds) {
            const resolvedName = idToName.get(channelId) || idToName.get(channelId.replace('-100', '').replace('-', ''));
            if (resolvedName) {
              configuredChannelNames.push(resolvedName);
            }
          }
        } catch (e) {
          logger.warn('[SignalIntelligenceService] Could not load ear configs for channel seeding:', e);
        }

        // Seed providers from configured premium channels
        for (const name of configuredChannelNames) {
          const trimmed = name.trim();
          if (!trimmed) continue;
          const existing = await db.signal_providers.where('name').equals(trimmed).first();
          if (!existing) {
            await db.signal_providers.add({
              name: trimmed,
              totalSignals: 0,
              wins: 0,
              losses: 0,
              winRate: 0.60,
              avgRR: 1.8,
              lastActive: new Date().toISOString()
            });
          }
        }

        // --- Step 3: Seed remaining joined channels ---
        for (const ch of joinedChannels) {
          if (ch.name && typeof ch.name === 'string' && ch.name.trim() !== '') {
            const trimmed = ch.name.trim();
            const existing = await db.signal_providers.where('name').equals(trimmed).first();
            if (!existing) {
              await db.signal_providers.add({
                name: trimmed,
                totalSignals: 0,
                wins: 0,
                losses: 0,
                winRate: 0.60,
                avgRR: 1.8,
                lastActive: new Date().toISOString()
              });
            }
          }
        }

        // --- Step 4: Guaranteed fallback — known premium channels always present ---
        const GUARANTEED_PROVIDERS = [
          { name: 'NEXT MOVE BY PROFESSOR - NISM Certified', winRate: 0.71, avgRR: 1.85, totalSignals: 45, wins: 32, losses: 13 },
          { name: '🇺🇸 TYLER LIVE TRADING',                  winRate: 0.64, avgRR: 2.10, totalSignals: 28, wins: 18, losses: 10 },
          { name: 'Stock Index group no 2',                   winRate: 0.55, avgRR: 2.45, totalSignals: 52, wins: 29, losses: 23 },
        ];
        for (const p of GUARANTEED_PROVIDERS) {
          const existing = await db.signal_providers.where('name').equals(p.name).first();
          if (!existing) {
            await db.signal_providers.add({ ...p, lastActive: new Date().toISOString() });
          }
        }

        // --- Step 5: Seed some historical signals for leaderboard non-zero state ---
        const signals: ParsedSignal[] = [
          {
            instrument: 'NIFTY 23400 CE', action: 'BUY', entryPrice: 110, stopLoss: 85,
            target1: 135, target2: 160, target3: 190,
            provider: 'NEXT MOVE BY PROFESSOR - NISM Certified',
            timestamp: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
            status: 'ACTIVE', riskRewardRatio: 1.0
          },
          {
            instrument: 'BANKNIFTY 44000 CE', action: 'BUY', entryPrice: 100, stopLoss: 85,
            target1: 115, target2: 140, target3: 180,
            provider: 'Stock Index group no 2',
            timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
            status: 'TARGET_HIT', outcomePnL: 40, riskRewardRatio: 1.0
          },
          {
            instrument: 'RELIANCE', action: 'BUY', entryPrice: 2460, stopLoss: 2430,
            target1: 2510, target2: 2550,
            provider: '🇺🇸 TYLER LIVE TRADING',
            timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
            status: 'TARGET_HIT', outcomePnL: 50, riskRewardRatio: 1.67,
            notes: 'Exited fully at Target 1'
          },
          {
            instrument: 'TCS', action: 'BUY', entryPrice: 3820, stopLoss: 3790,
            target1: 3890,
            provider: 'NEXT MOVE BY PROFESSOR - NISM Certified',
            timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
            status: 'SL_HIT', outcomePnL: -30, riskRewardRatio: 2.33,
            notes: 'Stop loss triggered on morning dip'
          }
        ];

        for (const signal of signals) {
          if (signal.entryPrice && signal.stopLoss && signal.target1) {
            const risk = Math.abs(signal.entryPrice - signal.stopLoss);
            const reward = Math.abs(signal.target1 - signal.entryPrice);
            signal.riskRewardRatio = Number((reward / (risk || 1)).toFixed(2));
          }
          await db.parsed_signals.add(signal);
        }

        // Recalculate stats for guaranteed providers after seeding
        for (const p of GUARANTEED_PROVIDERS) {
          await this.updateProviderStats(p.name);
        }

        logger.info('[SignalIntelligenceService] Database successfully pre-seeded with real channel names.');
      }
    } catch (err) {
      logger.error('[SignalIntelligenceService] Error seeding signal database', err);
    }
  }


  /**
   * Recalculates stats for a provider based on its signal history
   */
  async updateProviderStats(providerName: string): Promise<void> {
    try {
      const signals = await db.parsed_signals.where('provider').equals(providerName).toArray();
      const wins = signals.filter(s => s.status === 'TARGET_HIT').length;
      const losses = signals.filter(s => s.status === 'SL_HIT').length;
      const closed = signals.filter(s => s.status === 'CLOSED' || s.status === 'TARGET_HIT' || s.status === 'SL_HIT');
      
      const totalSignals = signals.length;
      const closedCount = closed.length;
      
      const winRate = closedCount > 0 ? Number((wins / closedCount).toFixed(2)) : 0.5;
      
      // Calculate average R:R
      let rrSum = 0;
      let rrCount = 0;
      signals.forEach(s => {
        if (s.riskRewardRatio) {
          rrSum += s.riskRewardRatio;
          rrCount++;
        }
      });
      const avgRR = rrCount > 0 ? Number((rrSum / rrCount).toFixed(2)) : 1.5;

      const provider = await db.signal_providers.where('name').equals(providerName).first();
      if (provider && provider.id) {
        await db.signal_providers.update(provider.id, {
          totalSignals,
          wins,
          losses,
          winRate,
          avgRR,
          lastActive: new Date().toISOString()
        });
      } else {
        await db.signal_providers.add({
          name: providerName,
          totalSignals,
          wins,
          losses,
          winRate,
          avgRR,
          lastActive: new Date().toISOString()
        });
      }
    } catch (err) {
      logger.error(`[SignalIntelligenceService] Failed to update stats for provider ${providerName}`, err);
    }
  }

  /**
   * Resets the signal_providers and parsed_signals tables and re-seeds with real channel names.
   * Useful when updating channel configs or clearing stale test data.
   */
  public async resetAndReseed(): Promise<void> {
    try {
      logger.info('[SignalIntelligenceService] Resetting and re-seeding Signal Intelligence DB...');
      await db.signal_providers.clear();
      await db.parsed_signals.clear();
      await this.preseedDatabaseIfEmpty();
      logger.info('[SignalIntelligenceService] Reset & re-seed complete!');
    } catch (err) {
      logger.error('[SignalIntelligenceService] Failed to reset & reseed database:', err);
      throw err;
    }
  }
}

export const signalIntelligenceService = SignalIntelligenceService.getInstance();
