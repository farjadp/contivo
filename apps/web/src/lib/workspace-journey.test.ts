import { describe, expect, it } from 'vitest';
import { buildJourney, matrixFacts, tabGate, type WorkspaceFacts } from './workspace-journey';

const charts = (n: number) => Array.from({ length: n }, () => ({}));

/** Everything else ready, so only the matrices decide the gate. */
const facts = (insights: unknown, overrides: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  workspaceId: 'ws',
  hasBrandSummary: true,
  acceptedCompetitors: 3,
  totalCompetitors: 3,
  ...matrixFacts(insights),
  keywordCompetitors: 4,
  storylines: 2,
  hasChannel: true,
  channelLabel: 'LINKEDIN',
  autopilotEnabled: false,
  publishedCount: 0,
  scheduledCount: 0,
  ...overrides,
});

const step = (f: WorkspaceFacts, id: string) => buildJourney(f).steps.find((s) => s.id === id)!;

describe('matrixFacts', () => {
  it('counts charts and asks the server gate whether they are usable', () => {
    expect(
      matrixFacts({ competitiveMatrices: { run_id: 'r', charts: charts(3), competitor_basis: 'ACCEPTED' } }),
    ).toEqual({ matrixCharts: 3, matricesReady: true });
    expect(matrixFacts({ competitiveMatrices: { charts: charts(2) } })).toEqual({
      matrixCharts: 2,
      matricesReady: false,
    });
  });
  it('treats missing or malformed insights as no charts', () => {
    for (const v of [null, undefined, {}, 'x', { competitiveMatrices: { charts: 'x' } }]) {
      expect(matrixFacts(v)).toEqual({ matrixCharts: 0, matricesReady: false });
    }
  });
});

describe('tabGate agrees with the ideation server gate', () => {
  it('gates ideation and autopilot at 2 charts', () => {
    const g = tabGate(facts({ competitiveMatrices: { charts: charts(2) } }));
    expect(g.ideation).toBeDefined();
    expect(g.autopilot).toBeDefined();
  });

  it('gates at 3 charts when a new-pipeline blob has no confirmed basis', () => {
    const g = tabGate(
      facts({ competitiveMatrices: { run_id: 'r', charts: charts(3), competitor_basis: 'UNKNOWN' } }),
    );
    expect(g.ideation).toBeDefined();
    expect(g.autopilot).toBeDefined();
  });

  it('gates a fabricated legacy blob', () => {
    const fabricated = {
      charts: charts(3).map(() => ({
        summary: { market_pattern: 'Estimated pattern from limited public signals.' },
      })),
    };
    expect(tabGate(facts({ competitiveMatrices: fabricated })).ideation).toBeDefined();
  });

  it('opens at 3 charts on an accepted basis', () => {
    const g = tabGate(
      facts({ competitiveMatrices: { run_id: 'r', charts: charts(3), competitor_basis: 'ACCEPTED' } }),
    );
    expect(g.ideation).toBeUndefined();
    expect(g.autopilot).toBeUndefined();
  });

  it('never gates an autopilot that is already enabled', () => {
    for (const insights of [{}, { competitiveMatrices: { charts: charts(2) } }]) {
      expect(
        tabGate(facts(insights, { autopilotEnabled: true, storylines: 0, keywordCompetitors: 0 })).autopilot,
      ).toBeUndefined();
    }
  });

  it('keeps the narrative tab on its own server rule: one chart and two accepted competitors', () => {
    expect(tabGate(facts({ competitiveMatrices: { charts: charts(1) } })).narrative).toBeUndefined();
    expect(
      tabGate(facts({ competitiveMatrices: { charts: charts(1) } }, { acceptedCompetitors: 1 })).narrative,
    ).toBeDefined();
  });
});

describe('journey steps agree with the server gate', () => {
  it('does not mark the market step done on charts ideation would refuse', () => {
    const f = facts({ competitiveMatrices: { charts: charts(2) } });
    expect(step(f, 'market').state).toBe('current');
    expect(step(f, 'market').action.key).toBe('steps.market.actionCharts');
  });

  it('asks for a re-run when there are enough charts but no confirmed basis', () => {
    const f = facts({ competitiveMatrices: { run_id: 'r', charts: charts(3) } });
    expect(step(f, 'market').state).toBe('current');
    expect(step(f, 'market').action.key).toBe('steps.market.actionRerunCharts');
  });

  it('marks the market step done once the matrices pass the server gate', () => {
    const f = facts({ competitiveMatrices: { run_id: 'r', charts: charts(3), competitor_basis: 'ACCEPTED' } });
    expect(step(f, 'market').state).toBe('done');
  });

  it('locks the autopilot step until the matrices pass the server gate', () => {
    const f = facts({ competitiveMatrices: { charts: charts(2) } });
    expect(step(f, 'autopilot').state).toBe('locked');
    expect(step(f, 'autopilot').blockedBy?.key).toBe('blockers.intelligenceSteps');
  });

  it('never locks an autopilot step that is already enabled', () => {
    const f = facts({}, { autopilotEnabled: true });
    expect(step(f, 'autopilot').state).toBe('done');
    expect(step(f, 'autopilot').blockedBy).toBeUndefined();
  });

  it('leaves the narrative step reachable on one chart, as the narrative action allows', () => {
    const f = facts({ competitiveMatrices: { charts: charts(1) } }, { storylines: 0 });
    expect(step(f, 'narrative').blockedBy).toBeUndefined();
  });
});

describe('the firstPost end step', () => {
  const ready = { competitiveMatrices: { run_id: 'r', charts: charts(3), competitor_basis: 'ACCEPTED' } };

  it('is appended last, after the six setup steps', () => {
    const j = buildJourney(facts({}));
    expect(j.steps).toHaveLength(7);
    expect(j.steps.map((s) => s.id)).toEqual([
      'brand',
      'market',
      'keywords',
      'narrative',
      'channel',
      'autopilot',
      'firstPost',
    ]);
    expect(j.steps[6]).toMatchObject({
      order: 7,
      href: '/growth/ws?tab=first-post',
      title: { key: 'steps.firstPost.title' },
      why: { key: 'steps.firstPost.why' },
      action: { key: 'steps.firstPost.action' },
    });
  });

  it('is done once anything is published, and never locked', () => {
    expect(step(facts({}, { publishedCount: 0 }), 'firstPost')).toMatchObject({
      state: 'available',
      detail: { key: 'steps.firstPost.detailTodo' },
    });
    expect(step(facts({}, { publishedCount: 0 }), 'firstPost').blockedBy).toBeUndefined();
    expect(step(facts({}, { publishedCount: 2, hasBrandSummary: false }), 'firstPost')).toMatchObject({
      state: 'done',
      detail: { key: 'steps.firstPost.detailDone' },
    });
  });

  it('leaves completed, total, percent, isComplete and next to the six setup steps', () => {
    const fixtures: WorkspaceFacts[] = [
      facts({}),
      facts({}, { hasBrandSummary: false, acceptedCompetitors: 0, totalCompetitors: 0, keywordCompetitors: 0 }),
      facts({ competitiveMatrices: { charts: charts(2) } }),
      facts(ready, { publishedCount: 3 }),
      facts(ready, { autopilotEnabled: true }),
      facts(ready, { autopilotEnabled: true, publishedCount: 1 }),
    ];
    for (const f of fixtures) {
      const j = buildJourney(f);
      const setup = j.steps.filter((s) => s.id !== 'firstPost');
      const completed = setup.filter((s) => s.state === 'done').length;
      expect(j.total).toBe(6);
      expect(j.completed).toBe(completed);
      expect(j.percent).toBe(Math.round((completed / 6) * 100));
      expect(j.isComplete).toBe(completed === 6);
      expect(j.next?.id).not.toBe('firstPost');
      expect(j.next).toEqual(setup.find((s) => s.state === 'current') ?? null);
    }
  });

  it('is never current, even when setup is complete and nothing is published', () => {
    const j = buildJourney(facts(ready, { autopilotEnabled: true, publishedCount: 0 }));
    expect(j.isComplete).toBe(true);
    expect(j.next).toBeNull();
    expect(j.steps[6].state).toBe('available');
  });
});
