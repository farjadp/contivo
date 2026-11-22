/**
 * Reconnecting the same account must update the existing row (same id), not
 * add a duplicate beside it.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { decryptToken } from '../src/modules/social/token-crypto';

import { fakePrisma } from './helpers/fake-prisma';

const dto = {
  workspaceId: 'w1',
  platform: 'LINKEDIN' as const,
  accountName: 'Me',
  accountIdentifier: 'person-1',
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  tokenExpiresAt: new Date('2027-01-01T00:00:00Z'),
  isDefault: true,
};

describe('SocialConnectionsService.create upsert', () => {
  it('updates the existing row, keeps its id, resets status to CONNECTED', async () => {
    const prisma = fakePrisma({
      socialConnection: [
        {
          id: 'keep-me',
          workspaceId: 'w1',
          platform: 'LINKEDIN',
          accountIdentifier: 'person-1',
          accountName: 'Old',
          status: 'EXPIRED',
          isDefault: false,
          encryptedAccessTokenRef: 'old',
          encryptedRefreshTokenRef: null,
          tokenExpiresAt: new Date('2026-01-01'),
        },
      ],
    });
    const svc = new SocialConnectionsService(prisma as any);
    const out = await svc.create(dto);
    assert.equal(prisma.socialConnection.rows.length, 1);
    const row = prisma.socialConnection.rows[0];
    assert.equal(out.id, 'keep-me');
    assert.equal(row.status, 'CONNECTED');
    assert.equal(row.accountName, 'Me');
    assert.equal(row.isDefault, true);
    assert.equal(decryptToken(row.encryptedAccessTokenRef), 'new-access');
    assert.equal(decryptToken(row.encryptedRefreshTokenRef), 'new-refresh');
    assert.equal(row.tokenExpiresAt.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('a reconnect without a refresh token or expiry clears the old ones', async () => {
    const prisma = fakePrisma({
      socialConnection: [
        { id: 'k', workspaceId: 'w1', platform: 'LINKEDIN', accountIdentifier: 'person-1', status: 'REVOKED',
          encryptedRefreshTokenRef: 'stale', tokenExpiresAt: new Date('2026-01-01') },
      ],
    });
    const svc = new SocialConnectionsService(prisma as any);
    await svc.create({ ...dto, refreshToken: undefined, tokenExpiresAt: undefined });
    const row = prisma.socialConnection.rows[0];
    assert.equal(row.encryptedRefreshTokenRef, null);
    assert.equal(row.tokenExpiresAt, null);
  });

  it('a different account on the same platform is a new row', async () => {
    const prisma = fakePrisma({
      socialConnection: [{ id: 'other', workspaceId: 'w1', platform: 'LINKEDIN', accountIdentifier: 'person-2', status: 'CONNECTED' }],
    });
    const svc = new SocialConnectionsService(prisma as any);
    await svc.create(dto);
    assert.equal(prisma.socialConnection.rows.length, 2);
  });
});

describe('markForReauth', () => {
  const seed = (status: string) =>
    fakePrisma({
      user: [{ id: 'u1', role: 'USER' }],
      workspace: [{ id: 'w1', userId: 'u1' }],
      socialConnection: [{ id: 'c1', workspaceId: 'w1', platform: 'LINKEDIN', accountIdentifier: 'p', status }],
    });

  it('returns what the web needs to restart the OAuth flow', async () => {
    const prisma = seed('EXPIRED');
    const out = await new SocialConnectionsService(prisma as any).markForReauth('c1', 'w1', 'u1');
    assert.deepEqual(out.reconnect, { platform: 'linkedin', flow: 'oauth' });
    assert.equal(prisma.socialConnection.rows[0].status, 'PENDING_REAUTH');
  });

  it('does not take a working CONNECTED account offline if the user abandons the flow', async () => {
    const prisma = seed('CONNECTED');
    await new SocialConnectionsService(prisma as any).markForReauth('c1', 'w1', 'u1');
    assert.equal(prisma.socialConnection.rows[0].status, 'CONNECTED');
  });

  it('a platform with no OAuth flow says so', async () => {
    const prisma = seed('REVOKED');
    prisma.socialConnection.rows[0].platform = 'TELEGRAM';
    const out = await new SocialConnectionsService(prisma as any).markForReauth('c1', 'w1', 'u1');
    assert.deepEqual(out.reconnect, { platform: 'telegram', flow: 'unsupported' });
  });
});
