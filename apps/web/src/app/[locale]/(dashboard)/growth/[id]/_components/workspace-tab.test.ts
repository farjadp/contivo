import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ findFirst: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { activity_logs: { findFirst: m.findFirst } } }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: m.write }));

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
      { id: 'a', name: 'A', domain: 'a.com', userDecision: 'ACCEPTED', evidence: [{ kind: 'source', url: 'https://a.com' }] },
      { id: 'b', name: 'B', domain: null, userDecision: 'REJECTED', evidence: [] },
      { id: 'c', name: 'C', domain: 'c.com', userDecision: null, evidence: { junk: true } },
    ];
    expect(toFirstPostCompetitors(rows)).toEqual([
      { id: 'a', name: 'A', domain: 'a.com', userDecision: 'ACCEPTED', evidence: [{ kind: 'source', url: 'https://a.com' }] },
      { id: 'c', name: 'C', domain: 'c.com', userDecision: null, evidence: [] },
    ]);
  });
});

describe('recordFirstDraftSeen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes FIRST_DRAFT_SEEN with ids only when the workspace has none', async () => {
    m.findFirst.mockResolvedValue(null);
    await recordFirstDraftSeen('u1', 'ws1', { contentItemId: 'c1', approved: true });
    expect(m.findFirst).toHaveBeenCalledWith({
      where: { workspace_id: 'ws1', action: 'FIRST_DRAFT_SEEN' },
      select: { id: true },
    });
    expect(m.write).toHaveBeenCalledWith({
      userId: 'u1',
      workspaceId: 'ws1',
      action: 'FIRST_DRAFT_SEEN',
      detail: { contentItemId: 'c1', approved: true },
    });
  });

  it('writes nothing the second time', async () => {
    m.findFirst.mockResolvedValue({ id: 'row' });
    await recordFirstDraftSeen('u1', 'ws1', { contentItemId: 'c1', approved: false });
    expect(m.write).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    m.findFirst.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordFirstDraftSeen('u1', 'ws1', { contentItemId: 'c1', approved: true })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
