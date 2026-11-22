/**
 * Account resolution for a verified provider identity (spec §5, rules 1-4).
 *
 * 1. Known identity -> that user. Email changes at the provider are ignored.
 * 2. Unknown identity without a verified email -> refuse, create nothing.
 * 3. Unknown identity, verified email, nobody has that email -> create the user
 *    and the identity together, in one write.
 * 4. Unknown identity, any user already has that email (any case) -> refuse.
 *    Never sign in, never merge: passwords are not email-verified here, so an
 *    email match proves nothing. Linking is a signed-in action in Settings.
 *
 * Role, plan and cohort come from us, never from the provider's claims.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { allowedCohort } from '@/lib/signup-cohort';

import { OAuthFlowError } from './errors';
import { PROVIDER_ENUM, type OAuthProviderId } from './providers';

export interface ProviderIdentity {
  provider: OAuthProviderId;
  /** Stable id at the provider (Google `sub`). */
  providerAccountId: string;
  /** Lower-cased and trimmed, or null. */
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface ResolvedUser {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
}

export type Resolution =
  | { kind: 'known'; user: ResolvedUser }
  | { kind: 'created'; user: ResolvedUser };

export interface ResolveHooks {
  /** Called only once an account is certain to be created; throws to refuse (rate limit). */
  beforeCreate: () => Promise<void>;
  /** Called for a known identity before it signs in; throws to refuse. */
  beforeKnownSignIn: (user: ResolvedUser) => Promise<void>;
  isSuspended: (userId: string) => Promise<boolean>;
}

const USER_SELECT = { id: true, email: true, role: true } as const;

function displayName(identity: ProviderIdentity): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = (identity.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  if (cleaned) return cleaned;
  return (identity.email ?? '').split('@')[0].slice(0, 100) || 'Contivo user';
}

async function findKnown(identity: ProviderIdentity) {
  return prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: PROVIDER_ENUM[identity.provider],
        providerAccountId: identity.providerAccountId,
      },
    },
    select: { id: true, user: { select: USER_SELECT } },
  });
}

async function signInKnown(
  known: NonNullable<Awaited<ReturnType<typeof findKnown>>>,
  hooks: ResolveHooks,
): Promise<Resolution> {
  if (await hooks.isSuspended(known.user.id)) {
    throw new OAuthFlowError('suspended', 'suspended', known.user.id);
  }
  await hooks.beforeKnownSignIn(known.user);
  await prisma.oAuthAccount.update({ where: { id: known.id }, data: { lastUsedAt: new Date() } });
  return { kind: 'known', user: known.user };
}

export async function resolveIdentity(
  identity: ProviderIdentity,
  ctx: { cohort: string | null },
  hooks: ResolveHooks,
): Promise<Resolution> {
  // Rule 1
  const known = await findKnown(identity);
  if (known) return signInKnown(known, hooks);

  // Rule 2
  const email = identity.email?.trim().toLowerCase() ?? '';
  if (!identity.emailVerified || !email) {
    throw new OAuthFlowError('no_verified_email', 'no_verified_email');
  }

  // Rule 4: ANY user with this email, in any letter case, even more than one.
  const holders = await prisma.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
    take: 2,
  });
  if (holders.length > 0) {
    throw new OAuthFlowError('email_in_use', holders.length > 1 ? 'email_in_use_multiple' : 'email_in_use', holders[0].id);
  }

  // Rule 3
  await hooks.beforeCreate();
  // The tx may be old; the allowlist is checked again now.
  const cohort = allowedCohort(ctx.cohort);
  try {
    const user = await prisma.user.create({
      data: {
        email,
        name: displayName(identity),
        passwordHash: null,
        role: 'USER',
        plan: 'FREE',
        ...(cohort ? { cohort } : {}),
        oauthAccounts: {
          create: {
            provider: PROVIDER_ENUM[identity.provider],
            providerAccountId: identity.providerAccountId,
            email,
            emailVerified: true,
            lastUsedAt: new Date(),
          },
        },
      },
      select: USER_SELECT,
    });
    return { kind: 'created', user };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Lost a race. Same identity created a moment ago: treat as known.
      // Anything else (the email was taken meanwhile): refuse.
      const raced = await findKnown(identity);
      if (raced) return signInKnown(raced, hooks);
      throw new OAuthFlowError('email_in_use', 'email_in_use_race');
    }
    throw error;
  }
}
