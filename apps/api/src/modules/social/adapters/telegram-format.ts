/**
 * telegram-format.ts
 *
 * Pure: our markdown subset → Telegram `parse_mode: HTML`, split into messages.
 *
 * Why HTML and not MarkdownV2: MarkdownV2 needs `_ * [ ] ( ) ~ \` > # + - = | { } . !`
 * escaped everywhere outside entities, and model-written text is full of them.
 * HTML needs only `<`, `>`, `&` escaped (https://core.telegram.org/bots/api#html-style).
 *
 * Output uses only: b i u s a code pre blockquote. Headings → bold, list items
 * → "• ", horizontal rules dropped, links only for http(s) URLs. Raw HTML in
 * the source is escaped, never passed through. A marker without its pair stays
 * literal text.
 *
 * Splitting happens on the SOURCE, block by block, so a cut never falls inside
 * a tag. Limits count visible characters (text after entity parsing), which is
 * how Telegram counts its 4,096 / 1,024 limits.
 */

export const ALLOWED_TAGS = ['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote'] as const;

/** Our per-message target; Telegram's hard limit is 4,096 after entities parsing. */
export const TELEGRAM_MESSAGE_TARGET = 3800;
/** Telegram's caption limit (0-1024 characters after entities parsing). */
export const TELEGRAM_CAPTION_LIMIT = 1024;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** http(s) only. Telegram has no use for relative links; tg:// and the rest are refused. */
export function telegramSafeHref(href: string): string | null {
  const value = href.trim();
  if (!/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Characters a reader sees: tags removed, the four entities Telegram knows decoded. */
export function visibleLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(lt|gt|amp|quot);/g, '_')
    .length;
}

// ─── Inline ───────────────────────────────────────────────────────────────────

const WORD = /[\p{L}\p{N}]/u;
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWord = (c: string | undefined) => c !== undefined && WORD.test(c);

interface InlineOpts {
  /** Inside a heading (already bold) or a link (no nested links). */
  noBold?: boolean;
  noLinks?: boolean;
}

const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;
const IMAGE = /^!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;

/**
 * Finds the closing `marker` for an opener at `from`. The content must not
 * start or end with whitespace. Returns the index of the closer or -1.
 */
function findCloser(src: string, from: number, marker: string): number {
  let i = from;
  while (i < src.length) {
    const at = src.indexOf(marker, i);
    if (at === -1) return -1;
    const before = src[at - 1];
    const after = src[at + marker.length];
    const single = marker.length === 1;
    // `*` must not be half of `**`; `_` closer must not be inside a word.
    const okSingle =
      !single ||
      (src[at + 1] !== marker && before !== marker && (marker !== '_' || !isWord(after)));
    if (at > from && !isSpace(before) && okSingle) return at;
    i = at + 1;
  }
  return -1;
}

function renderInline(src: string, opts: InlineOpts = {}, depth = 0): string {
  if (depth > 8) return escapeHtml(src);
  let out = '';
  let text = '';
  const flush = () => {
    out += escapeHtml(text);
    text = '';
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);

    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out += `<code>${escapeHtml(src.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    if (c === '!' && !opts.noLinks) {
      const m = IMAGE.exec(rest);
      if (m) {
        flush();
        const href = telegramSafeHref(m[2]);
        const label = m[1].trim() || m[2];
        out += href ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>` : escapeHtml(m[1]);
        i += m[0].length;
        continue;
      }
    }

    if (c === '[') {
      const m = LINK.exec(rest);
      if (m) {
        flush();
        const href = opts.noLinks ? null : telegramSafeHref(m[2]);
        const inner = renderInline(m[1], { ...opts, noLinks: true }, depth + 1);
        out += href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
        i += m[0].length;
        continue;
      }
    }

    // Paired markers: ** __ ~~ (double) then * _ (single).
    const double = rest.slice(0, 2);
    if ((double === '**' || double === '__' || double === '~~') && !isSpace(src[i + 2])) {
      const wordOk = double !== '__' || !isWord(src[i - 1]);
      const end = wordOk ? findCloser(src, i + 2, double) : -1;
      const afterOk = end !== -1 && (double !== '__' || !isWord(src[end + 2]));
      if (end !== -1 && afterOk) {
        flush();
        const inner = renderInline(src.slice(i + 2, end), opts, depth + 1);
        if (double === '~~') out += `<s>${inner}</s>`;
        else out += opts.noBold ? inner : `<b>${inner}</b>`;
        i = end + 2;
        continue;
      }
    }

    if ((c === '*' || c === '_') && src[i + 1] !== c && !isSpace(src[i + 1]) && src[i - 1] !== c) {
      const wordOk = c !== '_' || !isWord(src[i - 1]);
      const end = wordOk ? findCloser(src, i + 1, c) : -1;
      if (end !== -1) {
        flush();
        out += `<i>${renderInline(src.slice(i + 1, end), opts, depth + 1)}</i>`;
        i = end + 1;
        continue;
      }
    }

    text += c;
    i += 1;
  }
  flush();
  return out;
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

type SourceBlock =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'code'; lang: string; text: string };

export interface RenderedBlock {
  html: string;
  /** Visible characters. */
  length: number;
}

const FENCE = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;

function parseBlocks(markdown: string): SourceBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: SourceBlock[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.some((l) => l.trim())) blocks.push({ kind: 'paragraph', lines: para });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      endPara();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) body.push(lines[j++]);
      // An unclosed fence is a stray ``` (model output often ends with one):
      // drop that line and read the rest as normal text, rather than turning
      // everything after it into code — or emitting an empty <pre></pre>.
      if (j >= lines.length) continue;
      // A closed fence with nothing in it renders nothing.
      if (body.some((l) => l.trim())) blocks.push({ kind: 'code', lang: fence[1], text: body.join('\n') });
      i = j; // skips the closing fence
      continue;
    }
    if (!line.trim()) { endPara(); continue; }
    if (RULE.test(line)) { endPara(); continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      endPara();
      if (heading[1].trim()) blocks.push({ kind: 'heading', text: heading[1].trim() });
      continue;
    }

    if (QUOTE.test(line)) {
      endPara();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])![1]);
      i -= 1;
      blocks.push({ kind: 'quote', lines: quoted });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      endPara();
      const items: string[] = [];
      while (i < lines.length && (BULLET.test(lines[i]) || ORDERED.test(lines[i]))) {
        const b = BULLET.exec(lines[i]);
        const o = b ? null : ORDERED.exec(lines[i]);
        const indent = '  '.repeat(Math.floor(((b ?? o)![1].length) / 2));
        items.push(b ? `${indent}• ${b[2]}` : `${indent}${o![2]}. ${o![3]}`);
        i += 1;
      }
      i -= 1;
      blocks.push({ kind: 'list', lines: items });
      continue;
    }

    para.push(line.trim());
  }
  endPara();
  return blocks;
}

function codeHtml(lang: string, text: string): string {
  return lang
    ? `<pre><code class="language-${lang}">${escapeHtml(text)}</code></pre>`
    : `<pre>${escapeHtml(text)}</pre>`;
}

function renderBlock(block: SourceBlock): string {
  switch (block.kind) {
    case 'paragraph': return renderInline(block.lines.join('\n'));
    case 'heading':   return `<b>${renderInline(block.text, { noBold: true })}</b>`;
    case 'list':      return block.lines.map((l) => renderInline(l)).join('\n');
    case 'quote':     return `<blockquote>${renderInline(block.lines.join('\n'))}</blockquote>`;
    case 'code':      return codeHtml(block.lang, block.text);
  }
}

const rendered = (html: string): RenderedBlock => ({ html, length: visibleLength(html) });

/** Cuts a string with no usable whitespace into pieces of at most `max` UTF-16 units. */
function hardCut(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of Array.from(text)) {
    if (cur.length + ch.length > max) { out.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Greedy grouping of source units joined by `sep`, each group rendered with
 * `render` and kept ≤ max visible characters. A unit too long on its own is
 * split by `split` (words, then a hard cut).
 */
function group(
  units: string[],
  sep: string,
  max: number,
  render: (src: string) => string,
  split: (unit: string) => string[],
): RenderedBlock[] {
  const out: RenderedBlock[] = [];
  let cur: string[] = [];
  const emit = () => {
    if (cur.length) out.push(rendered(render(cur.join(sep))));
    cur = [];
  };
  for (const unit of units) {
    if (visibleLength(render(unit)) > max) {
      emit();
      for (const piece of split(unit)) out.push(rendered(render(piece)));
      continue;
    }
    const next = [...cur, unit];
    if (cur.length && visibleLength(render(next.join(sep))) > max) {
      emit();
      cur = [unit];
    } else {
      cur = next;
    }
  }
  emit();
  return out;
}

/** A line too long for one message → source pieces split at whitespace. */
function splitWords(render: (s: string) => string, max: number) {
  return (line: string): string[] => {
    const words = line.split(/\s+/).filter(Boolean);
    const sources: string[] = [];
    let cur: string[] = [];
    for (const w of words) {
      if (visibleLength(render(w)) > max) {
        if (cur.length) sources.push(cur.join(' '));
        cur = [];
        sources.push(...hardCut(w, max));
        continue;
      }
      const next = [...cur, w];
      if (cur.length && visibleLength(render(next.join(' '))) > max) {
        sources.push(cur.join(' '));
        cur = [w];
      } else {
        cur = next;
      }
    }
    if (cur.length) sources.push(cur.join(' '));
    return sources;
  };
}

/** One block → one or more rendered pieces, each ≤ max visible characters. */
function renderSplit(block: SourceBlock, max: number): RenderedBlock[] {
  const whole = rendered(renderBlock(block));
  if (whole.length <= max) return [whole];

  switch (block.kind) {
    case 'code': {
      const render = (s: string) => codeHtml(block.lang, s);
      return group(block.text.split('\n'), '\n', max, render, (l) => hardCut(l, max));
    }
    case 'heading': {
      const render = (s: string) => `<b>${renderInline(s, { noBold: true })}</b>`;
      return splitWords(render, max)(block.text).map((s) => rendered(render(s)));
    }
    case 'quote': {
      const render = (s: string) => `<blockquote>${renderInline(s)}</blockquote>`;
      return group(block.lines, '\n', max, render, splitWords(render, max));
    }
    case 'list':
    case 'paragraph': {
      const render = (s: string) => renderInline(s);
      return group(block.lines, '\n', max, render, splitWords(render, max));
    }
  }
}

/** Every block rendered, oversize blocks split. */
export function renderTelegramBlocks(markdown: string, max = TELEGRAM_MESSAGE_TARGET): RenderedBlock[] {
  return parseBlocks(markdown ?? '').flatMap((b) => renderSplit(b, max)).filter((b) => b.html.length > 0);
}

/**
 * The post as Telegram messages: blocks joined by a blank line, each message
 * ≤ max visible characters, cut only between blocks. Deterministic, so a retry
 * sees exactly the parts the first attempt sent.
 */
export function splitTelegramMessages(markdown: string, max = TELEGRAM_MESSAGE_TARGET): string[] {
  const messages: string[] = [];
  let cur: RenderedBlock[] = [];
  let len = 0;
  for (const block of renderTelegramBlocks(markdown, max)) {
    const added = cur.length ? len + 2 + block.length : block.length;
    if (cur.length && added > max) {
      messages.push(cur.map((b) => b.html).join('\n\n'));
      cur = [block];
      len = block.length;
    } else {
      cur.push(block);
      len = added;
    }
  }
  if (cur.length) messages.push(cur.map((b) => b.html).join('\n\n'));
  return messages;
}
