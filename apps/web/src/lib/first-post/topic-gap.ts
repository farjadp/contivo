/**
 * Which stored topic gap (competitorKeywordsIntel.content_gaps[].topic) a
 * draft is about, read from the draft's own topic. "Why this post" shows the
 * gap only when the draft matches one: after "Try another angle" the new post
 * may be about something else, and claiming the old top gap would be invented.
 */

function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}‌]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** At least this share of the gap's words must appear in the topic. */
const MIN_SHARE = 0.6;

export function matchTopicGap(gaps: readonly string[], topic: string | null | undefined): string | null {
  const topicWords = new Set(words(topic ?? ''));
  if (topicWords.size === 0) return null;
  for (const gap of gaps) {
    const gapWords = [...new Set(words(gap))];
    if (gapWords.length === 0) continue;
    const hits = gapWords.filter((w) => topicWords.has(w)).length;
    if (hits / gapWords.length >= MIN_SHARE) return gap.trim();
  }
  return null;
}
