/**
 * QA: a REAL provider failure, not a hand-written error string.
 *
 * The recorded OpenAI out-of-credit response (lib/ai/__fixtures__) is served by a stubbed
 * global fetch to the real failover layer and the real matrix call site (`callStructured`).
 * The error text the matrix run would store is whatever the code produced, and the report
 * context built from it must name the cause without the user writing a word.
 *
 * Known gaps are pinned with `it.fails`: they pass while the defect exists and turn red the
 * day it is fixed, which is the cue to turn them into plain `it`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadFixture } from '@/lib/ai/__fixtures__/load';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aiProviderEvent: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
    workspace: { findFirst: vi.fn() },
    contentItem: { findFirst: vi.fn() },
    discoveryRun: { findFirst: vi.fn(), findMany: vi.fn() },
    matrixRun: { findFirst: vi.fn(), findMany: vi.fn() },
    socialPublishLog: { findFirst: vi.fn(), findMany: vi.fn() },
    autopilotRun: { findMany: vi.fn() },
    activity_logs: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
// The layer's event store imports the database lazily; give it a store that records rows in the mock and
// restores no health, so this file can never reach a real database whatever DATABASE_URL is set to.
vi.mock('@/lib/ai/alert', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai/alert')>();
  return {
    ...real,
    createPrismaEventStore: () => ({
      ...real.createPrismaEventStore(),
      insert: async (row: unknown) => {
        await (prismaMock.aiProviderEvent.create as (arg: unknown) => Promise<unknown>)({ data: row });
      },
      latestCriticalSince: async () => [],
    }),
  };
});

const WS = 'clws0000000000000000000a1';
const RUN = 'clmx0000000000000000000a1';
const USER = 'user-1';
const ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'AI_FORCE_FAIL'] as const;
const savedEnv: Record<string, string | undefined> = {};
const hosts: string[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.OPENAI_API_KEY = 'sk-fake-test-key';
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_FORCE_FAIL;
  hosts.length = 0;
  const fx = loadFixture('openai-429-insufficient-quota.json');
  vi.stubGlobal('fetch', async (input: unknown) => {
    const host = new URL(typeof input === 'string' ? input : String(input)).host;
    hosts.push(host);
    if (host !== 'api.openai.com') throw new Error(`unexpected network call to ${host}`);
    return new Response(JSON.stringify(fx.body), { status: fx.status, headers: { 'content-type': 'application/json' } });
  });
  prismaMock.workspace.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === WS ? { id: WS } : null));
  prismaMock.contentItem.findFirst.mockResolvedValue(null);
  prismaMock.discoveryRun.findFirst.mockResolvedValue(null);
  prismaMock.discoveryRun.findMany.mockResolvedValue([]);
  prismaMock.matrixRun.findFirst.mockResolvedValue({ id: RUN });
  prismaMock.socialPublishLog.findFirst.mockResolvedValue(null);
  prismaMock.socialPublishLog.findMany.mockResolvedValue([]);
  prismaMock.autopilotRun.findMany.mockResolvedValue([]);
  prismaMock.activity_logs.findMany.mockResolvedValue([]);
  prismaMock.activity_logs.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const args = { name: 'chart_scores', schema: { type: 'object' }, system: 'sys', user: 'usr' };

/** The string the matrix pipeline stores in matrix_runs.error for a failed call. */
async function storedMatrixError(): Promise<string> {
  const { callStructured } = await import('@/lib/matrices/openai');
  const { sanitizeUpstreamText } = await import('@/lib/competitors/redact');
  try {
    await callStructured(args);
  } catch (error) {
    return sanitizeUpstreamText((error as Error).message) ?? '';
  }
  throw new Error('expected the out-of-credit response to fail the call');
}

describe('a real out-of-credit failure becomes a report that names the cause', () => {
  it('the failure the pipeline stores classifies as PROVIDER_OUT_OF_CREDIT', async () => {
    const stored = await storedMatrixError();
    expect(hosts).toEqual(['api.openai.com']);
    expect(stored).toContain('AI_UNAVAILABLE');
    const { classifyCauseFromStored } = await import('./cause');
    expect(classifyCauseFromStored(stored)).toBe('PROVIDER_OUT_OF_CREDIT');
  });

  it('buildServerContext names it with an empty report, keeps no raw error text, and stays under the cap', async () => {
    const stored = await storedMatrixError();
    prismaMock.matrixRun.findMany.mockResolvedValue([
      { id: RUN, status: 'FAILED', stage: 'SCORE', startedAt: new Date(Date.now() - 30_000), error: stored },
    ]);
    const { buildServerContext } = await import('./context');
    const { computeFingerprint } = await import('./fingerprint');
    const built = await buildServerContext({
      userId: USER,
      client: {
        route: `/en/growth/${WS}`,
        locale: 'en',
        viewport: { w: 1280, h: 800 },
        breadcrumbs: [],
        consoleErrors: [],
        viewedIds: { workspaceId: WS, matrixRunId: RUN },
      },
    });
    expect(built.causeCode).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(built.failedAction).toBe('matrix_run');
    expect(built.context.failedRuns[0]).toMatchObject({ kind: 'matrix', id: RUN, code: 'PROVIDER_OUT_OF_CREDIT' });
    const json = JSON.stringify(built.context);
    expect(json).not.toMatch(/credits|insufficient_quota|all_unavailable|AI_UNAVAILABLE|api\.openai|sk-/i);
    expect(json.length).toBeLessThan(32 * 1024);
    // Two users with the same failure share one fingerprint.
    const fp = (route: string) => computeFingerprint({ causeCode: built.causeCode, failedAction: built.failedAction, route });
    expect(fp('/en/growth/clws0000000000000000000a1')).toBe(fp('/en/growth/clws0000000000000000000b2'));
  });

  // GAP 1 (real, found by running it): provider health puts OpenAI in a 15-minute cooldown after a billing
  // failure, and every run in that window stores "openai:cooling_down" with the reason dropped by
  // describeAiFailure. cause.ts then reads the neighbouring "anthropic:not_configured" as PROVIDER_AUTH.
  it('a run that fails while the provider is cooling down from a billing error is still out-of-credit', async () => {
    await storedMatrixError(); // opens the cooldown
    const second = await storedMatrixError();
    expect(second).toContain('cooling_down');
    const { classifyCauseFromStored } = await import('./cause');
    expect(classifyCauseFromStored(second)).toBe('PROVIDER_OUT_OF_CREDIT');
  });

  // GAP 2 (real): matrices/openai.ts calls runAiTask without a context, so its ai_provider_events rows carry no
  // workspaceId and the report's aiProviderEvents (filtered by workspace) is empty for every matrix failure.
  it('the provider event written for a matrix failure carries the run workspace', async () => {
    const { runWithAiContext } = await import('@/lib/ai-usage');
    await runWithAiContext({ userId: USER, workspaceId: WS }, () => storedMatrixError());
    const rows = prismaMock.aiProviderEvent.create.mock.calls.map((c) => (c as unknown as [{ data: { workspaceId: string | null } }])[0].data);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.workspaceId === WS)).toBe(true);
  });
});
