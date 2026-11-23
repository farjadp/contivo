import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  captureException: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  writeActivityLog: vi.fn(),
  getSession: vi.fn(),
  actionError: vi.fn(),
  rethrow: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({ captureException: m.captureException }));
vi.mock('next/headers', () => ({ cookies: m.cookies }));
vi.mock('next/navigation', () => ({ unstable_rethrow: m.rethrow }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: m.writeActivityLog }));
vi.mock('@/lib/auth', () => ({ getSession: m.getSession }));
vi.mock('@/lib/action-errors', () => ({ actionError: m.actionError }));

import { guardedAction, recordActionFailure } from './action-failure';
import { REF_COOKIE, REF_PATTERN } from './types';

const SECRET = 'sk-proj-SECRETSECRETSECRET';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.cookies.mockResolvedValue({ set: m.cookieSet });
  m.getSession.mockResolvedValue({ userId: 'u1' });
  m.captureException.mockReturnValue('evt123');
  m.actionError.mockResolvedValue('Friendly text');
  m.writeActivityLog.mockResolvedValue(undefined);
});

describe('recordActionFailure', () => {
  it('records everything and never leaks the upstream message', async () => {
    const err = Object.assign(new Error(`429 insufficient_quota ${SECRET}`), { status: 429 });
    const { ref, code } = await recordActionFailure({ action: 'runMatrices', error: err, workspaceId: 'w1' });
    expect(ref).toMatch(REF_PATTERN);
    expect(code).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(m.writeActivityLog).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'ACTION_FAILED',
      workspaceId: 'w1',
      detail: { ref, action: 'runMatrices', code, sentryEventId: 'evt123' },
    });
    expect(m.captureException).toHaveBeenCalledWith(err, { tags: { ref, code, action: 'runMatrices' } });
    expect(m.cookieSet).toHaveBeenCalledWith(REF_COOKIE, ref, { path: '/', maxAge: 600, sameSite: 'lax', httpOnly: false });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).toContain(`[${ref}] runMatrices PROVIDER_OUT_OF_CREDIT`);
    expect(logged).not.toContain(SECRET);
    expect(JSON.stringify(m.writeActivityLog.mock.calls)).not.toContain(SECRET);
  });

  it('skips the DB write quietly with no user', async () => {
    m.getSession.mockResolvedValue(null);
    const r = await recordActionFailure({ action: 'a', error: new Error('x') });
    expect(r.ref).toMatch(REF_PATTERN);
    expect(m.writeActivityLog).not.toHaveBeenCalled();
  });

  it('uses the passed userId without a session lookup', async () => {
    await recordActionFailure({ action: 'a', error: new Error('x'), userId: 'u9' });
    expect(m.getSession).not.toHaveBeenCalled();
    expect(m.writeActivityLog.mock.calls[0][0].userId).toBe('u9');
  });

  it('never throws when every dependency fails', async () => {
    m.getSession.mockRejectedValue(new Error('no request'));
    m.captureException.mockImplementation(() => {
      throw new Error('sentry down');
    });
    m.writeActivityLog.mockRejectedValue(new Error('db down'));
    m.cookies.mockRejectedValue(new Error('outside request'));
    const r = await recordActionFailure({ action: 'a', error: new Error('x'), userId: 'u1' });
    expect(r.ref).toMatch(REF_PATTERN);
    expect(r.code).toBe('UNKNOWN');
  });

  it('honours a caller-supplied code', async () => {
    const r = await recordActionFailure({ action: 'a', error: null, code: 'NOT_ENOUGH_EVIDENCE' });
    expect(r.code).toBe('NOT_ENOUGH_EVIDENCE');
  });
});

describe('guardedAction', () => {
  it('passes success through', async () => {
    expect(await guardedAction('a', 'w1', async () => ({ ok: true }))).toEqual({ ok: true });
    expect(m.writeActivityLog).not.toHaveBeenCalled();
  });

  it('turns a thrown error into friendly text plus ref', async () => {
    const r = (await guardedAction('a', 'w1', async () => {
      throw new Error('boom');
    }, 'matricesFailed')) as { error: string; ref: string };
    expect(m.actionError).toHaveBeenCalledWith('matricesFailed');
    expect(r.error).toBe('Friendly text');
    expect(r.ref).toMatch(REF_PATTERN);
    expect(m.writeActivityLog).toHaveBeenCalledTimes(1);
  });

  it('uses the generic key by default and survives a missing locale', async () => {
    m.actionError.mockRejectedValue(new Error('no request'));
    const r = (await guardedAction('a', null, async () => {
      throw new Error('boom');
    })) as { error: string; ref: string };
    expect(m.actionError).toHaveBeenCalledWith('generic');
    expect(r.error).toBeTruthy();
    expect(r.ref).toMatch(REF_PATTERN);
  });

  it('returned errors pass through unchanged without a code hint', async () => {
    const result = { error: 'No.' };
    expect(await guardedAction('a', 'w1', async () => result)).toEqual({ error: 'No.' });
    expect(m.writeActivityLog).not.toHaveBeenCalled();
  });

  it('returned errors gain a ref with a code hint, and keep an existing one', async () => {
    const r = (await guardedAction('a', 'w1', async () => ({ error: 'No.' }), undefined, {
      code: 'NOT_ENOUGH_EVIDENCE',
    })) as { error: string; ref: string };
    expect(r.error).toBe('No.');
    expect(r.ref).toMatch(REF_PATTERN);
    const kept = await guardedAction('a', 'w1', async () => ({ error: 'No.', ref: 'CTV-AAAA' }), undefined, {
      code: 'VALIDATION',
    });
    expect(kept).toEqual({ error: 'No.', ref: 'CTV-AAAA' });
  });

  it('rethrows redirect and notFound', async () => {
    for (const digest of ['NEXT_REDIRECT;replace;/x;307;', 'NEXT_NOT_FOUND']) {
      await expect(
        guardedAction('a', null, async () => {
          throw Object.assign(new Error('ctl'), { digest });
        }),
      ).rejects.toMatchObject({ digest });
    }
    expect(m.writeActivityLog).not.toHaveBeenCalled();
  });
});
