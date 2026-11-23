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
import {
  briefProblem,
  buildBriefPrompt,
  compositionFor,
  fallbackBrief,
  readBrand,
  styleForIndustry,
  type BriefContext,
  type BriefJson,
  type ImageStyle,
} from '@/lib/content-image-brief';
import type { CauseCode } from '@/lib/bug-report/types';

export type { ImageCause } from '@/lib/ai/image';

export type GeneratedImage = {
  id: string;
  prompt: string;
  altText: string;
  bytes: number;
};

/**
 * Turns a post into an art-direction brief that shows something concrete from
 * the post (content-image-brief.ts). A brief that reads as generic or
 * abstract is rewritten once; if it still fails, or the model is down, the
 * fallback is built from the post's own subject.
 */
export async function buildImageBrief(input: {
  topic: string;
  body: string;
  brandSummary: unknown;
  workspaceId?: string;
  style?: ImageStyle;
  /** Seed for the framing; the content item id in production. */
  seed?: string;
}): Promise<{ prompt: string; altText: string; style: ImageStyle; source: 'model' | 'model_retry' | 'fallback' }> {
  const { industry, audience } = readBrand(input.brandSummary);
  const ctx: BriefContext = {
    topic: String(input.topic ?? ''),
    body: String(input.body ?? ''),
    industry,
    audience,
    style: input.style ?? styleForIndustry(industry),
    composition: compositionFor(input.seed ?? String(input.topic ?? '')),
  };

  const ask = async (feedback?: string): Promise<BriefJson | undefined> => {
    const result = await runAiTask(
      'image_prompt',
      {
        system: 'You are a photo editor and art director for a business publication. Return only valid JSON.',
        output: { kind: 'json_object' },
        timeoutMs: 60_000,
        prompt: buildBriefPrompt(ctx, feedback),
      },
      { workspaceId: input.workspaceId },
    );
    if (!result.ok) {
      console.error(`[content-image] image prompt AI ${result.kind} (first error: ${result.firstErrorClass}); using the post-based fallback`);
      return undefined;
    }
    return result.json as BriefJson | undefined;
  };

  const first = await ask();
  if (first === undefined) return { ...fallbackBrief(ctx), style: ctx.style, source: 'fallback' };
  const problem = briefProblem(first, ctx);
  if (!problem) return { ...toBrief(first, ctx), style: ctx.style, source: 'model' };

  const second = await ask(problem);
  if (second !== undefined && !briefProblem(second, ctx)) {
    return { ...toBrief(second, ctx), style: ctx.style, source: 'model_retry' };
  }
  console.error(`[content-image] image brief still generic after one rewrite (${problem}); using the post-based fallback`);
  return { ...fallbackBrief(ctx, second ?? first), style: ctx.style, source: 'fallback' };
}

function toBrief(brief: BriefJson, ctx: BriefContext): { prompt: string; altText: string } {
  const prompt = String(brief.prompt ?? '').trim();
  const alt = String(brief.alt ?? '').trim();
  // The no-text rule is restated on every prompt: the model's own brief may drop it.
  const guarded = /no text/i.test(prompt) ? prompt : `${prompt} No text, letters, numbers or logos anywhere.`;
  return { prompt: guarded, altText: alt || fallbackBrief(ctx, brief).altText };
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
    const { prompt, altText } = await buildImageBrief({ ...input, seed: input.contentItemId });

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
