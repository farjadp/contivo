import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

// pipeline.ts imports prisma; the bundle only needs its pure parser.
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: vi.fn() }));

import { buildEvidenceBundle, evidenceIdsFor, hasBrandSummary, ownEvidence, ownEvidenceId } from './bundle';

const ownId = (text: string) => `own:${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;

const workspace = {
  name: 'Acme',
  websiteUrl: 'https://www.acme.com/pricing',
  brandSummary: { offers: ['Fast CRM', 'Cheap CRM'], tagline: 'Sell more' },
  audienceInsights: {
    competitorKeywordsIntel: {
      competitors: [
        { competitor: 'Rival', domain: 'rival.io', primary_keywords: ['crm', 'sales'], secondary_keywords: [], keyword_clusters: [{ cluster: 'pipeline', keywords: [] }] },
        { competitor: 'Empty', domain: 'empty.io', primary_keywords: [], secondary_keywords: [], keyword_clusters: [] },
      ],
    },
  },
};

const rival = {
  id: 'c1',
  name: 'Rival',
  domain: 'www.Rival.io',
  type: 'INDIRECT',
  positioning: 'CRM for teams',
  keyFeatures: ['a'],
  labels: ['crm'],
  evidence: [
    { id: 'abcd1234', kind: 'serp', url: 'https://rival.io', title: 'Rival', snippet: 'Best CRM' },
    { id: 'ffff0000', kind: 'site', url: 'https://rival.io/x' },
  ],
};

describe('buildEvidenceBundle', () => {
  it('keeps stored evidence ids and drops items with no text', () => {
    const b = buildEvidenceBundle({ workspace, competitors: [rival] });
    expect(b.competitors[0].evidence).toEqual([{ id: 'abcd1234', kind: 'serp', text: 'Rival — Best CRM' }]);
  });

  it('gives a competitor with null evidence an empty list and defaults unknown type to DIRECT', () => {
    const b = buildEvidenceBundle({ workspace, competitors: [{ ...rival, evidence: null, type: 'weird' }] });
    expect(b.competitors[0].evidence).toEqual([]);
    expect(b.competitors[0].type).toBe('DIRECT');
  });

  it('ids target evidence by its text (own: + 8 hex of sha256) and normalises the target domain', () => {
    const b = buildEvidenceBundle({ workspace, competitors: [] });
    expect(b.target.companyId).toBe('TARGET');
    expect(b.target.competitorId).toBeNull();
    expect(b.target.domain).toBe('acme.com');
    expect(b.target.evidence.map((e) => e.id).sort()).toEqual(
      [ownId('Fast CRM'), ownId('Cheap CRM'), ownId('Sell more')].sort(),
    );
    expect(b.target.evidence.every((e) => /^own:[0-9a-f]{8}$/.test(e.id))).toBe(true);
    expect(b.target.evidence.every((e) => e.kind === 'own')).toBe(true);
  });

  it('matches keyword themes by normalised domain and ignores empty entries', () => {
    const b = buildEvidenceBundle({
      workspace,
      competitors: [rival, { ...rival, id: 'c2', domain: 'https://empty.io' }],
    });
    expect(b.competitors[0].keywordThemes).toEqual(['crm', 'sales', 'pipeline']);
    expect(b.competitors[1].keywordThemes).toEqual([]);
  });

  it('caps evidence text at 300 chars and items at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `0000000${i}`.slice(-8), kind: 'serp', url: `https://r.io/${i}`, title: 'x'.repeat(400) }));
    const b = buildEvidenceBundle({ workspace, competitors: [{ ...rival, evidence: many }] });
    expect(b.competitors[0].evidence).toHaveLength(12);
    expect(b.competitors[0].evidence[0].text).toHaveLength(300);
  });
});

describe('ownEvidence ids', () => {
  it('are stable when the brand summary is reordered', () => {
    const before = ownEvidence({ offers: ['A', 'B'], tagline: 'T' });
    const after = ownEvidence({ tagline: 'T', offers: ['B', 'A'] });
    const idOf = (items: typeof before, text: string) => items.find((e) => e.text === text)!.id;
    for (const text of ['A', 'B', 'T']) expect(idOf(after, text)).toBe(idOf(before, text));
    expect(idOf(before, 'A')).toBe(ownEvidenceId('A'));
  });

  it('collapse duplicate texts to one item', () => {
    const items = ownEvidence({ tagline: 'Same', offers: ['  Same ', 'Other'] });
    expect(items.map((e) => e.text)).toEqual(['Same', 'Other']);
    expect(new Set(items.map((e) => e.id)).size).toBe(2);
  });
});

describe('hasBrandSummary', () => {
  it('is false for null and true when any string exists', () => {
    expect(hasBrandSummary(null)).toBe(false);
    expect(hasBrandSummary({ a: 1, b: {}, c: [''] })).toBe(false);
    expect(hasBrandSummary({ offers: ['A'] })).toBe(true);
  });
});

describe('evidenceIdsFor', () => {
  it('returns the ids for one company', () => {
    const b = buildEvidenceBundle({ workspace, competitors: [rival] });
    expect(evidenceIdsFor(b, 'c1')).toEqual(new Set(['abcd1234']));
    expect(evidenceIdsFor(b, 'TARGET').has(ownId('Sell more'))).toBe(true);
    expect(evidenceIdsFor(b, 'nope').size).toBe(0);
  });
});
