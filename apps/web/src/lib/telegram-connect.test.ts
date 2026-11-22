import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_ERROR_CODES,
  endsSession,
  failedReason,
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

describe('session-ending API codes', () => {
  it('too many attempts, too many codes, denied and session_finished end the session', () => {
    for (const code of ['too_many_attempts', 'too_many_codes', 'denied', 'session_finished'] as const) {
      expect(endsSession(code)).toBe(true);
    }
  });

  it('already_pending, too_many_lookups and wrong_code do not: the user can act on the same screen', () => {
    for (const code of ['already_pending', 'too_many_lookups', 'wrong_code', 'chat_not_found'] as const) {
      expect(endsSession(code)).toBe(false);
    }
  });

  it('the new API codes are known', () => {
    for (const code of ['already_pending', 'session_finished', 'too_many_lookups', 'too_many_codes', 'denied']) {
      expect(isTelegramErrorCode(code)).toBe(true);
    }
  });

  it('the stopped screen uses the session reason, then the action error, else session_finished', () => {
    expect(failedReason(view({ status: 'failed', error: 'denied' }), 'session_finished')).toBe('denied');
    expect(failedReason(view({ status: 'failed', error: 'too_many_codes' }), null)).toBe('too_many_codes');
    expect(failedReason(view({ status: 'failed' }), null)).toBe('session_finished');
    expect(failedReason(null, null)).toBe('session_finished');
  });

  it('a denied session lands on the failed step', () => {
    expect(panelStep(view({ status: 'failed', error: 'denied' }), { expired: false, usernameMode: false })).toBe('failed');
  });
});

describe('every error code has a sentence in every locale', () => {
  it('en, fa and it cover TELEGRAM_ERROR_CODES', async () => {
    for (const locale of ['en', 'fa', 'it']) {
      const messages = (await import(`../../messages/${locale}/connections.json`)).default;
      const errors = messages.connections.telegram.errors as Record<string, string>;
      for (const code of TELEGRAM_ERROR_CODES) expect(errors[code], `${locale}: ${code}`).toBeTruthy();
    }
  });
});
