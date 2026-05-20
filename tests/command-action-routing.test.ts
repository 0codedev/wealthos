import { describe, expect, it } from 'vitest';
import { resolveCommandActionRoute } from '../services/CommandActionRoutingService';

describe('command action routing', () => {
  it('routes broker and portfolio actions to the expected tabs', () => {
    expect(resolveCommandActionRoute('broker-sync')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
    expect(resolveCommandActionRoute('trade-review')).toEqual({ category: 'journal', subTab: 'journal' });
    expect(resolveCommandActionRoute('rebalance')).toEqual({ category: 'portfolio', subTab: 'portfolio' });
  });

  it('falls back to dashboard for unknown actions', () => {
    expect(resolveCommandActionRoute('something-else')).toEqual({ category: 'dashboard', subTab: 'dashboard' });
  });
});
