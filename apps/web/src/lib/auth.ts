import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';

import { isUserSuspended } from '@/lib/admin-state';

/**
 * Session signing key.
 *
 * This used to fall back to a hardcoded string in every environment. The repo
 * is public, so on any host where JWT_SECRET was unset, forging an ADMIN
 * session was a copy-paste away. Outside development it is now required, and
 * the app refuses to start rather than signing with a known key.
 */
const JWT_SECRET = (() => {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set. Refusing to sign sessions with a default key.');
  }
  return 'contivo-local-development-only-key';
})();
const encodedKey = new TextEncoder().encode(JWT_SECRET);

export interface SessionPayload {
  userId: string;
  email: string;
  role: 'ADMIN' | 'USER';
}

export async function signToken(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encodedKey);
}

export async function verifyToken(token: string | undefined = '') {
  try {
    if (!token) return null;
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ['HS256'],
    });
    return payload as unknown as SessionPayload;
  } catch (error) {
    return null;
  }
}

export async function createSessionCookie(payload: SessionPayload) {
  const token = await signToken(payload);
  const cookieStore = await cookies();
  
  cookieStore.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function deleteSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete('auth-token');
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth-token')?.value;
  if (!token) return null;
  const session = await verifyToken(token);
  if (!session) return null;

  if (await isUserSuspended(session.userId)) {
    return null;
  }

  return session;
}

/**
 * Mints a bearer token for a server-to-server call to the Nest API.
 *
 * The API verifies this with the same `JWT_SECRET` (see
 * `apps/api/src/modules/auth/guards/session-auth.guard.ts`). Only call this
 * from server actions — the token must never reach the browser, which is
 * exactly why the old Clerk `getToken()` path could not work: the browser had
 * no Clerk session to mint from, so it sent `Bearer null` and got a 401.
 */
export async function mintApiToken(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  return signToken(session);
}
