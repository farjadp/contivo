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

import { prisma } from '@/lib/db';
import { requestJsonFromAi } from '@/lib/gemini';

const IMAGE_MODEL = 'gpt-image-1';
const IMAGE_SIZE = '1024x1024';

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
}): Promise<{ prompt: string; altText: string }> {
  const brand = input.brandSummary as any;
  const fallbackPrompt =
    'Minimal flat vector illustration, deep navy background, a single bright green ascending line with three node points, generous negative space, editorial business style, no text, no letters, no logos, no people';

  const result = await requestJsonFromAi<{ prompt?: unknown; alt?: unknown }>(
    `Art-direct one image for this social post.

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
    'You are an art director for editorial illustration. Return only valid JSON.',
  );

  const prompt = String(result?.data?.prompt || '').trim();
  const alt = String(result?.data?.alt || '').trim();
  return {
    prompt: prompt && prompt.length > 20 ? prompt : fallbackPrompt,
    altText: alt || `Abstract illustration representing ${input.topic}`,
  };
}

/**
 * Generates an image for a content item and stores it. Returns null on any
 * failure — a post without artwork is still publishable, so image trouble must
 * never block the pipeline.
 */
export async function generateImageForContentItem(input: {
  contentItemId: string;
  workspaceId: string;
  topic: string;
  body: string;
  brandSummary: unknown;
}): Promise<GeneratedImage | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const { prompt, altText } = await buildImageBrief(input);

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: IMAGE_SIZE, n: 1 }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      console.error('[content-image] generation failed', res.status, (await res.text()).slice(0, 300));
      return null;
    }

    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64 || typeof b64 !== 'string') return null;

    const buffer = Buffer.from(b64, 'base64');

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

    return { id: row.id, prompt, altText, bytes: buffer.byteLength };
  } catch (err) {
    console.error('[content-image] error', err instanceof Error ? err.message : err);
    return null;
  }
}
