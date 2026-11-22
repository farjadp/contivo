/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import en from '../../../../../../../messages/en/tabs-a.json';
import fa from '../../../../../../../messages/fa/tabs-a.json';
import itMsgs from '../../../../../../../messages/it/tabs-a.json';
import es from '../../../../../../../messages/es/tabs-a.json';
import he from '../../../../../../../messages/he/tabs-a.json';

import { QualityVerdictNotice } from './QualityVerdictNotice';

const LOCALES = { en, fa, it: itMsgs, es, he } as const;

function render(verdict: unknown, locale: keyof typeof LOCALES, variant: 'card' | 'preview' = 'preview') {
  const missing: string[] = [];
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: LOCALES[locale],
      timeZone: 'UTC',
      onError: (e: Error) => missing.push(e.message),
      children: createElement(QualityVerdictNotice, {
        verdict,
        variant,
        onCheckAgain: async () => {},
        onPublishAnyway: async () => {},
      }),
    }),
  );
  return { html, missing };
}

const failed = (rejectedBy: string, extra: object = {}) => ({
  approved: false,
  rejectedBy,
  reasons: ['raw english reason'],
  scores: { brandFit: 4, factualSafety: 3, clarity: 5, storylineFit: 2, evidenceDiscipline: 1 },
  below: ['brandFit', 'factualSafety', 'clarity', 'storylineFit', 'evidenceDiscipline'],
  judge: 'openai',
  judgeModel: 'm',
  checkedAt: '2026-11-22T10:00:00.000Z',
  source: 'pipeline',
  ...extra,
});

const CODES = [
  'empty', 'platform_char_limit', 'word_count', 'leakage', 'avoid_list', 'duplicate',
  'judge_unavailable', 'gate_unavailable', 'judge_veto', 'not_checked', 'low_score', 'something_new',
];

describe('QualityVerdictNotice', () => {
  for (const locale of Object.keys(LOCALES) as Array<keyof typeof LOCALES>) {
    it(`${locale}: every rejection code renders a real message`, () => {
      for (const code of CODES) {
        const { html, missing } = render(failed(code), locale);
        expect(missing, `${locale}/${code}`).toEqual([]);
        expect(html).not.toContain('tabsA.quality');
      }
      const card = render(failed('low_score'), locale, 'card');
      expect(card.missing).toEqual([]);
      expect(render({ ...failed('low_score'), approved: true }, locale).missing).toEqual([]);
    });
  }

  it('shows failed scores with locale digits in Persian', () => {
    const { html } = render(failed('low_score'), 'fa');
    expect(html).toContain('۳');
    expect(html).not.toContain('raw english reason');
  });

  it('renders nothing for an ungated item', () => {
    expect(render(null, 'en', 'card').html).toBe('');
  });

  it('a blocked card offers Check again and Publish anyway', () => {
    const { html } = render(failed('not_checked'), 'en', 'card');
    expect(html).toContain('Not checked');
    expect(html).toContain('Check again');
    expect(html).toContain('Publish anyway…');
  });

  it('a passed or overridden item shows no blocking controls on the card', () => {
    expect(render({ ...failed('low_score'), approved: true }, 'en', 'card').html).toBe('');
    expect(render(failed('low_score', { override: { userId: 'u', at: 'x' } }), 'en', 'card').html).not.toContain('Check again');
  });
});
