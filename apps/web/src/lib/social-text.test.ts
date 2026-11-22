import { describe, expect, it } from 'vitest';

import samples from './social-text.samples.json';
import { isPlainTextChannel, markdownToPlainText, textForChannel } from './social-text';

// B15: LinkedIn showed **bold** as asterisks. The samples are shared with the
// publish-time copy in apps/api (adapters/social-text.ts).
describe('markdownToPlainText', () => {
  it.each(samples.map((s) => [s.name, s.input, s.output] as const))('%s', (_name, input, output) => {
    expect(markdownToPlainText(input)).toBe(output);
  });

  it('keeps every ZWNJ in Persian text', () => {
    const fa = samples.find((s) => s.name.startsWith('fa'))!;
    const count = (t: string) => (t.match(/‌/g) ?? []).length;
    expect(count(markdownToPlainText(fa.input))).toBe(count(fa.input));
  });

  it('is idempotent', () => {
    for (const s of samples) expect(markdownToPlainText(s.output)).toBe(s.output);
  });
});

describe('textForChannel', () => {
  it('converts social channels only', () => {
    expect(textForChannel('linkedin', '**Hi**')).toBe('Hi');
    expect(textForChannel('twitter', '**Hi**')).toBe('Hi');
    expect(textForChannel('blog', '**Hi**')).toBe('**Hi**');
    expect(textForChannel('telegram', '**Hi**')).toBe('**Hi**');
    expect(textForChannel('email', '**Hi**')).toBe('**Hi**');
    expect(isPlainTextChannel('LINKEDIN')).toBe(true);
  });
});
