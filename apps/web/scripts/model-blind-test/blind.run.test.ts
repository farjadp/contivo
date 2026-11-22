/**
 * PAID. The blind test itself. Skipped unless BLIND_TEST_RUN=1.
 *
 *   cd apps/web
 *   set -a; source <primary checkout>/apps/web/.env.local; set +a   # OPENAI / GEMINI / ANTHROPIC keys
 *   BLIND_TEST_RUN=1 pnpm exec vitest run --config scripts/model-blind-test/vitest.config.ts blind.run
 *
 * Options:
 *   BLIND_TEST_MAX_USD=10      projected and measured spend cap (default 10)
 *   BLIND_TEST_ONLY=slot,slot  run only these candidates (e.g. fill the Claude slots later);
 *                              results merge into the existing key (same seed), the pack is re-rendered
 *   BLIND_PACK_ALLOW_PARTIAL=1 write the pack even if some posts are missing
 *
 * Every (brief × model) unit runs once (one retry only after a 429/5xx). A
 * provider without a key is recorded as not_run, never called. Nothing is
 * written to any database and no alert is sent (route.ts).
 */

import fs from 'node:fs';

import { describe, expect, test, vi } from 'vitest';

import { BRIEFS_FILE, CANDIDATES, DEFAULT_MAX_USD, KEY_FILE, OUT_DIR, PACK_HTML, PACK_MD, SCORES_FILE } from './config';
import { runBlindTest } from './harness';
import { buildKey, coverage, mergeResults, renderPackHtml, renderPackMarkdown, scoresTemplate, type BlindKey } from './pack';
import { setRoute } from './routing';
import type { Brief } from './types';

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

describe.skipIf(!process.env.BLIND_TEST_RUN)('model blind test (paid)', () => {
  test('runs every brief × model once and writes the key and the blind pack', async () => {
    if (!fs.existsSync(BRIEFS_FILE)) throw new Error(`No briefs: run export.run first (${BRIEFS_FILE}).`);
    const briefs = (JSON.parse(fs.readFileSync(BRIEFS_FILE, 'utf8')) as { briefs: Brief[] }).briefs;
    const only = process.env.BLIND_TEST_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
    const candidates = only ? CANDIDATES.filter((c) => only.includes(c.slot)) : CANDIDATES;
    if (!candidates.length) throw new Error('BLIND_TEST_ONLY matched no candidate');
    const maxUsd = Number(process.env.BLIND_TEST_MAX_USD || DEFAULT_MAX_USD);

    const run = await runBlindTest({ briefs, candidates, maxUsd, deps: { setRoute, log: (l) => console.log(l) } });
    console.log(`[blind] projected $${run.projection.totalUsd.toFixed(2)}, measured $${run.spentUsd.toFixed(4)}`);

    const previous: BlindKey | null = fs.existsSync(KEY_FILE)
      ? (JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')) as BlindKey)
      : null;
    const key = buildKey({
      briefs,
      candidates: CANDIDATES,
      results: mergeResults(previous?.results ?? [], run.results),
      projection: run.projection,
      spentUsd: (previous?.spentUsd ?? 0) + run.spentUsd,
      // One seed for the whole test, so filling a slot later does not reshuffle what Farjad may have seen.
      seed: previous?.seed,
    });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, JSON.stringify(key, null, 2));
    console.log(`[blind] key → ${KEY_FILE} (do not show it before scoring)`);

    const cov = coverage(key);
    if (cov.complete || process.env.BLIND_PACK_ALLOW_PARTIAL) {
      fs.writeFileSync(PACK_MD, renderPackMarkdown(key, briefs));
      fs.writeFileSync(PACK_HTML, renderPackHtml(key, briefs));
      if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, JSON.stringify(scoresTemplate(key), null, 2));
      console.log(`[blind] pack → ${PACK_MD} and ${PACK_HTML} (${cov.present}/${cov.expected} posts)`);
    } else {
      console.log(
        `[blind] pack NOT written: ${cov.present}/${cov.expected} posts. Fill the empty slots or set BLIND_PACK_ALLOW_PARTIAL=1.`,
      );
    }
    const tells = key.results.filter((r) => r.possibleTells.length);
    if (tells.length) console.log(`[blind] WARNING: ${tells.length} outputs name a vendor or model; check before sending the pack.`);
    expect(run.results.length).toBe(briefs.length * candidates.length);
  });
});
