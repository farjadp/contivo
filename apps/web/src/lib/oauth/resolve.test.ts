import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    oAuthAccount: { findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { OAuthFlowError } from './errors';
import { resolveIdentity, type ProviderIdentity, type ResolveHooks } from './resolve';

const identity: ProviderIdentity = {
  provider: 'google',
  providerAccountId: 'sub-1',
  email: 'mina@example.com',
  emailVerified: true,
  name: 'Mina',
};

let hooks: ResolveHooks;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SIGNUP_COHORTS;
  hooks = {
    beforeCreate: vi.fn(async () => {}),
    beforeKnownSignIn: vi.fn(async () => {}),
    isSuspended: vi.fn(async () => false),
  };
  prismaMock.oAuthAccount.findUnique.mockResolvedValue(null);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.user.create.mockImplementation(async ({ data }: { data: { email: string } }) => ({
    id: 'new-user',
    email: data.email,
    role: 'USER',
  }));
});

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(error).toBeInstanceOf(OAuthFlowError);
  return error as OAuthFlowError;
};

describe('rule 1: known identity', () => {
  it('signs that user in, ignores the email, touches lastUsedAt, charges only the sign-in hook', async () => {
    prismaMock.oAuthAccount.findUnique.mockResolvedValue({
      id: 'link-1',
      user: { id: 'u1', email: 'old@example.com', role: 'ADMIN' },
    });
    const result = await resolveIdentity({ ...identity, email: null, emailVerified: false }, { cohort: null }, hooks);
    expect(result).toEqual({ kind: 'known', user: { id: 'u1', email: 'old@example.com', role: 'ADMIN' } });
    expect(prismaMock.oAuthAccount.update.mock.calls[0][0].data.lastUsedAt).toBeInstanceOf(Date);
    expect(hooks.beforeKnownSignIn).toHaveBeenCalled();
    expect(hooks.beforeCreate).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('refuses a suspended user before anything is touched', async () => {
    prismaMock.oAuthAccount.findUnique.mockResolvedValue({ id: 'l', user: { id: 'u1', email: 'a@b.co', role: 'USER' } });
    (hooks.isSuspended as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    expect((await refusal(resolveIdentity(identity, { cohort: null }, hooks))).code).toBe('suspended');
    expect(prismaMock.oAuthAccount.update).not.toHaveBeenCalled();
  });
});

describe('rule 2: no verified email', () => {
  it.each([
    ['unverified', { emailVerified: false }],
    ['missing', { email: null }],
    ['empty', { email: '  ' }],
  ])('refuses and creates nothing when the email is %s', async (_label, patch) => {
    const error = await refusal(resolveIdentity({ ...identity, ...patch }, { cohort: null }, hooks));
    expect(error.code).toBe('no_verified_email');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(hooks.beforeCreate).not.toHaveBeenCalled();
  });
});

describe('rule 3: create', () => {
  it('creates user + identity in ONE write, role USER, plan FREE, no password, no avatar', async () => {
    const result = await resolveIdentity(
      { ...identity, email: 'Mina@Example.com ' } as ProviderIdentity,
      { cohort: null },
      hooks,
    );
    expect(result.kind).toBe('created');
    expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      email: 'mina@example.com',
      name: 'Mina',
      passwordHash: null,
      role: 'USER',
      plan: 'FREE',
      oauthAccounts: {
        create: { provider: 'GOOGLE', providerAccountId: 'sub-1', email: 'mina@example.com', emailVerified: true },
      },
    });
    expect(data).not.toHaveProperty('avatarUrl');
    expect(data).not.toHaveProperty('cohort');
    expect(hooks.beforeCreate).toHaveBeenCalledTimes(1);
  });

  it('looks the email up case-insensitively', async () => {
    await resolveIdentity(identity, { cohort: null }, hooks);
    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({
      email: { equals: 'mina@example.com', mode: 'insensitive' },
    });
  });

  it('keeps an allow-listed cohort and drops one that is no longer listed', async () => {
    process.env.SIGNUP_COHORTS = 'mentee-nov26';
    await resolveIdentity(identity, { cohort: 'mentee-nov26' }, hooks);
    expect(prismaMock.user.create.mock.calls[0][0].data.cohort).toBe('mentee-nov26');
    delete process.env.SIGNUP_COHORTS;
    await resolveIdentity({ ...identity, providerAccountId: 'sub-2' }, { cohort: 'mentee-nov26' }, hooks);
    expect(prismaMock.user.create.mock.calls[1][0].data).not.toHaveProperty('cohort');
  });

  it('falls back to the email local part when the provider gives no name', async () => {
    await resolveIdentity({ ...identity, name: null }, { cohort: null }, hooks);
    expect(prismaMock.user.create.mock.calls[0][0].data.name).toBe('mina');
  });

  it('does not create when the register bucket refuses', async () => {
    (hooks.beforeCreate as ReturnType<typeof vi.fn>).mockRejectedValue(new OAuthFlowError('rate_limited'));
    expect((await refusal(resolveIdentity(identity, { cohort: null }, hooks))).code).toBe('rate_limited');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe('rule 4: an existing email is always refused', () => {
  it('refuses an existing account (password or not), never signs in, does not charge the register bucket', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'victim' }]);
    const error = await refusal(resolveIdentity(identity, { cohort: null }, hooks));
    expect(error.code).toBe('email_in_use');
    expect(error.userId).toBe('victim');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(hooks.beforeCreate).not.toHaveBeenCalled();
  });

  it('refuses case-variant duplicate rows (more than one match)', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const error = await refusal(resolveIdentity(identity, { cohort: null }, hooks));
    expect(error.code).toBe('email_in_use');
    expect(error.reason).toBe('email_in_use_multiple');
  });

  it('on a unique-violation race: known identity signs in, otherwise refuses', async () => {
    const p2002 = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    prismaMock.user.create.mockRejectedValue(p2002());
    expect((await refusal(resolveIdentity(identity, { cohort: null }, hooks))).reason).toBe('email_in_use_race');

    prismaMock.oAuthAccount.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'l',
      user: { id: 'u9', email: 'mina@example.com', role: 'USER' },
    });
    const result = await resolveIdentity(identity, { cohort: null }, hooks);
    expect(result).toMatchObject({ kind: 'known', user: { id: 'u9' } });
  });

  it('rethrows other database errors instead of pretending', async () => {
    prismaMock.user.create.mockRejectedValue(new Error('connection lost'));
    await expect(resolveIdentity(identity, { cohort: null }, hooks)).rejects.toThrow('connection lost');
  });
});
