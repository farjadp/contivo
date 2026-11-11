import { describe, expect, it } from 'vitest';

import { detectPostLocale, extractFaq, isFaqHeading, parseInline, parseMarkdown, plainText, safeHref } from './content';

describe('detectPostLocale', () => {
  it('reads Persian text as fa even with Latin brand names inside', () => {
    expect(detectPostLocale('سئو چیست؟', 'برای دیده شدن در ChatGPT و Google باید محتوای دقیق و منبع‌دار بنویسید.')).toBe('fa');
  });

  it('reads English as en', () => {
    expect(detectPostLocale('What is GEO?', 'Answer engines cite pages that answer the question first.')).toBe('en');
  });

  it('ignores code blocks and URLs, which are Latin in both languages', () => {
    const content = 'این یک نمونه است.\n```\nconst lots = "of english code here and more and more and more";\n```\nhttps://www.example.com/a-very-long-english-url-path';
    expect(detectPostLocale('راهنما', content)).toBe('fa');
  });
});

describe('parseMarkdown', () => {
  it('drops a leading h1 that repeats the title and demotes other h1s', () => {
    const blocks = parseMarkdown('# What is GEO?\n\nIntro.\n\n# Part one\n\nBody', 'What is GEO?');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Intro.' },
      { kind: 'heading', level: 2, text: 'Part one' },
      { kind: 'paragraph', text: 'Body' },
    ]);
  });

  it('parses lists, quotes, code and rules', () => {
    const blocks = parseMarkdown('- one\n- two\n  continued\n\n1. first\n2. second\n\n> quoted\n> more\n\n```\ncode\n```\n\n---');
    expect(blocks).toEqual([
      { kind: 'list', ordered: false, items: ['one', 'two continued'] },
      { kind: 'list', ordered: true, items: ['first', 'second'] },
      { kind: 'quote', text: 'quoted more' },
      { kind: 'code', text: 'code' },
      { kind: 'rule' },
    ]);
  });

  it('joins wrapped paragraph lines', () => {
    expect(parseMarkdown('line one\nline two')).toEqual([{ kind: 'paragraph', text: 'line one line two' }]);
  });
});

describe('parseInline', () => {
  it('parses emphasis, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.test)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' ' },
      { kind: 'em', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', href: 'https://x.test', children: [{ kind: 'text', text: 'e' }] },
    ]);
  });

  it('keeps the text of an unsafe link but not the link', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ kind: 'text', text: 'click' }, { kind: 'text', text: ')' }]);
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('//evil.test')).toBeNull();
    expect(safeHref('/en/pricing')).toBe('/en/pricing');
  });

  it('flattens to plain text', () => {
    expect(plainText('**Bold** and [link](/x)')).toBe('Bold and link');
  });
});

describe('extractFaq', () => {
  const article = [
    '## Why it matters',
    'Context.',
    '## FAQ',
    '### What is GEO?',
    'Getting **cited** by AI answers.',
    '### Does it replace SEO?',
    'No.',
    '- It builds on it',
    '### Unanswered?',
    '## Next steps',
    '### Not a question',
    'Body.',
  ].join('\n\n');

  it('collects h3 questions under the FAQ h2 and stops at the next h2', () => {
    expect(extractFaq(parseMarkdown(article))).toEqual([
      { question: 'What is GEO?', answer: 'Getting cited by AI answers.' },
      { question: 'Does it replace SEO?', answer: 'No. It builds on it' },
    ]);
  });

  it('is empty when there is no FAQ section', () => {
    expect(extractFaq(parseMarkdown('## Intro\n\n### A?\n\nB'))).toEqual([]);
  });

  it('recognises Persian FAQ headings with or without the half-space', () => {
    expect(isFaqHeading('پرسش‌های متداول')).toBe(true);
    expect(isFaqHeading('پرسش های متداول')).toBe(true);
    expect(isFaqHeading('سؤالات متداول')).toBe(true);
    expect(isFaqHeading('Frequently Asked Questions')).toBe(true);
    expect(isFaqHeading('FAQs:')).toBe(true);
    expect(isFaqHeading('Pricing')).toBe(false);
  });
});
