import { beforeEach, describe, expect, it, vi } from 'vitest';

// Brand assets go through the failover layer (task `brand_assets`). An outage
// is reported as an outage, never as "not enough evidence", and nothing is
// saved. fetch serves only the client's website pages here; the model is the
// mocked layer.

const { prismaMock, activityLogMock, runAiTaskMock } = vi.hoisted(() => ({
  runAiTaskMock: vi.fn(),
  prismaMock: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
  },
  activityLogMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'user-1' })) }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));

import { generateWorkspaceBrandAssets } from './growth-brand-assets';

const PAGE = `<html><head><title>Acme</title><meta name="description" content="Acme plans content for marketing teams"></head>
<body><h1>Plan a month of content in an hour</h1><p>Acme helps small marketing teams plan, write and schedule posts.</p>
<p>Built for founders who do their own marketing.</p></body></html>`;

const fetchMock = vi.fn(async () => ({ ok: true, text: async () => PAGE }));

function aiDown(firstErrorClass: string, allRateLimited = false) {
  return { ok: false as const, kind: 'all_unavailable' as const, attempts: [], firstErrorClass, allRateLimited };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  prismaMock.workspace.findUnique.mockResolvedValue({
    id: 'ws-1',
    userId: 'user-1',
    name: 'Acme',
    websiteUrl: 'https://acme.com',
    brandSummary: {},
    audienceInsights: {},
  });
  prismaMock.workspace.update.mockResolvedValue({});
});

describe('generateWorkspaceBrandAssets on the failover layer', () => {
  it('calls runAiTask("brand_assets") with JSON output and the caller context', async () => {
    runAiTaskMock.mockResolvedValue(aiDown('billing'));

    await generateWorkspaceBrandAssets('ws-1');

    expect(runAiTaskMock).toHaveBeenCalledTimes(1);
    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('brand_assets');
    expect(request).toMatchObject({ output: { kind: 'json_object' }, timeoutMs: 60_000 });
    expect(ctx).toEqual({ workspaceId: 'ws-1', userId: 'user-1' });
    // Only the website pages were fetched, never a provider endpoint.
    for (const [url] of fetchMock.mock.calls as unknown as Array<[string]>) {
      expect(String(url)).toContain('acme.com');
    }
  });

  it.each([
    ['billing', false],
    ['auth', false],
    ['rate_limit', true],
  ])('ok:false (%s) returns brandAssetsFailed, not brandAssetsNoEvidence, and saves nothing', async (cls, rl) => {
    runAiTaskMock.mockResolvedValue(aiDown(cls, rl));

    const result = await generateWorkspaceBrandAssets('ws-1');

    expect(result).toEqual({ error: 'brandAssetsFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });
});
