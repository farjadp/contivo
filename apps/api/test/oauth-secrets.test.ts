/**
 * Run: pnpm --filter @contivo/api test
 */
import 'reflect-metadata';

import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { verifyHandoffToken, createHandoffToken } from '../src/modules/social/connect-handoff';
import { getOAuthStateSecret } from '../src/modules/social/oauth-state-secret';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialOAuthService } from '../src/modules/social/social-oauth.service';

const STATE_SECRET = 'test-only-state-secret';

/** Mirrors apps/web/src/app/actions/social-connect.ts (the side that signs). */
function webSignedHandoff(secret: string, userId: string, workspaceId: string): string {
  const body = Buffer.from(
    JSON.stringify({ userId, workspaceId, exp: Date.now() + 5 * 60 * 1000 }),
    'utf8',
  ).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

describe('OAUTH_STATE_SECRET', () => {
  let saved: { state?: string; token?: string };
  beforeEach(() => {
    saved = { state: process.env.OAUTH_STATE_SECRET, token: process.env.SOCIAL_TOKEN_SECRET };
    process.env.OAUTH_STATE_SECRET = STATE_SECRET;
    process.env.SOCIAL_TOKEN_SECRET = 'test-only-token-secret';
  });
  afterEach(() => {
    for (const [k, v] of [['OAUTH_STATE_SECRET', saved.state], ['SOCIAL_TOKEN_SECRET', saved.token]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('throws naming the variable when unset or empty', () => {
    delete process.env.OAUTH_STATE_SECRET;
    assert.throws(() => getOAuthStateSecret(), /OAUTH_STATE_SECRET/);
    assert.throws(() => createHandoffToken({ userId: 'u', workspaceId: 'w' }), /OAUTH_STATE_SECRET/);
    process.env.OAUTH_STATE_SECRET = '';
    assert.throws(() => getOAuthStateSecret(), /OAUTH_STATE_SECRET/);
  });

  it('a web-signed handoff token verifies on the API with the same secret', () => {
    const token = webSignedHandoff(STATE_SECRET, 'user-1', 'ws-1');
    assert.deepEqual(verifyHandoffToken(token), { userId: 'user-1', workspaceId: 'ws-1' });
  });

  it('a handoff token signed with the old public fallback is rejected', () => {
    const forged = webSignedHandoff('contivo-oauth-state-secret', 'victim', 'ws-1');
    assert.equal(verifyHandoffToken(forged), null);
  });

  it('OAuth state built by the API verifies on the API, and tamper fails', () => {
    const svc = new SocialOAuthService({} as never, {} as never, {} as never) as unknown as {
      buildState(ctx: Record<string, string>, extra?: Record<string, string>): string;
      verifyState(s: string): Record<string, unknown>;
    };
    const state = svc.buildState({ workspaceId: 'ws-1', userId: 'u', platform: 'x', nonce: 'n' }, { codeVerifier: 'v' });
    const payload = svc.verifyState(state);
    assert.equal(payload.workspaceId, 'ws-1');
    assert.equal(payload.codeVerifier, 'v');

    const bytes = Buffer.from(state, 'base64url');
    bytes[bytes.length - 1] ^= 0x01;
    assert.throws(() => svc.verifyState(bytes.toString('base64url')), /Invalid OAuth state/);
  });

  it('services refuse to construct without their secrets (startup check)', () => {
    delete process.env.OAUTH_STATE_SECRET;
    assert.throws(() => new SocialOAuthService({} as never, {} as never, {} as never), /OAUTH_STATE_SECRET/);
    delete process.env.SOCIAL_TOKEN_SECRET;
    assert.throws(() => new SocialConnectionsService({} as never), /SOCIAL_TOKEN_SECRET/);
  });
});
