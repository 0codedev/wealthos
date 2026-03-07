import { SecureStorage } from "../../utils/Encryption";
import { AIProvider } from "../../types/ai";
import { logger } from "../Logger";

const secureKeyPoolStorage = new SecureStorage('wealth-secure-key-pool');

interface KeyState {
  key: string;
  exhaustedUntil: number; // timestamp, 0 if active
  latencyMs?: number; // Exponential moving average of latency
}

interface ProviderPool {
  keys: KeyState[];
  currentIndex: number;
  callsToday: number;
  lastCallResetDate: string; // YYYY-MM-DD
  dailyLimit?: number;
}

export class KeyPoolManager {
  private static instance: KeyPoolManager;
  private pool: Record<AIProvider, ProviderPool>;

  private constructor() {
    this.pool = this.loadPool();
  }

  public static getInstance(): KeyPoolManager {
    if (!KeyPoolManager.instance) {
      KeyPoolManager.instance = new KeyPoolManager();
    }
    return KeyPoolManager.instance;
  }

  private loadPool(): Record<AIProvider, ProviderPool> {
    const defaultPool = (): Record<AIProvider, ProviderPool> => ({
      omniroute: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      gemini: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      groq: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      openrouter: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      mistral: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      cerebras: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      github: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      cloudflare: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' },
      cohere: { keys: [], currentIndex: 0, callsToday: 0, lastCallResetDate: '' }
    });

    try {
      const stored = secureKeyPoolStorage.get<any>();
      if (stored) {
        const pool = defaultPool();
        for (const p of Object.keys(pool)) {
          const provider = p as AIProvider;
          const keyList = stored[provider] || [];
          pool[provider].keys = keyList.map((k: any) => {
            if (typeof k === 'string') {
              return { key: k, exhaustedUntil: 0 };
            }
            return { key: k.key, exhaustedUntil: k.exhaustedUntil || 0, latencyMs: k.latencyMs };
          });
          pool[provider].currentIndex = stored[provider + '_currentIndex'] || 0;
          pool[provider].callsToday = stored[provider + '_callsToday'] || 0;
          pool[provider].lastCallResetDate = stored[provider + '_lastCallResetDate'] || '';
        }
        return pool;
      }
    } catch (e) {
      logger.error("Failed to load Key Pool", e);
    }
    return defaultPool();
  }

  private savePool(): void {
    try {
      const toStore: Record<string, any> = {};
      for (const p of Object.keys(this.pool)) {
        const provider = p as AIProvider;
        toStore[provider] = this.pool[provider].keys;
        toStore[provider + '_currentIndex'] = this.pool[provider].currentIndex;
        toStore[provider + '_callsToday'] = this.pool[provider].callsToday;
        toStore[provider + '_lastCallResetDate'] = this.pool[provider].lastCallResetDate;
      }
      secureKeyPoolStorage.set(toStore);
    } catch (e) {
      logger.error("Failed to save Key Pool", e);
    }
  }

  public getKeys(provider: AIProvider): string[] {
    return this.pool[provider].keys.map(k => k.key);
  }

  public setKeys(provider: AIProvider, keys: string[]): void {
    const currentKeys = this.pool[provider].keys;
    const cleanKeys = keys.map(k => k.trim()).filter(Boolean);
    
    this.pool[provider].keys = cleanKeys.map(key => {
      const match = currentKeys.find(c => c.key === key);
      return {
        key,
        exhaustedUntil: match ? match.exhaustedUntil : 0,
        latencyMs: match ? match.latencyMs : undefined
      };
    });
    this.pool[provider].currentIndex = 0;
    this.savePool();
  }

  public getNextKey(provider: AIProvider): string | undefined {
    const pPool = this.pool[provider];
    if (!pPool || pPool.keys.length === 0) return undefined;

    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];
    if (pPool.lastCallResetDate !== todayStr) {
      pPool.callsToday = 0;
      pPool.lastCallResetDate = todayStr;
    }

    // Filter active keys
    const activeKeys = pPool.keys.filter(k => k.exhaustedUntil <= now);
    if (activeKeys.length === 0) {
      logger.warn(`KeyPoolManager: All keys for provider ${provider} are exhausted.`);
      return undefined;
    }

    // Latency-aware selection: prioritize keys with lower EMA latency.
    // Unmeasured keys are assigned a default high latency (1000ms) to ensure they get tested.
    activeKeys.sort((a, b) => (a.latencyMs || 1000) - (b.latencyMs || 1000));
    
    const selected = activeKeys[0];
    pPool.callsToday = (pPool.callsToday || 0) + 1;
    this.savePool();
    return selected.key;
  }

  public recordLatency(provider: AIProvider, key: string, latencyMs: number): void {
    const pPool = this.pool[provider];
    if (!pPool) return;
    const keyState = pPool.keys.find(k => k.key === key);
    if (keyState) {
        // Exponential Moving Average (70% old, 30% new)
        keyState.latencyMs = keyState.latencyMs ? (keyState.latencyMs * 0.7 + latencyMs * 0.3) : latencyMs;
        // Optimization: don't save to storage on every request to save I/O
    }
  }

  public markKeyExhausted(provider: AIProvider, key: string, cooldownMs: number = 5 * 60 * 1000): void {
    const pPool = this.pool[provider];
    if (!pPool) return;

    const keyState = pPool.keys.find(k => k.key === key);
    if (keyState) {
      keyState.exhaustedUntil = Date.now() + cooldownMs;
      logger.warn(`KeyPoolManager: Key for provider ${provider} marked exhausted until ${new Date(keyState.exhaustedUntil).toLocaleTimeString()}`);
      this.savePool();
    }
  }

  public getExhaustedProviders(): AIProvider[] {
    return Object.keys(this.pool).filter(p => {
      const pool = this.pool[p as AIProvider];
      return pool.keys.length > 0 && 
             pool.keys.every(k => k.exhaustedUntil > Date.now());
    }) as AIProvider[];
  }

  public getCallStats(): Record<AIProvider, { callsToday: number; totalKeys: number; activeKeys: number; dailyLimit?: number; utilizationPct?: number }> {
    const stats: any = {};
    const now = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];
    
    for (const p of Object.keys(this.pool)) {
      const provider = p as AIProvider;
      const pPool = this.pool[provider];
      
      if (pPool.lastCallResetDate !== todayStr) {
        pPool.callsToday = 0;
        pPool.lastCallResetDate = todayStr;
      }

      const callsToday = pPool.callsToday || 0;
      const totalKeys = pPool.keys.length;
      const activeKeys = pPool.keys.filter(k => k.exhaustedUntil <= now).length;
      
      let utilizationPct: number | undefined;
      if (pPool.dailyLimit) {
        utilizationPct = Math.round((callsToday / pPool.dailyLimit) * 100);
      }

      stats[provider] = {
        callsToday,
        totalKeys,
        activeKeys,
        dailyLimit: pPool.dailyLimit,
        utilizationPct
      };
    }
    return stats;
  }
}
