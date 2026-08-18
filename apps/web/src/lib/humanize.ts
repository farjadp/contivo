/**
 * humanize.ts
 *
 * A rewrite pass that strips the tells of machine-written social copy.
 *
 * The draft generator produces competent but recognisably "LinkedIn AI" text:
 * em-dash pile-ups, rhetorical-question openers, "Here's the thing", tricolon
 * summaries, a hashtag block, and a CTA like "Ready to X? Book a
 * conversation." Readers pattern-match that in about a second, and it makes
 * the brand look automated — which defeats the point of Autopilot being
 * invisible.
 *
 * This runs after generation and before the quality gate, so humanised text
 * is what gets judged and published.
 */

import { requestJsonFromAi } from '@/lib/gemini';

/** Phrases that mark copy as machine-written. Used to score, not to censor. */
const TELLS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhere'?s the (thing|kicker|truth|reality)\b/gi, label: 'here-s-the-thing' },
  { pattern: /\bbut the real (killer|problem|issue|question)\?/gi, label: 'but-the-real-x' },
  { pattern: /\blet'?s dive in\b|\bdive deep\b/gi, label: 'dive-in' },
  { pattern: /\bin today'?s (fast-paced|ever-changing|digital) \w+/gi, label: 'in-todays-world' },
  { pattern: /\bgame[- ]chang(er|ing)\b/gi, label: 'game-changer' },
  { pattern: /\bunlock(ing)? (the |your )?(power|potential|growth)\b/gi, label: 'unlock-potential' },
  { pattern: /\bsupercharge\b|\bleverage\b|\bsynerg/gi, label: 'corporate-verb' },
  { pattern: /\bthe silent killer\b/gi, label: 'silent-killer' },
  { pattern: /\bready to [^?]{3,60}\?\s*(book|let'?s|schedule|dm)/gi, label: 'cta-formula' },
  { pattern: /\b(don'?t let|stop) \w+ (compound|hold you back)\b/gi, label: 'imperative-warning' },
];

export type HumanizeResult = {
  text: string;
  changed: boolean;
  /** Machine-tell hits before and after, for the run log. */
  tellsBefore: string[];
  tellsAfter: string[];
  source: 'ai' | 'unchanged';
};

export function findTells(text: string): string[] {
  const hits: string[] = [];
  for (const { pattern, label } of TELLS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) hits.push(label);
  }
  // Em-dash density is the other giveaway: more than two in a short post.
  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes > 2) hits.push(`em-dash-x${emDashes}`);
  // A trailing hashtag block.
  if (/(^|\n)\s*(#\w+\s*){3,}$/.test(text.trim())) hits.push('hashtag-block');
  return hits;
}

/**
 * Rewrites a draft to sound like a person wrote it. Falls back to the original
 * text if no provider answers or the rewrite looks damaged — never returns
 * something worse than what it was given.
 */
export async function humanizeDraft(input: {
  text: string;
  channel: string;
  brandSummary: unknown;
  /** Keeps first-person voice honest: what this person actually does. */
  authorContext?: string;
}): Promise<HumanizeResult> {
  const original = String(input.text || '').trim();
  const tellsBefore = findTells(original);
  if (!original) {
    return { text: original, changed: false, tellsBefore, tellsAfter: tellsBefore, source: 'unchanged' };
  }

  const brand = input.brandSummary as any;
  const prompt = `Rewrite this ${input.channel} post so it reads like one experienced person wrote it in one sitting. Keep the substance and the specifics; change how it sounds.

Voice to match:
${JSON.stringify(
    { audience: brand?.audience, tone: brand?.tone, valueProposition: brand?.valueProposition },
    null,
    2,
  ).slice(0, 700)}
${input.authorContext ? `Author: ${input.authorContext}` : ''}

Rules:
- Cut every phrase that signals AI writing: "Here's the thing", "But the real killer?", "the silent killer", "unlock", "leverage", "supercharge", "game-changer", "dive in".
- No rhetorical-question opener. Start with a claim, an observation, or a concrete situation.
- At most one em-dash in the whole post. Prefer full stops.
- No hashtag block. Remove hashtags entirely.
- No "Ready to X? Book a call" CTA. If a close is needed, make it a plain sentence or a question a person would actually ask.
- Vary sentence length. Allow one short fragment. Do not use a three-item list as the climax.
- Keep it roughly the same length, same language, same core point. Do not invent facts, numbers or claims that are not already there.
- Plain text only. No markdown, no emoji.

Post:
"""
${original.slice(0, 6000)}
"""

Return JSON only: {"text": "the rewritten post"}`;

  const result = await requestJsonFromAi<{ text?: unknown }>(
    prompt,
    'You are a ghostwriter who makes copy sound human and specific. Return only valid JSON.',
  );
  if (!result) {
    return { text: original, changed: false, tellsBefore, tellsAfter: tellsBefore, source: 'unchanged' };
  }

  const rewritten = String(result.data.text || '').trim();

  // Guard against a rewrite that truncated, ballooned, or came back empty.
  const ratio = rewritten.length / original.length;
  if (!rewritten || ratio < 0.5 || ratio > 1.8) {
    return { text: original, changed: false, tellsBefore, tellsAfter: tellsBefore, source: 'unchanged' };
  }

  const tellsAfter = findTells(rewritten);
  // If the rewrite is not actually cleaner, keep the original.
  if (tellsAfter.length > tellsBefore.length) {
    return { text: original, changed: false, tellsBefore, tellsAfter: tellsBefore, source: 'unchanged' };
  }

  return { text: rewritten, changed: rewritten !== original, tellsBefore, tellsAfter, source: 'ai' };
}
