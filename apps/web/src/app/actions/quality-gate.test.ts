import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, gateMock } = vi.hoisted(() => ({
  prismaMock: { contentItem: { findFirst: vi.fn(), update: vi.fn() } },
  gateMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'user-1' })) }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (k: string) => k) }));
vi.mock('@/lib/quality-verdict', () => ({ runManualGate: gateMock }));

import { recheckContentQuality } from './quality-gate';

const item = {
  id: 'item-1',
  workspaceId: 'ws-1',
  topic: 'T',
  channel: 'linkedin',
  content: ' Edited body ',
  storylineId: null,
  qualityVerdict: { approved: false, rejectedBy: 'not_checked' },
  workspace: { brandSummary: {}, contentLanguage: 'EN' },
};

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue({ approved: true, rejectedBy: null, source: 'recheck' });
});

describe('recheckContentQuality', () => {
  it('judges the current text once and stores the new verdict', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item);
    const res = await recheckContentQuality('item-1');
    expect(gateMock).toHaveBeenCalledTimes(1);
    expect(gateMock.mock.calls[0][0]).toMatchObject({ content: 'Edited body', excludeItemId: 'item-1', source: 'recheck' });
    expect(prismaMock.contentItem.update.mock.calls[0][0].data.qualityVerdict).toMatchObject({ approved: true });
    expect(res).toEqual({ verdict: expect.objectContaining({ approved: true }) });
  });

  it('never gates a Write-a-post item (no verdict)', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue({ ...item, qualityVerdict: null });
    const res = await recheckContentQuality('item-1');
    expect(gateMock).not.toHaveBeenCalled();
    expect(res).toHaveProperty('error');
  });

  it("refuses another user's item", async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(null);
    expect(await recheckContentQuality('item-1')).toHaveProperty('error');
    expect(prismaMock.contentItem.findFirst.mock.calls[0][0].where).toEqual({ id: 'item-1', userId: 'user-1' });
  });
});
