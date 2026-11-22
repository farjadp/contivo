/**
 * Free tests for the calibration eval: no network, no provider keys.
 *   pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval-judge
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  decide,
  gatePromptFrom,
  loadGatePrompt,
  MissingGateExportError,
  parseGateJson,
  REQUIRED_EXPORT_LINE,
  type GatePrompt,
} from './judge';
import { AGREEMENT_BAR, wilson } from './metrics';
import { loadDataset, runEval } from './run';
import { fixtureTransport, LayerNotAvailableError, layerTransport } from './transport';
import type { Dataset, DatasetItem } from './types';

// dataset.json holds real drafts and brand summaries from the local DB, so it is
// gitignored (public repo). Build it with export-dataset.mjs; without it the
// dataset tests are skipped and the rest run on an empty set.
const DATASET_FILE = path.join(__dirname, 'dataset.json');
const hasDataset = fs.existsSync(DATASET_FILE);
/** Without dataset.json, the runner tests use the committed synthetic drafts. */
function syntheticDataset(): Dataset {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'synthetic.json'), 'utf8')) as Array<
    Omit<DatasetItem, 'brandSummary' | 'reference'> & { expected: DatasetItem['expected'] }
  >;
  const items = raw.map((item) => ({
    ...item,
    brandSummary: { businessSummary: 'Synthetic test brand.' },
    reference: { verdict: item.expected.verdict, labelSource: 'hand_written' },
  })) as unknown as DatasetItem[];
  return { builtAt: 'synthetic', census: {}, counts: {}, items };
}
const dataset: Dataset = hasDataset ? loadDataset(DATASET_FILE) : syntheticDataset();

/** Prompt stand-in: the draft text is enough for fixtures to match on. */
const fakePrompt: GatePrompt = { build: (item) => `DRAFT:${item.id}`, system: 'sys', systemSource: 'copy' };
const reply = (o: Record<string, unknown>) => JSON.stringify(o);
const APPROVE = reply({ brand_fit: 9, factual_safety: 9, clarity: 9, verdict: 'approve', notes: [] });
const REJECT = reply({ brand_fit: 8, factual_safety: 1, clarity: 8, verdict: 'reject', notes: ['fabricated case study'] });

/** A judge that is right on every item. */
function perfectReplies(items: DatasetItem[]) {
  return items.map((i) => ({ match: `DRAFT:${i.id}`, reply: i.expected.verdict === 'approve' ? APPROVE : REJECT }));
}

describe.skipIf(!hasDataset)('dataset.json', () => {
  test('every item is replayable and labelled', () => {
    const ids = new Set<string>();
    for (const item of dataset.items) {
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(item.content.trim().length).toBeGreaterThan(100);
      expect(item.brandSummary).toBeTruthy();
      expect(['approve', 'reject']).toContain(item.expected.verdict);
      expect(item.expected.verdict).toBe(item.reference.verdict);
      expect(item.storyline).toBeNull();
      // Synthetic drafts are never passed off as real ones.
      expect(item.synthetic).toBe(item.source === 'hand_written');
      if (item.expected.fabrication) expect(item.expected.verdict).toBe('reject');
    }
  });

  test('at most 5 synthetic drafts, and real verdicts carry their judge', () => {
    expect(dataset.items.filter((i) => i.synthetic).length).toBeLessThanOrEqual(5);
    for (const item of dataset.items.filter((i) => i.source === 'local_db_gate_verdict')) {
      expect(item.reference.labelSource).toBe('gate_verdict');
      expect(item.reference.judgeProvider).toBeTruthy();
      expect(item.reference.judgedAt).toBeTruthy();
    }
  });
});

describe('gate prompt', () => {
  test('uses the exported builder, or names the exact export that is missing', async () => {
    try {
      const prompt = await loadGatePrompt();
      const item = dataset.items[0];
      const text = prompt.build(item);
      expect(text).toContain(item.content.trim().slice(0, 200));
      expect(text).toContain('factual_safety');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingGateExportError);
      expect((error as Error).message).toContain(REQUIRED_EXPORT_LINE);
    }
  });

  test('prefers an exported system prompt over the local copy', () => {
    const p = gatePromptFrom({ buildJudgePrompt: () => 'x', JUDGE_SYSTEM_PROMPT: 'exported' });
    expect(p.system).toBe('exported');
    expect(p.systemSource).toBe('export');
    expect(gatePromptFrom({ buildJudgePrompt: () => 'x' }).systemSource).toBe('copy');
  });
});

describe('decide (mirrors evaluateDraft)', () => {
  test('approves only above every threshold and without a veto', () => {
    expect(decide(JSON.parse(APPROVE)).approved).toBe(true);
    const low = decide({ brand_fit: 9, factual_safety: 6, clarity: 9, verdict: 'approve' });
    expect(low.approved).toBe(false);
    expect(low.below).toEqual(['factual_safety']);
    const veto = decide({ brand_fit: 9, factual_safety: 9, clarity: 9, verdict: 'REJECT' });
    expect(veto).toMatchObject({ approved: false, vetoed: true, below: [] });
  });

  test('a missing or non-numeric score is a fail, as in the gate', () => {
    expect(decide({ brand_fit: 9, clarity: 9, verdict: 'approve' }).below).toEqual(['factual_safety']);
    expect(decide({ brand_fit: 'high', factual_safety: 9, clarity: 9 }).below).toEqual(['brand_fit']);
  });

  test('parse is exactly as lenient as the gate: fences yes, prose no', () => {
    expect(parseGateJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseGateJson('Here you go: {"a":1}')).toBeNull();
    expect(parseGateJson('[1]')).toBeNull();
  });
});

describe('runEval with fixtures', () => {
  test('a perfect judge passes the bar', async () => {
    const report = await runEval({ transport: fixtureTransport(perfectReplies(dataset.items)), dataset, prompt: fakePrompt });
    expect(report.summary.agreement).toBe(1);
    expect(report.summary.passBar.pass).toBe(true);
    // fixture-model is not in PRICES: cost is unknown, never zero.
    expect(report.summary.cost.totalUsd).toBeNull();
    expect(report.summary.cost.unpricedCalls).toBe(dataset.items.length);
  });

  test('one approved fabrication fails the bar even at high agreement', async () => {
    const fab = dataset.items.find((i) => i.synthetic && i.expected.fabrication)!;
    const replies = perfectReplies(dataset.items).map((r) => (r.match === `DRAFT:${fab.id}` ? { ...r, reply: APPROVE } : r));
    const report = await runEval({ transport: fixtureTransport(replies), dataset, prompt: fakePrompt });
    expect(report.summary.fabricationsAccepted.map((f) => f.itemId)).toEqual([fab.id]);
    expect(report.summary.passBar.pass).toBe(false);
  });

  test('errors and unparseable replies count as disagreements', async () => {
    const [a, b] = dataset.items;
    const replies = perfectReplies(dataset.items).map((r) =>
      r.match === `DRAFT:${a.id}` ? { ...r, reply: new Error('timeout') } : r.match === `DRAFT:${b.id}` ? { ...r, reply: 'not json' } : r,
    );
    const report = await runEval({ transport: fixtureTransport(replies), dataset, prompt: fakePrompt });
    expect(report.summary.errors).toBe(2);
    expect(report.summary.agreements).toBe(dataset.items.length - 2);
    expect(report.summary.errorMessages.sort()).toEqual(['timeout', 'unparseable_json']);
  });

  test('per-criterion: a judge that fails real posts on clarity shows up there', async () => {
    const realIds = new Set(dataset.items.filter((i) => i.reference.scores).map((i) => `DRAFT:${i.id}`));
    const lowClarity = reply({ brand_fit: 9, factual_safety: 9, clarity: 4, verdict: 'approve' });
    const replies = perfectReplies(dataset.items).map((r) => (realIds.has(r.match) ? { ...r, reply: lowClarity } : r));
    const report = await runEval({ transport: fixtureTransport(replies), dataset, prompt: fakePrompt });
    const clarity = report.summary.perCriterion.find((c) => c.criterion === 'clarity')!;
    expect(clarity.passFailDisagreements).toBe(realIds.size);
    expect(report.summary.perCriterion.find((c) => c.criterion === 'factual_safety')!.passFailDisagreements).toBe(0);
  });

  test('repeats expose decisions that flip', async () => {
    const item = dataset.items[0];
    let n = 0;
    const flaky = {
      provider: 'fixture' as const,
      async call(req: { prompt: string }) {
        const text = req.prompt === `DRAFT:${item.id}` ? (n++ % 2 ? REJECT : APPROVE) : item.expected.verdict === 'approve' ? APPROVE : REJECT;
        return { ok: true as const, provider: 'fixture', model: 'm', text, json: null, usage: null, latencyMs: 0 };
      },
    };
    const small: Dataset = { ...dataset, items: [item] };
    const report = await runEval({ transport: flaky, dataset: small, prompt: fakePrompt, repeats: 2 });
    expect(report.summary.flippedItems).toEqual([item.id]);
  });
});

describe('layerTransport', () => {
  test('fails loudly while the provider layer does not exist', async () => {
    const t = layerTransport('anthropic', async () => {
      throw new LayerNotAvailableError('cannot import');
    });
    await expect(t.call({ system: 's', prompt: 'p', timeoutMs: 1 })).rejects.toBeInstanceOf(LayerNotAvailableError);
  });

  test('forces one provider and rejects a silent failover', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const t = layerTransport('anthropic', async () => async (task, req) => {
      seen.push({ task, ...req, chain: process.env.AI_CHAIN_QUALITY_GATE });
      return { ok: true, provider: 'openai', model: 'gpt-4.1', text: APPROVE, failedOver: [{ provider: 'anthropic' }] };
    });
    const res = await t.call({ system: 's', prompt: 'p', timeoutMs: 5 });
    expect(seen[0]).toMatchObject({
      task: 'quality_gate',
      chain: 'anthropic',
      output: { kind: 'json_object' },
      system: 's',
      prompt: 'p',
      timeoutMs: 5,
    });
    // The override is scoped to the call.
    expect(process.env.AI_CHAIN_QUALITY_GATE).toBeUndefined();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/^provider_mismatch/);
  });

  test('pins the model through modelOverride when asked (before/after runs)', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const loader = async () => async (_task: string, req: Record<string, unknown>) => {
      seen.push(req);
      return { ok: true as const, provider: 'openai', model: 'gpt-4.1-2025-04-14', text: APPROVE, failedOver: [] };
    };
    await layerTransport('openai', loader, 'gpt-4.1').call({ system: 's', prompt: 'p', timeoutMs: 5 });
    await layerTransport('openai', loader).call({ system: 's', prompt: 'p', timeoutMs: 5 });
    expect(seen[0].modelOverride).toEqual({ openai: 'gpt-4.1' });
    expect(seen[1]).not.toHaveProperty('modelOverride');
  });

  test('passes through a clean answer from the forced provider', async () => {
    const t = layerTransport('gemini', async () => async () => ({
      ok: true,
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      text: APPROVE,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      failedOver: [],
    }));
    const res = await t.call({ system: 's', prompt: 'p', timeoutMs: 5 });
    expect(res).toMatchObject({ ok: true, provider: 'gemini', model: 'gemini-3.8-flash' });
  });
});

test('wilson interval is wide at n=11', () => {
  const ci = wilson(10, 11);
  expect(ci.low).toBeLessThan(AGREEMENT_BAR);
  expect(ci.high).toBeGreaterThan(0.95);
});
