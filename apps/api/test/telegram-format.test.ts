/**
 * Markdown → Telegram HTML (parse_mode HTML). Pure; no network.
 *
 * Telegram accepts only a few tags and needs every other <, >, & escaped, or
 * the whole message is rejected ("can't parse entities"). Model-written posts
 * are full of stray punctuation, so the renderer must never emit anything
 * outside the allowed set.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ALLOWED_TAGS,
  escapeHtml,
  renderTelegramBlocks,
  splitTelegramMessages,
  telegramSafeHref,
  visibleLength,
} from '../src/modules/social/adapters/telegram-format';

const one = (md: string) => splitTelegramMessages(md).join('\n\n');

/** Every tag in the output is in the allowed set and balanced. */
function assertValidTelegramHtml(html: string) {
  const stack: string[] = [];
  const re = /<(\/?)([a-z-]+)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, close, tag] = m;
    assert.ok((ALLOWED_TAGS as readonly string[]).includes(tag), `tag <${tag}> is not allowed: ${html}`);
    if (close) assert.equal(stack.pop(), tag, `unbalanced </${tag}> in ${html}`);
    else stack.push(tag);
  }
  assert.deepEqual(stack, [], `unclosed tags in ${html}`);
  // No raw < > & outside tags/entities.
  const text = html.replace(re, '');
  assert.doesNotMatch(text, /[<>]/, `raw angle bracket in ${html}`);
  assert.doesNotMatch(text, /&(?!(lt|gt|amp|quot);)/, `raw ampersand in ${html}`);
}

describe('escapeHtml', () => {
  it('escapes the three characters Telegram requires, and quotes', () => {
    assert.equal(escapeHtml('a < b && c > "d"'), 'a &lt; b &amp;&amp; c &gt; &quot;d&quot;');
  });
});

describe('telegramSafeHref', () => {
  it('allows http and https only', () => {
    assert.equal(telegramSafeHref('https://contivo.app/x?a=1&b=2'), 'https://contivo.app/x?a=1&b=2');
    assert.equal(telegramSafeHref('http://example.com'), 'http://example.com');
    assert.equal(telegramSafeHref('javascript:alert(1)'), null);
    assert.equal(telegramSafeHref('/relative'), null);
    assert.equal(telegramSafeHref('tg://user?id=1'), null);
    assert.equal(telegramSafeHref('https://exa mple.com'), null);
  });
});

describe('inline markdown', () => {
  it('bold, italic, strike, code, link', () => {
    const html = one('**bold** and *it* and _it2_ and ~~gone~~ and `x<y` and [site](https://a.com/?q=1&r=2)');
    assert.equal(
      html,
      '<b>bold</b> and <i>it</i> and <i>it2</i> and <s>gone</s> and <code>x&lt;y</code> and <a href="https://a.com/?q=1&amp;r=2">site</a>',
    );
    assertValidTelegramHtml(html);
  });

  it('nested markers: italic inside bold', () => {
    const html = one('**bold with *italic* inside**');
    assert.equal(html, '<b>bold with <i>italic</i> inside</b>');
    assertValidTelegramHtml(html);
  });

  it('unmatched markers stay literal text', () => {
    const html = one('5 * 3 = 15, a ** b, snake_case_name, price < 10 & > 5');
    assert.equal(html, '5 * 3 = 15, a ** b, snake_case_name, price &lt; 10 &amp; &gt; 5');
    assertValidTelegramHtml(html);
  });

  it('unsafe link keeps its text, drops the link', () => {
    assert.equal(one('[click](javascript:alert)'), 'click');
  });

  it('raw HTML in the source is escaped, never passed through', () => {
    const html = one('<script>alert(1)</script> <b>x</b>');
    assert.equal(html, '&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;x&lt;/b&gt;');
  });

  it('image markdown becomes a link to the image', () => {
    assert.equal(one('![chart](https://a.com/c.png)'), '<a href="https://a.com/c.png">chart</a>');
  });

  it('code spans are not parsed for markers', () => {
    assert.equal(one('`**not bold**`'), '<code>**not bold**</code>');
  });
});

describe('blocks', () => {
  it('headings become bold, lists become bullets', () => {
    const html = one('# Title\n\nIntro line.\n\n- one\n- **two**\n* three\n\n1. first\n2. second');
    assert.equal(html, '<b>Title</b>\n\nIntro line.\n\n• one\n• <b>two</b>\n• three\n\n1. first\n2. second');
    assertValidTelegramHtml(html);
  });

  it('blockquote', () => {
    const html = one('> quoted *line*\n> second');
    assert.equal(html, '<blockquote>quoted <i>line</i>\nsecond</blockquote>');
  });

  it('fenced code block keeps content verbatim and escaped', () => {
    const html = one('```ts\nconst a = b < c && d;\n**x**\n```');
    assert.equal(html, '<pre><code class="language-ts">const a = b &lt; c &amp;&amp; d;\n**x**</code></pre>');
    assertValidTelegramHtml(html);
  });

  it('code fence without language', () => {
    assert.equal(one('```\nline\n```'), '<pre>line</pre>');
  });

  it('horizontal rules are dropped', () => {
    assert.equal(one('a\n\n---\n\nb'), 'a\n\nb');
  });

  it('a heading directly followed by text still splits', () => {
    assert.equal(one('## Head\nbody text'), '<b>Head</b>\n\nbody text');
  });
});

describe('Persian', () => {
  it('keeps Persian text, ZWNJ and Persian digits intact', () => {
    const md = '## راهنمای **سئو** برای کسب‌وکارها\n\nدر سال ۱۴۰۵ می‌توانید *سریع‌تر* رشد کنید.\n\n- نکته‌ی اول\n- نکته‌ی دوم';
    const html = one(md);
    assert.equal(
      html,
      '<b>راهنمای سئو برای کسب‌وکارها</b>\n\nدر سال ۱۴۰۵ می‌توانید <i>سریع‌تر</i> رشد کنید.\n\n• نکته‌ی اول\n• نکته‌ی دوم',
    );
    assert.ok(html.includes('‌'), 'ZWNJ preserved');
    assertValidTelegramHtml(html);
  });

  it('Persian link text', () => {
    assert.equal(one('[سایت ما](https://contivo.app/fa)'), '<a href="https://contivo.app/fa">سایت ما</a>');
  });
});

describe('visibleLength', () => {
  it('counts text after entity parsing', () => {
    assert.equal(visibleLength('<b>ab</b> &amp; <a href="https://x.y">c</a>'), 6);
  });
});

describe('splitTelegramMessages', () => {
  it('short text is one message', () => {
    assert.equal(splitTelegramMessages('hello').length, 1);
  });

  it('splits on block boundaries, every part ≤ the limit', () => {
    const para = (n: number) => `Paragraph ${n} ${'word '.repeat(150)}`.trim();
    const md = Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n');
    const parts = splitTelegramMessages(md, 3800);
    assert.ok(parts.length >= 2);
    for (const p of parts) {
      assert.ok(visibleLength(p) <= 3800, `part too long: ${visibleLength(p)}`);
      assertValidTelegramHtml(p);
    }
    const joined = parts.join('\n\n');
    for (let i = 0; i < 12; i++) assert.ok(joined.includes(para(i)), `paragraph ${i} intact`);
  });

  it('one huge paragraph is split at whitespace, never inside a tag', () => {
    const md = `**start** ${'کلمه '.repeat(2500)}**end**`;
    const parts = splitTelegramMessages(md, 3800);
    assert.ok(parts.length >= 3);
    for (const p of parts) {
      assert.ok(visibleLength(p) <= 3800);
      assertValidTelegramHtml(p);
    }
    assert.ok(parts[0].startsWith('<b>start</b>'));
    assert.ok(parts[parts.length - 1].endsWith('<b>end</b>'));
  });

  it('a very long code block is split into several <pre> blocks', () => {
    const code = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
    const parts = splitTelegramMessages('```\n' + code + '\n```', 3800);
    assert.ok(parts.length >= 3);
    for (const p of parts) {
      assert.ok(visibleLength(p) <= 3800);
      assertValidTelegramHtml(p);
      assert.ok(p.startsWith('<pre>'));
    }
  });

  it('a single word longer than the limit is hard-cut', () => {
    const parts = splitTelegramMessages('a'.repeat(9000), 3800);
    assert.equal(parts.length, 3);
    for (const p of parts) assert.ok(visibleLength(p) <= 3800);
  });

  it('is deterministic (retries must see the same parts)', () => {
    const md = Array.from({ length: 30 }, (_, i) => `Block ${i} ${'z '.repeat(200)}`).join('\n\n');
    assert.deepEqual(splitTelegramMessages(md), splitTelegramMessages(md));
  });

  it('empty / whitespace-only gives no parts', () => {
    assert.deepEqual(splitTelegramMessages('  \n\n '), []);
  });
});

describe('renderTelegramBlocks', () => {
  it('returns one entry per block with its visible length', () => {
    const blocks = renderTelegramBlocks('# A\n\nb **c**');
    assert.deepEqual(blocks.map((b) => b.html), ['<b>A</b>', 'b <b>c</b>']);
    assert.deepEqual(blocks.map((b) => b.length), [1, 3]);
  });
});
