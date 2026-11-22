import { beforeEach, describe, expect, it, vi } from 'vitest';

const { purgeMock } = vi.hoisted(() => ({ purgeMock: vi.fn() }));
vi.mock('@/lib/bug-report/retention', () => ({ purgeOldBugReports: purgeMock }));

import { POST } from './route';

const req = (auth?: string) => new Request('http://x/api/bug-reports/purge', { method: 'POST', headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret-value';
});

describe('purge route', () => {
  it('503 when CRON_SECRET is unset (fails closed)', async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req('Bearer x'))).status).toBe(503);
    expect(purgeMock).not.toHaveBeenCalled();
  });
  it('401 without or with a wrong secret', async () => {
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req('Bearer wrong-secret-valu'))).status).toBe(401);
    expect(purgeMock).not.toHaveBeenCalled();
  });
  it('runs the purge with the right secret', async () => {
    purgeMock.mockResolvedValue(7);
    const res = await POST(req('Bearer test-secret-value'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 7 });
  });
  it('500 when the purge throws, not a healthy-looking 200', async () => {
    purgeMock.mockRejectedValue(new Error('db'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await POST(req('Bearer test-secret-value'))).status).toBe(500);
    spy.mockRestore();
  });
});
