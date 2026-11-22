import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every Nest route is behind the session guard. These actions used to send no
// Authorization header, so Disconnect / Make default / Retry / Cancel all got
// a 401 that nobody showed. They must send the minted bearer and return a
// human {error}.

const { mintMock, connectUrlMock } = vi.hoisted(() => ({
  mintMock: vi.fn(async (): Promise<string | null> => 'minted-jwt'),
  connectUrlMock: vi.fn(async (): Promise<{ url: string } | { error: string }> => ({ url: 'https://api/connect' })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ mintApiToken: mintMock }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => `t:${key}`) }));
vi.mock('./social-connect', () => ({ getSocialConnectUrl: connectUrlMock }));

import {
  cancelPublishJob,
  disconnectSocialConnection,
  reconnectSocialConnection,
  retryPublishJob,
  setDefaultConnection,
} from './social';

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mintMock.mockResolvedValue('minted-jwt');
});

describe('actions/social auth', () => {
  it.each([
    ['disconnect', () => disconnectSocialConnection('c1', 'w1'), 'DELETE'],
    ['set default', () => setDefaultConnection('c1', 'w1'), 'PATCH'],
    ['retry', () => retryPublishJob('j1', 'w1'), 'POST'],
    ['cancel', () => cancelPublishJob('j1', 'w1'), 'DELETE'],
  ])('%s sends Authorization: Bearer <minted token>', async (_name, call, method) => {
    reply(200, { success: true });
    const result = await call();
    expect(result.error).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer minted-jwt');
    expect(init.method).toBe(method);
  });

  it('no session → session-expired error and no request', async () => {
    mintMock.mockResolvedValueOnce(null);
    const result = await retryPublishJob('j1', 'w1');
    expect(result).toEqual({ error: 't:sessionExpired', code: 'session_expired' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 → session-expired error', async () => {
    reply(401, { message: 'Unauthorized' });
    expect(await retryPublishJob('j1', 'w1')).toEqual({ error: 't:sessionExpired', code: 'session_expired' });
  });

  it('400 → the API message, readable', async () => {
    reply(400, { statusCode: 400, message: 'Job j1 has no content item, so there is no body to publish again. Create a new job.' });
    const result = await retryPublishJob('j1', 'w1');
    expect(result.error).toBe('Job j1 has no content item, so there is no body to publish again. Create a new job.');
    expect(result.code).toBe('rejected');
  });

  it('400 with a validation message array joins it', async () => {
    reply(400, { message: { message: 'Publish payload failed platform validation.', errors: ['LinkedIn post body cannot be empty.'] } });
    const result = await retryPublishJob('j1', 'w1');
    expect(result.error).toBe('Publish payload failed platform validation. LinkedIn post body cannot be empty.');
  });

  it('network failure → unreachable, not a raw stack', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const result = await cancelPublishJob('j1', 'w1');
    expect(result.code).toBe('unreachable');
    expect(result.error).toMatch(/could not reach/i);
  });
});

describe('path encoding (P3-4)', () => {
  it('ids and workspaceId cannot change the path or add query params', async () => {
    reply(200, {});
    await retryPublishJob('../connections/x?evil=1', 'w1&status=FAILED');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/social/publish-jobs/..%2Fconnections%2Fx%3Fevil%3D1/retry?workspaceId=w1%26status%3DFAILED');
  });
});

describe('reconnectSocialConnection', () => {
  it('returns the OAuth url for the platform the API names', async () => {
    reply(200, { connection: { id: 'c1', status: 'PENDING_REAUTH' }, reconnect: { platform: 'linkedin', flow: 'oauth' } });
    const result = await reconnectSocialConnection('c1', 'w1');
    expect(connectUrlMock).toHaveBeenCalledWith('linkedin', 'w1');
    expect(result.data?.url).toBe('https://api/connect');
    expect(result.data?.reconnect).toEqual({ platform: 'linkedin', flow: 'oauth' });
  });

  it('a platform without an OAuth flow returns an error, no url', async () => {
    reply(200, { connection: { id: 'c1' }, reconnect: { platform: 'telegram', flow: 'unsupported' } });
    const result = await reconnectSocialConnection('c1', 'w1');
    expect(connectUrlMock).not.toHaveBeenCalled();
    expect(result.code).toBe('reconnect_unsupported');
    expect(result.error).toBeTruthy();
  });
});
