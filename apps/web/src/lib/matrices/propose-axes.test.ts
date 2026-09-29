import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coreAxes } from './axes';
import type { EvidenceBundle } from './bundle';
import { MatrixAiError, callStructured } from './openai';
import { AXIS_SCHEMA, buildAxisPrompt, proposeMarketAxes } from './propose-axes';

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

const company = (name: string, over: Record<string, unknown> = {}) => ({
  companyId: name,
  competitorId: name === 'Acme' ? null : name,
  name,
  domain: `${name.toLowerCase()}.com`,
  type: 'DIRECT' as const,
  positioning: `${name} positioning`,
  keyFeatures: ['invoicing'],
  labels: ['saas'],
  keywordThemes: [],
  evidence: Array.from({ length: 8 }, (_, i) => ({ id: `${name}-${i}`, kind: 'site', text: `${name} evidence ${i}` })),
  ...over,
});

const bundle = { target: company('Acme'), competitors: [company('Rival')] } as unknown as EvidenceBundle;
const brief = { brandName: 'Acme', targetCountry: 'Iran' };

const cand = (key: string) => ({
  key,
  x: { label: `${key} x`, low: 'low', high: 'high' },
  y: { label: `${key} y`, low: 'low', high: 'high' },
  rationale: 'Because.',
  evidence_fields: ['positioning'],
});

const reply = (candidates: unknown[]) => mocked.mockResolvedValueOnce({ data: { candidates }, tokens: 42 });

describe('proposeMarketAxes', () => {
  beforeEach(() => mocked.mockReset());

  it('returns four slugified candidates', async () => {
    reply([cand('Compliance Depth'), cand('smb-focus'), cand('a'), cand('b')]);
    const out = await proposeMarketAxes(bundle, 'en', brief);
    expect(out.candidates.map((c) => c.key)).toEqual(['compliance_depth', 'smb_focus', 'a', 'b']);
    expect(out.tokens).toBe(42);
  });

  it('drops a candidate that uses a core key', async () => {
    reply([cand('offer_breadth_specialization'), cand('a'), cand('b'), cand('c')]);
    const out = await proposeMarketAxes(bundle, 'en', brief);
    expect(out.candidates.map((c) => c.key)).toEqual(['a', 'b', 'c']);
  });

  it('throws when fewer than two survive', async () => {
    reply([cand('content_presence_focus'), cand('a'), { key: '' }, 'junk']);
    await expect(proposeMarketAxes(bundle, 'en', brief)).rejects.toThrow(MatrixAiError);
    reply([cand('a')]);
    await expect(proposeMarketAxes(bundle, 'en', brief)).rejects.toThrow(
      'axis proposal returned fewer than 2 usable candidates',
    );
  });

  it('carries tokens on the failure', async () => {
    reply([cand('a')]);
    await expect(proposeMarketAxes(bundle, 'en', brief)).rejects.toMatchObject({ tokens: 42 });
  });

  it('sends the language instruction and both core axis labels', async () => {
    reply([cand('a'), cand('b')]);
    await proposeMarketAxes(bundle, 'fa', brief);
    const args = mocked.mock.calls[0][0];
    const prompt = `${args.system}\n${args.user}`;
    expect(prompt).toContain('Write every label and rationale in Persian.');
    for (const axis of coreAxes('fa')) {
      expect(prompt).toContain(axis.x.label);
      expect(prompt).toContain(axis.y.label);
    }
    expect(args.schema).toBe(AXIS_SCHEMA);
  });
});

describe('buildAxisPrompt', () => {
  it('states the rules, caps evidence at five per company and uses English for en', () => {
    const { system, user } = buildAxisPrompt(bundle, 'en', brief);
    expect(system).toContain('Write every label and rationale in English.');
    expect(system).toMatch(/40 characters/);
    expect(system).toMatch(/strategy/);
    expect(user).toContain('Rival positioning');
    expect(user).toContain('Rival evidence 4');
    expect(user).not.toContain('Rival evidence 5');
    expect(user).toContain('Iran');
  });
});

describe('AXIS_SCHEMA', () => {
  it('is strict at every object level', () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as object).sort());
      }
      Object.values(n).forEach(walk);
    };
    walk(AXIS_SCHEMA);
    const items = (AXIS_SCHEMA.properties as unknown as Record<string, { minItems: number; maxItems: number }>).candidates;
    expect([items.minItems, items.maxItems]).toEqual([4, 4]);
  });
});
