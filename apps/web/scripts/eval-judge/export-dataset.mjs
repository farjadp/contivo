#!/usr/bin/env node
/**
 * Builds scripts/eval-judge/dataset.json for the judge calibration eval.
 *
 * Source: the LOCAL database only. Every quality-gate verdict the runner ever
 * logged lives in `autopilot_runs.log` (steps `scheduled` and `gate_rejected`);
 * the draft text lives in `content_items`. A verdict whose draft row is gone
 * cannot be replayed and is counted, not invented.
 *
 * Usage (from apps/web):
 *   node scripts/eval-judge/export-dataset.mjs --env-file .env.local
 *   DATABASE_URL=... node scripts/eval-judge/export-dataset.mjs
 *
 * Needs `psql` on PATH. Refuses any host that is not localhost: this file is
 * committed to a public repo and must never be built from production rows.
 * The connection string is never printed.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'dataset.json');
const SYNTHETIC = path.join(here, 'synthetic.json');

/**
 * Drafts that are known fabrications but were never judged by the gate (they
 * predate it, or came from the manual draft path). Their label comes from the
 * gate prompt's own rule, not from a verdict, and says so.
 */
const KNOWN_FABRICATIONS = {
  cmoiy4ctk000jvadeao2li0s8: {
    why: 'Blog "case study" of a named but invented SME ("Acme Services", 15 people, 30+ hours a week, 80% automated). Written by the manual draft path on 2026-04-28, before the gate existed.',
  },
};

/**
 * Gate prompt history (git log -- apps/web/src/lib/autopilot/quality-gate.ts).
 * A verdict is labelled with the prompt that was committed when it was made.
 */
const PROMPT_COMMITS = [
  { sha: 'a21d4db', at: '2026-08-16T19:37:38Z', note: 'gate added' },
  { sha: '0d5e20c', at: '2026-08-18T05:49:41Z', note: 'fabricated-case-study rule added to factual_safety' },
  { sha: '75f8c2d', at: '2026-09-01T22:43:35Z', note: 'storyline_fit / evidence_discipline added (only for storyline-bound drafts)' },
];

/** Hand-checked exceptions to the commit-time rule above. */
const PROMPT_NOTES = {
  cmsy8p6gg001bd3j8ztkbb2bf: VERIFY_NOTE(),
  cmsy8pyjk001fd3j8juo9sxca: VERIFY_NOTE(),
  cmsy8rmvi001jd3j83xuhtale: VERIFY_NOTE(),
};
function VERIFY_NOTE() {
  return 'Judged 1-3 min before 0d5e20c was committed; 346-349 words, matching that commit message ("three regenerated posts at 346-349 words"), so most likely judged by the 0d5e20c prompt from the uncommitted working tree.';
}

function promptAt(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  let current = null;
  for (const c of PROMPT_COMMITS) if (Date.parse(c.at) <= t) current = c.sha;
  return current ?? 'pre-a21d4db';
}

function readDatabaseUrl() {
  const i = process.argv.indexOf('--env-file');
  if (i !== -1) {
    const file = process.argv[i + 1];
    const line = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('DATABASE_URL='));
    if (!line) throw new Error(`DATABASE_URL not found in ${file}`);
    return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  throw new Error('Set DATABASE_URL or pass --env-file <path>.');
}

function pgEnv(rawUrl) {
  const url = new URL(rawUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`Refusing non-local database host "${url.hostname}". This exporter reads the local DB only.`);
  }
  return {
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.replace(/^\//, ''),
    },
    schema: url.searchParams.get('schema') || 'public',
  };
}

function query(pg, sql) {
  const res = spawnSync('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path = "${pg.schema}"`, '-c', sql], {
    env: pg.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`psql failed: ${res.stderr.trim()}`);
  const lines = res.stdout.trim().split('\n');
  return JSON.parse(lines[lines.length - 1] || 'null');
}

const GATE_EVENTS_SQL = `
SELECT coalesce(json_agg(row_to_json(t) ORDER BY t."judgedAt"), '[]'::json) FROM (
  SELECT r.id AS "runId",
         e->>'step' AS step,
         e->>'itemId' AS "itemId",
         e->>'judge' AS judge,
         e->'scores' AS scores,
         e->>'rejectedBy' AS "rejectedBy",
         e->>'at' AS "judgedAt",
         c.id IS NOT NULL AS "rowExists",
         c.content, c.topic, c.channel::text AS channel, c."workspaceId",
         c."storylineId", c.status::text AS status,
         to_char(c."updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
         to_char(c."publishedAtUtc" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "publishedAt"
  FROM autopilot_runs r
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.log::jsonb) = 'array' THEN r.log::jsonb ELSE '[]'::jsonb END) e
  LEFT JOIN content_items c ON c.id = e->>'itemId'
  WHERE e->>'step' IN ('scheduled', 'gate_rejected')
) t`;

function fabricationSql(ids) {
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  return `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT id, content, topic, channel::text AS channel, "workspaceId", "agentId", "storylineId",
           to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM content_items WHERE id IN (${list})) t`;
}

function workspacesSql(ids) {
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
  return `SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) FROM (
    SELECT id, "brandSummary", lower("contentLanguage"::text) AS language,
           to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM workspaces WHERE id IN (${list})) t`;
}

function main() {
  const pg = pgEnv(readDatabaseUrl());
  const events = query(pg, GATE_EVENTS_SQL);
  const fabrications = query(pg, fabricationSql(Object.keys(KNOWN_FABRICATIONS)));
  const synthetic = JSON.parse(fs.readFileSync(SYNTHETIC, 'utf8'));

  const census = {
    gateEventsLogged: events.length,
    approvedLogged: events.filter((e) => e.step === 'scheduled').length,
    rejectedLogged: events.filter((e) => e.step === 'gate_rejected').length,
    approvedWithJudge: events.filter((e) => e.step === 'scheduled' && e.judge).length,
    rejectedByJudge: events.filter((e) => e.step === 'gate_rejected' && e.scores).length,
    rejectedBeforeJudge: events.filter((e) => e.step === 'gate_rejected' && !e.scores).length,
    judgedButDraftDeleted: events.filter((e) => (e.judge || e.scores) && !e.rowExists).length,
  };

  // Only verdicts the AI judge actually produced, whose draft still exists.
  const judged = events.filter((e) => e.rowExists && (e.judge || e.scores));
  const wsIds = [
    ...new Set([
      ...judged.map((e) => e.workspaceId),
      ...fabrications.map((f) => f.workspaceId),
      ...synthetic.map((s) => s.brandWorkspaceId),
    ].filter(Boolean)),
  ];
  const workspaces = Object.fromEntries(query(pg, workspacesSql(wsIds)).map((w) => [w.id, w]));
  const brandOf = (id) => workspaces[id]?.brandSummary ?? null;

  const items = [];
  for (const e of judged) {
    const approved = e.step === 'scheduled';
    // A publish touches updatedAt; anything later than the publish (or the
    // verdict, if never published) means the text may have been edited after
    // it was judged.
    const lastTouch = Date.parse(e.updatedAt);
    const allowed = Math.max(Date.parse(e.publishedAt ?? e.judgedAt) || 0, Date.parse(e.judgedAt)) + 5_000;
    items.push({
      id: e.itemId,
      synthetic: false,
      source: 'local_db_gate_verdict',
      contentItemId: e.itemId,
      runId: e.runId,
      workspaceId: e.workspaceId,
      channel: e.channel,
      language: workspaces[e.workspaceId]?.language ?? 'en',
      topic: e.topic,
      content: e.content,
      brandSummary: brandOf(e.workspaceId),
      storyline: null,
      reference: {
        verdict: approved ? 'approve' : 'reject',
        labelSource: 'gate_verdict',
        rejectedBy: e.rejectedBy ?? null,
        scores: e.scores ?? null,
        judgeProvider: e.judge ?? null,
        // The run log stores the provider only. gpt-4.1 was OPENAI_DEFAULT_MODEL's
        // default then; the Gemini model was an admin setting not logged anywhere.
        judgeModel: null,
        judgeModelAssumed: e.judge === 'openai' ? 'gpt-4.1' : null,
        judgedAt: e.judgedAt,
        promptCommitAtJudgment: promptAt(e.judgedAt),
        promptNote: PROMPT_NOTES[e.itemId] ?? null,
      },
      expected: { verdict: approved ? 'approve' : 'reject', fabrication: false, failingCriterion: null },
      caveats: [
        ...(lastTouch > allowed ? ['Row updated after the verdict; the text may have been edited since it was judged.'] : []),
        ...(e.storylineId ? ['Bound to a storyline; the eval replays it without the storyline block.'] : []),
        'Brand summary is the workspace\'s current one, not necessarily the one the judge saw.',
      ],
    });
  }

  for (const f of fabrications) {
    items.push({
      id: f.id,
      synthetic: false,
      source: 'local_db_known_fabrication',
      contentItemId: f.id,
      runId: null,
      workspaceId: f.workspaceId,
      channel: f.channel,
      language: workspaces[f.workspaceId]?.language ?? 'en',
      topic: f.topic,
      content: f.content,
      brandSummary: brandOf(f.workspaceId),
      storyline: null,
      reference: {
        verdict: 'reject',
        labelSource: 'gate_prompt_rule',
        rejectedBy: null,
        scores: null,
        judgeProvider: null,
        judgeModel: null,
        judgeModelAssumed: null,
        judgedAt: null,
        promptCommitAtJudgment: null,
        promptNote: 'Never judged by the gate. Label applies the current factual_safety rule (fake customer results, precise percentages => 0-3).',
      },
      expected: { verdict: 'reject', fabrication: true, failingCriterion: 'factual_safety' },
      why: KNOWN_FABRICATIONS[f.id].why,
      caveats: [],
    });
  }

  for (const s of synthetic) {
    const ws = workspaces[s.brandWorkspaceId];
    items.push({
      id: s.id,
      synthetic: true,
      source: 'hand_written',
      contentItemId: null,
      runId: null,
      workspaceId: s.brandWorkspaceId,
      channel: s.channel,
      language: s.language,
      topic: s.topic,
      content: s.content,
      brandSummary: ws?.brandSummary ?? null,
      storyline: null,
      reference: {
        verdict: s.expected.verdict,
        labelSource: 'hand_written',
        rejectedBy: null,
        scores: null,
        judgeProvider: null,
        judgeModel: null,
        judgeModelAssumed: null,
        judgedAt: null,
        promptCommitAtJudgment: null,
        promptNote: null,
      },
      expected: s.expected,
      why: s.why,
      caveats: ws ? [] : ['Brand workspace not found locally; judged with an empty brand profile.'],
    });
  }

  const missingBrand = items.filter((i) => !i.brandSummary).map((i) => i.id);
  const dataset = {
    builtAt: new Date().toISOString(),
    source: 'local database (localhost), autopilot_runs.log + content_items + workspaces',
    census,
    counts: {
      total: items.length,
      realGateVerdicts: items.filter((i) => i.source === 'local_db_gate_verdict').length,
      realApproved: items.filter((i) => i.source === 'local_db_gate_verdict' && i.reference.verdict === 'approve').length,
      realRejected: items.filter((i) => i.source === 'local_db_gate_verdict' && i.reference.verdict === 'reject').length,
      realKnownFabrications: items.filter((i) => i.source === 'local_db_known_fabrication').length,
      synthetic: items.filter((i) => i.synthetic).length,
    },
    missingBrandSummary: missingBrand,
    items,
  };
  fs.writeFileSync(OUT, JSON.stringify(dataset, null, 2) + '\n');
  console.log(JSON.stringify({ wrote: path.relative(process.cwd(), OUT), census, counts: dataset.counts, missingBrand }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`[eval-judge] export failed: ${error.message}`);
  process.exit(1);
}
