import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { activity_logs: { create: m.create } } }));

import { recordFirstDraftSeen, resolveWorkspaceTab, toFirstPostCompetitors } from './workspace-tab';

const OPEN = { guided: false, firstPostPublished: false, fromAnalyzing: false };
const GUIDED = { ...OPEN, guided: true };

describe('resolveWorkspaceTab', () => {
  it('keeps today\'s default and allowed tabs in open mode', () => {
    expect(resolveWorkspaceTab(undefined, OPEN)).toBe('pipeline');
    expect(resolveWorkspaceTab('matrices', OPEN)).toBe('matrices');
    expect(resolveWorkspaceTab(['keywords', 'x'], OPEN)).toBe('keywords');
    expect(resolveWorkspaceTab('nonsense', OPEN)).toBe('pipeline');
  });

  it('does not allow first-post in open mode (and so not under the kill switch)', () => {
    expect(resolveWorkspaceTab('first-post', OPEN)).toBe('pipeline');
  });

  it('opens on first-post in guided mode and still allows every other tab by URL', () => {
    expect(resolveWorkspaceTab(undefined, GUIDED)).toBe('first-post');
    expect(resolveWorkspaceTab('nonsense', GUIDED)).toBe('first-post');
    expect(resolveWorkspaceTab('first-post', GUIDED)).toBe('first-post');
    expect(resolveWorkspaceTab('pipeline', GUIDED)).toBe('pipeline');
  });

  it('keeps first-post reachable once it is published, so the live card survives a reload', () => {
    expect(resolveWorkspaceTab('first-post', { ...OPEN, firstPostPublished: true })).toBe('first-post');
    // ...but it is no longer the default.
    expect(resolveWorkspaceTab(undefined, { ...OPEN, firstPostPublished: true })).toBe('pipeline');
  });

  it('lands an open-mode user on strategy straight after the analysis, as before', () => {
    expect(resolveWorkspaceTab(undefined, { ...OPEN, fromAnalyzing: true })).toBe('strategy');
    expect(resolveWorkspaceTab(undefined, { ...GUIDED, fromAnalyzing: true })).toBe('first-post');
    // An explicit tab still wins.
    expect(resolveWorkspaceTab('calendar', { ...OPEN, fromAnalyzing: true })).toBe('calendar');
  });
});

describe('toFirstPostCompetitors', () => {
  it('drops rejected rows and keeps only a stored evidence array', () => {
    const rows = [
      {
        id: 'a',
        name: 'A',
        domain: 'a.com',
        userDecision: 'ACCEPTED',
        evidence: [{ kind: 'source', url: 'https://a.com' }],
        source: 'AI',
        discoveryRunId: 'run-1',
      },
      { id: 'b', name: 'B', domain: null, userDecision: 'REJECTED', evidence: [], source: 'AI', discoveryRunId: null },
      { id: 'c', name: 'C', domain: 'c.com', userDecision: null, evidence: { junk: true }, source: 'AI', discoveryRunId: null },
    ];
    expect(toFirstPostCompetitors(rows)).toEqual([
      {
        id: 'a',
        name: 'A',
        domain: 'a.com',
        userDecision: 'ACCEPTED',
        evidence: [{ kind: 'source', url: 'https://a.com' }],
        source: 'evidence',
      },
      { id: 'c', name: 'C', domain: 'c.com', userDecision: null, evidence: [], source: 'initialGuess' },
    ]);
  });

  it('marks rows the user added (Competitor.source MANUAL) as manual, on every load', () => {
    const [row] = toFirstPostCompetitors([
      { id: 'm', name: 'M', domain: 'm.com', userDecision: 'ACCEPTED', evidence: [], source: 'MANUAL', discoveryRunId: null },
    ]);
    expect(row.source).toBe('manual');
  });
});

describe('recordFirstDraftSeen', () => {
  beforeEach(() => vi.clearAllMocks());

  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`id`)', {
      code: 'P2002',
      clientVersion: 'test',
    });

  it('inserts FIRST_DRAFT_SEEN under the workspace\'s deterministic id, ids only, no read first', async () => {
    m.create.mockResolvedValue({});
    await recordFirstDraftSeen('u1', 'ws1', { contentItemId: 'c1', approved: true });
    expect(m.create).toHaveBeenCalledWith({
      data: {
        id: 'fds_ws1',
        user_id: 'u1',
        workspace_id: 'ws1',
        action: 'FIRST_DRAFT_SEEN',
        detail: { contentItemId: 'c1', approved: true },
      },
    });
  });

  it('two renders at once: the second insert hits P2002 and is "already seen", silently', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.create.mockResolvedValueOnce({}).mockRejectedValueOnce(p2002());
    await Promise.all([
      recordFirstDraftSeen('u1', 'ws1', { contentItemId: 'c1', approved: true }),
      recordFirstDraftSeen('u1', 'ws1', { contentItemId: 'c1', approved: true }),
    ]);
    expect(m.create).toHaveBeenCalledTimes(2);
    expect(m.create.mock.calls.map((c) => c[0].data.id)).toEqual(['fds_ws1', 'fds_ws1']);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('never throws on any other error, and logs it', async () => {
    m.create.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordFirstDraftSeen('u1', 'ws1', { contentItemId: 'c1', approved: true })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
