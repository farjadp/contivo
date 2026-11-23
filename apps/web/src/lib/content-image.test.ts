import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runAiTask, recordAiUsage, generateOpenAiImage, prismaMock } = vi.hoisted(() => ({
  runAiTask: vi.fn(),
  recordAiUsage: vi.fn(),
  generateOpenAiImage: vi.fn(),
  prismaMock: { contentImage: { deleteMany: vi.fn(), create: vi.fn() } },
}));

vi.mock('@/lib/ai', () => ({ runAiTask }));
vi.mock('@/lib/ai/image', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/image')>()), generateOpenAiImage }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/ai-usage', async (orig) => ({ ...(await orig<typeof import('@/lib/ai-usage')>()), recordAiUsage }));

import { generateImageForContentItem, generateImageOutcome } from './content-image';

const input = { contentItemId: 'item-1', workspaceId: 'ws-1', userId: 'u-1', topic: 'Plans', body: 'Body', brandSummary: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  runAiTask.mockResolvedValue({
    ok: true,
    json: { subject: 'founder sorting plans', setting: 'small office', prompt: 'A founder at a desk sorting printed plans for the week, natural window light.', alt: 'A green line' },
  });
  prismaMock.contentImage.create.mockResolvedValue({ id: 'img-1' });
});

describe('generateImageOutcome', () => {
  it('stores the picture and logs its cost under the model that made it', async () => {
    generateOpenAiImage.mockResolvedValue({
      ok: true,
      b64: Buffer.from('png').toString('base64'),
      model: 'gpt-image-2.5-flare',
      body: { usage: { input_tokens: 50, output_tokens: 439, total_tokens: 489 }, data: [{}] },
      attempts: [],
      ms: 9000,
    });
    const out = await generateImageOutcome(input);
    expect(out).toMatchObject({ ok: true, model: 'gpt-image-2.5-flare', image: { id: 'img-1', altText: 'A green line' } });
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'content_image', model: 'gpt-image-2.5-flare', workspaceId: 'ws-1', userId: 'u-1' }),
    );
    expect(generateOpenAiImage.mock.calls[0][0]).toMatchObject({ workspaceId: 'ws-1', userId: 'u-1' });
  });

  it('a failure returns its cause, writes a content_image_failed usage row, and stores nothing', async () => {
    generateOpenAiImage.mockResolvedValue({
      ok: false,
      cause: 'IMAGE_MODEL_UNAVAILABLE',
      model: 'gpt-image-2.5-sunburst',
      attempts: [],
      message: 'gone',
    });
    const out = await generateImageOutcome(input);
    expect(out).toMatchObject({ ok: false, cause: 'IMAGE_MODEL_UNAVAILABLE', model: 'gpt-image-2.5-sunburst' });
    expect(recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'content_image_failed', model: 'gpt-image-2.5-sunburst', workspaceId: 'ws-1' }),
    );
    expect(prismaMock.contentImage.create).not.toHaveBeenCalled();
    expect(prismaMock.contentImage.deleteMany).not.toHaveBeenCalled();
  });

  it('IMAGE_STORE_FAILED when the picture was made but could not be saved', async () => {
    generateOpenAiImage.mockResolvedValue({ ok: true, b64: 'cG5n', model: 'gpt-image-2.5-flare', body: {}, attempts: [], ms: 1 });
    prismaMock.contentImage.create.mockRejectedValue(new Error('db down'));
    const out = await generateImageOutcome(input);
    expect(out).toMatchObject({ ok: false, cause: 'IMAGE_STORE_FAILED', model: 'gpt-image-2.5-flare' });
  });

  it('the wrapper returns a coded failure a caller can record (a retired model is not an outage)', async () => {
    generateOpenAiImage.mockResolvedValue({ ok: false, cause: 'IMAGE_MODEL_UNAVAILABLE', model: 'x', attempts: [], message: 'gone' });
    await expect(generateImageForContentItem(input)).resolves.toEqual({
      ok: false,
      code: 'IMAGE_MODEL_UNAVAILABLE',
      cause: 'PROVIDER_AUTH',
      model: 'x',
    });
  });

  it('every image cause maps to a real bug-report cause code', async () => {
    const { IMAGE_CAUSES, IMAGE_CAUSE_CODE } = await vi.importActual<typeof import('@/lib/ai/image')>('@/lib/ai/image');
    const { CAUSE_CODES } = await import('@/lib/bug-report/types');
    for (const c of IMAGE_CAUSES) expect(CAUSE_CODES).toContain(IMAGE_CAUSE_CODE[c]);
  });

  it("content-image-service's reader records the retired model as PROVIDER_AUTH with the image code (PR #65 contract)", async () => {
    const { readGeneratorResult } = await import('./content-image-service');
    generateOpenAiImage.mockResolvedValue({ ok: false, cause: 'IMAGE_MODEL_UNAVAILABLE', model: 'x', attempts: [], message: 'gone' });
    const read = readGeneratorResult(await generateImageForContentItem(input));
    expect(read).toMatchObject({ ok: false, cause: 'PROVIDER_AUTH' });
    // PR #67 makes failureCode prefer `code`; either order must land cleanly.
    expect(['IMAGE_MODEL_UNAVAILABLE', 'PROVIDER_AUTH']).toContain((read as { failureCode: string | null }).failureCode);
  });
});

describe('buildImageBrief', () => {
  it('rewrites a generic brief once, with the reason, and keeps the rewrite', async () => {
    const { buildImageBrief } = await import('./content-image');
    runAiTask
      .mockResolvedValueOnce({ ok: true, json: { subject: 'geometric funnel', prompt: 'Bauhaus geometric funnel of circles and triangles, navy.', alt: 'x' } })
      .mockResolvedValueOnce({ ok: true, json: { subject: 'founder sorting plans', setting: 'office', prompt: 'A founder sorting printed plans at a desk, natural light.', alt: 'A founder' } });
    const b = await buildImageBrief({ topic: 'Plans', body: 'Body', brandSummary: { industry: 'B2B SaaS' } });
    expect(b).toMatchObject({ source: 'model_retry', style: 'illustration', altText: 'A founder' });
    expect(String(runAiTask.mock.calls[1][1].prompt)).toMatch(/previous brief was rejected: it was abstract/);
    expect(b.prompt).toMatch(/No text/);
  });

  it('falls back to the post subject after a second generic brief, or when the model is down', async () => {
    const { buildImageBrief } = await import('./content-image');
    runAiTask.mockResolvedValue({ ok: true, json: { subject: 'shapes', prompt: 'Abstract shapes and gradients on navy, minimal.', alt: 'x' } });
    const b = await buildImageBrief({ topic: 'Getting your flu shot', body: 'Book a walk-in slot.', brandSummary: { industry: 'Medical clinic' } });
    expect(b).toMatchObject({ source: 'fallback', style: 'photo' });
    expect(b.prompt).toMatch(/Getting your flu shot/);
    expect(runAiTask).toHaveBeenCalledTimes(2);

    runAiTask.mockReset();
    runAiTask.mockResolvedValue({ ok: false, kind: 'all_unavailable', firstErrorClass: 'server' });
    const down = await buildImageBrief({ topic: 'Getting your flu shot', body: 'x', brandSummary: {} });
    expect(down).toMatchObject({ source: 'fallback' });
    expect(down.prompt).not.toMatch(/navy/);
    expect(runAiTask).toHaveBeenCalledTimes(1);
  });
});
