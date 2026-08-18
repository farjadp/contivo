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
  // A trailing hashtag block is expected on social; only flag hashtag spam.
  const hashtags = (text.match(/#\w+/g) || []).length;
  if (hashtags > 8) hits.push(`hashtag-spam-x${hashtags}`);
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
  /** Length the finished post should land on. The rewrite expands to reach it. */
  targetWords?: number | null;
  minWords?: number | null;
  /** Number of hashtags to end on; 0 disables them (e.g. blog). */
  hashtags?: number;
}): Promise<HumanizeResult> {
  const original = String(input.text || '').trim();
  const tellsBefore = findTells(original);
  if (!original) {
    return { text: original, changed: false, tellsBefore, tellsAfter: tellsBefore, source: 'unchanged' };
  }

  const brand = input.brandSummary as any;
  const currentWords = original.split(/\s+/).filter(Boolean).length;
  const target = Number(input.targetWords || 0);
  const wantsExpansion = target > 0 && currentWords < target * 0.85;
  const hashtagCount = input.hashtags ?? 3;

  const lengthRule = target
    ? wantsExpansion
      ? `- The draft is ${currentWords} words and is too thin. Expand it to about ${target} words by developing the ARGUMENT, not by adding stories: name the trade-off, work through the reasoning, describe the failure mode in general terms, and give the reader steps they can act on. Do not pad with adjectives or restatement.
- CRITICAL: do not invent a client story, case study, or personal anecdote to fill space. No "I worked with a founder who...", no "one team I advised...", no invented outcomes like "churn dropped" or "support tickets fell". If you need an example, write it as a hypothetical the reader recognises ("picture an onboarding flow where..."), never as something the author did.`
      : `- Keep it close to ${target} words.`
    : '- Keep it roughly the same length.';

  const hashtagRule =
    hashtagCount > 0
      ? `- End with exactly ${hashtagCount} specific hashtags on their own line. Make them topic and industry specific, not generic (#Leadership, #Success and #Motivation are banned).`
      : '- No hashtags.';

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
${hashtagRule}
- No "Ready to X? Book a call" CTA. If a close is needed, make it a plain sentence or a question a person would actually ask.
- Vary sentence length. Allow one short fragment. Do not use a three-item list as the climax.
- Break it into short paragraphs with blank lines between them, the way people actually read on this platform.
${lengthRule}
- Same language, same core point. Do not invent facts, numbers, statistics, client results or first-person experiences that are not already in the draft.
- Plain text only. No markdown headers, no emoji.

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

  // Guard against a rewrite that truncated or came back empty. When we asked
  // for expansion, a much longer result is the point, so the ceiling lifts.
  const ratio = rewritten.length / original.length;
  const maxRatio = wantsExpansion ? 8 : 1.8;
  if (!rewritten || ratio < 0.5 || ratio > maxRatio) {
    return { text: original, changed: false, tellsBefore, tellsAfter: tellsBefore, source: 'unchanged' };
  }

  const tellsAfter = findTells(rewritten);
  // If the rewrite is not actually cleaner, keep the original.
  if (tellsAfter.length > tellsBefore.length) {
    return { text: original, changed: false, tellsBefore, tellsAfter: tellsBefore, source: 'unchanged' };
  }

  return { text: rewritten, changed: rewritten !== original, tellsBefore, tellsAfter, source: 'ai' };
}
