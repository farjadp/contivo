/**
 * social-text.ts
 *
 * Pure: markdown → plain text for channels that show text as typed. LinkedIn,
 * X, Instagram and Threads render no markdown, so `**bold**` reaches the
 * reader as asterisks (defect B15, e2e handover 2026-11-22).
 *
 * Kept: paragraphs, line breaks, hashtags, ordered list numbers, every
 * non-ASCII character (Persian letters, ZWNJ U+200C, «» and ، ؛ ؟).
 * Changed: headings → their text, bullet items → "• ", emphasis, strike and
 * code markers dropped, [text](url) → "text (url)", blockquote and rule lines
 * removed. Blog, email and Telegram keep markdown (Telegram converts it to
 * HTML itself).
 *
 * The same function lives in apps/api/src/modules/social/adapters/social-text.ts
 * for publish time; keep the two in step (their tests share the samples).
 */

/** Channels whose text is published exactly as stored. */
export const PLAIN_TEXT_CHANNELS: ReadonlySet<string> = new Set(['linkedin', 'twitter', 'x', 'instagram', 'threads']);

export function isPlainTextChannel(channel: unknown): boolean {
  return PLAIN_TEXT_CHANNELS.has(String(channel ?? '').trim().toLowerCase());
}

// Letters and digits in any script; emphasis markers glued to one are not markers.
const LN = '\\p{L}\\p{N}';
const WORDCHAR = `[${LN}]`;

function stripInline(line: string): string {
  let s = line;
  // Images before links: ![alt](url) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, '$1');
  // [text](url) → text (url); a link whose text is the url → url
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text: string, url: string) =>
    text.trim() === url ? url : `${text} (${url})`,
  );
  // <https://…> autolinks
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');
  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '$1');
  // Bold / bold-italic / strike, paired
  s = s.replace(/\*\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*\*/g, '$1');
  s = s.replace(/\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g, '$1');
  s = s.replace(new RegExp(`(?<!${WORDCHAR})__(?=\\S)([^\\n]+?)(?<=\\S)__(?!${WORDCHAR})`, 'gu'), '$1');
  s = s.replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, '$1');
  // Italic, paired, not inside a word (keeps 2*3, snake_case, file_name)
  s = s.replace(new RegExp(`(?<![${LN}*])\\*(?=\\S)([^*\\n]+?)(?<=\\S)\\*(?![${LN}*])`, 'gu'), '$1');
  s = s.replace(new RegExp(`(?<![${LN}_])_(?=\\S)([^_\\n]+?)(?<=\\S)_(?![${LN}_])`, 'gu'), '$1');
  // Unpaired bold markers have no meaning in plain text
  s = s.replace(/\*\*+/g, '');
  // Markdown escapes: \* → *
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
  return s;
}

export function markdownToPlainText(input: string): string {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    let line = raw.replace(/\s+$/, '');
    // Horizontal rule
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('');
      continue;
    }
    // Heading (needs the space: "#hashtag" is not a heading)
    line = line.replace(/^\s{0,3}#{1,6}\s+(.*?)(\s+#+)?$/, '$1');
    // Blockquote
    line = line.replace(/^\s{0,3}>\s?/, '');
    // Task list and bullet items → "• "
    line = line.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1• ');
    line = line.replace(/^(\s*)[-*+]\s+/, '$1• ');
    out.push(stripInline(line));
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The section names of the writing frameworks (lib/framework-engine.ts). The
 * model sometimes prints them as labels ("Strong Opinion: …", "Reason: …"),
 * which a reader sees as a template (first-post QA, 23 Nov).
 */
const FRAMEWORK_LABELS = [
  'Strong Opinion', 'Opinion', 'Reason', 'Example',
  'Hook', 'Value', 'CTA', 'Call to Action',
  'Problem', 'Cause', 'Solution',
  'What', 'Why', 'How',
  'Attention', 'Interest', 'Desire', 'Action',
  'Insight', 'Implication',
];
const LABEL_RE = new RegExp(
  `^(\\s*(?:• |\\d+[.)]\\s+)?)(?:${FRAMEWORK_LABELS.map((l) => l.replace(/ /g, '\\s+')).join('|')})\\s*[:：]\\s*`,
  'iu',
);

/**
 * Narrow on purpose: only a known framework label, only at the start of a
 * line, only when a colon follows it. "The reason: …" or "Why we bake: …"
 * are prose and stay. A line that was only a label is dropped.
 */
export function stripFrameworkLabels(text: string): string {
  const out: string[] = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = line.match(LABEL_RE);
    if (!match) {
      out.push(line);
      continue;
    }
    const rest = line.slice(match[0].length);
    if (rest.trim()) out.push(`${match[1]}${rest}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The body to store or publish for a channel: plain text for social, untouched otherwise. */
export function textForChannel(channel: unknown, body: string): string {
  return isPlainTextChannel(channel) ? stripFrameworkLabels(markdownToPlainText(body)) : body;
}
