/**
 * P2-A — OAuth connection CSRF.
 *
 * Any signed-in user can mint a valid /connect link for their OWN workspace.
 * If they send it to a victim and the victim approves on LinkedIn (or LinkedIn
 * auto-approves because the victim consented to Contivo before), the victim's
 * account used to be saved into the attacker's workspace — and the attacker
 * could then post as the victim. A nonce cookie alone does not stop this: the
 * victim's own browser opens /connect, so it holds the cookie. What stops it is
 * the finalize step, checked against the signed-in web session.
 *
 * Run: pnpm --filter @contivo/api test
 */
import 'reflect-metadata';

import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createHandoffToken } from '../src/modules/social/connect-handoff';
import { memoryOAuthStore } from '../src/modules/social/oauth-store';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialOAuthController } from '../src/modules/social/social-oauth.controller';
import { OAUTH_NONCE_COOKIE, SocialOAuthService } from '../src/modules/social/social-oauth.service';

type Row = Record<string, any>;
const ATTACKER = 'user-attacker';
const VICTIM = 'user-victim';

function fakePrisma() {
  const users: Row[] = [
    { id: ATTACKER, clerkId: null, role: 'USER' },
    { id: VICTIM, clerkId: null, role: 'USER' },
  ];
  const workspaces: Row[] = [
    { id: 'ws-attacker', userId: ATTACKER },
    { id: 'ws-victim', userId: VICTIM },
  ];
  const conns: Row[] = [];
  const match = (r: Row, w: Row = {}): boolean =>
    Object.entries(w).every(([k, v]) =>
      k === 'OR' ? (v as Row[]).some((x) => match(r, x)) : r[k] === v,
    );
  return {
    conns,
    user: { findFirst: async ({ where }: any) => users.find((u) => match(u, where)) ?? null },
    workspace: { findFirst: async ({ where }: any) => workspaces.find((w) => match(w, where)) ?? null },
    socialConnection: {
      findFirst: async ({ where }: any) => conns.find((c) => match(c, where)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `conn-${conns.length + 1}`, ...data };
        conns.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(conns.find((c) => c.id === where.id)!, data),
      updateMany: async () => ({ count: 0 }),
    },
  };
}

/** Minimal Express response: records cookies like a browser jar would. */
function fakeRes() {
  const jar: Record<string, string> = {};
  return {
    jar,
    cookie: (name: string, value: string) => { jar[name] = value; },
    clearCookie: (name: string) => { delete jar[name]; },
  };
}
const reqWithCookie = (jar: Record<string, string>) => ({
  headers: {
    cookie: Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '),
  },
});

const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
const ticketOf = (url: string) => new URL(url).searchParams.get('pending')!;

describe('P2-A: OAuth connect is bound to the signed-in web session', () => {
  let saved: Record<string, string | undefined>;
  let prisma: ReturnType<typeof fakePrisma>;
  let ctrl: SocialOAuthController;
  let tokenExchanges: number;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    saved = {};
    const env = {
      OAUTH_STATE_SECRET: 'test-only-state-secret',
      SOCIAL_TOKEN_SECRET: 'test-only-token-secret',
      LINKEDIN_CLIENT_ID: 'cid',
      LINKEDIN_CLIENT_SECRET: 'csecret',
      LINKEDIN_REDIRECT_URI: 'https://api.test/api/v1/social/oauth/linkedin/callback',
      WEB_APP_URL: 'https://web.test',
    };
    for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = v; }

    tokenExchanges = 0;
    // LinkedIn: whoever approves is the VICTIM (the browser owner).
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/oauth/v2/accessToken')) {
        tokenExchanges++;
        return new Response(JSON.stringify({ access_token: 'victim-li-token', expires_in: 3600 }));
      }
      if (String(url).includes('/v2/userinfo')) {
        return new Response(JSON.stringify({ sub: 'li-victim', name: 'Victim' }));
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    prisma = fakePrisma();
    const connections = new SocialConnectionsService(prisma as never);
    const oauth = new SocialOAuthService(connections, prisma as never, memoryOAuthStore());
    ctrl = new SocialOAuthController(oauth, connections);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** Victim's browser opens the link, approves, and lands back on the web app. */
  async function victimOpensLink(handoff: string) {
    const browser = fakeRes();
    const start = await ctrl.initiateOAuth('linkedin', '', browser as never, handoff);
    const back = await ctrl.handleCallback(
      'linkedin', 'code-1', stateOf(start.url), reqWithCookie(browser.jar) as never, fakeRes() as never,
    );
    return back.url;
  }

  it('attacker link opened by the victim connects nothing to the attacker workspace', async () => {
    const attackerLink = createHandoffToken({ userId: ATTACKER, workspaceId: 'ws-attacker' });
    const landing = await victimOpensLink(attackerLink);

    assert.equal(prisma.conns.length, 0, 'callback alone must not save a connection');
    assert.ok(landing.startsWith('https://web.test/connections?pending='));

    // The victim's own web session confirms → refused, ticket destroyed.
    await assert.rejects(ctrl.finalize({ ticket: ticketOf(landing) }, { id: VICTIM }), (e: any) => e?.status === 403);
    // The attacker cannot finalize it afterwards either.
    await assert.rejects(ctrl.finalize({ ticket: ticketOf(landing) }, { id: ATTACKER }), (e: any) => e?.status === 410);

    assert.equal(prisma.conns.length, 0);
  });

  it('the user who started the flow gets the connection (tokens encrypted)', async () => {
    const own = createHandoffToken({ userId: VICTIM, workspaceId: 'ws-victim' });
    const landing = await victimOpensLink(own);
    const out = await ctrl.finalize({ ticket: ticketOf(landing) }, { id: VICTIM });

    assert.deepEqual(out, { platform: 'linkedin', accounts: 1 });
    assert.equal(prisma.conns.length, 1);
    assert.equal(prisma.conns[0].workspaceId, 'ws-victim');
    assert.equal(prisma.conns[0].accountIdentifier, 'li-victim');
    assert.notEqual(prisma.conns[0].encryptedAccessTokenRef, 'victim-li-token');
  });

  it('reconnecting the same account updates its row instead of duplicating it', async () => {
    const own = () => createHandoffToken({ userId: VICTIM, workspaceId: 'ws-victim' });
    await ctrl.finalize({ ticket: ticketOf(await victimOpensLink(own())) }, { id: VICTIM });
    await ctrl.finalize({ ticket: ticketOf(await victimOpensLink(own())) }, { id: VICTIM });
    assert.equal(prisma.conns.length, 1);
  });

  it('callback without the nonce cookie, or with a wrong one, is refused before any code exchange', async () => {
    const browser = fakeRes();
    const start = await ctrl.initiateOAuth('linkedin', '', browser as never,
      createHandoffToken({ userId: VICTIM, workspaceId: 'ws-victim' }));
    assert.ok(browser.jar[OAUTH_NONCE_COOKIE], '/connect sets the nonce cookie');

    await assert.rejects(
      ctrl.handleCallback('linkedin', 'c', stateOf(start.url), reqWithCookie({}) as never, fakeRes() as never),
      (e: any) => e?.status === 400,
    );
    await assert.rejects(
      ctrl.handleCallback('linkedin', 'c', stateOf(start.url),
        reqWithCookie({ [OAUTH_NONCE_COOKIE]: 'not-the-nonce' }) as never, fakeRes() as never),
      (e: any) => e?.status === 400,
    );
    assert.equal(tokenExchanges, 0);
  });

  it('a replayed callback (same state and cookie) is refused', async () => {
    const browser = fakeRes();
    const start = await ctrl.initiateOAuth('linkedin', '', browser as never,
      createHandoffToken({ userId: VICTIM, workspaceId: 'ws-victim' }));
    const req = reqWithCookie({ ...browser.jar });
    await ctrl.handleCallback('linkedin', 'c', stateOf(start.url), req as never, fakeRes() as never);
    await assert.rejects(
      ctrl.handleCallback('linkedin', 'c', stateOf(start.url), req as never, fakeRes() as never),
      (e: any) => e?.status === 400,
    );
    assert.equal(tokenExchanges, 1);
  });
});
