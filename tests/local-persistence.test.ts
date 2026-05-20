import { beforeEach, describe, expect, it } from 'vitest';
import { localPersistence } from '../services/LocalPersistenceService';

describe('LocalPersistenceService', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('sets and gets typed values with namespacing', () => {
    localPersistence.set('theme', 'dark');
    expect(localPersistence.get('theme', 'light')).toBe('dark');
    
    // Check that it's stored under namespaced key in raw localStorage
    expect(window.localStorage.getItem('wealth-v2:theme')).toBe('dark');
  });

  it('returns default fallback value if key does not exist', () => {
    expect(localPersistence.get('theme', 'light')).toBe('light');
    expect(localPersistence.get('dhan_last_fund_limit_fetch', 123)).toBe(123);
  });

  it('supports backward compatibility and auto-migrates old unnamespaced keys', () => {
    // Write directly to old key format
    window.localStorage.setItem('theme', 'dark');
    
    // Read namespaced key (should find old key, migrate it, and return value)
    expect(localPersistence.get('theme', 'light')).toBe('dark');
    
    // Verify it was migrated in localStorage
    expect(window.localStorage.getItem('wealth-v2:theme')).toBe('dark');
  });

  it('correctly handles JSON objects', () => {
    const mockHandoff = [{ id: 'TCS:BUY:quick', ticker: 'TCS', action: 'BUY', orderStyle: 'quick' }];
    localPersistence.set('wealth-broker-execution-handoff', mockHandoff);
    
    const retrieved = localPersistence.get('wealth-broker-execution-handoff', []);
    expect(retrieved).toEqual(mockHandoff);
    expect(retrieved[0].ticker).toBe('TCS');
  });

  it('correctly removes keys', () => {
    localPersistence.set('theme', 'dark');
    expect(localPersistence.has('theme')).toBe(true);
    
    localPersistence.remove('theme');
    expect(localPersistence.has('theme')).toBe(false);
    expect(localPersistence.get('theme', 'light')).toBe('light');
  });

  it('clears only namespaced keys', () => {
    localPersistence.set('theme', 'dark');
    window.localStorage.setItem('external-key', 'keep-me');
    
    localPersistence.clearNamespace();
    
    expect(localPersistence.has('theme')).toBe(false);
    expect(window.localStorage.getItem('external-key')).toBe('keep-me');
  });
});
