#!/usr/bin/env node
/**
 * Unblinds Farjad's answers into the recommendation table. Run it only after
 * every post has a yes/no and every brief has a best pick.
 *
 *   node scripts/model-blind-test/score.mjs \
 *     --key    <dir>/2026-11-22-model-blind-key.json \
 *     --scores <dir>/2026-11-22-model-blind-scores.json \
 *     [--out   <dir>/2026-11-22-model-blind-results.md]
 *
 * Per model: publish-unchanged rate (all, English, Persian), best-pick count,
 * measured cost per post, p50 latency. Counts are shown next to every rate:
 * with 5 briefs per language one post moves a rate by 20 points.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const yes = (v) => /^\s*(y|yes|بله|آره)\s*$/i.test(String(v ?? ''));
const no = (v) => /^\s*(n|no|نه|خیر)\s*$/i.test(String(v ?? ''));

/** Throws on an incomplete answer sheet: a half-scored test is not a result. */
export function validateScores(key, scores) {
  const problems = [];
  for (const brief of key.briefs) {
    const labels = Object.keys(key.labels[brief.id] ?? {});
    if (!labels.length) continue;
    const answer = scores?.briefs?.[brief.id];
    if (!answer) {
      problems.push(`${brief.id}: no answers`);
      continue;
    }
    for (const label of labels) {
      const p = answer.posts?.[label]?.publish;
      if (!yes(p) && !no(p)) problems.push(`${brief.id} post ${label}: publish must be yes or no`);
    }
    if (!labels.includes(String(answer.best ?? '').trim().toUpperCase())) {
      problems.push(`${brief.id}: best pick must be one of ${labels.join(', ')}`);
    }
  }
  if (problems.length) throw new Error(`Answer sheet incomplete:\n  ${problems.join('\n  ')}`);
}

export function scoreBlind(key, scores) {
  validateScores(key, scores);
  const languageOf = Object.fromEntries(key.briefs.map((b) => [b.id, b.language]));
  const rows = key.candidates.map((c) => {
    const row = {
      slot: c.slot,
      role: c.role,
      scored: { all: 0, EN: 0, FA: 0 },
      publish: { all: 0, EN: 0, FA: 0 },
      best: 0,
      costs: [],
      latencies: [],
      failed: 0,
      resolvedModels: new Set(),
      why: [],
    };
    for (const brief of key.briefs) {
      const result = key.results.find((r) => r.briefId === brief.id && r.slot === c.slot);
      if (!result?.ok) {
        row.failed += 1;
        continue;
      }
      result.resolvedModels.forEach((m) => row.resolvedModels.add(m));
      if (typeof result.costUsd === 'number') row.costs.push(result.costUsd);
      row.latencies.push(result.latencyMs);
      const label = Object.entries(key.labels[brief.id] ?? {}).find(([, slot]) => slot === c.slot)?.[0];
      if (!label) continue;
      const answer = scores.briefs[brief.id];
      const lang = languageOf[brief.id];
      row.scored.all += 1;
      row.scored[lang] += 1;
      if (yes(answer.posts[label].publish)) {
        row.publish.all += 1;
        row.publish[lang] += 1;
      }
      if (String(answer.best).trim().toUpperCase() === label) row.best += 1;
      const why = String(answer.posts[label].why ?? '').trim();
      if (why) row.why.push(`${brief.id}: ${why}`);
    }
    return row;
  });
  return rows.map((r) => ({
    slot: r.slot,
    role: r.role,
    resolvedModels: [...r.resolvedModels],
    publishRate: { all: rate(r.publish.all, r.scored.all), EN: rate(r.publish.EN, r.scored.EN), FA: rate(r.publish.FA, r.scored.FA) },
    publish: r.publish,
    scored: r.scored,
    bestPicks: r.best,
    costPerPostUsd: r.costs.length ? r.costs.reduce((s, x) => s + x, 0) / r.costs.length : null,
    p50LatencyMs: median(r.latencies),
    failedUnits: r.failed,
    why: r.why,
  }));
}

function rate(n, d) {
  return d ? n / d : null;
}

const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);

export function formatTable(rows) {
  const lines = [
    '| Model | Role | Publish unchanged (all) | English | Persian | Best picks | Cost / post | p50 latency | Failed | Answered as |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.slot} | ${r.role} | ${pct(r.publishRate.all)} (${r.publish.all}/${r.scored.all}) | ${pct(r.publishRate.EN)} (${r.publish.EN}/${r.scored.EN}) | ${pct(r.publishRate.FA)} (${r.publish.FA}/${r.scored.FA}) | ${r.bestPicks} | ${r.costPerPostUsd === null ? '—' : `$${r.costPerPostUsd.toFixed(4)}`} | ${r.p50LatencyMs === null ? '—' : `${(r.p50LatencyMs / 1000).toFixed(1)} s`} | ${r.failedUnits} | ${r.resolvedModels.join(', ') || '—'} |`,
    );
  }
  lines.push(
    '',
    'Decision rule (decision note, 22 Nov): if no finalist clearly beats the baseline, nothing changes.',
    'With 5 briefs per language, one post is 20 points; treat differences of one post as noise.',
  );
  const whys = rows.filter((r) => r.why.length);
  if (whys.length) {
    lines.push('', '## Why (Farjad)', '');
    for (const r of whys) {
      lines.push(`### ${r.slot}`, '', ...r.why.map((w) => `- ${w}`), '');
    }
  }
  return lines.join('\n');
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const keyPath = arg('--key');
  const scoresPath = arg('--scores');
  if (!keyPath || !scoresPath) {
    console.error('Usage: node score.mjs --key <key.json> --scores <scores.json> [--out <results.md>]');
    process.exit(2);
  }
  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const scores = JSON.parse(fs.readFileSync(scoresPath, 'utf8'));
  const table = `# Blind test results\n\nKey: ${keyPath}\nScores: ${scoresPath}\nMeasured spend of the run: $${Number(key.spentUsd).toFixed(4)}\n\n${formatTable(scoreBlind(key, scores))}\n`;
  const out = arg('--out');
  if (out) fs.writeFileSync(out, table);
  console.log(table);
}
