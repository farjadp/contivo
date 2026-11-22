import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Start + callback end to end. Mocked at the boundary: Prisma, the rate-limit
// store, the session cookie, activity log, credits, and global fetch (Google's
// token endpoint and JWKS). jose runs for real.

const mocks = vi.hoisted(() => ({
  prisma: {
    oAuthAccount: { findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
  },
  writeActivityLog: vi.fn(async (_entry: { userId: string; action: string; detail?: unknown }) => {}),
  createSessionCookie: vi.fn(async (_p: { userId: string; email: string; role: string }) => {}),
  isUserSuspended: vi.fn(async (_id: string) => false),
  ensureWelcomeCredits: vi.fn(async (_id: string) => {}),
  consumeRateLimit: vi.fn(async (_key: string, _limit: number, _windowMs: number) => ({
    allowed: true,
    remaining: 1,
    retryAfter: 0,
  })),
}));

vi.mock('@/lib/db', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: mocks.writeActivityLog }));
vi.mock('@/lib/auth', () => ({ createSessionCookie: mocks.createSessionCookie }));
vi.mock('@/lib/admin-state', () => ({ isUserSuspended: mocks.isUserSuspended }));
vi.mock('@/lib/credits', () => ({ ensureWelcomeCredits: mocks.ensureWelcomeCredits }));
vi.mock('@/lib/rate-limit', () => ({
  callerIp: vi.fn(async () => '203.0.113.7'),
  consumeRateLimit: mocks.consumeRateLimit,
}));

import { resetGoogleKeysForTests } from './google';
import { handleCallback } from './callback';
import { handleStart } from './start';
import { sealTx } from './tx';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const APP = 'https://www.contivo.test';

let privateKey: CryptoKey;
let jwk: JWK;
let tokenInit: RequestInit | undefined;
let tokenRequests: Array<{ url: string; body: URLSearchParams }>;
let jwksStatus = 200;
let usedJti: Set<string>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
});

async function idToken(over: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const claims: Record<string, unknown> = {
    sub: 'google-sub-1',
    email: 'Mina@Example.com',
    email_verified: true,
    name: 'Mina Rad',
    azp: CLIENT_ID,
    nonce: 'PLACEHOLDER',
    ...over,
  };
  const jwt = new SignJWT(claims as Record<string, never>)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1', ...header })
    .setIssuer((over.iss as string) ?? 'https://accounts.google.com')
    .setAudience((over.aud as string) ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime((over.exp as number) ?? '1h');
  // iss/aud/exp are set via the setters, drop them from the free-form claims
  return jwt.sign(privateKey);
}

/** What Google "returns" for the next code exchange. */
let nextIdToken: (nonce: string) => Promise<string>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GOOGLE_CLIENT_ID', CLIENT_ID);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP);
  vi.stubEnv('SIGNUP_COHORTS', 'mentee-nov26');
  resetGoogleKeysForTests();
  jwksStatus = 200;
  usedJti = new Set();
  tokenRequests = [];
  nextIdToken = (nonce) => idToken({ nonce });

  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 1, retryAfter: 0 });
  mocks.isUserSuspended.mockResolvedValue(false);
  mocks.prisma.oAuthAccount.findUnique.mockResolvedValue(null);
  mocks.prisma.user.findMany.mockResolvedValue([]);
  mocks.prisma.user.create.mockImplementation(async ({ data }: { data: { email: string } }) => ({
    id: 'new-user',
    email: data.email,
    role: 'USER',
  }));
  mocks.prisma.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, jti: string) => {
    if (!strings.join('').includes('INSERT INTO oauth_tx_used')) return 0;
    if (usedJti.has(jti)) return 0;
    usedJti.add(jti);
    return 1;
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const url = req ? req.url : String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const raw = req ? await req.clone().text() : String(init?.body ?? '');
        const body = new URLSearchParams(raw);
        tokenInit = init;
        tokenRequests.push({ url, body });
        const nonce = lastNonce;
        return new Response(
          JSON.stringify({
            access_token: 'ACCESS-TOKEN-SECRET',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: await nextIdToken(nonce),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.startsWith('https://www.googleapis.com/oauth2/v3/certs')) {
        if (jwksStatus !== 200) return new Response('nope', { status: jwksStatus });
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

let lastNonce = '';

function startReq(provider: string, query: Record<string, string> = {}) {
  const url = new URL(`http://evil.example/api/auth/oauth/${provider}/start`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

/** Run start, return the sealed cookie, the state and the PKCE data the provider URL carried. */
async function begin(query: Record<string, string> = {}) {
  const res = await handleStart(startReq('google', query), 'google');
  expect([302, 307]).toContain(res.status);
  const location = new URL(res.headers.get('location')!);
  const cookie = res.cookies.get('oauth_tx')!.value;
  lastNonce = location.searchParams.get('nonce')!;
  return { res, location, cookie, state: location.searchParams.get('state')! };
}

function cbReq(opts: { cookie?: string; state?: string; code?: string; error?: string; provider?: string }) {
  const url = new URL(`http://evil.example/api/auth/oauth/${opts.provider ?? 'google'}/callback`);
  if (opts.state !== undefined) url.searchParams.set('state', opts.state);
  if (opts.code !== undefined) url.searchParams.set('code', opts.code);
  if (opts.error !== undefined) url.searchParams.set('error', opts.error);
  return new NextRequest(url, { headers: opts.cookie ? { cookie: `oauth_tx=${opts.cookie}` } : {} });
}

const callback = (req: NextRequest, provider = 'google') => handleCallback(req, provider);
const loc = (res: Response) => new URL(res.headers.get('location')!);
const setCookies = (res: Response) => res.headers.getSetCookie();

describe('start', () => {
  it('is 404 when the provider has no env, for facebook, and for github (phase 1)', async () => {
    expect((await handleStart(startReq('facebook'), 'facebook')).status).toBe(404);
    expect((await handleStart(startReq('github'), 'github')).status).toBe(404);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    expect((await handleStart(startReq('google'), 'google')).status).toBe(404);
    expect((await handleCallback(cbReq({}), 'google')).status).toBe(404);
    expect((await handleCallback(cbReq({ provider: 'facebook' }), 'facebook')).status).toBe(404);
  });

  it('builds the Google URL with PKCE S256, state, nonce, minimal scopes, account chooser, our redirect_uri', async () => {
    const { location, res } = await begin({ locale: 'fa' });
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = location.searchParams;
    expect(q.get('response_type')).toBe('code');
    expect(q.get('client_id')).toBe(CLIENT_ID);
    expect(q.get('redirect_uri')).toBe(`${APP}/api/auth/oauth/google/callback`);
    expect(q.get('scope')).toBe('openid email profile');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('prompt')).toBe('select_account');
    expect(q.has('access_type')).toBe(false);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sets the encrypted tx cookie HttpOnly, Lax, Path=/, with no Domain', async () => {
    const { res } = await begin();
    const header = setCookies(res).find((c) => c.startsWith('oauth_tx='))!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/Max-Age=600/);
    expect(header).not.toMatch(/Domain=/i);
  });

  it('uses the __Host- cookie name and Secure in production (from NODE_ENV)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'a-production-secret-for-the-test');
    const res = await handleStart(startReq('google'), 'google');
    const header = setCookies(res).find((c) => c.startsWith('__Host-oauth_tx='))!;
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/Path=\//);
  });

  it('never builds redirects from the request origin', async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 5 });
    const res = await handleStart(startReq('google', { locale: 'fa' }), 'google');
    expect(res.headers.get('location')).toBe(`${APP}/fa/sign-in?error=rate_limited`);
    expect(res.cookies.get('oauth_tx')).toBeUndefined();
  });

  it('rate limits per IP', async () => {
    await begin();
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith('oauth:start:ip:203.0.113.7', 30, 15 * 60_000);
  });

  it('drops an unknown locale to the default, never errors', async () => {
    const { cookie } = await begin({ locale: '../../evil' });
    const res = await callback(cbReq({ cookie, state: 'wrong' }));
    expect(loc(res).pathname).toBe('/en/sign-in');
  });
});

describe('callback: transaction integrity', () => {
  it('refuses a missing cookie', async () => {
    const { state } = await begin();
    const res = await callback(cbReq({ state, code: 'c' }));
    expect(loc(res).search).toBe('?error=invalid_state');
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
    expect(tokenRequests).toHaveLength(0);
  });

  it('refuses a wrong or missing state', async () => {
    const { cookie } = await begin();
    for (const state of ['not-the-state', '', undefined]) {
      const res = await callback(cbReq({ cookie, state, code: 'c' }));
      expect(loc(res).search).toBe('?error=invalid_state');
    }
    expect(tokenRequests).toHaveLength(0);
  });

  it('refuses a flipped byte in the cookie', async () => {
    const { cookie, state } = await begin();
    const parts = cookie.split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[ct.length - 1] ^= 0xff;
    parts[3] = ct.toString('base64url');
    const res = await callback(cbReq({ cookie: parts.join('.'), state, code: 'c' }));
    expect(loc(res).search).toBe('?error=invalid_state');
  });

  it('refuses an expired transaction', async () => {
    const cookie = await sealTx({
      provider: 'google', state: 'st', verifier: 'v', nonce: 'n', locale: 'fa', cohort: null, site: null,
      exp: Math.floor(Date.now() / 1000) - 5,
    });
    const res = await callback(cbReq({ cookie, state: 'st', code: 'c' }));
    expect(loc(res).search).toBe('?error=invalid_state');
  });

  it('refuses a cookie sealed for another provider', async () => {
    const cookie = await sealTx({
      provider: 'github', state: 'st', verifier: 'v', nonce: 'n', locale: 'en', cohort: null, site: null,
    });
    const res = await callback(cbReq({ cookie, state: 'st', code: 'c' }));
    expect(loc(res).search).toBe('?error=invalid_state');
  });

  it('refuses the second use of the same transaction (replay)', async () => {
    const { cookie, state } = await begin();
    const first = await callback(cbReq({ cookie, state, code: 'c' }));
    expect(loc(first).pathname).toBe('/en/dashboard');
    const replay = await callback(cbReq({ cookie, state, code: 'c' }));
    expect(loc(replay).search).toBe('?error=invalid_state');
    expect(mocks.createSessionCookie).toHaveBeenCalledTimes(1);
    expect(tokenRequests).toHaveLength(1);
  });

  it('refuses when the single-use insert errors (fail closed)', async () => {
    const { cookie, state } = await begin();
    mocks.prisma.$executeRaw.mockRejectedValue(new Error('db down'));
    const res = await callback(cbReq({ cookie, state, code: 'c' }));
    expect(loc(res).search).toBe('?error=invalid_state');
    expect(tokenRequests).toHaveLength(0);
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it('always deletes the tx cookie, on refusal and on success', async () => {
    const bad = await callback(cbReq({ cookie: 'junk', state: 'x' }));
    expect(setCookies(bad).some((c) => /^oauth_tx=;/.test(c) && /Expires=Thu, 01 Jan 1970/i.test(c))).toBe(true);
    const { cookie, state } = await begin();
    const ok = await callback(cbReq({ cookie, state, code: 'c' }));
    expect(setCookies(ok).some((c) => /^oauth_tx=;/.test(c) && /Expires=Thu, 01 Jan 1970/i.test(c))).toBe(true);
  });

  it('sends no-store and no-referrer', async () => {
    const res = await callback(cbReq({ cookie: 'junk' }));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

describe('callback: provider answers', () => {
  it('maps access_denied to cancelled and any other provider error to provider_error, without exchanging', async () => {
    let t = await begin({ locale: 'fa' });
    let res = await callback(cbReq({ cookie: t.cookie, state: t.state, error: 'access_denied' }));
    expect(res.headers.get('location')).toBe(`${APP}/fa/sign-in?error=cancelled`);
    t = await begin();
    res = await callback(cbReq({ cookie: t.cookie, state: t.state, error: '<script>alert(1)</script>' }));
    expect(res.headers.get('location')).toBe(`${APP}/en/sign-in?error=provider_error`);
    expect(res.headers.get('location')).not.toContain('script');
    expect(tokenRequests).toHaveLength(0);
  });

  it('sends the PKCE verifier from the tx and the code to Google, with our redirect_uri', async () => {
    const t = await begin();
    await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'auth-code-1' }));
    expect(tokenRequests).toHaveLength(1);
    const body = tokenRequests[0].body;
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-1');
    expect(body.get('redirect_uri')).toBe(`${APP}/api/auth/oauth/google/callback`);
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('client_secret')).toBe('test-secret');
    expect([...body.keys()].sort()).toEqual(
      ['client_id', 'client_secret', 'code', 'code_verifier', 'grant_type', 'redirect_uri'],
    );
    expect(tokenInit?.method).toBe('POST');
    expect(tokenInit?.redirect).toBe('manual');
    expect(tokenInit?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(tokenInit?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    // The verifier hashes to the challenge that was sent to Google at start.
    const { createHash } = await import('node:crypto');
    const challenge = createHash('sha256').update(body.get('code_verifier')!).digest('base64url');
    expect(challenge).toBe(t.location.searchParams.get('code_challenge'));
  });

  it('refuses with provider_error when there is no code', async () => {
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state }));
    expect(loc(res).search).toBe('?error=provider_error');
  });
});

describe('callback: id_token checks (each refuses, nothing is created, no session)', () => {
  const cases: Array<[string, (nonce: string) => Promise<string>]> = [
    ['nonce mismatch', () => idToken({ nonce: 'someone-elses-nonce' })],
    ['missing nonce', () => idToken({ nonce: undefined })],
    ['wrong audience', (nonce) => idToken({ nonce, aud: 'another-client' })],
    ['wrong issuer', (nonce) => idToken({ nonce, iss: 'https://evil.example' })],
    ['wrong azp', (nonce) => idToken({ nonce, azp: 'another-client' })],
    ['expired', (nonce) => idToken({ nonce, exp: Math.floor(Date.now() / 1000) - 3600 })],
    ['signed by another key', async (nonce) => {
      const other = await generateKeyPair('RS256');
      return new SignJWT({ sub: 's', nonce, email: 'a@b.co', email_verified: true, azp: CLIENT_ID })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('https://accounts.google.com').setAudience(CLIENT_ID).setIssuedAt().setExpirationTime('1h')
        .sign(other.privateKey);
    }],
    ['alg none', async (nonce) => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      return `${b64({ alg: 'none' })}.${b64({ sub: 's', nonce, iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: 9999999999 })}.`;
    }],
  ];

  it.each(cases)('%s', async (_name, make) => {
    nextIdToken = make;
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=provider_error');
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it('accepts the bare accounts.google.com issuer form', async () => {
    nextIdToken = (nonce) => idToken({ nonce, iss: 'accounts.google.com' });
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).pathname).toBe('/en/dashboard');
  });

  it.each([
    ['email_verified false', false],
    ['email_verified the string "true"', 'true'],
    ['email_verified 1', 1],
    ['email_verified absent', undefined],
  ])('%s -> no_verified_email, nothing created', async (_n, value) => {
    nextIdToken = (nonce) => idToken({ nonce, email_verified: value });
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=no_verified_email');
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it('no email claim at all -> no_verified_email, nothing created', async () => {
    nextIdToken = (nonce) => idToken({ nonce, email: undefined });
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=no_verified_email');
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it('fails closed when the JWKS cannot be fetched', async () => {
    jwksStatus = 503;
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=provider_error');
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it.each([
    ['a redirect', () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })],
    ['non-JSON', () => new Response('<html>oops SECRET-TEXT</html>', { status: 200 })],
    ['no id_token', () => new Response(JSON.stringify({ access_token: 'x' }), { status: 200 })],
    ['an oversized body', () => new Response('x'.repeat(70 * 1024), { status: 200 })],
  ])('refuses a token response that is %s, without logging its text', async (_n, make) => {
    const t = await begin();
    vi.stubGlobal('fetch', vi.fn(async () => make()));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=provider_error');
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/SECRET-TEXT|evil/);
    spy.mockRestore();
  });

  it('fails closed when the token endpoint rejects the code', async () => {
    const t = await begin();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'bad' }));
    expect(loc(res).search).toBe('?error=provider_error');
  });
});

describe('callback: account resolution end to end', () => {
  it('creates a new account, signs in as USER whatever the token claims, logs USER_SIGNED_UP, charges the register bucket once', async () => {
    nextIdToken = (nonce) => idToken({ nonce, role: 'ADMIN', plan: 'ENTERPRISE' });
    const t = await begin({ locale: 'fa' });
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));

    expect(res.headers.get('location')).toBe(`${APP}/fa/dashboard`);
    const data = mocks.prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: 'mina@example.com', role: 'USER', plan: 'FREE', passwordHash: null });
    expect(data).not.toHaveProperty('avatarUrl');
    expect(mocks.createSessionCookie).toHaveBeenCalledWith({ userId: 'new-user', email: 'mina@example.com', role: 'USER' });
    expect(mocks.ensureWelcomeCredits).toHaveBeenCalledWith('new-user');
    expect(mocks.writeActivityLog).toHaveBeenCalledWith({
      userId: 'new-user',
      action: 'USER_SIGNED_UP',
      detail: { locale: 'fa', cohort: null, provider: 'google', method: 'oauth' },
    });
    const keys = mocks.consumeRateLimit.mock.calls.map((c) => c[0]);
    expect(keys.filter((k) => k === 'register:ip:203.0.113.7')).toHaveLength(1);
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith('register:ip:203.0.113.7', 5, 60 * 60_000);
    expect(keys.some((k) => String(k).startsWith('login:ip:'))).toBe(false);
  });

  it('signs a known identity in with the role from the DB row, uses the login bucket, not the register bucket', async () => {
    mocks.prisma.oAuthAccount.findUnique.mockResolvedValue({
      id: 'l1',
      user: { id: 'admin-1', email: 'boss@example.com', role: 'ADMIN' },
    });
    const t = await begin({ locale: 'fa' });
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(res.headers.get('location')).toBe(`${APP}/fa/admin`);
    expect(mocks.createSessionCookie).toHaveBeenCalledWith({ userId: 'admin-1', email: 'boss@example.com', role: 'ADMIN' });
    expect(mocks.writeActivityLog).toHaveBeenCalledWith({
      userId: 'admin-1',
      action: 'USER_SIGNED_IN',
      detail: { locale: 'fa', provider: 'google', method: 'oauth' },
    });
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith('login:ip:203.0.113.7', 40, 15 * 60_000);
    expect(mocks.consumeRateLimit.mock.calls.some((c) => String(c[0]).startsWith('register:'))).toBe(false);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.ensureWelcomeCredits).toHaveBeenCalledWith('admin-1');
  });

  it('refuses an existing password account with the same email: no session cookie, no account, logged without the email', async () => {
    mocks.prisma.user.findMany.mockResolvedValue([{ id: 'victim' }]);
    const t = await begin({ locale: 'fa' });
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(res.headers.get('location')).toBe(`${APP}/fa/sign-in?error=email_in_use`);
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(setCookies(res).some((c) => c.startsWith('auth-token='))).toBe(false);
    expect(mocks.writeActivityLog).toHaveBeenCalledWith({
      userId: 'victim',
      action: 'OAUTH_LOGIN_REFUSED',
      detail: { provider: 'google', reason: 'email_in_use' },
    });
    expect(JSON.stringify(mocks.writeActivityLog.mock.calls)).not.toMatch(/example\.com/);
    expect(mocks.consumeRateLimit.mock.calls.some((c) => String(c[0]).startsWith('register:'))).toBe(false);
  });

  it('refuses when case-variant duplicate rows match', async () => {
    mocks.prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=email_in_use');
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it('refuses a suspended user', async () => {
    mocks.prisma.oAuthAccount.findUnique.mockResolvedValue({ id: 'l', user: { id: 'u', email: 'a@b.co', role: 'USER' } });
    mocks.isUserSuspended.mockResolvedValue(true);
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=suspended');
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
  });

  it('maps a full register bucket to rate_limited and creates nothing', async () => {
    mocks.consumeRateLimit.mockImplementation(async (key: string, _l: number, _w: number) => ({
      allowed: !String(key).startsWith('register:'),
      remaining: 0,
      retryAfter: 30,
    }));
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=rate_limited');
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it('turns an unexpected database error into provider_error, not a healthy-looking success', async () => {
    mocks.prisma.user.create.mockRejectedValue(new Error('connection lost: mina@example.com'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = await begin();
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(loc(res).search).toBe('?error=provider_error');
    expect(mocks.createSessionCookie).not.toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/mina@example|ACCESS-TOKEN/);
    spy.mockRestore();
  });
});

describe('cohort, site, locale round trips', () => {
  it('stores an allow-listed cohort and logs it', async () => {
    const t = await begin({ cohort: 'mentee-nov26' });
    await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(mocks.prisma.user.create.mock.calls[0][0].data.cohort).toBe('mentee-nov26');
    expect(mocks.writeActivityLog.mock.calls.find((c) => c[0].action === 'USER_SIGNED_UP')?.[0]).toMatchObject({
      detail: { cohort: 'mentee-nov26' },
    });
  });

  it('drops a cohort that is not on the allowlist, at start', async () => {
    const t = await begin({ cohort: 'made-up' });
    await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    expect(mocks.prisma.user.create.mock.calls[0][0].data).not.toHaveProperty('cohort');
  });

  it('sets the intake-site cookie (readable by JS, not HttpOnly) for a valid site', async () => {
    const t = await begin({ site: 'Example.com/shop' });
    const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
    const header = setCookies(res).find((c) => c.startsWith('contivo_intake_site='))!;
    expect(decodeURIComponent(header.split(';')[0].split('=')[1])).toBe('https://example.com/shop');
    expect(header).not.toMatch(/HttpOnly/i);
    expect(header).toMatch(/Max-Age=86400/);
    expect(header).toMatch(/Path=\//);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/Secure/i);
  });

  it('drops garbage sites and does not set the cookie', async () => {
    for (const site of ['javascript:alert(1)', 'nodots', 'x'.repeat(300), '//evil']) {
      const t = await begin({ site });
      const res = await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }));
      expect(setCookies(res).some((c) => c.startsWith('contivo_intake_site='))).toBe(false);
      expect(loc(res).origin).toBe(APP);
    }
  });

  it('preserves the fa locale on success and on errors', async () => {
    let t = await begin({ locale: 'fa' });
    expect(loc(await callback(cbReq({ cookie: t.cookie, state: t.state, code: 'c' }))).pathname).toBe('/fa/dashboard');
    t = await begin({ locale: 'fa' });
    expect(loc(await callback(cbReq({ cookie: t.cookie, state: t.state, error: 'access_denied' }))).pathname).toBe('/fa/sign-in');
  });
});
