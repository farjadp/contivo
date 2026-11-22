import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  lib/gemini.ts on the failover layer. The layer is mocked: these tests pin
  what each function asks for (task, output kind, timeout, context) and that a
  failed chain gives null — never the template text that used to stand in for
  a real generation.
*/
const { runAiTaskMock } = vi.hoisted(() => ({ runAiTaskMock: vi.fn() }));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));

import {
  analyzeSerpResultsWithGemini,
  analyzeWebsiteWithGemini,
  generateContentDraftWithGemini,
  generateContentIdeasWithGemini,
  generateInstantDraft,
  generatePositioningInsights,
  scrapeUrl,
} from './gemini';

const FAILURE = {
  ok: false as const,
  kind: 'all_unavailable' as const,
  attempts: [],
  firstErrorClass: 'rate_limit' as const,
  allRateLimited: true,
};

function ok(extra: { text?: string; json?: unknown; provider?: string }) {
  return { ok: true, provider: extra.provider ?? 'gemini', model: 'm', text: extra.text ?? '', json: extra.json, usage: {}, failedOver: [] };
}

// Phrases that only the removed heuristics produced.
const TEMPLATE_PHRASES = [
  'Practical next step',
  'Clarify the single outcome',
  'Business Services',
  'General business audience',
  'Get Started',
  'Most of the',
  'heuristic fallback',
  'Practical playbook for',
];

function expectNoTemplate(value: unknown) {
  const text = JSON.stringify(value ?? null);
  for (const phrase of TEMPLATE_PHRASES) expect(text).not.toContain(phrase);
}

const brand = { industry: 'Dental clinic', audience: 'Families', valueProposition: 'Same-day care', pillars: ['Care'] };

beforeEach(() => {
  runAiTaskMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('analyzeWebsiteWithGemini', () => {
  it('asks website_analysis for a strict brand schema and passes the context', async () => {
    runAiTaskMock.mockResolvedValue(
      ok({
        json: {
          heroMessage: 'Dental care for the whole family',
          extractedCta: 'Book',
          industry: 'Dental clinic',
          businessSummary: 'A family dental clinic in Newmarket.',
          audience: 'Families',
          tone: 'warm, clear',
          valueProposition: 'Same-day appointments',
          pillars: ['Prevention', 'Read more'],
          persona: { title: 'Parent', description: 'Books care for three kids.' },
        },
      }),
    );

    const result = await analyzeWebsiteWithGemini('acme.com', 'text', 'EN', { workspaceId: 'ws-1', userId: 'u-1' });

    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('website_analysis');
    expect(request.output).toMatchObject({ kind: 'json_schema', name: 'brand_extraction' });
    expect(request.system).toMatch(/Brand Strategist/);
    expect(request.timeoutMs).toBe(60_000);
    expect(ctx).toEqual({ workspaceId: 'ws-1', userId: 'u-1' });
    // Short model values are kept now ("Book", "Families"); scrape debris is dropped.
    expect(result).toMatchObject({ extractedCta: 'Book', audience: 'Families', pillars: ['Prevention'] });
  });

  it('returns null when the chain fails — no regex brand extraction', async () => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    const result = await analyzeWebsiteWithGemini('acme.com', 'We help founders grow. Start free trial.');
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/website_analysis.*rate_limit/));
  });

  it('leaves fields the model left empty empty, and is null when nothing usable came back', async () => {
    runAiTaskMock.mockResolvedValueOnce(
      ok({ json: { industry: 'Dental clinic', heroMessage: '', extractedCta: '', businessSummary: '', audience: '', tone: '', valueProposition: '', pillars: [], persona: { title: '', description: '' } } }),
    );
    const partial = await analyzeWebsiteWithGemini('acme.com', 'text');
    expect(partial).toMatchObject({ industry: 'Dental clinic', audience: '', extractedCta: '', pillars: [] });
    expectNoTemplate(partial);

    runAiTaskMock.mockResolvedValueOnce(
      ok({ json: { industry: '', heroMessage: '', extractedCta: '', businessSummary: '', audience: '', tone: '', valueProposition: '', pillars: [], persona: { title: '', description: '' } } }),
    );
    await expect(analyzeWebsiteWithGemini('acme.com', 'text')).resolves.toBeNull();
  });
});

describe('generateContentIdeasWithGemini', () => {
  const options = {
    marketMatrices: { charts: [] },
    competitorKeywordsIntel: { competitors: [{ competitor: 'X' }] },
    requestedIdeaCount: 3,
  };

  it('asks content_ideas for strict JSON and returns only the ideas the model wrote (no padding)', async () => {
    runAiTaskMock.mockResolvedValue(
      ok({
        json: {
          ideas: [{ topic: 'Same-day care', angle: 'Why waiting costs families', format: 'LinkedIn Post', pillar: 'Care', brand_anchor: '', market_anchor: '', keyword_anchor: '', image_briefs: [] }],
          quality_scores: { brand_fit: 9, audience_fit: 9, goal_fit: 9, platform_fit: 9, clarity_usefulness: 9, overall_score: 9 },
        },
      }),
    );

    const result = await generateContentIdeasWithGemini(brand, options, { workspaceId: 'ws-1' });

    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('content_ideas');
    expect(request.output).toMatchObject({ kind: 'json_schema', name: 'content_ideas' });
    expect(ctx).toEqual({ workspaceId: 'ws-1' });
    expect(result?.ideas).toHaveLength(1);
    expect(result?.ideas[0].topic).toBe('Same-day care');
    expectNoTemplate(result);
  });

  it('returns null when the chain fails — no template ideas with made-up scores', async () => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    await expect(generateContentIdeasWithGemini(brand, options)).resolves.toBeNull();
  });
});

describe('generateContentDraftWithGemini', () => {
  it('asks content_draft for text with the long-draft timeout and returns the text', async () => {
    runAiTaskMock.mockResolvedValue(ok({ text: '  A real post.  ', provider: 'anthropic' }));

    const draft = await generateContentDraftWithGemini(brand, 'Topic', 'ctx', 'LINKEDIN', undefined, null, 'EN', {
      userId: 'u-1',
      workspaceId: 'ws-1',
    });

    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('content_draft');
    expect(request.output).toEqual({ kind: 'text' });
    expect(request.timeoutMs).toBe(120_000);
    expect(request.system).toMatch(/copywriter/);
    expect(ctx).toEqual({ userId: 'u-1', workspaceId: 'ws-1' });
    expect(draft).toBe('A real post.');
  });

  it.each(['LINKEDIN', 'EMAIL', 'BLOG'])('returns null for %s when the chain fails — no fallbackDraft template', async (channel) => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    const draft = await generateContentDraftWithGemini(brand, 'Topic', 'Context', channel);
    expect(draft).toBeNull();
  });
});

describe('generateInstantDraft', () => {
  it('uses instant_draft and reports whichever provider answered', async () => {
    runAiTaskMock.mockResolvedValue(ok({ text: 'Post', provider: 'anthropic' }));
    await expect(generateInstantDraft({ topic: 't', channel: 'linkedin', ctx: { userId: 'u-1' } })).resolves.toEqual({
      content: 'Post',
      provider: 'anthropic',
    });
    expect(runAiTaskMock.mock.calls[0][0]).toBe('instant_draft');
    expect(runAiTaskMock.mock.calls[0][2]).toEqual({ userId: 'u-1' });
  });

  it('returns null when the chain fails', async () => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    await expect(generateInstantDraft({ topic: 't', channel: 'linkedin' })).resolves.toBeNull();
  });
});

describe('generatePositioningInsights', () => {
  it('uses the positioning task with a strict schema', async () => {
    runAiTaskMock.mockResolvedValue(ok({ json: { positioningOpportunity: 'Own speed.', messagingDifferentiation: 'Say same-day.' } }));
    await expect(generatePositioningInsights(brand, [])).resolves.toEqual({
      positioningOpportunity: 'Own speed.',
      messagingDifferentiation: 'Say same-day.',
    });
    expect(runAiTaskMock.mock.calls[0][0]).toBe('positioning');
    expect(runAiTaskMock.mock.calls[0][1].output.kind).toBe('json_schema');
  });

  it('returns null when the chain fails — no fallbackPositioning template', async () => {
    runAiTaskMock.mockResolvedValue(FAILURE);
    await expect(generatePositioningInsights(brand, [{ name: 'A' }, { name: 'B' }])).resolves.toBeNull();
  });
});

describe('analyzeSerpResultsWithGemini', () => {
  it('uses serp_analysis text and returns null on failure', async () => {
    runAiTaskMock.mockResolvedValueOnce(ok({ text: 'Report' }));
    await expect(analyzeSerpResultsWithGemini('kw', [])).resolves.toBe('Report');
    expect(runAiTaskMock.mock.calls[0][0]).toBe('serp_analysis');
    expect(runAiTaskMock.mock.calls[0][1].output).toEqual({ kind: 'text' });

    runAiTaskMock.mockResolvedValueOnce(FAILURE);
    await expect(analyzeSerpResultsWithGemini('kw', [])).resolves.toBeNull();
  });
});

describe('scrapeUrl', () => {
  it('keeps Persian lines (they used to be dropped as junk by a non-Unicode \\W test)', async () => {
    const html = `<html><head><title>کلینیک دندانپزشکی خانواده</title></head><body>
      <p>ما در نیومارکت به خانواده‌ها خدمات دندانپزشکی همان روز می‌دهیم.</p>
      <p>© 2026</p></body></html>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })));

    const text = await scrapeUrl('acme.ir');
    expect(text).toContain('ما در نیومارکت به خانواده‌ها خدمات دندانپزشکی همان روز می‌دهیم.');
    expect(text).toContain('کلینیک دندانپزشکی خانواده');
    expect(text).not.toContain('© 2026');
  });
});
