/**
 * autopilot/quality-gate.ts
 *
 * The thing that stands in for a human reviewer.
 *
 * Autopilot publishes with nobody watching, so every draft passes through
 * here before it is allowed to become SCHEDULED. Two layers:
 *
 *   1. Deterministic checks — free, instant, no model involved. Length,
 *      platform hard limits, banned phrases, template/AI leakage, and
 *      near-duplication against what was recently published.
 *   2. An AI judge — one cheap JSON call scoring brand fit, factual safety
 *      and clarity, with a hard veto for anything unsafe to publish
 *      unattended (unverifiable claims, fabricated numbers, off-brand voice).
 *
 * Failure policy is deliberately FAIL-CLOSED: if both providers are down we
 * do NOT publish an unvetted draft. The item stays a DRAFT and the next run
 * (3h later) tries again. A quiet week is recoverable; an unreviewed post on
 * a real brand account is not.
 */

import { requestJsonFromAi } from '@/lib/gemini';
import { storylinePromptBlock, type StorylineContext } from '@/lib/narrative/context';
import { getContentWordCountLimits } from '@/lib/app-settings';
import {
  resolveWordCountPlatformKey,
  type ContentWordCountLimits,
} from '@/lib/content-word-count';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Scores below these (0-10) fail the gate. */
export const THRESHOLDS = {
  brandFit: 6,
  factualSafety: 7, // strictest: unverifiable claims are the real risk
  clarity: 6,
  /** Only applied when the item is bound to a storyline. */
  storylineFit: 6,
  /** As strict as factual safety: leaning on evidence you do not have is the
   *  same failure, just dressed as a story. */
  evidenceDiscipline: 7,
} as const;

/** Hard per-platform character ceilings enforced by the network itself. */
const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  twitter: 280,
  instagram: 2200,
  // LinkedIn rejects a share over 3,000 characters outright.
  linkedin: 3000,
};

/** Word count tolerance either side of the configured range. */
const WORD_COUNT_TOLERANCE = 0.25;

/** Jaccard overlap above this against a recent post counts as duplication. */
const DUPLICATE_THRESHOLD = 0.5;

/**
 * Strings that mean the generator leaked scaffolding, hedged as an assistant,
 * or left a placeholder behind. Any hit is an automatic reject.
 */
const LEAKAGE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bas an ai\b|\bas a language model\b|\bi'?m an ai\b/i, label: 'AI self-reference' },
  { pattern: /\b(lorem ipsum)\b/i, label: 'Lorem ipsum placeholder' },
  { pattern: /\[(insert|your|company name|topic|link|url|name here)[^\]]*\]/i, label: 'Unfilled [placeholder]' },
  { pattern: /\{\{[^}]+\}\}/, label: 'Unrendered {{template}}' },
  { pattern: /\b(TODO|FIXME|TBD|XXX)\b/, label: 'TODO marker' },
  { pattern: /^(ANGLE\/HOOK|PILLAR|TARGET_WORD_COUNT|FRAMEWORK_(ID|REASON|SCORE)):/im, label: 'Pipeline scaffolding' },
  { pattern: /example\.com/i, label: 'Placeholder link (example.com)' },
  { pattern: /\bhere'?s? (?:is )?(?:the|your) (?:draft|post|content)\b/i, label: 'Assistant preamble' },
  { pattern: /^(sure|certainly|of course)[,!]/i, label: 'Assistant preamble' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateCheck = {
  id: string;
  passed: boolean;
  detail: string;
};

export type GateScores = {
  brandFit: number;
  factualSafety: number;
  clarity: number;
  /** Null when the item is not bound to a storyline; not scored, not enforced. */
  storylineFit: number | null;
  evidenceDiscipline: number | null;
};

export type GateVerdict = {
  approved: boolean;
  /** Machine-readable reason when rejected; null when approved. */
  rejectedBy: string | null;
  reasons: string[];
  checks: GateCheck[];
  scores: GateScores | null;
  judge: 'gemini' | 'openai' | 'unavailable' | 'skipped';
};

export type GateInput = {
  content: string;
  topic: string;
  channel: string;
  brandSummary: unknown;
  /** Phrases the operator never wants published. */
  avoidTopics?: string[];
  /** Bodies of recently published/scheduled posts, for duplication checks. */
  recentContents?: string[];
  /** Injected in tests; loaded from app settings otherwise. */
  wordCountLimits?: ContentWordCountLimits;
  /**
   * The storyline this draft is meant to advance. When absent the gate behaves
   * exactly as it did before the narrative layer existed, so content created
   * without one keeps publishing.
   */
  storyline?: StorylineContext | null;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function evaluateDraft(input: GateInput): Promise<GateVerdict> {
  const checks: GateCheck[] = [];
  const reasons: string[] = [];
  const content = String(input.content || '').trim();

  const fail = (id: string, detail: string): GateVerdict => {
    checks.push({ id, passed: false, detail });
    reasons.push(detail);
    return { approved: false, rejectedBy: id, reasons, checks, scores: null, judge: 'skipped' };
  };
  const pass = (id: string, detail: string) => checks.push({ id, passed: true, detail });

  // ── 1. Deterministic ────────────────────────────────────────────────────

  if (!content) return fail('empty', 'Draft is empty.');
  pass('empty', 'Draft has content.');

  const platform = resolveWordCountPlatformKey(input.channel);
  const charLimit = PLATFORM_CHAR_LIMITS[platform];
  if (charLimit && content.length > charLimit) {
    return fail(
      'platform_char_limit',
      `${content.length} characters exceeds the ${charLimit}-character limit for ${platform}.`,
    );
  }
  if (charLimit) pass('platform_char_limit', `${content.length}/${charLimit} characters.`);

  const limits = input.wordCountLimits ?? (await getContentWordCountLimits());
  const range = limits[platform];
  const words = countWords(content);
  const minAllowed = Math.floor(range.min * (1 - WORD_COUNT_TOLERANCE));
  const maxAllowed = Math.ceil(range.max * (1 + WORD_COUNT_TOLERANCE));
  if (words < minAllowed || words > maxAllowed) {
    return fail(
      'word_count',
      `${words} words is outside the acceptable ${minAllowed}-${maxAllowed} range for ${platform}.`,
    );
  }
  pass('word_count', `${words} words (target ${range.min}-${range.max}).`);

  for (const { pattern, label } of LEAKAGE_PATTERNS) {
    if (pattern.test(content)) {
      return fail('leakage', `${label} found in the draft.`);
    }
  }
  pass('leakage', 'No placeholders, scaffolding or assistant preamble.');

  const bannedHit = (input.avoidTopics ?? [])
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .find((p) => content.toLowerCase().includes(p));
  if (bannedHit) {
    return fail('avoid_list', `Draft mentions a banned phrase: "${bannedHit}".`);
  }
  pass('avoid_list', 'No banned phrases.');

  const duplicate = (input.recentContents ?? []).find(
    (prev) => jaccard(tokenize(prev), tokenize(content)) > DUPLICATE_THRESHOLD,
  );
  if (duplicate) {
    return fail('duplicate', 'Draft closely repeats a recent post.');
  }
  pass('duplicate', 'Distinct from recent posts.');

  // ── 2. AI judge ─────────────────────────────────────────────────────────

  const judged = await runJudge(input, content, platform);
  if (!judged) {
    checks.push({ id: 'judge', passed: false, detail: 'No AI provider available to review the draft.' });
    reasons.push('Quality judge unavailable — holding the draft rather than publishing it unreviewed.');
    return {
      approved: false,
      rejectedBy: 'judge_unavailable',
      reasons,
      checks,
      scores: null,
      judge: 'unavailable',
    };
  }

  const { scores, verdict, notes, provider } = judged;
  const below: string[] = [];
  if (scores.brandFit < THRESHOLDS.brandFit) below.push(`brand fit ${scores.brandFit}/10`);
  if (scores.factualSafety < THRESHOLDS.factualSafety)
    below.push(`factual safety ${scores.factualSafety}/10`);
  if (scores.clarity < THRESHOLDS.clarity) below.push(`clarity ${scores.clarity}/10`);
  // Only when bound to a storyline: an unbound draft was never asked these.
  if (scores.storylineFit !== null && scores.storylineFit < THRESHOLDS.storylineFit)
    below.push(`storyline fit ${scores.storylineFit}/10`);
  if (scores.evidenceDiscipline !== null && scores.evidenceDiscipline < THRESHOLDS.evidenceDiscipline)
    below.push(`evidence discipline ${scores.evidenceDiscipline}/10`);

  if (verdict === 'reject' || below.length > 0) {
    const detail =
      below.length > 0
        ? `Below threshold: ${below.join(', ')}.`
        : 'Judge vetoed the draft as unsafe to publish unattended.';
    checks.push({ id: 'judge', passed: false, detail });
    reasons.push(detail, ...notes);
    return {
      approved: false,
      rejectedBy: below.length > 0 ? 'low_score' : 'judge_veto',
      reasons,
      checks,
      scores,
      judge: provider,
    };
  }

  checks.push({
    id: 'judge',
    passed: true,
    detail:
      `brand ${scores.brandFit}/10 · safety ${scores.factualSafety}/10 · clarity ${scores.clarity}/10` +
      (scores.storylineFit !== null
        ? ` · storyline ${scores.storylineFit}/10 · evidence ${scores.evidenceDiscipline}/10`
        : ''),
  });
  return { approved: true, rejectedBy: null, reasons: notes, checks, scores, judge: provider };
}

// ---------------------------------------------------------------------------
// AI judge
// ---------------------------------------------------------------------------

type JudgeReply = {
  brand_fit?: unknown;
  factual_safety?: unknown;
  clarity?: unknown;
  storyline_fit?: unknown;
  evidence_discipline?: unknown;
  verdict?: unknown;
  notes?: unknown;
};

async function runJudge(input: GateInput, content: string, platform: string) {
  const prompt = buildJudgePrompt(input, content, platform);
  const result = await requestJsonFromAi<JudgeReply>(
    prompt,
    'You are a strict brand editor. You reject anything you would not want published unattended on a real company account. Return ONLY valid JSON.',
  );
  if (!result) return null;

  const raw = result.data;
  const scores: GateScores = {
    brandFit: clampScore(raw.brand_fit),
    factualSafety: clampScore(raw.factual_safety),
    clarity: clampScore(raw.clarity),
    // Only meaningful when a storyline was in the prompt. Scoring them without
    // one would reject every unbound draft on a question never asked.
    storylineFit: input.storyline ? clampScore(raw.storyline_fit) : null,
    evidenceDiscipline: input.storyline ? clampScore(raw.evidence_discipline) : null,
  };
  const verdict = String(raw.verdict || '').toLowerCase() === 'reject' ? 'reject' : 'approve';
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((n) => String(n).slice(0, 300)).slice(0, 5)
    : [];

  return { scores, verdict, notes, provider: result.provider };
}

function buildJudgePrompt(input: GateInput, content: string, platform: string): string {
  const brand = input.brandSummary && typeof input.brandSummary === 'object' ? input.brandSummary : {};
  return `You are reviewing a social post that will be published AUTOMATICALLY with no human review.

Brand profile:
${JSON.stringify(brand, null, 2).slice(0, 3000)}

Platform: ${platform}
Intended topic: ${input.topic}
${input.storyline ? `\n${storylinePromptBlock(input.storyline)}\n` : ''}

Draft:
"""
${content.slice(0, 6000)}
"""

Score each 0-10 and be harsh — this goes out unattended on a real company account:
- brand_fit: matches the brand's audience, tone and value proposition; nothing that contradicts the profile.
- factual_safety: makes NO specific factual claim it cannot support. Invented statistics, named studies, fake customer results, precise percentages, awards, or claims about named third parties all score 0-3. A first-person anecdote presented as something the author actually did — "I worked with a founder who...", "one client of ours...", followed by outcomes like churn dropping — is a FABRICATED CASE STUDY and scores 0-2, because nobody can verify it and the author may never have done it. Hypotheticals clearly framed as such ("picture a team that...") are fine. Generic, experience-based advice scores high.
- clarity: reads as finished, native to the platform, coherent, no filler or repetition.
${
  input.storyline
    ? `- storyline_fit: does this actually ADVANCE the storyline's claim above? A post that is merely on-topic but makes no move toward that claim scores 0-4. It does not have to state the claim outright; it has to argue for it.
- evidence_discipline: does it stay inside the EVIDENCE listed above? Pointing at proof not on that list — customers, results, numbers, case studies — scores 0-2 even if the post never names them, because the company cannot back it. When the evidence list is empty, arguing from reasoning alone is CORRECT and scores high; implying customers or results scores 0-2. Violating a NEVER CLAIM entry scores 0.`
    : ''
}

Set "verdict" to "reject" if the post would embarrass the brand, makes unverifiable claims, gives regulated advice (medical, legal, financial), touches politics or religion, attacks a named competitor, or reads as machine-generated. Otherwise "approve".

Return ONLY this JSON:
{"brand_fit": 0-10, "factual_safety": 0-10, "clarity": 0-10, "verdict": "approve" | "reject", "notes": ["short reason", "..."]}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0; // unparseable score is treated as a fail
  return Math.max(0, Math.min(10, Math.round(n)));
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'with', 'how', 'why', 'what',
  'your', 'you', 'is', 'are', 'vs', 'from', 'that', 'this', 'it', 'at', 'by', 'as', 'be', 'we',
  'our', 'their', 'they', 'but', 'not', 'can', 'will', 'has', 'have', 'was', 'were', 'more',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}
