// Image generation for video backgrounds.
//
// OpenAI only for now: Contivo's Gemini key has no image quota (429), see
// apps/web/src/lib/content-image.ts. IMAGE_MODEL lets you switch to a newer
// model (e.g. gpt-image-2) without a code change.

import { writeFile } from 'node:fs/promises';

const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-1';
const PORTRAIT = '1024x1536';

// Steers away from the two classic failures: text baked into the image and
// flags/logos/faces that create legal or brand risk.
const GUARD = 'vertical composition, cinematic, no text, no letters, no logos, no flags, no recognizable faces';

export async function generateImage(prompt, outFile) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt: `${prompt}. ${GUARD}`, size: PORTRAIT, n: 1 }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`image generation failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('image generation returned no image');
  await writeFile(outFile, Buffer.from(b64, 'base64'));
  return outFile;
}
