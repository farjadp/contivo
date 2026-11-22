import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sign-up and sign-in leave a USER_SIGNED_UP / USER_SIGNED_IN row, and a
// ?cohort= tag is stored only when it is on the SIGNUP_COHORTS allowlist.
// No database, no cookies: everything the actions touch is mocked.

const { prismaMock, writeActivityLogMock, redirectMock, compareMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn(), create: vi.fn() } },
  writeActivityLogMock: vi.fn(async () => {}),
  // next's redirect() throws; the mock does too, so code after it never runs.
  redirectMock: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  compareMock: vi.fn(async () => true),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: writeActivityLogMock }));
vi.mock('@/lib/auth', () => ({ createSessionCookie: vi.fn(async () => {}), deleteSessionCookie: vi.fn() }));
vi.mock('@/lib/admin-state', () => ({ isUserSuspended: vi.fn(async () => false) }));
vi.mock('@/lib/credits', () => ({ ensureWelcomeCredits: vi.fn(async () => {}) }));
vi.mock('@/lib/password-policy', () => ({ checkPassword: vi.fn(() => null) }));
vi.mock('@/lib/rate-limit', () => ({
  callerIp: vi.fn(async () => '127.0.0.1'),
  consumeRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  retryAfterLabel: vi.fn(() => '1 minute'),
}));
vi.mock('@/i18n/navigation', () => ({ redirect: redirectMock }));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn(async () => 'fa') }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));
vi.mock('bcryptjs', () => ({ default: { compare: compareMock, hash: vi.fn(async () => 'hashed') } }));

import { login, register } from './auth';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const signUp = (extra: Record<string, string> = {}) =>
  form({ name: 'Mina', email: 'mina@example.com', password: 'a-long-password-1', ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SIGNUP_COHORTS;
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'user-1',
    email: data.email,
    role: 'USER',
    cohort: data.cohort ?? null,
  }));
});

afterEach(() => {
  delete process.env.SIGNUP_COHORTS;
});

describe('register', () => {
  it('writes USER_SIGNED_UP with locale and a null cohort, then redirects', async () => {
    await expect(register(null, signUp())).rejects.toThrow('NEXT_REDIRECT');

    expect(prismaMock.user.create.mock.calls[0][0].data.cohort).toBeUndefined();
    expect(writeActivityLogMock).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'USER_SIGNED_UP',
      detail: { locale: 'fa', cohort: null },
    });
    expect(redirectMock).toHaveBeenCalledWith({ href: '/dashboard', locale: 'fa' });
  });

  it('stores an allow-listed cohort and logs it', async () => {
    process.env.SIGNUP_COHORTS = ' mentee-nov26 , other_team ';

    await expect(register(null, signUp({ cohort: 'mentee-nov26' }))).rejects.toThrow('NEXT_REDIRECT');

    expect(prismaMock.user.create.mock.calls[0][0].data.cohort).toBe('mentee-nov26');
    expect(writeActivityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_SIGNED_UP', detail: { locale: 'fa', cohort: 'mentee-nov26' } }),
    );
  });

  it.each([
    ['not on the allowlist', 'mentee-nov26', 'someone-else'],
    ['different case', 'mentee-nov26', 'Mentee-Nov26'],
    ['allowlist unset', '', 'mentee-nov26'],
    ['bad shape even if listed', '-bad', '-bad'],
    ['too long even if listed', 'a'.repeat(41), 'a'.repeat(41)],
  ])('ignores the cohort when %s, and still signs the user up', async (_label, allowlist, tag) => {
    if (allowlist) process.env.SIGNUP_COHORTS = allowlist;

    await expect(register(null, signUp({ cohort: tag }))).rejects.toThrow('NEXT_REDIRECT');

    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.create.mock.calls[0][0].data.cohort).toBeUndefined();
    expect(writeActivityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_SIGNED_UP', detail: { locale: 'fa', cohort: null } }),
    );
  });

  it('writes nothing when the account already exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(register(null, signUp())).resolves.toEqual({ error: 'userExists' });
    expect(writeActivityLogMock).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  const signIn = () => form({ email: 'mina@example.com', password: 'a-long-password-1' });

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'mina@example.com',
      passwordHash: 'hashed',
      role: 'USER',
    });
  });

  it('writes USER_SIGNED_IN before the redirect', async () => {
    await expect(login(null, signIn())).rejects.toThrow('NEXT_REDIRECT');

    expect(writeActivityLogMock).toHaveBeenCalledWith({
      userId: 'user-1',
      action: 'USER_SIGNED_IN',
      detail: { locale: 'fa' },
    });
    expect(writeActivityLogMock.mock.invocationCallOrder[0]).toBeLessThan(redirectMock.mock.invocationCallOrder[0]);
  });

  it('writes nothing on a wrong password', async () => {
    compareMock.mockResolvedValueOnce(false);
    await expect(login(null, signIn())).resolves.toEqual({ error: 'invalidCredentials' });
    expect(writeActivityLogMock).not.toHaveBeenCalled();
  });
});
