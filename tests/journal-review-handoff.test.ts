import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveJournalReviewHandoffs,
  registerJournalReviewHandoff,
} from '../services/JournalReviewHandoffService';

describe('journal review handoff service', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and returns fresh journal review handoffs in newest-first order', () => {
    registerJournalReviewHandoff('alpha', 'NEEDS_ANNOTATION', 1_000);
    registerJournalReviewHandoff('beta', 'READY_FOR_LESSON', 2_000);

    const handoffs = getActiveJournalReviewHandoffs(3_000);

    expect(handoffs).toHaveLength(2);
    expect(handoffs[0].ticker).toBe('BETA');
    expect(handoffs[0].reviewStatus).toBe('READY_FOR_LESSON');
  });
});
