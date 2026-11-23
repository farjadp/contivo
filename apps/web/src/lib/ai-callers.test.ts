import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  The call sites that used lib/gemini.ts' old JSON helper (or their own
  provider fetch) now call the failover layer directly. Each test pins the
  task, the output kind and what a failed chain does.
*/
const { runAiTaskMock, prismaMock } = vi.hoisted(() => ({
  runAiTaskMock: vi.fn(),
  prismaMock: { contentImage: { deleteMany: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/ai-usage', () => ({
  recordAiUsage: vi.fn(),
  parseOpenAiImageUsage: vi.fn(() => ({})),
  resolveResponseModel: vi.fn((_d: unknown, m: string) => m),
}));

import { humanizeDraft } from './humanize';
import { draftStorylines, proposeChanges } from './narrative/engine';
import { generateImageForContentItem } from './content-image';
import { EMPTY_NARRATIVE, generateNarrative } from './report/narrative';

const FAILURE = { ok: false, kind: 'all_unavailable', attempts: [], firstErrorClass: 'billing', allRateLimited: false };
const ok = (json: unknown, provider = 'gemini') => ({ ok: true, provider, model: 'm', text: JSON.stringify(json), json, usage: {}, failedOver: [] });

const narrativeCtx = { brandSummary: {}, competitiveMatrices: {}, competitorKeywordsIntel: {}, competitors: [] };

beforeEach(() => {
  runAiTaskMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('humanizeDraft', () => {
  const draft = 'This is the original post about dental care for busy families in town.';

  it('uses the humanize task, json_object, 120 s, and the caller context', async () => {
    runAiTaskMock.mockResolvedValue(ok({ text: 'This is the rewritten post about dental care for busy families here.' }));
    const result = await humanizeDraft({ text: draft, channel: 'LINKEDIN', brandSummary: {}, ctx: { workspaceId: 'ws-1' } });

    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('humanize');
    expect(request.output).toEqual({ kind: 'json_object' });
    expect(request.timeoutMs).toBe(120_000);
    expect(ctx).toEqual({ workspaceId: 'ws-1' });
    expect(result.source).toBe('ai');
  });

  it('keeps the original when the chain fails', async () => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    const result = await humanizeDraft({ text: draft, channel: 'LINKEDIN', brandSummary: {} });
    expect(result).toMatchObject({ text: draft, changed: false, source: 'unchanged' });
  });
});

describe('narrative engine', () => {
  it('proposeChanges uses narrative_change and returns the answering provider', async () => {
    runAiTaskMock.mockResolvedValue(ok({ options: [{ change: 'Clinics book online now', rationale: 'r', evidence: [] }] }, 'anthropic'));
    const result = await proposeChanges(narrativeCtx, { workspaceId: 'ws-1' });
    expect(runAiTaskMock.mock.calls[0][0]).toBe('narrative_change');
    expect(runAiTaskMock.mock.calls[0][1].output).toEqual({ kind: 'json_object' });
    expect(runAiTaskMock.mock.calls[0][2]).toEqual({ workspaceId: 'ws-1' });
    expect(result?.provider).toBe('anthropic');
  });

  it('draftStorylines uses storylines; both return null on chain failure', async () => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    await expect(draftStorylines(narrativeCtx, 'change', [])).resolves.toBeNull();
    expect(runAiTaskMock.mock.calls[0][0]).toBe('storylines');
    await expect(proposeChanges(narrativeCtx)).resolves.toBeNull();
  });
});

describe('content image prompt', () => {
  it('asks image_prompt for the brief; image generation itself stays OpenAI direct', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test');
    const fetchMock = vi.fn(async () => new Response('down', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    runAiTaskMock.mockResolvedValue(
      ok({ subject: 'baker shaping dough', setting: 'small bakery', prompt: 'A baker shaping dough on a floured counter in a small bakery, morning light. No text.', alt: 'A baker' }),
    );

    await generateImageForContentItem({ contentItemId: 'i', workspaceId: 'ws-1', topic: 't', body: 'b', brandSummary: {} });

    expect(runAiTaskMock.mock.calls[0][0]).toBe('image_prompt');
    expect(runAiTaskMock.mock.calls[0][2]).toEqual({ workspaceId: 'ws-1' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(String(init.body)).prompt).toBe('A baker shaping dough on a floured counter in a small bakery, morning light. No text.');
  });
});

describe('report narrative', () => {
  const input = { companyName: 'Acme', brandSummary: {}, matrices: [], keywords: [], contentGaps: [], offerings: [] };

  it('uses report_narrative with json_object, 8192 tokens, and no model of its own', async () => {
    runAiTaskMock.mockResolvedValue(ok({ executiveSummary: ['One.', 'Two.'] }));
    const result = await generateNarrative(input, { workspaceId: 'ws-1' });
    const [task, request] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('report_narrative');
    expect(request).toMatchObject({ output: { kind: 'json_object' }, maxTokens: 8192, timeoutMs: 120_000 });
    expect(request.modelOverride).toBeUndefined();
    expect(result).toEqual({ narrative: { ...EMPTY_NARRATIVE, executiveSummary: ['One.', 'Two.'] }, degraded: false });
  });

  it('degrades to the honest empty narrative when the chain fails', async () => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    await expect(generateNarrative(input)).resolves.toEqual({ narrative: EMPTY_NARRATIVE, degraded: true });
  });
});
