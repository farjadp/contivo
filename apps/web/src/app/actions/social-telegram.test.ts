import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mintMock, revalidateMock } = vi.hoisted(() => ({
  mintMock: vi.fn(async (): Promise<string | null> => 'minted-jwt'),
  revalidateMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: revalidateMock }));
vi.mock('@/lib/auth', () => ({ mintApiToken: mintMock }));

import {
  confirmTelegramConnect,
  getTelegramConnect,
  startTelegramConnect,
  submitTelegramUsername,
} from './social-telegram';

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mintMock.mockResolvedValue('minted-jwt');
});

describe('actions/social-telegram', () => {
  it('starts a session with the minted bearer and the workspace', async () => {
    reply(201, { sessionId: 's1', deepLink: 'https://t.me/contivo_bot?start=n', expiresAt: '2026-11-22T10:15:00.000Z' });
    const result = await startTelegramConnect('w1');
    expect(result).toEqual({
      ok: true,
      data: { sessionId: 's1', deepLink: 'https://t.me/contivo_bot?start=n', expiresAt: '2026-11-22T10:15:00.000Z' },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/social\/telegram\/connect-sessions$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: 'w1' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer minted-jwt');
  });

  it('passes the API error code through', async () => {
    reply(503, { code: 'telegram_not_configured', message: 'Telegram is not set up on this deployment.' });
    expect(await startTelegramConnect('w1')).toEqual({ ok: false, code: 'telegram_not_configured' });
  });

  it('a wrong code keeps attemptsLeft', async () => {
    reply(400, { statusCode: 400, code: 'wrong_code', message: 'x', attemptsLeft: 3 });
    expect(await confirmTelegramConnect('s1', '۱۲۳۴۵۶')).toEqual({ ok: false, code: 'wrong_code', attemptsLeft: 3 });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('a confirmed code refreshes the Connections page', async () => {
    reply(200, { sessionId: 's1', status: 'connected', expiresAt: 'x', telegramLinked: true });
    const result = await confirmTelegramConnect('s1', '123456');
    expect(result.ok).toBe(true);
    expect(revalidateMock).toHaveBeenCalledWith('/connections');
  });

  it('maps statuses without a code', async () => {
    reply(404, { statusCode: 404, message: 'Not Found' });
    expect(await getTelegramConnect('s1')).toEqual({ ok: false, code: 'session_not_found' });
    reply(403, { statusCode: 403, message: 'Forbidden' });
    expect(await getTelegramConnect('s1')).toEqual({ ok: false, code: 'forbidden' });
    reply(500, { statusCode: 500, message: 'boom' });
    expect(await getTelegramConnect('s1')).toEqual({ ok: false, code: 'api_error' });
  });

  it('a 404 with its own code is that code, not a lost session', async () => {
    reply(404, { statusCode: 404, code: 'chat_not_found', message: 'x' });
    expect(await submitTelegramUsername('s1', '@nope')).toEqual({ ok: false, code: 'chat_not_found' });
  });

  it('no session → session_expired and no request; network failure → unreachable', async () => {
    mintMock.mockResolvedValueOnce(null);
    expect(await getTelegramConnect('s1')).toEqual({ ok: false, code: 'session_expired' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await getTelegramConnect('s1')).toEqual({ ok: false, code: 'unreachable' });
  });

  it('encodes the session id into the path', async () => {
    reply(200, { sessionId: 'a/b', status: 'waiting', expiresAt: 'x', telegramLinked: false });
    await getTelegramConnect('a/b');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/connect-sessions\/a%2Fb$/);
  });
});
