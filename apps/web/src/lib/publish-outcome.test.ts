import { describe, expect, it } from 'vitest';

import {
  canStartConnectFlow,
  failureAction,
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

describe('failureAction', () => {
  it('decides by code', () => {
    expect(failureAction('CONNECTION_EXPIRED', '', 'CONNECTED')).toEqual({ action: 'reconnect', tab: 'social' });
    expect(failureAction('CONNECTION_REVOKED', '', null)).toEqual({ action: 'reconnect', tab: 'social' });
    expect(failureAction('NO_CONNECTION', '', null)).toEqual({ action: 'connect', tab: 'social' });
    expect(failureAction('NO_SITE', '', null)).toEqual({ action: 'connect', tab: 'websites' });
    for (const code of ['INVALID_CONTENT', 'RATE_LIMITED', 'CREDITS_EXHAUSTED', 'UNREACHABLE', 'PLATFORM_ERROR', 'NO_PUBLISHER'] as const) {
      expect(failureAction(code, '', 'CONNECTED')).toBeNull();
    }
  });

  it('falls back to connection status, then our English sentences, for rows with no code', () => {
    expect(failureAction(null, 'anything', 'EXPIRED')).toEqual({ action: 'reconnect', tab: 'social' });
    expect(
      failureAction(null, 'No default LINKEDIN connection found. Please connect your account in the Connections page.', null),
    ).toEqual({ action: 'connect', tab: 'social' });
    expect(failureAction(null, 'No active site connection for this workspace.', null)).toEqual({
      action: 'connect',
      tab: 'websites',
    });
    expect(failureAction(null, 'Rate limited by provider', 'CONNECTED')).toBeNull();
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
    const failedJob = job({ status: 'FAILED', lastError: '[PLATFORM_ERROR] Job error', externalPostUrl: null });
    expect(resolvePublishOutcome({ status: 'FAILED', failedReason: '[INVALID_CONTENT] Too long' }, failedJob)).toEqual({
      kind: 'failed',
      code: 'INVALID_CONTENT',
      detail: 'Too long',
      action: null,
      platform: 'LINKEDIN',
    });
    expect(resolvePublishOutcome({ status: 'FAILED', failedReason: '  ' }, failedJob)).toMatchObject({
      code: 'PLATFORM_ERROR',
      detail: 'Job error',
    });
    expect(resolvePublishOutcome({ status: 'FAILED' }, null)).toMatchObject({ code: null, detail: null, action: null });
  });

  it('asks for a reconnect on a coded expired or revoked connection', () => {
    for (const code of ['CONNECTION_EXPIRED', 'CONNECTION_REVOKED']) {
      expect(
        resolvePublishOutcome(
          { status: 'FAILED', failedReason: `[${code}] LinkedIn rejected the access token (401).` },
          job({ status: 'FAILED', connectionStatus: 'CONNECTED' }),
        ),
      ).toMatchObject({ kind: 'failed', code, action: { action: 'reconnect', tab: 'social' } });
    }
  });

  it('still asks for a reconnect on an old uncoded row whose connection has expired', () => {
    expect(
      resolvePublishOutcome(
        { status: 'FAILED', failedReason: 'LinkedIn token is no longer valid' },
        job({ status: 'FAILED', connectionStatus: 'REVOKED' }),
      ),
    ).toMatchObject({ code: null, detail: 'LinkedIn token is no longer valid', action: { action: 'reconnect' } });
  });

  it('sends a blog post with no site to the Websites tab', () => {
    expect(
      resolvePublishOutcome({ status: 'FAILED', failedReason: '[NO_SITE] No active site connection for this workspace.' }, null),
    ).toMatchObject({ code: 'NO_SITE', action: { action: 'connect', tab: 'websites' } });
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
