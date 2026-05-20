import { describe, expect, it } from 'vitest';
import { acknowledgeCommandAction, acknowledgeCommandInsight, filterAcknowledgedInsights, getActiveAcknowledgedInsights } from '../services/CommandCenterAcknowledgementService';

describe('command center acknowledgement', () => {
  it('suppresses acknowledged insights from the active queue', () => {
    const acknowledged = acknowledgeCommandInsight({
      id: 'proposal-rebalance-sell-Equity',
      title: 'Trim Equity & Related',
      description: 'Equity is above target.',
      priority: 'high',
      lane: 'portfolio',
      action: 'rebalance',
    }, 1000);

    const filtered = filterAcknowledgedInsights(
      [
        {
          id: 'proposal-rebalance-sell-Equity',
          title: 'Trim Equity & Related',
          description: 'Equity is above target.',
          priority: 'high',
          lane: 'portfolio',
          action: 'rebalance',
        },
        {
          id: 'smart-trade-review',
          title: 'Review imported trades',
          description: 'Trade review queue is elevated.',
          priority: 'medium',
          lane: 'broker',
          action: 'trade-review',
        },
      ],
      getActiveAcknowledgedInsights(1001),
    );

    expect(acknowledged.id).toBe('proposal-rebalance-sell-Equity');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('smart-trade-review');
  });

  it('suppresses all insights for an acknowledged command action', () => {
    acknowledgeCommandAction('journal', 'journal-coach', 'Working journal coaching queue', 2000);

    const filtered = filterAcknowledgedInsights(
      [
        {
          id: 'journal-process',
          title: 'Repair trade process discipline',
          description: 'Process score is weak.',
          priority: 'high',
          lane: 'journal',
          action: 'journal-coach',
        },
        {
          id: 'journal-best-setup',
          title: 'Press your breakout edge',
          description: 'Breakout is leading your playbook.',
          priority: 'low',
          lane: 'journal',
          action: 'journal-coach',
        },
        {
          id: 'smart-broker-sync',
          title: 'Review broker sync',
          description: 'Broker queue is elevated.',
          priority: 'medium',
          lane: 'broker',
          action: 'broker-sync',
        },
      ],
      getActiveAcknowledgedInsights(2001),
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('smart-broker-sync');
  });
});
