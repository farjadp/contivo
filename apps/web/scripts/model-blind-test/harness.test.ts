/**
 * FREE. No network, no database. Drives the real content path
 * (generateContentDraftWithGemini → humanizeDraft) and the real failover
 * runner with fake provider adapters.
 *
 *   pnpm exec vitest run --config scripts/model-blind-test/vitest.config.ts harness
 */

import { describe, expect, test, vi } from 'vitest';

import { AiProviderError } from '@/lib/ai/errors';
import type { ProviderAdapter, ProviderCallInput, ProviderId } from '@/lib/ai/types';

import type { Candidate } from './config';
import { BudgetExceededError, findVendorTells, normaliseOutput, projectCostUsd, runBlindTest, runUnit } from './harness';
import { buildKey, coverage, mergeResults, prng, renderPackHtml, renderPackMarkdown, scoresTemplate, shuffled } from './pack';
import { makeRoute } from './route';
import { setRoute } from './routing';
import { formatTable, scoreBlind } from './score.mjs';
import type { Brief, UnitResult } from './types';

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  const { active } = await import('./routing');
  return {
    ...actual,
    runAiTask: (...args: Parameters<typeof actual.runAiTask>) => {
      if (!active.route) throw new Error('blind test: runAiTask called outside a unit');
      return active.route(...args);
    },
  };
});

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');

const BRIEF: Brief = {
  id: 'en-1',
  language: 'EN',
  source: { kind: 'content_item', id: 'item1', workspaceId: 'ws1' },
  workspaceName: 'Acme',
  brandSummary: { tone: 'direct', audience: 'founders' },
  topic: 'Why small teams should write weekly',
  context: '',
  contextNote: 'none',
  channel: 'linkedin',
  frameworkId: 'hook_value_cta',
  selectionReason: null,
  wordCount: { platform: 'linkedin', min: 380, max: 430, target: 400 },
  storylineBlock: null,
  storylineClaim: null,
};
const FA_BRIEF: Brief = { ...BRIEF, id: 'fa-1', language: 'FA', topic: 'چرا تیم‌های کوچک' };

const SONNET: Candidate = { slot: 'claude-sonnet-5-5', provider: 'anthropic', model: 'claude-sonnet-5-5', role: 'finalist' };
const SOL: Candidate = { slot: 'gpt-6.2-sol', provider: 'openai', model: 'gpt-6.2-sol', role: 'finalist' };
const ENV = { OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'k' };

type Reply = (input: ProviderCallInput) => { text: string; model?: string } | Error;

function fakeAdapters(reply: Reply, seen: ProviderCallInput[]): Record<ProviderId, ProviderAdapter> {
  const make = (id: ProviderId, keyEnv: string): ProviderAdapter => ({
    id,
    keyEnv,
    async call(input) {
      seen.push(input);
      const r = reply(input);
      if (r instanceof Error) throw r;
      return { model: r.model ?? input.model, text: r.text, usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 } };
    },
  });
  return { openai: make('openai', 'OPENAI_API_KEY'), anthropic: make('anthropic', 'ANTHROPIC_API_KEY'), gemini: make('gemini', 'GEMINI_API_KEY') };
}

const goodReply: Reply = (input) =>
  input.task === 'humanize'
    ? { text: JSON.stringify({ text: `Small teams win by shipping. ${words(395, 'clear')}` }) }
    : { text: `Here is the post:\n\nSmall teams win. ${words(400)}` };

function deps(reply: Reply, seen: ProviderCallInput[], env: Record<string, string> = ENV) {
  return {
    setRoute,
    env,
    sleep: async () => {},
    makeRoute: ((c, calls, o) => makeRoute(c, calls, { ...o, adapters: fakeAdapters(reply, seen) })) as typeof makeRoute,
  };
}

describe('runUnit through the real content path', () => {
  test('pins provider and model, drafts then humanizes, prices every call', async () => {
    const seen: ProviderCallInput[] = [];
    const r = await runUnit(BRIEF, SONNET, deps(goodReply, seen));
    expect(r.ok).toBe(true);
    expect(seen.map((s) => s.task)).toEqual(['content_draft', 'humanize']);
    expect(new Set(seen.map((s) => s.model))).toEqual(new Set(['claude-sonnet-5-5']));
    // The production prompt reached the model.
    expect(seen[0].request.prompt).toContain('Topic: Why small teams should write weekly');
    expect(r.text?.startsWith('Small teams win by shipping.')).toBe(true);
    expect(r.resolvedModels).toEqual(['claude-sonnet-5-5']);
    expect(r.costUsd).toBeCloseTo(2 * ((1000 * 2 + 500 * 10) / 1e6), 9);
    expect(r.attempts).toBe(1);
  });

  test('a provider without a key is not run and not called', async () => {
    const seen: ProviderCallInput[] = [];
    const r = await runUnit(BRIEF, SONNET, deps(goodReply, seen, { OPENAI_API_KEY: 'k' }));
    expect(r).toMatchObject({ ok: false, attempts: 0, error: 'not_run: ANTHROPIC_API_KEY not set' });
    expect(seen).toHaveLength(0);
  });

  test('a 5xx is retried once, then the unit fails', async () => {
    const seen: ProviderCallInput[] = [];
    const r = await runUnit(BRIEF, SOL, deps(() => new AiProviderError({ provider: 'openai', errorClass: 'server', message: 'boom', status: 503 }), seen));
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(2);
    expect(r.error).toMatch(/server$/);
  });

  test('billing is not retried', async () => {
    const seen: ProviderCallInput[] = [];
    const r = await runUnit(BRIEF, SOL, deps(() => new AiProviderError({ provider: 'openai', errorClass: 'billing', message: 'no credits', status: 429 }), seen));
    expect(r.attempts).toBe(1);
    expect(r.error).toMatch(/billing$/);
  });

  test('a failed humanize fails the unit instead of passing off the raw draft', async () => {
    const seen: ProviderCallInput[] = [];
    const reply: Reply = (input) =>
      input.task === 'humanize' ? new AiProviderError({ provider: 'anthropic', errorClass: 'bad_request', message: 'nope', status: 400 }) : goodReply(input);
    const r = await runUnit(BRIEF, SONNET, deps(reply, seen));
    expect(r.ok).toBe(false);
    expect(r.text).toBeNull();
    expect(r.error).toBe('bad_request:bad_request');
  });
});

describe('budget', () => {
  test('stops before any call when the projection is over the cap', async () => {
    const seen: ProviderCallInput[] = [];
    await expect(
      runBlindTest({ briefs: [BRIEF], candidates: [SONNET], maxUsd: 0.000001, deps: deps(goodReply, seen) }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(seen).toHaveLength(0);
  });

  test('10 briefs × the five candidates project under $10', () => {
    const briefs = [...Array(5)].map((_, i) => ({ ...BRIEF, id: `en-${i}` })).concat([...Array(5)].map((_, i) => ({ ...FA_BRIEF, id: `fa-${i}` })));
    const blog = briefs.map((b, i) => (i % 2 ? b : { ...b, channel: 'blog', wordCount: { platform: 'blog' as const, min: 600, max: 2200, target: 1400 } }));
    const p = projectCostUsd(blog, [
      SONNET,
      SOL,
      { slot: 'gemini-4-argon', provider: 'gemini', model: 'gemini-4-argon', role: 'finalist' },
      { slot: 'claude-opus-5-5', provider: 'anthropic', model: 'claude-opus-5-5', role: 'finalist' },
      { slot: 'gemini-3.7-flash', provider: 'gemini', model: 'gemini-3.7-flash', role: 'baseline' },
    ], new Date('2026-12-02T00:00:00Z'));
    expect(p.totalUsd).toBeLessThan(10);
  });
});

describe('normalisation and tells', () => {
  test('strips a preamble and a whole-output fence, never the body', () => {
    expect(normaliseOutput('Here is your LinkedIn post:\n\nBody line.')).toBe('Body line.');
    expect(normaliseOutput('```markdown\n# Title\n\nBody\n```')).toBe('# Title\n\nBody');
    expect(normaliseOutput('Here is why it matters: we ship.')).toBe('Here is why it matters: we ship.');
  });
  test('flags vendor names', () => {
    expect(findVendorTells('As an AI language model, Claude thinks')).toEqual(['as an ai', 'language model', 'claude']);
    expect(findVendorTells('Plain post.')).toEqual([]);
  });
});

function result(briefId: string, slot: string, ok = true, text = `post by ${slot}`): UnitResult {
  return {
    briefId,
    slot,
    provider: 'x',
    requestedModel: slot,
    ok,
    text: ok ? text : null,
    draftText: null,
    humanizePasses: 1,
    error: ok ? null : 'x',
    attempts: 1,
    calls: [],
    resolvedModels: ok ? [slot] : [],
    promptTokens: 1,
    completionTokens: 1,
    costUsd: 0.01,
    latencyMs: 1000,
    words: 3,
    possibleTells: [],
  };
}

describe('pack', () => {
  const candidates: Candidate[] = [SONNET, SOL, { slot: 'gemini-4-argon', provider: 'gemini', model: 'gemini-4-argon', role: 'finalist' }];
  const briefs = [BRIEF, FA_BRIEF];
  const results = briefs.flatMap((b) => candidates.map((c) => result(b.id, c.slot, true, `Text ${b.id} ${c.slot.length}`)));
  const projection = { rows: [], totalUsd: 0 };

  test('the seed fixes the order, and the order differs between briefs', () => {
    const a = buildKey({ briefs, candidates, results, projection, spentUsd: 0, seed: 42 });
    const b = buildKey({ briefs, candidates, results, projection, spentUsd: 0, seed: 42 });
    expect(a.labels).toEqual(b.labels);
    expect(shuffled([1, 2, 3, 4, 5], prng(1))).not.toEqual(shuffled([1, 2, 3, 4, 5], prng(2)));
  });

  test('pack has no model, vendor, slot, seed, cost or token data; Persian is RTL', () => {
    const key = buildKey({ briefs, candidates, results, projection, spentUsd: 1.23, seed: 7 });
    const md = renderPackMarkdown(key, briefs);
    const html = renderPackHtml(key, briefs);
    for (const doc of [md, html]) {
      for (const banned of ['claude', 'sonnet', 'gpt', 'gemini', 'argon', 'anthropic', 'openai', 'seed', '1.23', 'token']) {
        expect(doc.toLowerCase()).not.toContain(banned);
      }
    }
    expect(md).toContain('<div dir="rtl" lang="fa">');
    expect(html).toContain('dir="rtl" lang="fa"');
    expect(md).toContain('**Would you publish Post A unchanged?** yes / no — why:');
    expect(coverage(key).complete).toBe(true);
  });

  test('a missing output gets no label and makes the pack partial', () => {
    const partial = results.filter((r) => !(r.briefId === 'fa-1' && r.slot === SOL.slot));
    const key = buildKey({ briefs, candidates, results: partial, projection, spentUsd: 0, seed: 7 });
    expect(Object.keys(key.labels['fa-1'])).toEqual(['A', 'B']);
    expect(coverage(key)).toMatchObject({ complete: false, present: 5, expected: 6 });
    expect(Object.keys(scoresTemplate(key).briefs['fa-1'].posts)).toEqual(['A', 'B']);
  });

  test('a later failure never replaces an earlier success', () => {
    const merged = mergeResults([result('en-1', 'a')], [result('en-1', 'a', false), result('en-1', 'b')]);
    expect(merged.find((r) => r.slot === 'a')?.ok).toBe(true);
    expect(merged).toHaveLength(2);
  });
});

describe('score.mjs', () => {
  const candidates: Candidate[] = [SONNET, { slot: 'gemini-3.7-flash', provider: 'gemini', model: 'gemini-3.7-flash', role: 'baseline' }];
  const briefs = [BRIEF, FA_BRIEF];
  const results = briefs.flatMap((b) => candidates.map((c) => result(b.id, c.slot)));
  const key = buildKey({ briefs, candidates, results, projection: { rows: [], totalUsd: 0 }, spentUsd: 0.04, seed: 3 });
  const labelOf = (briefId: string, slot: string) => Object.entries(key.labels[briefId]).find(([, s]) => s === slot)![0];

  test('turns answers into publish rates, best picks, cost and latency', () => {
    const scores = { briefs: {} as Record<string, { best: string; posts: Record<string, { publish: string; why: string }> }> };
    for (const b of briefs) {
      scores.briefs[b.id] = {
        best: labelOf(b.id, SONNET.slot),
        posts: {
          [labelOf(b.id, SONNET.slot)]: { publish: 'yes', why: 'clean' },
          [labelOf(b.id, 'gemini-3.7-flash')]: { publish: b.language === 'FA' ? 'yes' : 'no', why: 'generic' },
        },
      };
    }
    const rows = scoreBlind(key, scores);
    const sonnet = rows.find((r: { slot: string }) => r.slot === SONNET.slot);
    const flash = rows.find((r: { slot: string }) => r.slot === 'gemini-3.7-flash');
    expect(sonnet).toMatchObject({ bestPicks: 2, publish: { all: 2, EN: 1, FA: 1 }, costPerPostUsd: 0.01, p50LatencyMs: 1000 });
    expect(flash).toMatchObject({ bestPicks: 0, publish: { all: 1, EN: 0, FA: 1 } });
    expect(formatTable(rows)).toContain('| claude-sonnet-5-5 | finalist | 100 % (2/2) |');
  });

  test('refuses a half-filled answer sheet', () => {
    expect(() => scoreBlind(key, { briefs: {} })).toThrow(/incomplete/);
  });
});
