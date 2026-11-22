/**
 * validateConnection must tell an expired/revoked token apart from a network
 * blip: before this, any thrown error marked a healthy account EXPIRED.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { LinkedInAdapter } from '../src/modules/social/adapters/linkedin.adapter';
import { XAdapter } from '../src/modules/social/adapters/x.adapter';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body = '{}', headers: Record<string, string> = {}) {
  globalThis.fetch = (async () => new Response(body, { status, headers })) as typeof fetch;
}

function dnsFailure() {
  globalThis.fetch = (async () => {
    const err = new TypeError('fetch failed');
    (err as any).cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.linkedin.com'), { code: 'ENOTFOUND' });
    throw err;
  }) as typeof fetch;
}

const conn = { id: 'c1', platform: 'LINKEDIN' as const, accountIdentifier: 'abc', accessToken: 't' };

for (const [name, make] of [
  ['LinkedIn', () => new LinkedInAdapter()],
  ['X', () => new XAdapter()],
] as const) {
  describe(`${name} validateConnection → ConnectionHealth`, () => {
    it('200 → ok', async () => {
      respond(200);
      assert.deepEqual(await make().validateConnection(conn), { ok: true });
    });
    it('401 → expired', async () => {
      respond(401, '{"message":"Invalid access token"}');
      const h = await make().validateConnection(conn);
      assert.equal(h.ok, false);
      assert.equal(!h.ok && h.reason, 'expired');
    });
    it('403 → revoked', async () => {
      respond(403);
      const h = await make().validateConnection(conn);
      assert.equal(!h.ok && h.reason, 'revoked');
    });
    it('500 → transient', async () => {
      respond(500);
      const h = await make().validateConnection(conn);
      assert.equal(!h.ok && h.reason, 'transient');
    });
    it('429 → transient with retryAfterSec', async () => {
      respond(429, '{}', { 'retry-after': '30' });
      const h = await make().validateConnection(conn);
      assert.equal(!h.ok && h.reason, 'transient');
      assert.equal(!h.ok && h.retryAfterSec, 30);
    });
    it('DNS failure → transient, never expired', async () => {
      dnsFailure();
      const h = await make().validateConnection(conn);
      assert.equal(!h.ok && h.reason, 'transient');
    });
  });
}

describe('publish failures carry retryable', () => {
  it('LinkedIn 429 is retryable', async () => {
    respond(429, '{"message":"slow down"}', { 'retry-after': '12' });
    const r = await new LinkedInAdapter().publish(conn, { body: 'hello' });
    assert.equal(r.success, false);
    assert.equal(r.retryable, true);
    assert.equal(r.retryAfterSec, 12);
  });
  it('LinkedIn DNS failure is retryable (request never left)', async () => {
    dnsFailure();
    const r = await new LinkedInAdapter().publish(conn, { body: 'hello' });
    assert.equal(r.retryable, true);
  });
  it('LinkedIn 500 is NOT retried automatically (the post may exist)', async () => {
    respond(500, 'boom');
    const r = await new LinkedInAdapter().publish(conn, { body: 'hello' });
    assert.equal(r.success, false);
    assert.equal(r.retryable, false);
  });
  it('429 carries RATE_LIMITED, 402 CREDITS_EXHAUSTED, network UNREACHABLE', async () => {
    respond(429, '{}');
    assert.equal((await new XAdapter().publish(conn, { body: 'hi' })).failureCode, 'RATE_LIMITED');
    respond(402, '{"title":"CreditsDepleted"}');
    const credits = await new XAdapter().publish(conn, { body: 'hi' });
    assert.equal(credits.failureCode, 'CREDITS_EXHAUSTED');
    assert.equal(credits.retryable, false);
    dnsFailure();
    assert.equal((await new XAdapter().publish(conn, { body: 'hi' })).failureCode, 'UNREACHABLE');
  });
  it('LinkedIn 422 is a permanent failure', async () => {
    respond(422, '{"message":"duplicate"}');
    const r = await new LinkedInAdapter().publish(conn, { body: 'hello' });
    assert.equal(r.retryable, false);
  });
});

describe('X refreshToken', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const xConn = { ...conn, platform: 'X' as const, refreshToken: 'r-old' };

  it('posts a refresh_token grant to api.x.com with Basic auth and returns both tokens', async () => {
    process.env.TWITTER_CLIENT_ID = 'cid';
    process.env.TWITTER_CLIENT_SECRET = 'csecret';
    let seen: { url: string; init: RequestInit } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ access_token: 'a-new', refresh_token: 'r-new', expires_in: 7200 }), { status: 200 });
    }) as typeof fetch;
    const r = await new XAdapter().refreshToken!(xConn);
    assert.equal(seen!.url, 'https://api.x.com/2/oauth2/token');
    assert.equal((seen!.init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    const body = new URLSearchParams(String(seen!.init.body));
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'r-old');
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.accessToken, 'a-new');
    assert.equal(r.ok && r.refreshToken, 'r-new');
    assert.ok(r.ok && r.expiresAt && r.expiresAt.getTime() > Date.now() + 7000_000);
  });

  it('400 invalid_request → expired', async () => {
    process.env.TWITTER_CLIENT_ID = 'cid';
    process.env.TWITTER_CLIENT_SECRET = 'csecret';
    respond(400, '{"error":"invalid_request"}');
    const r = await new XAdapter().refreshToken!(xConn);
    assert.equal(!r.ok && r.reason, 'expired');
  });

  it('network failure → transient', async () => {
    process.env.TWITTER_CLIENT_ID = 'cid';
    process.env.TWITTER_CLIENT_SECRET = 'csecret';
    dnsFailure();
    const r = await new XAdapter().refreshToken!(xConn);
    assert.equal(!r.ok && r.reason, 'transient');
  });

  it('missing client credentials is our fault → transient, not the user being expired', async () => {
    delete process.env.TWITTER_CLIENT_ID;
    delete process.env.TWITTER_CLIENT_SECRET;
    const r = await new XAdapter().refreshToken!(xConn);
    assert.equal(!r.ok && r.reason, 'transient');
  });
});
