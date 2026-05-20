import { describe, expect, it } from 'vitest';
import { computeResolvedCommandInsights } from '../services/CommandCenterResolutionService';

describe('command center resolution', () => {
  it('detects queue items that disappeared from the active mission list', () => {
    const resolved = computeResolvedCommandInsights(
      [
        { id: 'a', title: 'Review Broker Sync', description: 'sync', priority: 'high', lane: 'broker', action: 'broker-sync' },
        { id: 'b', title: 'Deploy Idle Cash', description: 'cash', priority: 'medium', lane: 'portfolio', action: 'deploy-cash' },
      ],
      [
        { id: 'b', title: 'Deploy Idle Cash', description: 'cash', priority: 'medium', lane: 'portfolio', action: 'deploy-cash' },
      ],
      123,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe('a');
    expect(resolved[0].resolvedAt).toBe(123);
  });
});
