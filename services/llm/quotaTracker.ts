import { AIProvider } from "../../types/ai";

export interface QuotaEntry {
  modelId: string;
  provider: string;
  callsToday: number;
  dailyLimit: number;
  lastResetDate: string; // YYYY-MM-DD
}

const PROVIDER_QUOTAS: Record<string, number> = {
  "gemini-3.5-flash-latest": 20,           // * 10 keys = 200/day
  "gemini-3.1-flash-lite-latest": 500,     // * 10 keys = 5,000/day
  "gemini-3-flash-latest": 20,             // * 10 keys = 200/day
  "meta-llama/llama-4-scout-17b-16e-instruct": 1000,
  "openai/gpt-oss-120b": 1000,
  "gpt-oss-120b": 14400,
  "mistral-small-latest": Infinity,
};

export class QuotaTracker {
  private static instance: QuotaTracker;
  private storageKey = "wealth-llm-quota-tracker";
  private dynamicQuotas: Record<string, number> = {};

  private constructor() {}

  public static getInstance(): QuotaTracker {
    if (!QuotaTracker.instance) {
      QuotaTracker.instance = new QuotaTracker();
    }
    return QuotaTracker.instance;
  }

  /**
   * Allows dynamic updates to quotas (e.g. from remote config or 429 detections)
   */
  public updateQuota(modelId: string, limit: number): void {
    this.dynamicQuotas[modelId] = limit;
  }

  private getEntries(): Record<string, { callsToday: number; lastResetDate: string }> {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  private saveEntries(entries: Record<string, { callsToday: number; lastResetDate: string }>): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(entries));
    } catch (e) {
      console.error("Failed to save quota entries", e);
    }
  }

  private getTodayStr(): string {
    return new Date().toISOString().split('T')[0];
  }

  public trackCall(modelId: string, provider: string): void {
    const entries = this.getEntries();
    const today = this.getTodayStr();
    
    if (!entries[modelId] || entries[modelId].lastResetDate !== today) {
      entries[modelId] = { callsToday: 0, lastResetDate: today };
    }
    
    entries[modelId].callsToday += 1;
    this.saveEntries(entries);
  }

  public markExhausted(modelId: string): void {
    const entries = this.getEntries();
    const today = this.getTodayStr();
    const limit = this.dynamicQuotas[modelId] || PROVIDER_QUOTAS[modelId] || 1000;
    entries[modelId] = { callsToday: limit, lastResetDate: today };
    this.saveEntries(entries);
  }

  public getRemainingQuota(modelId: string): number {
    const entries = this.getEntries();
    const today = this.getTodayStr();
    const entry = entries[modelId];
    const callsToday = (entry && entry.lastResetDate === today) ? entry.callsToday : 0;
    
    const limit = this.dynamicQuotas[modelId] ?? PROVIDER_QUOTAS[modelId] ?? Infinity;
    if (limit === Infinity) return Infinity;
    return Math.max(0, limit - callsToday);
  }

  public getUtilizationSummary(): QuotaEntry[] {
    const entries = this.getEntries();
    const today = this.getTodayStr();
    
    // Combine static and dynamic keys
    const allModelIds = Array.from(new Set([...Object.keys(PROVIDER_QUOTAS), ...Object.keys(this.dynamicQuotas)]));

    return allModelIds.map(modelId => {
      const entry = entries[modelId];
      const callsToday = (entry && entry.lastResetDate === today) ? entry.callsToday : 0;
      const limit = this.dynamicQuotas[modelId] ?? PROVIDER_QUOTAS[modelId];
      
      // Determine provider from model registry
      const provider = modelId.includes("gemini") ? "gemini" 
                     : modelId.includes("llama-4") ? "groq"
                     : modelId.includes("gpt-oss") ? "cerebras"
                     : modelId.includes("mistral") ? "mistral" : "other";

      return {
        modelId,
        provider,
        callsToday,
        dailyLimit: limit,
        lastResetDate: entry?.lastResetDate || today
      };
    });
  }

  public getBestAvailableModel(taskType: 'speed' | 'quality' | 'vision' | 'code'): string {
    let candidates: string[] = [];
    if (taskType === 'quality') {
      candidates = ["gemini-3.5-flash-latest", "gemini-3-flash-latest"];
    } else if (taskType === 'speed') {
      candidates = ["gemini-3.1-flash-lite-latest", "meta-llama/llama-4-scout-17b-16e-instruct"];
    } else if (taskType === 'vision') {
      candidates = ["gemini-3-flash-latest", "gemini-3.5-flash-latest"];
    } else if (taskType === 'code') {
      candidates = ["qwen/qwen3-coder:free", "gemini-3.5-flash-latest"];
    }

    for (const modelId of candidates) {
      if (this.getRemainingQuota(modelId) > 0) {
        return modelId;
      }
    }

    return "mistral-small-latest";
  }
}
