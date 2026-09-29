import { beforeEach, describe, expect, it, vi } from 'vitest';

// A manual edit of Offerings must keep the competitor basis the
// stored result was built on (spec D8): the "unconfirmed competitors" label
// would otherwise vanish on the first edit. Only the STORED basis counts; a
// basis sent by the client is ignored. A legacy result with no basis stays
// without one. No network, no database: prisma and the session are mocked.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'user-1' })) }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: vi.fn() }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));
vi.mock('@/lib/competitors/site-signals', () => ({ collectSiteSignals: vi.fn() }));

import { saveWorkspaceProductsServicesIntelEdits } from './growth-offerings';

function workspace(audienceInsights: Record<string, unknown>) {
  return {
    id: 'ws-1',
    userId: 'user-1',
    name: 'Acme',
    websiteUrl: 'https://acme.com',
    audienceInsights,
    competitors: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workspace.update.mockResolvedValue({});
});

describe('saveWorkspaceProductsServicesIntelEdits keeps the stored competitor basis', () => {
  it('carries UNCONFIRMED_HIGH through an edit, ignoring the client', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(
      workspace({ productsServicesIntel: { competitor_basis: 'UNCONFIRMED_HIGH' } }),
    );

    await saveWorkspaceProductsServicesIntelEdits('ws-1', { competitor_basis: 'ACCEPTED' } as never);

    const payload = prismaMock.workspace.update.mock.calls[0][0].data.audienceInsights.productsServicesIntel;
    expect(payload.competitor_basis).toBe('UNCONFIRMED_HIGH');
  });

  it('leaves a legacy result without a basis', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(workspace({ productsServicesIntel: {} }));

    await saveWorkspaceProductsServicesIntelEdits('ws-1', { competitor_basis: 'ACCEPTED' } as never);

    const payload = prismaMock.workspace.update.mock.calls[0][0].data.audienceInsights.productsServicesIntel;
    expect(payload).not.toHaveProperty('competitor_basis');
  });
});
