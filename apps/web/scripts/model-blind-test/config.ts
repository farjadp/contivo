/**
 * What the blind test compares and on what. Decision note:
 * .claude/agent-org/work/strategy/2026-11-22-model-choice.md
 *
 * Model ids and prices: .claude/agent-org/work/data/2026-11-22-model-facts.md
 * (official vendor pages, 22 Nov 2026). Prices themselves live in
 * src/lib/ai-usage.ts PRICES, so the test is costed exactly like production.
 */

import path from 'node:path';

import type { ProviderId } from '@/lib/ai/types';

export interface Candidate {
  /** Stable internal id; only ever written to the key file. */
  slot: string;
  provider: ProviderId;
  model: string;
  role: 'finalist' | 'baseline';
}

export const CANDIDATES: readonly Candidate[] = [
  { slot: 'claude-sonnet-5-5', provider: 'anthropic', model: 'claude-sonnet-5-5', role: 'finalist' },
  { slot: 'gpt-6.2-sol', provider: 'openai', model: 'gpt-6.2-sol', role: 'finalist' },
  { slot: 'gemini-4-argon', provider: 'gemini', model: 'gemini-4-argon', role: 'finalist' },
  { slot: 'claude-opus-5-5', provider: 'anthropic', model: 'claude-opus-5-5', role: 'finalist' },
  // Today's content primary (admin setting default). Google routes it to
  // gemini-3.8-flash; the resolved id is recorded per output.
  { slot: 'gemini-3.7-flash', provider: 'gemini', model: 'gemini-3.7-flash', role: 'baseline' },
];

/** The env var each provider's adapter reads (src/lib/ai/providers/*). */
export const KEY_ENV: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

/**
 * The briefs, from the LOCAL database (export.run.test.ts). Real workspaces,
 * real brand memory, real stored topics and framework choices.
 *
 * Persian: the local DB has no real Persian workspace (only "کافه نمونه",
 * example.com test data with a 344-character brand summary). Real Persian
 * briefs need a read-only production query that Farjad has not approved, so
 * the FA list is empty until he does. Add ids here; nothing else changes.
 */
export type BriefSelection =
  | { kind: 'content_item'; id: string; note?: string }
  | { kind: 'storyline'; id: string; channel: 'linkedin' | 'blog'; note?: string };

export const BRIEF_SELECTION: { EN: BriefSelection[]; FA: BriefSelection[] } = {
  EN: [
    { kind: 'content_item', id: 'cmsw10hwg0003vuxv0bwmeiah' }, // LinkedIn, opinion_reason_example
    { kind: 'content_item', id: 'cmswgxuso000311pk509njzb9' }, // blog, what_why_how
    { kind: 'content_item', id: 'cmsy8p6gg001bd3j8ztkbb2bf' }, // LinkedIn, hook_value_cta
    {
      kind: 'content_item',
      id: 'cmoiy4ctk000jvadeao2li0s8',
      note: 'Fabrication bait: the stored topic asks for a "case study" of an SME the brand has no evidence for. The April draft of this topic invented "Acme Services".',
    },
    {
      kind: 'storyline',
      id: 'cmtj8m9cw0004669budmzpagu',
      channel: 'linkedin',
      note: 'No stored idea: the topic is the storyline claim verbatim. Exercises the storyline + evidence-discipline prompt.',
    },
  ],
  FA: [],
};

/** Hard stop: projected and measured spend (USD) for one run. */
export const DEFAULT_MAX_USD = 10;

const REPO_ROOT = path.resolve(__dirname, '../../../..');
export const DATA_DIR = path.join(__dirname, 'data');
export const BRIEFS_FILE = path.join(DATA_DIR, 'briefs.json');
/** Gitignored (.claude/ is ignored at the repo root). */
export const OUT_DIR = process.env.BLIND_TEST_OUT_DIR || path.join(REPO_ROOT, '.claude/agent-org/work/data');
export const KEY_FILE = path.join(OUT_DIR, '2026-11-22-model-blind-key.json');
export const PACK_MD = path.join(OUT_DIR, '2026-11-22-model-blind-pack.md');
export const PACK_HTML = path.join(OUT_DIR, '2026-11-22-model-blind-pack.html');
export const SCORES_FILE = path.join(OUT_DIR, '2026-11-22-model-blind-scores.json');
