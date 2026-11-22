/* eslint-disable react/no-children-prop -- server-render tests build the provider tree with createElement props */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../../../messages/en/connections.json';
import fa from '../../../../../../messages/fa/connections.json';
import it_ from '../../../../../../messages/it/connections.json';
import { TELEGRAM_ERROR_CODES } from '@/lib/telegram-connect';

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock('@/app/actions/social-telegram', () => ({
  startTelegramConnect: vi.fn(),
  getTelegramConnect: vi.fn(),
  confirmTelegramConnect: vi.fn(),
  submitTelegramUsername: vi.fn(),
}));

const { TelegramConnectSteps } = await import('./TelegramConnectPanel');
type StepsProps = Parameters<typeof TelegramConnectSteps>[0];

const start = { sessionId: 's1', deepLink: 'https://t.me/contivo_bot?start=abc', expiresAt: '2026-11-22T10:15:00.000Z' };
const noop = () => {};

function render(over: Partial<StepsProps>, locale: 'en' | 'fa' = 'en') {
  const props: StepsProps = {
    start,
    step: 'open',
    view: null,
    error: null,
    attemptsLeft: null,
    busy: false,
    username: '',
    code: '',
    onUsernameChange: noop,
    onCodeChange: noop,
    onUsernameMode: noop,
    onSubmitUsername: noop,
    onSubmitCode: noop,
    onRestart: noop,
    onDone: noop,
    ...over,
  };
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: locale === 'en' ? en : fa,
      timeZone: 'UTC',
      children: createElement(TelegramConnectSteps, props),
    }),
  );
}

describe('TelegramConnectSteps', () => {
  it('step 1 opens the deep link in a new tab', () => {
    const html = render({});
    expect(html).toContain('href="https://t.me/contivo_bot?start=abc"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('Open Telegram');
  });

  it('step 2 explains the channel picker and offers the public-channel fallback', () => {
    const html = render({ step: 'choose' });
    expect(html).toContain('Choose a channel');
    expect(html).toContain('My channel is public and the bot is already admin');
  });

  it('shows the session problem as a sentence', () => {
    const html = render({ step: 'choose', error: 'bot_not_admin' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Make it an admin');
  });

  it('a wrong code says how many tries are left, in Persian digits on the Persian side', () => {
    expect(render({ step: 'code', error: 'wrong_code', attemptsLeft: 3 })).toContain('3 tries left.');
    const html = render({ step: 'code', error: 'wrong_code', attemptsLeft: 3 }, 'fa');
    expect(html).toContain('۳ بار دیگر');
    expect(html).not.toMatch(/>[^<]*[0-9][^<]*بار دیگر/);
  });

  it('the confirm button waits for a full code, Persian digits included', () => {
    expect(render({ step: 'code', code: '۱۲۳' })).toMatch(/<button type="submit" disabled=""/);
    expect(render({ step: 'code', code: '۱۲۳۴۵۶' })).not.toMatch(/<button type="submit" disabled=""/);
  });

  it('connected shows the channel name and its public username', () => {
    const html = render({
      step: 'connected',
      view: {
        sessionId: 's1',
        status: 'connected',
        expiresAt: start.expiresAt,
        telegramLinked: true,
        connection: { id: 'c1', accountName: 'Contivo News', chatType: 'channel', username: 'contivo_news' },
      },
    });
    expect(html).toContain('Contivo News');
    expect(html).toContain('@contivo_news');
    expect(html).toContain('Channel');
  });

  it('expiry offers Start again', () => {
    const html = render({ step: 'expired' }, 'fa');
    expect(html).toContain('مهلت این لینک تمام شده است');
    expect(html).toContain('شروع دوباره');
  });

  it('a failed start shows the reason and a retry', () => {
    const html = render({ start: null, error: 'telegram_not_configured' });
    expect(html).toContain('Telegram is not switched on for Contivo yet.');
    expect(html).toContain('Try again');
  });

  it('every error code has a sentence in every locale', () => {
    for (const messages of [en, fa, it_]) {
      const errors = messages.connections.telegram.errors as Record<string, string>;
      for (const code of TELEGRAM_ERROR_CODES) expect(errors[code], code).toBeTruthy();
    }
  });
});
