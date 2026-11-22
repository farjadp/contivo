import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A slug the user chose before publishing is the URL; only items without one
// get an auto slug from the title (spec 2026-11-21, write-own-post).

const { prismaMock, activityLogMock, buildUniqueSlugMock, lookupMock, requestMock } = vi.hoisted(() => ({
  prismaMock: {
    contentItem: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    siteConnection: { findFirst: vi.fn(), update: vi.fn() },
  },
  activityLogMock: vi.fn(),
  buildUniqueSlugMock: vi.fn(),
  lookupMock: vi.fn(),
  requestMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('./posts', () => ({ buildUniqueSlug: buildUniqueSlugMock }));
// The revalidate ping goes through the SSRF guard (node:dns + node:https), not fetch.
vi.mock('node:dns', () => ({ default: { lookup: lookupMock }, lookup: lookupMock }));
vi.mock('node:https', () => ({ default: { request: requestMock }, request: requestMock }));
vi.mock('node:http', () => ({ default: { request: requestMock }, request: requestMock }));

import { publishDueWebContent, revalidateWorkspaceSite } from './publisher';

type UpdateManyArgs = { where: Record<string, unknown>; data: { slug: string; status: string } };

function dueItem(overrides: Record<string, unknown> = {}) {
  return { id: 'item-1', workspaceId: 'ws-1', topic: 'چطور محتوا بنویسیم', userId: 'user-1', slug: null, ...overrides };
}

type Addr = { address: string; family: number };
type Sent = { url: URL; options: { method: string; headers: Record<string, string>; lookup: (host: string, opts: object, cb: (err: Error | null) => void) => void }; body: string };

/** Each call to dns.lookup answers with the next list (the last one repeats). */
function dnsAnswers(...answers: Addr[][]) {
  let i = 0;
  lookupMock.mockImplementation((_h: string, _o: unknown, cb: (e: Error | null, a: Addr[]) => void) => {
    const a = answers[Math.min(i++, answers.length - 1)]!;
    cb(null, a);
  });
}

/**
 * Fake https.request: runs the socket's lookup hook (as Node would), then
 * answers with `status` or errors like a real socket would.
 */
function respondWith(status: number | Error) {
  requestMock.mockImplementation((url: URL, options: Sent['options'], onResponse: (res: unknown) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: (b: string) => void; destroy: () => void };
    req.destroy = vi.fn();
    req.end = (body: string) => {
      sent.push({ url, options, body });
      options.lookup(url.hostname, {}, (err: Error | null) => {
        if (err) req.emit('error', err);
        else if (status instanceof Error) req.emit('error', status);
        else onResponse({ statusCode: status, resume: () => undefined });
      });
    };
    return req;
  });
}

let sent: Sent[] = [];
const PUBLIC = [{ address: '66.33.22.11', family: 4 }];

beforeEach(() => {
  vi.clearAllMocks();
  sent = [];
  dnsAnswers(PUBLIC);
  prismaMock.siteConnection.update.mockResolvedValue({});
  prismaMock.siteConnection.findFirst.mockResolvedValue({
    id: 'site-1',
    name: 'Site',
    revalidateUrl: null,
    revalidateSecret: null,
  });
  prismaMock.contentItem.updateMany.mockResolvedValue({ count: 1 });
  buildUniqueSlugMock.mockResolvedValue('post-abcdefgh');
});

describe('publishDueWebContent slug', () => {
  it('selects the stored slug', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([]);
    await publishDueWebContent();
    const args = prismaMock.contentItem.findMany.mock.calls[0]?.[0] as { select: Record<string, boolean> };
    expect(args.select.slug).toBe(true);
  });

  it('publishes with the pre-set slug and does not generate one', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem({ slug: 'how-to-write-content' })]);
    const [outcome] = await publishDueWebContent();
    expect(outcome?.slug).toBe('how-to-write-content');
    expect(outcome?.published).toBe(true);
    expect(buildUniqueSlugMock).not.toHaveBeenCalled();
    const args = prismaMock.contentItem.updateMany.mock.calls[0]?.[0] as UpdateManyArgs;
    expect(args.data.slug).toBe('how-to-write-content');
    expect(args.data.status).toBe('PUBLISHED');
  });

  it('falls back to an auto slug when none is set', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem()]);
    const [outcome] = await publishDueWebContent();
    expect(buildUniqueSlugMock).toHaveBeenCalledWith('ws-1', 'چطور محتوا بنویسیم', 'item-1');
    expect(outcome?.slug).toBe('post-abcdefgh');
  });

  it('treats an empty stored slug as unset', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem({ slug: '' })]);
    const [outcome] = await publishDueWebContent();
    expect(buildUniqueSlugMock).toHaveBeenCalled();
    expect(outcome?.slug).toBe('post-abcdefgh');
  });
});

describe('publishDueWebContent revalidate event', () => {
  it('still sends post.published', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue({
      id: 'site-1',
      name: 'Site',
      revalidateUrl: 'https://site.test/api/revalidate',
      revalidateSecret: null,
    });
    respondWith(200);
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem({ slug: 'live' })]);
    await publishDueWebContent();
    expect(JSON.parse(sent[0]!.body)).toEqual({ slug: 'live', event: 'post.published' });
  });
});

describe('revalidateWorkspaceSite', () => {
  const activeSite = {
    id: 'site-1',
    name: 'Site',
    revalidateUrl: 'https://site.test/api/revalidate',
    revalidateSecret: 'shh',
  };

  it('returns null when the workspace has no active site', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(null);
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBeNull();
    expect(prismaMock.siteConnection.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('returns null when the site has no revalidate URL', async () => {
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('posts the slug and event with the bearer secret', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(activeSite);
    respondWith(200);
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(true);
    const { url, options, body } = sent[0]!;
    expect(url.href).toBe('https://site.test/api/revalidate');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer shh');
    expect(JSON.parse(body)).toEqual({ slug: 'live', event: 'post.updated' });
    expect(prismaMock.siteConnection.update).toHaveBeenCalledWith({
      where: { id: 'site-1' },
      data: { lastRevalidateAt: expect.any(Date), lastRevalidateStatus: 200 },
    });
  });

  it('returns false on a non-2xx response', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(activeSite);
    respondWith(500);
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
  });

  it('returns false and does not throw when fetch fails', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(activeSite);
    respondWith(new Error('network down'));
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
  });

  it('returns false and does not throw when the site lookup fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prismaMock.siteConnection.findFirst.mockRejectedValue(new Error('db down'));
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
    expect(errSpy.mock.calls[0]?.[0]).toBe('[site-publisher] revalidate failed');
    errSpy.mockRestore();
  });

  describe('SSRF guard', () => {
    function siteWith(revalidateUrl: string) {
      prismaMock.siteConnection.findFirst.mockResolvedValue({ ...activeSite, revalidateUrl });
    }
    function recordedStatus() {
      return (prismaMock.siteConnection.update.mock.calls[0]?.[0] as { data: { lastRevalidateStatus: number } }).data
        .lastRevalidateStatus;
    }

    it.each([
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.7/revalidate',
      'https://[::1]/revalidate',
      'https://contivo-api.railway.internal/api/v1/health',
      'https://localhost:3000/api/revalidate',
    ])('never sends a request to %s', async (url) => {
      siteWith(url);
      respondWith(200);
      expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
      expect(requestMock).not.toHaveBeenCalled();
      expect(recordedStatus()).toBe(0);
    });

    it('never sends a request when the name resolves to a private address', async () => {
      siteWith('https://hooks.attacker.example/revalidate');
      dnsAnswers([{ address: '192.168.1.10', family: 4 }]);
      respondWith(200);
      expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('refuses at connect time when DNS changes after the check (rebinding)', async () => {
      siteWith('https://rebind.attacker.example/revalidate');
      dnsAnswers(PUBLIC, [{ address: '127.0.0.1', family: 4 }]);
      respondWith(200);
      expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
      expect(recordedStatus()).toBe(0);
    });

    it('does not follow a redirect', async () => {
      siteWith('https://site.test/api/revalidate');
      respondWith(302);
      expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(recordedStatus()).toBe(302);
    });

    it('sends to a valid public https URL', async () => {
      siteWith('https://www.contivo.app/api/blog/revalidate');
      respondWith(200);
      expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.published')).toBe(true);
      expect(sent[0]!.url.hostname).toBe('www.contivo.app');
      expect(recordedStatus()).toBe(200);
    });
  });
});

describe('publishDueWebContent with no site connection', () => {
  it('parks the item as FAILED with a NO_SITE coded reason', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem()]);
    prismaMock.siteConnection.findFirst.mockResolvedValue(null);
    const [outcome] = await publishDueWebContent();
    expect(outcome?.published).toBe(false);
    expect(outcome?.error).toBe('no_site_connection');
    const args = prismaMock.contentItem.update.mock.calls[0]?.[0] as { data: { status: string; failedReason: string } };
    expect(args.data.status).toBe('FAILED');
    expect(args.data.failedReason).toMatch(/^\[NO_SITE\] No active site connection/);
  });
});
