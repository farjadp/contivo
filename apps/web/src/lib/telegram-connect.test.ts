import { describe, expect, it } from 'vitest';

import {
  isCompleteCode,
  isExpired,
  isTelegramErrorCode,
  isTerminalStatus,
  normalizeCodeInput,
  panelStep,
  pickConnectionMeta,
  telegramChatUrl,
  type TelegramSessionView,
} from './telegram-connect';

const view = (over: Partial<TelegramSessionView> = {}): TelegramSessionView => ({
  sessionId: 's1',
  status: 'waiting',
  expiresAt: '2026-11-22T10:15:00.000Z',
  telegramLinked: false,
  ...over,
});

describe('panelStep', () => {
  const base = { expired: false, usernameMode: false };

  it('waits for Start until Telegram has been opened', () => {
    expect(panelStep(null, base)).toBe('open');
    expect(panelStep(view(), base)).toBe('open');
  });

  it('asks for the channel once Start was tapped', () => {
    expect(panelStep(view({ status: 'started', telegramLinked: true }), base)).toBe('choose');
  });

  it('shows the username form only when asked for', () => {
    expect(panelStep(view({ status: 'started', telegramLinked: true }), { ...base, usernameMode: true })).toBe('username');
  });

  it('moves to the code as soon as the bot sent one, even from the username form', () => {
    expect(panelStep(view({ status: 'pending_confirm', telegramLinked: true }), { ...base, usernameMode: true })).toBe('code');
  });

  it('ends on connected or failed, and connected wins over a clock that just ran out', () => {
    expect(panelStep(view({ status: 'connected' }), { ...base, expired: true })).toBe('connected');
    expect(panelStep(view({ status: 'failed', error: 'too_many_attempts' }), base)).toBe('failed');
  });

  it('expires anything still open', () => {
    expect(panelStep(view({ status: 'pending_confirm' }), { ...base, expired: true })).toBe('expired');
    expect(panelStep(null, { ...base, expired: true })).toBe('expired');
  });
});

describe('isTerminalStatus / isExpired', () => {
  it('stops polling only on connected and failed', () => {
    expect(isTerminalStatus('connected')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('started')).toBe(false);
    expect(isTerminalStatus('pending_confirm')).toBe(false);
  });

  it('compares against expiresAt', () => {
    const at = Date.parse('2026-11-22T10:15:00.000Z');
    expect(isExpired('2026-11-22T10:15:00.000Z', at - 1)).toBe(false);
    expect(isExpired('2026-11-22T10:15:00.000Z', at)).toBe(true);
    expect(isExpired(null, at)).toBe(false);
    expect(isExpired('not a date', at)).toBe(false);
  });
});

describe('normalizeCodeInput', () => {
  it('accepts Persian and Arabic digits and drops everything else', () => {
    expect(normalizeCodeInput('۱۲۳ ۴۵۶')).toBe('123456');
    expect(normalizeCodeInput('١٢٣٤٥٦')).toBe('123456');
    expect(normalizeCodeInput('12-34-56')).toBe('123456');
    expect(normalizeCodeInput('1234567')).toBe('123456');
  });

  it('only a full six-digit code is complete', () => {
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
  });
});

describe('telegramChatUrl', () => {
  it('links public usernames only', () => {
    expect(telegramChatUrl('contivo_news')).toBe('https://t.me/contivo_news');
    expect(telegramChatUrl('@contivo_news')).toBe('https://t.me/contivo_news');
    expect(telegramChatUrl('ab')).toBeNull();
    expect(telegramChatUrl('javascript:alert(1)')).toBeNull();
    expect(telegramChatUrl(null)).toBeNull();
  });
});

describe('pickConnectionMeta', () => {
  it('keeps only the known, safe fields', () => {
    expect(
      pickConnectionMeta({ chatType: 'channel', username: 'contivo_news', revokedReason: 'BOT_REMOVED', linkedByTelegramUserId: 42 }),
    ).toEqual({ chatType: 'channel', username: 'contivo_news', revokedReason: 'BOT_REMOVED' });
  });

  it('drops anything unexpected', () => {
    expect(pickConnectionMeta({ chatType: 'private', username: 'x y', revokedReason: 'OTHER' })).toEqual({
      chatType: null,
      username: null,
      revokedReason: null,
    });
    expect(pickConnectionMeta(null)).toEqual({ chatType: null, username: null, revokedReason: null });
    expect(pickConnectionMeta(['channel'])).toEqual({ chatType: null, username: null, revokedReason: null });
  });
});

describe('isTelegramErrorCode', () => {
  it('knows the API codes and nothing else', () => {
    expect(isTelegramErrorCode('wrong_code')).toBe(true);
    expect(isTelegramErrorCode('start_bot_first')).toBe(true);
    expect(isTelegramErrorCode('made_up')).toBe(false);
    expect(isTelegramErrorCode(undefined)).toBe(false);
  });
});
