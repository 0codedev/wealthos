import { describe, expect, it } from 'vitest';
import { buildIPOTimeline, scoreIPOBreakdown, summarizeIPOApplications } from '../services/IPOWarRoomService';

describe('ipo war room helpers', () => {
  it('builds score breakdown with positive and negative factors', () => {
    const result = scoreIPOBreakdown({
      id: 'ipo-1',
      name: 'Test IPO',
      issueOpenDate: '2026-03-30',
      issueCloseDate: '2026-04-01',
      allotmentDate: '2026-04-03',
      refundDate: '2026-04-04',
      listingDate: '2026-04-07',
      priceRange: { min: 100, max: 110 },
      lotSize: 100,
      issueSize: 2000,
      gmp: 45,
      subscriptionData: { qib: 10, nii: 4, retail: 2.5, total: 5 },
      status: 'OPEN',
      category: 'MAINBOARD',
      sector: 'Technology',
      rating: 'SUBSCRIBE',
    });

    expect(result.score).toBeGreaterThan(50);
    expect(result.factors.some((factor) => factor.label === 'GMP momentum')).toBe(true);
  });

  it('builds timeline milestones and summarizes application capital', () => {
    const timeline = buildIPOTimeline({
      id: 'ipo-2',
      name: 'Timeline IPO',
      issueOpenDate: '2026-03-30',
      issueCloseDate: '2026-04-01',
      allotmentDate: '2026-04-03',
      refundDate: '2026-04-04',
      listingDate: '2026-04-07',
      priceRange: { min: 100, max: 110 },
      lotSize: 100,
      issueSize: 500,
      status: 'UPCOMING',
      category: 'MAINBOARD',
      sector: 'Finance',
    }, new Date('2026-04-02T00:00:00.000Z'));

    const summary = summarizeIPOApplications([
      {
        applicantName: 'A',
        ipoName: 'Timeline IPO',
        amount: 15000,
        blockedAmount: 15000,
        status: 'BLOCKED',
        upiHandle: 'test@upi',
        appliedDate: '2026-03-30',
      },
      {
        applicantName: 'B',
        ipoName: 'Timeline IPO',
        amount: 15000,
        refundAmount: 15000,
        status: 'REFUNDED',
        upiHandle: 'test@upi',
        appliedDate: '2026-03-30',
      },
      {
        applicantName: 'C',
        ipoName: 'Timeline IPO',
        amount: 15000,
        status: 'LISTED',
        realizedPnL: 4200,
        upiHandle: 'test@upi',
        appliedDate: '2026-03-30',
      },
    ]);

    expect(timeline[2].label).toBe('Allotment');
    expect(summary.blockedCapital).toBe(15000);
    expect(summary.refundedCapital).toBe(15000);
    expect(summary.listedPnL).toBe(4200);
  });
});
