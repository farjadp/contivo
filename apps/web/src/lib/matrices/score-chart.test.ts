import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxisDefinition } from './axes';
import type { EvidenceBundle } from './bundle';
import { callStructured } from './openai';
import { REASON_MAX_CHARS, SCORE_SCHEMA, applyCoreAgreement, buildScorePrompt, scoreChart, type ScoredCompany } from './score-chart';

vi.mock('./openai', async () => {
  class MatrixAiError extends Error {
    readonly tokens: number | null;
    constructor(message: string, tokens: number | null = null) {
      super(message);
      this.name = 'MatrixAiError';
      this.tokens = tokens;
    }
  }
  return { MatrixAiError, callStructured: vi.fn() };
});

const mocked = vi.mocked(callStructured);

const company = (id: string, type: string, evidenceIds: string[]) => ({
  companyId: id,
  competitorId: id === 'TARGET' ? null : id,
  name: id === 'TARGET' ? 'Acme' : id,
  domain: `${id.toLowerCase()}.com`,
  type,
  positioning: 'p',
  keyFeatures: [],
  labels: [],
  keywordThemes: [],
  evidence: evidenceIds.map((e) => ({ id: e, kind: 'site', text: `text ${e}` })),
});

const bundle = {
  target: company('TARGET', 'TARGET', ['own:a', 'own:b']),
  competitors: [company('r1', 'DIRECT', ['e1', 'e2', 'e3'])],
} as unknown as EvidenceBundle;

const axis: AxisDefinition = {
  key: 'k',
  kind: 'CORE',
  name: 'K',
  x: { label: 'X axis', low: 'x-low', high: 'x-high' },
  y: { label: 'Y axis', low: 'y-low', high: 'y-high' },
};

const row = (id: string, over: Record<string, unknown> = {}) => ({
  company_id: id,
  x_score: 5,
  y_score: 5,
  x_reason: 'xr',
  y_reason: 'yr',
  evidence_refs: [],
  certainty: 'likely',
  ...over,
});
const reply = (companies: unknown[]) => mocked.mockResolvedValueOnce({ data: { companies }, tokens: 7 });

describe('scoreChart', () => {
  beforeEach(() => mocked.mockReset());

  it('maps certainty to floors, target to null competitorId, and flags estimated', async () => {
    reply([
      row('TARGET', { certainty: 'certain', evidence_refs: ['own:a', 'own:b', 'own:zzz'], x_score: 8 }),
      row('r1', { certainty: 'certain', evidence_refs: [] }),
    ]);
    const out = await scoreChart(bundle, axis, 'en');
    expect(out.tokens).toBe(7);
    const t = out.scores.find((s) => s.type === 'TARGET')!;
    expect(t.competitorId).toBeNull();
    expect(t.evidenceRefs).toEqual(['own:a', 'own:b']); // unknown dropped
    expect(t.estimated).toBe(false);
    expect(t.confidence).toBeGreaterThanOrEqual(0.9);
    expect(t.confidence).toBeLessThan(1);
    const r = out.scores.find((s) => s.competitorId === 'r1')!;
    expect(r.estimated).toBe(true);
    expect(r.confidence).toBeLessThanOrEqual(0.5);
    expect(r.type).toBe('DIRECT');
  });

  it('maps likely and unsure to their floors', async () => {
    reply([row('TARGET', { certainty: 'unsure', evidence_refs: ['own:a'] }), row('r1', { certainty: 'likely', evidence_refs: ['e1'] })]);
    const out = await scoreChart(bundle, axis, 'en');
    expect(out.scores[0].confidence).toBeGreaterThanOrEqual(0.5);
    expect(out.scores[0].confidence).toBeLessThan(0.6);
    expect(out.scores[1].confidence).toBeGreaterThanOrEqual(0.7);
    expect(out.scores[1].confidence).toBeLessThan(0.8);
  });

  it('throws with tokens when a company is missing', async () => {
    reply([row('TARGET')]);
    await expect(scoreChart(bundle, axis, 'en')).rejects.toMatchObject({ name: 'MatrixAiError', tokens: 7 });
  });

  it('throws when a company appears twice', async () => {
    reply([row('TARGET'), row('r1'), row('r1')]);
    await expect(scoreChart(bundle, axis, 'en')).rejects.toMatchObject({ tokens: 7 });
  });

  it('throws on an unknown company id', async () => {
    reply([row('TARGET'), row('r1'), row('ghost')]);
    await expect(scoreChart(bundle, axis, 'en')).rejects.toMatchObject({ tokens: 7 });
  });

  it.each([0, 11, 5.5, '5', null])('throws on score %s', async (bad) => {
    reply([row('TARGET', { x_score: bad }), row('r1')]);
    await expect(scoreChart(bundle, axis, 'en')).rejects.toMatchObject({ tokens: 7 });
  });

  it('throws when the reply has no companies array', async () => {
    mocked.mockResolvedValueOnce({ data: {}, tokens: 7 });
    await expect(scoreChart(bundle, axis, 'en')).rejects.toMatchObject({ tokens: 7 });
  });

  it('trims reasons to the limit and treats a bad certainty as unsure', async () => {
    reply([row('TARGET', { x_reason: `  ${'a'.repeat(300)}  `, certainty: 'sure!', evidence_refs: ['own:a'] }), row('r1')]);
    const out = await scoreChart(bundle, axis, 'en');
    expect(out.scores[0].xReason.length).toBe(REASON_MAX_CHARS);
    expect(out.scores[0].certainty).toBe('unsure');
  });

  it('sends the strict schema and a prompt stating the rubric', async () => {
    reply([row('TARGET'), row('r1')]);
    await scoreChart(bundle, axis, 'fa');
    const args = mocked.mock.calls[0][0];
    expect(args.schema).toBe(SCORE_SCHEMA);
    expect(args.system).toContain('x-low');
    expect(args.system).toContain('do not default it to the middle');
    expect(args.system).toContain('Persian');
    expect(args.user).toContain('TARGET');
  });
});

describe('buildScorePrompt', () => {
  it('writes English reasons for en', () => {
    expect(buildScorePrompt(bundle, axis, 'en').system).toContain('English');
  });
});

describe('SCORE_SCHEMA', () => {
  it('is strict at every object level', () => {
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as object).sort());
      }
      Object.values(n).forEach(walk);
    };
    walk(SCORE_SCHEMA);
  });
});

const sc = (id: string, x: number, y: number, certainty: ScoredCompany['certainty'], refs: string[]): ScoredCompany => ({
  competitorId: id,
  name: id,
  domain: id,
  type: 'DIRECT',
  xScore: x,
  yScore: y,
  confidence: 0,
  estimated: refs.length === 0,
  xReason: '',
  yReason: '',
  evidenceRefs: refs,
  certainty,
});

describe('applyCoreAgreement', () => {
  it('raises confidence only where the cell matches, within the band, keeping estimated capped', () => {
    const a = [sc('agree', 2, 9, 'likely', ['e1']), sc('differ', 2, 9, 'likely', ['e1']), sc('est', 2, 2, 'certain', [])];
    const b = [sc('agree', 3, 8, 'likely', ['e1']), sc('differ', 6, 9, 'likely', ['e1']), sc('est', 1, 4, 'certain', [])];
    const [ra, rb] = applyCoreAgreement(a, b);
    expect(ra[0].confidence).toBe(0.75);
    expect(rb[0].confidence).toBe(0.75);
    expect(ra[1].confidence).toBe(0); // unchanged
    expect(ra[2].confidence).toBe(0.5); // estimated cap intact
  });

  it('does not mutate its inputs', () => {
    const a = [sc('x', 1, 1, 'likely', ['e1'])];
    const b = [sc('x', 1, 1, 'likely', ['e1'])];
    applyCoreAgreement(a, b);
    expect(a[0].confidence).toBe(0);
  });
});
