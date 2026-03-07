/**
 * LocalPersistenceService
 * A typed, namespaced wrapper for localStorage with safe JSON parsing,
 * backward-compatibility safety checks, and fallback default values.
 */

const DEFAULT_NAMESPACE = 'wealth-v2';

export interface StorageSchema {
  theme: 'light' | 'dark';
  'gemini-api-key': string;
  'dhan_cached_fund_limit': any;
  'dhan_cached_positions': any;
  'dhan_last_fund_limit_fetch': number;
  'dhan_last_positions_fetch': number;
  'wealth-broker-execution-handoff': any[];
  'wealth-aggregator-logic': any;
  [key: string]: any;
}

class LocalPersistenceService {
  private namespace: string;

  constructor(namespace: string = DEFAULT_NAMESPACE) {
    this.namespace = namespace;
  }

  private canUseWindow(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  private getFullKey(key: string): string {
    return this.namespace ? `${this.namespace}:${key}` : key;
  }

  /**
   * Retrieves an item from localStorage, parses it as JSON, and falls back if not found.
   * Includes backward compatibility checks for un-namespaced keys.
   */
  public get<K extends keyof StorageSchema>(key: K, defaultValue: StorageSchema[K]): StorageSchema[K] {
    if (!this.canUseWindow()) return defaultValue;

    try {
      const namespacedKey = this.getFullKey(key as string);
      let raw = window.localStorage.getItem(namespacedKey);

      // Backwards compatibility safety check:
      // If the namespaced key is missing, check the original un-namespaced key
      if (raw === null) {
        raw = window.localStorage.getItem(key as string);
        if (raw !== null) {
          // Migrate old key to new namespaced key for continuity
          window.localStorage.setItem(namespacedKey, raw);
        }
      }

      if (raw === null) return defaultValue;

      // Handle simple string types directly to avoid JSON.parse errors on plain strings
      if (typeof defaultValue === 'string' && !raw.startsWith('"') && !raw.startsWith('{') && !raw.startsWith('[')) {
        return raw as unknown as StorageSchema[K];
      }

      return JSON.parse(raw) as StorageSchema[K];
    } catch (e) {
      console.warn(`Error parsing localStorage key "${String(key)}":`, e);
      return defaultValue;
    }
  }

  /**
   * Saves an item to localStorage with namespacing.
   */
  public set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): void {
    if (!this.canUseWindow()) return;

    try {
      const namespacedKey = this.getFullKey(key as string);
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      window.localStorage.setItem(namespacedKey, serialized);
    } catch (e) {
      console.error(`Error writing localStorage key "${String(key)}":`, e);
    }
  }

  /**
   * Removes an item from localStorage.
   */
  public remove<K extends keyof StorageSchema>(key: K): void {
    if (!this.canUseWindow()) return;

    try {
      window.localStorage.removeItem(this.getFullKey(key as string));
      window.localStorage.removeItem(key as string); // Also remove old non-namespaced key
    } catch (e) {
      console.error(`Error removing localStorage key "${String(key)}":`, e);
    }
  }

  /**
   * Checks if a key exists in localStorage.
   */
  public has<K extends keyof StorageSchema>(key: K): boolean {
    if (!this.canUseWindow()) return false;
    const namespacedKey = this.getFullKey(key as string);
    return window.localStorage.getItem(namespacedKey) !== null || window.localStorage.getItem(key as string) !== null;
  }

  /**
   * Clears all keys belonging to this namespace.
   */
  public clearNamespace(): void {
    if (!this.canUseWindow()) return;

    try {
      const prefix = `${this.namespace}:`;
      const keysToRemove: string[] = [];

      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => window.localStorage.removeItem(key));
    } catch (e) {
      console.error(`Error clearing localStorage namespace "${this.namespace}":`, e);
    }
  }
}

export const localPersistence = new LocalPersistenceService();
export default localPersistence;
