/**
 * The unblinding key and the blind pack.
 *
 * The key holds everything (model names, seed, tokens, cost, latency). The
 * pack holds only the brief and the post text, labelled A–E in an order
 * shuffled independently per brief from a seed that exists only in the key.
 * No scores of ours go in the pack: Farjad judges, alone.
 */

import { randomInt } from 'node:crypto';

import type { Candidate } from './config';
import type { Brief, UnitResult } from './types';

export const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

/** mulberry32: small, deterministic, good enough to shuffle five items. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface BlindKey {
  kind: 'contivo-model-blind-key';
  createdAt: string;
  seed: number;
  candidates: Candidate[];
  briefs: Array<Pick<Brief, 'id' | 'language' | 'channel' | 'topic' | 'workspaceName' | 'source'>>;
  /** briefId → label → slot. Only outputs that exist get a label. */
  labels: Record<string, Record<string, string>>;
  projection: { rows: Array<{ slot: string; usd: number; unpriced: boolean }>; totalUsd: number };
  spentUsd: number;
  results: UnitResult[];
}

/**
 * One result per (brief, slot): a new successful run replaces the old one; a
 * new failure never replaces an earlier success.
 */
export function mergeResults(previous: UnitResult[], next: UnitResult[]): UnitResult[] {
  const byUnit = new Map<string, UnitResult>();
  for (const r of previous) byUnit.set(`${r.briefId}|${r.slot}`, r);
  for (const r of next) {
    const id = `${r.briefId}|${r.slot}`;
    const old = byUnit.get(id);
    if (!old || r.ok || !old.ok) byUnit.set(id, r);
  }
  return [...byUnit.values()];
}

export function buildKey(input: {
  briefs: Brief[];
  candidates: readonly Candidate[];
  results: UnitResult[];
  projection: BlindKey['projection'];
  spentUsd: number;
  seed?: number;
  now?: Date;
}): BlindKey {
  const seed = input.seed ?? randomInt(1, 2 ** 31 - 1);
  const rand = prng(seed);
  const labels: BlindKey['labels'] = {};
  for (const brief of input.briefs) {
    // Shuffle every slot (so the order is independent of which ones failed), then label the ones with text.
    const order = shuffled(
      input.candidates.map((c) => c.slot),
      rand,
    );
    const present = order.filter((slot) =>
      input.results.some((r) => r.briefId === brief.id && r.slot === slot && r.ok && r.text),
    );
    labels[brief.id] = Object.fromEntries(present.map((slot, i) => [LABELS[i], slot]));
  }
  return {
    kind: 'contivo-model-blind-key',
    createdAt: (input.now ?? new Date()).toISOString(),
    seed,
    candidates: [...input.candidates],
    briefs: input.briefs.map(({ id, language, channel, topic, workspaceName, source }) => ({
      id,
      language,
      channel,
      topic,
      workspaceName,
      source,
    })),
    labels,
    projection: input.projection,
    spentUsd: input.spentUsd,
    results: input.results,
  };
}

function textFor(key: BlindKey, briefId: string, slot: string): string {
  return key.results.find((r) => r.briefId === briefId && r.slot === slot)?.text ?? '';
}

function briefSummaryLines(brief: Brief): string[] {
  return [
    `Language: ${brief.language === 'FA' ? 'Persian' : 'English'} · Channel: ${brief.channel} · Target: ${brief.wordCount.target} words (allowed ${brief.wordCount.min}–${brief.wordCount.max}, before the Persian adjustment)`,
    `Brand: ${brief.workspaceName}`,
    `Topic: ${brief.topic}`,
    brief.storylineClaim ? `Storyline claim it must advance: ${brief.storylineClaim}` : null,
    `Framework: ${brief.frameworkId ?? 'none'}`,
    `Context given to the writer: ${brief.contextNote}`,
    brief.source.note ? `Note: ${brief.source.note}` : null,
  ].filter((l): l is string => Boolean(l));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Is every brief fully covered? A partial pack is allowed only on request. */
export function coverage(key: BlindKey) {
  const expected = key.briefs.length * key.candidates.length;
  const present = Object.values(key.labels).reduce((s, l) => s + Object.keys(l).length, 0);
  return { expected, present, complete: expected === present };
}

export function renderPackMarkdown(key: BlindKey, briefs: Brief[]): string {
  const out: string[] = [
    '# Blind test: final post text',
    '',
    'For Farjad only. Each brief has several posts written by different AI models through Contivo\'s real content pipeline',
    '(draft, then the humanize pass), so every post is what a customer would get. The labels are shuffled for every brief.',
    'Nothing here tells you which model wrote what; the key stays closed until you have scored everything.',
    '',
    'For each post: would you publish it unchanged? Answer yes or no and say why in a few words. Then pick the best one per brief.',
    'Write your answers in `2026-11-22-model-blind-scores.json` next to this file, or use the HTML version, which saves that file for you.',
    '',
  ];
  const cov = coverage(key);
  if (!cov.complete) {
    out.push(`> Partial pack: ${cov.present} of ${cov.expected} posts exist. Some models could not be run; briefs with fewer posts are not a hint.`, '');
  }
  briefs.forEach((brief, index) => {
    const isFa = brief.language === 'FA';
    out.push('---', '', `## Brief ${index + 1} of ${briefs.length} (\`${brief.id}\`)`, '');
    for (const line of briefSummaryLines(brief)) out.push(`- ${line}`);
    out.push('');
    for (const [label, slot] of Object.entries(key.labels[brief.id] ?? {})) {
      out.push(`### Post ${label}`, '');
      out.push(isFa ? '<div dir="rtl" lang="fa">' : '<div dir="ltr" lang="en">', '');
      out.push(textFor(key, brief.id, slot), '');
      out.push('</div>', '');
      out.push(`**Would you publish Post ${label} unchanged?** yes / no — why:`, '');
    }
    out.push(`**Best pick for brief ${index + 1}:** __`, '');
  });
  return out.join('\n');
}

export function scoresTemplate(key: BlindKey) {
  return {
    kind: 'contivo-model-blind-scores',
    instructions:
      'For every post: "publish" is "yes" or "no", "why" is a few words. "best" is the label of the best post for that brief. Leave the key file closed until this is complete.',
    briefs: Object.fromEntries(
      key.briefs.map((b) => [
        b.id,
        {
          best: '',
          posts: Object.fromEntries(Object.keys(key.labels[b.id] ?? {}).map((label) => [label, { publish: '', why: '' }])),
        },
      ]),
    ),
  };
}

export function renderPackHtml(key: BlindKey, briefs: Brief[]): string {
  const template = scoresTemplate(key);
  const sections = briefs
    .map((brief, index) => {
      const isFa = brief.language === 'FA';
      const posts = Object.entries(key.labels[brief.id] ?? {})
        .map(([label, slot]) => {
          const name = `${brief.id}__${label}`;
          return `
      <article class="post">
        <h3>Post ${label}</h3>
        <div class="text" dir="${isFa ? 'rtl' : 'ltr'}" lang="${isFa ? 'fa' : 'en'}">${escapeHtml(textFor(key, brief.id, slot))}</div>
        <fieldset>
          <legend>Would you publish Post ${label} unchanged?</legend>
          <label><input type="radio" name="${name}__publish" value="yes" data-brief="${brief.id}" data-label="${label}" data-field="publish"> yes</label>
          <label><input type="radio" name="${name}__publish" value="no" data-brief="${brief.id}" data-label="${label}" data-field="publish"> no</label>
          <label class="why">why: <input type="text" data-brief="${brief.id}" data-label="${label}" data-field="why"></label>
        </fieldset>
      </article>`;
        })
        .join('\n');
      const options = Object.keys(key.labels[brief.id] ?? {})
        .map((l) => `<label><input type="radio" name="${brief.id}__best" value="${l}" data-brief="${brief.id}" data-field="best"> ${l}</label>`)
        .join(' ');
      return `
    <section>
      <h2>Brief ${index + 1} of ${briefs.length}</h2>
      <ul>${briefSummaryLines(brief).map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
      ${posts}
      <fieldset class="best"><legend>Best pick for brief ${index + 1}</legend>${options}</fieldset>
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Blind test: final post text</title>
<style>
  body { font-family: "Iowan Old Style", Georgia, serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1d1d1b; background: #fbfaf7; line-height: 1.55; }
  h1, h2, h3, legend { font-family: "Avenir Next", "Segoe UI", sans-serif; }
  section { border-top: 2px solid #1d1d1b; margin-top: 3rem; padding-top: 1rem; }
  .post { margin: 1.5rem 0; padding: 1rem; background: #fff; border: 1px solid #d8d4cc; }
  .text { white-space: pre-wrap; }
  .text[dir="rtl"] { font-family: Vazirmatn, "Noto Naskh Arabic", Tahoma, sans-serif; line-height: 1.9; }
  fieldset { border: 0; padding: 0.5rem 0 0; }
  .why input { width: 70%; }
  button { font: inherit; padding: 0.6rem 1.2rem; margin-top: 2rem; }
</style>
</head>
<body>
<h1>Blind test: final post text</h1>
<p>Each brief has posts written by different AI models through Contivo's real content pipeline (draft, then the humanize pass). Labels are shuffled for every brief. For each post: would you publish it unchanged? Then pick the best per brief. When done, press the button: it downloads <code>2026-11-22-model-blind-scores.json</code>. Put it next to the key file.</p>
${coverage(key).complete ? '' : `<p><strong>Partial pack:</strong> ${coverage(key).present} of ${coverage(key).expected} posts exist. A brief with fewer posts is not a hint.</p>`}
${sections}
<button type="button" id="save">Download my answers</button>
<script>
  const template = ${JSON.stringify(template)};
  document.getElementById('save').addEventListener('click', () => {
    const out = JSON.parse(JSON.stringify(template));
    document.querySelectorAll('[data-field]').forEach((el) => {
      const brief = out.briefs[el.dataset.brief];
      if (!brief) return;
      if (el.dataset.field === 'best') { if (el.checked) brief.best = el.value; return; }
      const post = brief.posts[el.dataset.label];
      if (el.dataset.field === 'publish' && el.checked) post.publish = el.value;
      if (el.dataset.field === 'why') post.why = el.value;
    });
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '2026-11-22-model-blind-scores.json';
    a.click();
  });
</script>
</body>
</html>
`;
}
