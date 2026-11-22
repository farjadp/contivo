import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// finalizeSocialConnect is the step that binds an OAuth connect to the person
// signed in here (P2-A). It must send the session's own bearer, never act
// without a session, and report the API's "started by another account" as
// 'foreign' so the page can say nothing was connected.

const { sessionMock, mintMock } = vi.hoisted(() => ({ sessionMock: vi.fn(), mintMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getSession: sessionMock, mintApiToken: mintMock }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));

import { finalizeSocialConnect } from './social-connect';

const fetchMock = vi.fn();

describe('finalizeSocialConnect', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    sessionMock.mockResolvedValue({ userId: 'user-a' });
    mintMock.mockResolvedValue('minted-bearer');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('posts the ticket with the session bearer and returns ok on 200', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'ok' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/social\/oauth\/finalize$/);
    expect(init.headers.Authorization).toBe('Bearer minted-bearer');
    expect(JSON.parse(init.body)).toEqual({ ticket: 'tkt' });
  });

  it('returns the workspace the API saved the connection to (B17)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ platform: 'linkedin', accounts: 1, workspaceId: 'ws-9' }), { status: 200 }),
    );
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'ok', workspaceId: 'ws-9' });
  });

  it('still reports ok when an older API sends no workspace or a non-JSON body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"platform":"linkedin"}', { status: 200 }));
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'ok' });
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'ok' });
  });

  it('maps 403 (flow started by another account) to foreign', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }));
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'foreign' });
  });

  it('maps expired/used tickets and network errors to failed', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 410 }));
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'failed' });
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'failed' });
  });

  it('does nothing without a session', async () => {
    sessionMock.mockResolvedValue(null);
    expect(await finalizeSocialConnect('tkt')).toEqual({ result: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
