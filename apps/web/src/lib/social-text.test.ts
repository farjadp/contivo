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

describe('stripFrameworkLabels (first-post QA: "Strong Opinion:", "Reason:", "Example:" in the post)', () => {
  it('removes known framework labels at a line start, keeping the sentence (after markdown is gone)', () => {
    const input = [
      'Strong Opinion: Bread classes beat bread ads.',
      '',
      '**Reason:** People trust what they made with their hands.',
      '',
      '• Example: Our Saturday class sold out.',
      '',
      'Hook:',
      'CTA – Book a seat.',
    ].join('\n');
    expect(textForChannel('linkedin', input)).toBe(
      [
        'Bread classes beat bread ads.',
        '',
        'People trust what they made with their hands.',
        '',
        '• Our Saturday class sold out.',
        '',
        'CTA – Book a seat.',
      ].join('\n'),
    );
  });

  it('leaves prose alone: a label word mid-line, or a line-start word without a colon', async () => {
    const { stripFrameworkLabels } = await import('./social-text');
    const text = 'The reason: we bake daily.\nWhy we bake: love.\nExample of care is time.\nOur action: more classes.';
    expect(stripFrameworkLabels('The reason: we bake daily.')).toBe('The reason: we bake daily.');
    expect(stripFrameworkLabels('Why we bake: love.')).toBe('Why we bake: love.');
    expect(stripFrameworkLabels(text)).toBe(text);
  });

  it('runs for LinkedIn and X through textForChannel, never for blog', () => {
    expect(textForChannel('linkedin', 'Insight: Small batches sell out.')).toBe('Small batches sell out.');
    expect(textForChannel('twitter', 'Insight: Small batches sell out.')).toBe('Small batches sell out.');
    expect(textForChannel('blog', 'Insight: Small batches sell out.')).toBe('Insight: Small batches sell out.');
  });
});
