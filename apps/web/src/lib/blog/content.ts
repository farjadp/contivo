/**
 * blog/content.ts
 *
 * Turns the markdown body the Content API serves into a block tree the blog
 * renders, and reads the facts the page needs out of it: which language it is
 * in, and its FAQ.
 *
 * Deliberately small. It covers what our generator writes (headings,
 * paragraphs, lists, quotes, code, emphasis, links) and nothing else, and it
 * never produces raw HTML: the body is model-written, and a renderer that
 * passes HTML through would let a prompt inject script into contivo.app.
 */

export type BlogLocale = 'en' | 'fa';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'heading'; level: 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

export type FaqEntry = { question: string; answer: string };

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN_LETTER = /[A-Za-z]/g;

/**
 * Which blog a post belongs to. The Content API carries no language, so the
 * script decides: a body that is mostly Arabic-script letters is Persian.
 * Code and URLs are stripped first because they are Latin in both languages.
 */
export function detectPostLocale(title: string, content: string): BlogLocale {
  const text = `${title}\n${content}`
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\]\([^)]*\)/g, ']');
  const arabic = text.match(ARABIC_SCRIPT)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  if (arabic + latin === 0) return 'en';
  return arabic / (arabic + latin) > 0.5 ? 'fa' : 'en';
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/**
 * Splits markdown into blocks. `title` is the post title: a leading `# Title`
 * that repeats it is dropped, since the page already prints the title as its
 * one h1. Any other h1 becomes an h2 for the same reason.
 */
export function parseMarkdown(markdown: string, title = ''): Block[] {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const isBlockStart = (line: string) =>
    HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line) || line.startsWith('>') ||
    line.startsWith('```') || RULE.test(line);

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) body.push(lines[i++] ?? '');
      i++; // closing fence (or end of input)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      const text = heading[2]!.trim();
      i++;
      if (depth === 1 && blocks.length === 0 && normalise(text) === normalise(title)) continue;
      const level = (depth <= 2 ? 2 : depth === 3 ? 3 : 4) as 2 | 3 | 4;
      blocks.push({ kind: 'heading', level, text });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('>')) {
        body.push((lines[i] ?? '').replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ kind: 'quote', text: body.join(' ').trim() });
      continue;
    }

    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const match = pattern.exec(current);
        if (match) {
          items.push(match[1]!.trim());
        } else if (current.trim() && /^\s{2,}/.test(current) && items.length) {
          // An indented continuation line belongs to the item above it.
          items[items.length - 1] += ` ${current.trim()}`;
        } else {
          break;
        }
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length && (lines[i] ?? '').trim() && !isBlockStart(lines[i] ?? '')) {
      body.push((lines[i] ?? '').trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', text: body.join(' ') });
  }

  return blocks;
}

function normalise(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Only these schemes become links; anything else (javascript:, data:) stays text. */
export function safeHref(href: string): string | null {
  const value = href.trim();
  if (/^(https?:|mailto:)/i.test(value)) return value;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (value.startsWith('#')) return value;
  return null;
}

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\))/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ kind: 'text', text: rest });
      break;
    }
    if (match.index > 0) out.push({ kind: 'text', text: rest.slice(0, match.index) });
    const [whole, , strongA, strongB, emA, emB, code, linkText, linkHref] = match;
    if (strongA ?? strongB) out.push({ kind: 'strong', children: parseInline((strongA ?? strongB)!) });
    else if (emA ?? emB) out.push({ kind: 'em', children: parseInline((emA ?? emB)!) });
    else if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (linkText !== undefined && linkHref !== undefined) {
      const href = safeHref(linkHref);
      const children = parseInline(linkText);
      if (href) out.push({ kind: 'link', href, children });
      else out.push(...children);
    }
    rest = rest.slice(match.index + whole!.length);
  }
  return out;
}

/** The text a reader sees, without markdown markers. */
export function plainText(text: string): string {
  return flatten(parseInline(text)).replace(/\s+/g, ' ').trim();
}

function flatten(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.kind === 'text' || n.kind === 'code' ? n.text : flatten(n.children)))
    .join('');
}

/**
 * FAQ headings, compared with spaces, zero-width non-joiners and punctuation
 * removed, so «پرسش‌های متداول», «پرسش های متداول» and "FAQs:" all match.
 */
const FAQ_HEADINGS = new Set([
  'faq',
  'faqs',
  'frequentlyaskedquestions',
  'frequentlyaskedquestionsfaq',
  'commonquestions',
  '\u067e\u0631\u0633\u0634\u0647\u0627\u06cc\u0645\u062a\u062f\u0627\u0648\u0644', // پرسشهایمتداول
  '\u067e\u0631\u0633\u0634\u0647\u0627\u06cc\u0631\u0627\u06cc\u062c', // پرسشهایرایج
  '\u0633\u0624\u0627\u0644\u0627\u062a\u0645\u062a\u062f\u0627\u0648\u0644', // سؤالاتمتداول
  '\u0633\u0648\u0627\u0644\u0627\u062a\u0645\u062a\u062f\u0627\u0648\u0644', // سوالاتمتداول
]);

export function isFaqHeading(text: string): boolean {
  const compact = plainText(text)
    .toLowerCase()
    .replace(/[\s\u200c\u200f\u200e:؟?!.()\-–—]/g, '')
    // Arabic yeh and kaf, which Persian text typed on an Arabic layout carries.
    .replace(/\u064a/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9');
  return FAQ_HEADINGS.has(compact);
}

/**
 * The questions under the article's FAQ heading (an h2 such as "FAQ" or
 * «پرسش‌های متداول»), each h3 being a question and the blocks under it the
 * answer. Empty when the article has no FAQ section, in which case the page
 * emits no FAQPage schema: Google only accepts FAQ markup for questions that
 * are visible on the page.
 */
export function extractFaq(blocks: Block[]): FaqEntry[] {
  const start = blocks.findIndex(
    (b) => b.kind === 'heading' && b.level === 2 && isFaqHeading(b.text),
  );
  if (start < 0) return [];

  const entries: FaqEntry[] = [];
  let current: { question: string; answer: string[] } | null = null;
  const flush = () => {
    if (current && current.answer.length) {
      entries.push({ question: current.question, answer: current.answer.join(' ') });
    }
  };

  for (const block of blocks.slice(start + 1)) {
    if (block.kind === 'heading' && block.level === 2) break;
    if (block.kind === 'heading') {
      flush();
      current = { question: plainText(block.text), answer: [] };
      continue;
    }
    if (!current) continue;
    if (block.kind === 'paragraph' || block.kind === 'quote') current.answer.push(plainText(block.text));
    if (block.kind === 'list') current.answer.push(block.items.map(plainText).join('; '));
  }
  flush();
  return entries;
}

/** Rough reading time, in minutes, for the article header. */
export function readingMinutes(content: string, locale: BlogLocale): number {
  const words = content.split(/\s+/).filter(Boolean).length;
  // Persian runs shorter words, so readers cover more of them per minute.
  const perMinute = locale === 'fa' ? 260 : 230;
  return Math.max(1, Math.round(words / perMinute));
}
