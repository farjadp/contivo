/**
 * content-image.ts
 *
 * Generates the artwork that ships with a post.
 *
 * Uses OpenAI images: Gemini's image models return 429 on this project's key
 * (the free tier has no image quota), so routing there would just burn the
 * cooldown and fail. If that changes, try Gemini first and fall back here.
 *
 * Bytes go into `content_images` rather than the filesystem — the web app runs
 * on a read-only serverless FS, and the Nest publisher reads the same row when
 * uploading to LinkedIn.
 */

import { parseOpenAiImageUsage, recordAiUsage, resolveResponseModel } from '@/lib/ai-usage';
import { prisma } from '@/lib/db';
import { runAiTask } from '@/lib/ai';
import { generateOpenAiImage, IMAGE_CAUSE_CODE, type ImageCause, type ImageDeps } from '@/lib/ai/image';
import type { CauseCode } from '@/lib/bug-report/types';

export type { ImageCause } from '@/lib/ai/image';

export type GeneratedImage = {
  id: string;
  prompt: string;
  altText: string;
  bytes: number;
};

/**
 * Turns a post into an art-direction brief. Deliberately steers away from the
 * two failure modes of AI social imagery: text baked into the picture, and
 * generic robot/glowing-brain clip art.
 */
async function buildImageBrief(input: {
  topic: string;
  body: string;
  brandSummary: unknown;
  workspaceId?: string;
}): Promise<{ prompt: string; altText: string }> {
  const brand = input.brandSummary as any;
  const fallbackPrompt =
    'Minimal flat vector illustration, deep navy background, a single bright green ascending line with three node points, generous negative space, editorial business style, no text, no letters, no logos, no people';

  const result = await runAiTask(
    'image_prompt',
    {
      system: 'You are an art director for editorial illustration. Return only valid JSON.',
      output: { kind: 'json_object' },
      timeoutMs: 60_000,
      prompt: `Art-direct one image for this social post.

Industry: ${brand?.industry ?? 'business services'}
Post topic: ${input.topic}
Post: """${String(input.body).slice(0, 1200)}"""

Produce an image prompt for a flat, editorial, abstract illustration that represents the post's core idea as a visual metaphor.

Hard rules for the prompt:
- Absolutely no text, letters, numbers, words or logos in the image.
- No stock-AI cliches: no robots, no glowing brains, no humanoid androids, no circuit-board overlays, no handshakes.
- Abstract or diagrammatic, not literal people at desks.
- Named palette, high contrast, lots of negative space, single focal idea.
- One sentence, under 60 words.

Also write alt text: one factual sentence describing what the image shows, for a screen reader.

Return JSON only: {"prompt": "...", "alt": "..."}`,
    },
    { workspaceId: input.workspaceId },
  );
  if (!result.ok) {
    // The image is decoration: a post without a tailored brief still gets the
    // neutral house illustration below, never invented post content.
    console.error(`[content-image] image prompt AI ${result.kind} (first error: ${result.firstErrorClass}); using the neutral brief`);
  }
  const brief = (result.ok ? result.json : undefined) as { prompt?: unknown; alt?: unknown } | undefined;

  const prompt = String(brief?.prompt || '').trim();
  const alt = String(brief?.alt || '').trim();
  return {
    prompt: prompt && prompt.length > 20 ? prompt : fallbackPrompt,
    altText: alt || `Abstract illustration representing ${input.topic}`,
  };
}

export type ImageInput = {
  contentItemId: string;
  workspaceId: string;
  userId?: string;
  topic: string;
  body: string;
  brandSummary: unknown;
};

export type ImageOutcome =
  | { ok: true; image: GeneratedImage; model: string }
  | { ok: false; cause: ImageCause; model: string | null; message: string };

/**
 * Generates an image for a content item and stores it. A post without artwork
 * is still publishable, so image trouble never blocks the pipeline — but it is
 * never silent either: the outcome carries a coded cause, every failed attempt
 * is an ai_provider_events row, and a failed generation writes a zero-cost
 * `content_image_failed` usage row, so the cost table shows the attempt.
 */
export async function generateImageOutcome(input: ImageInput, deps: ImageDeps = {}): Promise<ImageOutcome> {
  let lastModel: string | null = null;
  try {
    const { prompt, altText } = await buildImageBrief(input);

    const result = await generateOpenAiImage(
      { prompt, workspaceId: input.workspaceId, userId: input.userId ?? null },
      deps,
    );
    lastModel = result.model;

    if (!result.ok) {
      void recordAiUsage({
        provider: 'openai',
        model: result.model ?? 'none',
        feature: 'content_image_failed',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        workspaceId: input.workspaceId,
        userId: input.userId,
      });
      return { ok: false, cause: result.cause, model: result.model, message: result.message };
    }

    void recordAiUsage({
      provider: 'openai',
      model: resolveResponseModel(result.body, result.model),
      feature: 'content_image',
      usage: parseOpenAiImageUsage(result.body),
      workspaceId: input.workspaceId,
      userId: input.userId,
    });

    const buffer = Buffer.from(result.b64, 'base64');

    // One image per item: replace rather than accumulate on regeneration.
    await prisma.contentImage.deleteMany({ where: { contentItemId: input.contentItemId } });
    const row = await prisma.contentImage.create({
      data: {
        contentItemId: input.contentItemId,
        workspaceId: input.workspaceId,
        data: buffer,
        mimeType: 'image/png',
        width: 1024,
        height: 1024,
        prompt,
        altText,
        provider: 'openai',
      },
      select: { id: true },
    });

    return { ok: true, model: result.model, image: { id: row.id, prompt, altText, bytes: buffer.byteLength } };
  } catch (err) {
    // Storing the picture failed (DB), not the provider.
    const message = err instanceof Error ? err.message : String(err);
    console.error('[content-image] error', message);
    return { ok: false, cause: 'IMAGE_STORE_FAILED', model: lastModel, message: `stored no image: ${message.slice(0, 200)}` };
  }
}

/** A failed generation as content-image-service's readGeneratorResult reads it. */
export type ImageFailure = { ok: false; code: ImageCause; cause: CauseCode; model: string | null };

/**
 * The image, or a coded failure: `code` is the ImageCause (logged as
 * failureCode), `cause` the bug-report CauseCode the caller records once with
 * its own ref. This function records no ACTION_FAILED itself.
 */
export async function generateImageForContentItem(input: ImageInput): Promise<GeneratedImage | ImageFailure> {
  const outcome = await generateImageOutcome(input);
  if (outcome.ok) return outcome.image;
  return { ok: false, code: outcome.cause, cause: IMAGE_CAUSE_CODE[outcome.cause], model: outcome.model };
}
