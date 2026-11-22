import { describe, expect, it } from 'vitest';

import {
  canStartConnectFlow,
  isMissingConnectionReason,
  latestJobByContentItem,
  needsReconnect,
  resolvePublishOutcome,
  safePostUrl,
  type LatestPublishJob,
} from './publish-outcome';

const job = (overrides: Partial<LatestPublishJob> = {}): LatestPublishJob => ({
  platform: 'LINKEDIN',
  status: 'PUBLISHED',
  externalPostUrl: 'https://www.linkedin.com/feed/update/urn:li:share:1',
  lastError: null,
  publishedAtUtc: '2026-11-20T10:00:00.000Z',
  connectionStatus: 'CONNECTED',
  ...overrides,
});

describe('needsReconnect', () => {
  it('is true only for states a new sign-in fixes', () => {
    for (const s of ['EXPIRED', 'REVOKED', 'PENDING_REAUTH', 'FAILED']) expect(needsReconnect(s)).toBe(true);
    expect(needsReconnect('CONNECTED')).toBe(false);
    expect(needsReconnect(null)).toBe(false);
    expect(needsReconnect(undefined)).toBe(false);
  });
});

describe('canStartConnectFlow', () => {
  it('matches the platforms getSocialConnectUrl accepts, case-insensitively', () => {
    expect(canStartConnectFlow('LINKEDIN')).toBe(true);
    expect(canStartConnectFlow('x')).toBe(true);
    expect(canStartConnectFlow('INSTAGRAM')).toBe(false);
    // No connect flow exists for these yet; they must not offer Reconnect.
    expect(canStartConnectFlow('TELEGRAM')).toBe(false);
    expect(canStartConnectFlow('THREADS')).toBe(false);
  });
});

describe('isMissingConnectionReason', () => {
  it('recognises the two messages we write when nothing is connected', () => {
    expect(
      isMissingConnectionReason('No default LINKEDIN connection found. Please connect your account in the Connections page.'),
    ).toBe(true);
    expect(isMissingConnectionReason('No active site connection for this workspace.')).toBe(true);
    expect(isMissingConnectionReason('Rate limited by provider')).toBe(false);
    expect(isMissingConnectionReason(null)).toBe(false);
  });
});

describe('safePostUrl', () => {
  it('keeps http(s) and drops anything else', () => {
    expect(safePostUrl('https://x.com/i/web/status/1')).toBe('https://x.com/i/web/status/1');
    expect(safePostUrl('javascript:alert(1)')).toBeNull();
    expect(safePostUrl('not a url')).toBeNull();
    expect(safePostUrl(null)).toBeNull();
  });
});

describe('resolvePublishOutcome', () => {
  it('returns nothing for an item that has not been through publishing', () => {
    expect(resolvePublishOutcome({ status: 'READY' }, null)).toBeNull();
    expect(resolvePublishOutcome({ status: 'SCHEDULED' }, job({ status: 'SCHEDULED' }))).toBeNull();
  });

  it('links to the post from the latest published job', () => {
    expect(resolvePublishOutcome({ status: 'PUBLISHED' }, job())).toEqual({
      kind: 'published',
      url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
      platform: 'LINKEDIN',
      publishedAtUtc: '2026-11-20T10:00:00.000Z',
    });
  });

  it('shows a published blog post without a link when there is no social job', () => {
    const published = new Date('2026-11-19T08:00:00.000Z');
    expect(resolvePublishOutcome({ status: 'PUBLISHED', publishedAtUtc: published }, null)).toEqual({
      kind: 'published',
      url: null,
      platform: null,
      publishedAtUtc: '2026-11-19T08:00:00.000Z',
    });
  });

  it('prefers the item failure reason and falls back to the job error', () => {
    const failedJob = job({ status: 'FAILED', lastError: 'Job error', externalPostUrl: null });
    expect(resolvePublishOutcome({ status: 'FAILED', failedReason: 'Item reason' }, failedJob)).toMatchObject({
      kind: 'failed',
      reason: 'Item reason',
      action: null,
    });
    expect(resolvePublishOutcome({ status: 'FAILED', failedReason: '  ' }, failedJob)).toMatchObject({
      reason: 'Job error',
    });
    expect(resolvePublishOutcome({ status: 'FAILED' }, null)).toMatchObject({ reason: null, action: null });
  });

  it('asks for a reconnect when the connection behind the job has expired or been revoked', () => {
    for (const connectionStatus of ['EXPIRED', 'REVOKED', 'PENDING_REAUTH']) {
      expect(
        resolvePublishOutcome(
          { status: 'FAILED', failedReason: 'LinkedIn token is no longer valid' },
          job({ status: 'FAILED', connectionStatus }),
        ),
      ).toMatchObject({ kind: 'failed', action: 'reconnect', platform: 'LINKEDIN' });
    }
  });

  it('asks for a connection when nothing was connected to publish through', () => {
    expect(
      resolvePublishOutcome(
        { status: 'FAILED', failedReason: 'No default X connection found. Please connect your account in the Connections page.' },
        null,
      ),
    ).toMatchObject({ action: 'connect' });
  });

  it('never puts a non-http link in front of the user', () => {
    expect(
      resolvePublishOutcome({ status: 'PUBLISHED' }, job({ externalPostUrl: 'javascript:alert(1)' })),
    ).toMatchObject({ kind: 'published', url: null });
  });
});

describe('latestJobByContentItem', () => {
  it('keeps the first (newest) job per item and skips jobs with no item', () => {
    const map = latestJobByContentItem([
      { id: 'b', contentItemId: 'item-1' },
      { id: 'a', contentItemId: 'item-1' },
      { id: 'c', contentItemId: null },
      { id: 'd', contentItemId: 'item-2' },
    ]);
    expect(map.get('item-1')?.id).toBe('b');
    expect(map.get('item-2')?.id).toBe('d');
    expect(map.size).toBe(2);
  });
});
