/**
 * The production content path, with the model as the only variable.
 *
 * Mirrors generateDraftForItem (src/lib/content-engine.ts) as autopilot calls
 * it (`humanize: true`): generateContentDraftWithGemini → humanizeDraft → the
 * same bounded expansion loop. Same functions, same prompts; only the
 * transport underneath `runAiTask` is pinned to one provider + model
 * (see route.ts and the vi.mock in the test entries).
 *
 * Not included, on purpose:
 *  - the quality gate. It does not change the text; it is a separate judge
 *    model (OpenAI Astra / Claude Opus / Gemini on the gate chain), and its
 *    reject-and-regenerate loop would make the number of drafts per model
 *    vary. Farjad's "would you publish this unchanged?" is the gate here.
 *  - images, scheduling, DB writes.
 */

import { adjustWordCountForLanguage } from '@/lib/content-language';
import { generateContentDraftWithGemini } from '@/lib/gemini';
import { humanizeDraft } from '@/lib/humanize';

import type { Brief } from './types';

export class StepFailedError extends Error {
  constructor(readonly step: 'content_draft' | 'humanize', detail: string) {
    super(`${step} failed: ${detail}`);
    this.name = 'StepFailedError';
  }
}

const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;

export interface FinalPost {
  text: string;
  draftText: string;
  humanizePasses: number;
}

/**
 * `humanizeOk` lets the caller say whether the humanize call itself
 * succeeded: humanizeDraft returns the input unchanged on a failed call, so
 * the result alone cannot tell "nothing to fix" from "provider down".
 */
export async function generateFinalPost(brief: Brief, humanizeOk: () => boolean): Promise<FinalPost> {
  const draft = await generateContentDraftWithGemini(
    brief.brandSummary,
    brief.topic,
    brief.context,
    brief.channel,
    {
      frameworkId: brief.frameworkId,
      selectionReason: brief.selectionReason,
      wordCount: brief.wordCount,
    },
    brief.storylineBlock,
    brief.language,
  );
  if (!draft) throw new StepFailedError('content_draft', 'provider returned nothing');

  const platform = brief.wordCount.platform;
  const hashtagCount = platform === 'blog' || platform === 'email' ? 0 : 3;
  const minWords = adjustWordCountForLanguage(brief.wordCount.min, brief.language);
  const humanizeInput = {
    channel: brief.channel,
    brandSummary: brief.brandSummary,
    language: brief.language,
    targetWords: brief.wordCount.target,
    minWords,
    hashtags: hashtagCount,
  };

  let humanized = await humanizeDraft({ text: draft, ...humanizeInput });
  if (!humanizeOk()) throw new StepFailedError('humanize', 'provider call failed');
  let passes = 1;
  while (countWords(humanized.text) < minWords && passes < 3) {
    const before = countWords(humanized.text);
    const next = await humanizeDraft({ text: humanized.text, ...humanizeInput });
    if (!humanizeOk()) throw new StepFailedError('humanize', 'provider call failed (expansion pass)');
    if (countWords(next.text) <= before) break;
    humanized = next;
    passes += 1;
  }

  return { text: humanized.text, draftText: draft, humanizePasses: passes };
}
