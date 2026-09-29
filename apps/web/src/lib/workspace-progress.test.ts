import { describe, expect, it } from 'vitest';

import { buildWorkspaceProgressReport } from './workspace-progress';

const zeroBaselineScores = {
  brand_understanding: 0,
  strategy_readiness: 0,
  market_intelligence: 0,
  content_system: 0,
  distribution_readiness: 0,
  optimization_maturity: 0,
};

function buildInput(competitors: Array<{ userDecision?: string | null }>) {
  return {
    workspace: {
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      brandSummary: {},
      audienceInsights: {
        progressReport: {
          baseline: {
            created_at: '2026-01-01T00:00:00.000Z',
            scores: zeroBaselineScores,
          },
        },
      },
      contentItems: [],
      competitors,
    },
    activityLogs: [],
  };
}

describe('market intelligence score', () => {
  it('does not give the "3+ competitors" credit for REJECTED-only rows', () => {
    const rejectedOnly = buildInput([
      { userDecision: 'REJECTED' },
      { userDecision: 'REJECTED' },
      { userDecision: 'REJECTED' },
    ]);
    const report = buildWorkspaceProgressReport(rejectedOnly);
    expect(report).not.toBeNull();
    // The "3 or more competitors" term (2 pts) must not be credited when every
    // row is REJECTED, matching countCompetitors used everywhere else. The raw
    // score is 0, which clampScore floors to 1 (its documented minimum).
    expect(report!.dimension_scores.market_intelligence.now).toBe(1);
  });

  it('still credits undecided (null) and PENDING rows toward the 3+ total', () => {
    const undecided = buildInput([
      { userDecision: null },
      { userDecision: 'PENDING' },
      { userDecision: 'REJECTED' },
    ]);
    const report = buildWorkspaceProgressReport(undecided);
    expect(report).not.toBeNull();
    // 2 rows count (null + PENDING), still short of 3 -> no credit yet, and
    // the raw 0 is floored to 1 by clampScore.
    expect(report!.dimension_scores.market_intelligence.now).toBe(1);

    const threeCounted = buildInput([
      { userDecision: null },
      { userDecision: 'PENDING' },
      { userDecision: 'PENDING' },
      { userDecision: 'REJECTED' },
    ]);
    const reportWithThree = buildWorkspaceProgressReport(threeCounted);
    expect(reportWithThree).not.toBeNull();
    expect(reportWithThree!.dimension_scores.market_intelligence.now).toBe(2);
  });
});
