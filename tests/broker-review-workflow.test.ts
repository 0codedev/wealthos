import { describe, expect, it } from 'vitest';
import {
  getBrokerReviewStatusMeta,
  resolveTradeReviewStatus,
  summarizeBrokerReviewQueue,
} from '../services/BrokerReviewWorkflowService';

describe('broker review workflow summary', () => {
  it('summarizes pending imported trades by review stage', () => {
    const summary = summarizeBrokerReviewQueue([
      {
        ticker: 'ALPHA',
        direction: 'Long',
        quantity: 10,
        entryPrice: 100,
        exitPrice: 100,
        date: '2026-04-05',
        moodEntry: 'Focused',
        moodExit: 'Satisfied',
        mistakes: [],
        isImported: true,
        reviewStatus: 'NEEDS_ANNOTATION',
      },
      {
        ticker: 'BETA',
        direction: 'Long',
        quantity: 10,
        entryPrice: 100,
        exitPrice: 100,
        date: '2026-04-05',
        moodEntry: 'Focused',
        moodExit: 'Satisfied',
        mistakes: [],
        isImported: true,
        reviewStatus: 'NEEDS_SCREENSHOTS',
      },
      {
        ticker: 'GAMMA',
        direction: 'Long',
        quantity: 10,
        entryPrice: 100,
        exitPrice: 100,
        date: '2026-04-05',
        moodEntry: 'Focused',
        moodExit: 'Satisfied',
        mistakes: [],
        isImported: true,
        reviewStatus: 'READY_FOR_LESSON',
      },
      {
        ticker: 'DONE',
        direction: 'Long',
        quantity: 10,
        entryPrice: 100,
        exitPrice: 100,
        date: '2026-04-05',
        moodEntry: 'Focused',
        moodExit: 'Satisfied',
        mistakes: [],
        isImported: true,
        reviewStatus: 'ANNOTATED',
      },
    ] as any);

    expect(summary.total).toBe(3);
    expect(summary.needsAnnotation).toBe(1);
    expect(summary.needsScreenshots).toBe(1);
    expect(summary.readyForLesson).toBe(1);
    expect(summary.nextTrade?.ticker).toBe('ALPHA');
  });

  it('derives review status from annotation, evidence, and lesson completion', () => {
    expect(resolveTradeReviewStatus({
      ticker: 'ALPHA',
      direction: 'Long',
      quantity: 10,
      entryPrice: 100,
      exitPrice: 100,
      date: '2026-04-05',
      moodEntry: 'Focused',
      moodExit: 'Satisfied',
      mistakes: [],
      isImported: true,
      notes: 'Tagged the setup',
      screenshotEntry: 'blob:entry',
      coreLesson: 'Wait for confirmation',
    } as any)).toBe('ANNOTATED');

    expect(resolveTradeReviewStatus({
      ticker: 'BETA',
      direction: 'Long',
      quantity: 10,
      entryPrice: 100,
      exitPrice: 100,
      date: '2026-04-05',
      moodEntry: 'Focused',
      moodExit: 'Satisfied',
      mistakes: [],
      isImported: true,
      notes: 'Tagged the setup',
      screenshotEntry: 'blob:entry',
    } as any)).toBe('READY_FOR_LESSON');
  });

  it('provides workflow metadata for review states', () => {
    const lessonMeta = getBrokerReviewStatusMeta('READY_FOR_LESSON');
    const completeMeta = getBrokerReviewStatusMeta('ANNOTATED');

    expect(lessonMeta.recommendedStep).toBe(5);
    expect(lessonMeta.label).toBe('Ready For Lesson');
    expect(completeMeta.shortLabel).toBe('Complete');
  });
});
