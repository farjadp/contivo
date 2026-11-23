/**
 * Art direction for the picture that ships with a post.
 *
 * Before 23 Nov the brief asked for "a flat, editorial, abstract illustration
 * … as a visual metaphor", so every post got the same kind of geometric
 * shapes, whatever it said (Farjad: "these images are not good at all").
 * Now the picture shows something concrete from the post: a subject, setting
 * or object a reader recognises as this post's topic. Look by industry:
 * a natural editorial photo for local services, a clean concrete illustration
 * for software and B2B. Abstract is only an explicit option.
 *
 * Kept rules: no text, letters, numbers or logos in the picture (image models
 * still garble text), and no AI clip art.
 *
 * Pure module: prompt text, style choice, the relevance guard and the
 * fallback. The model call lives in content-image.ts.
 */

export type ImageStyle = 'photo' | 'illustration' | 'abstract';

export type BriefJson = { subject?: unknown; setting?: unknown; prompt?: unknown; alt?: unknown };

export type BriefContext = {
  topic: string;
  body: string;
  industry: string | null;
  audience: string | null;
  style: ImageStyle;
  /** Framing for this post; varies across posts so a feed does not repeat one scene. */
  composition?: string;
};

/**
 * Framings rotated across posts. Without this, five posts about founders and
 * drafts got five pictures of one woman at one desk (eval, 23 Nov).
 */
export const COMPOSITIONS: readonly string[] = [
  'a close-up of the key object, with hands in frame',
  'a wide shot of the setting, people small in the frame',
  'an over-the-shoulder view of someone mid-task',
  'a still life of the objects involved, no people',
  'a candid medium shot of two people working on it together',
  'a top-down view of the objects on a surface',
];

/** Same post → same framing (regeneration is stable); different posts spread out. */
export function compositionFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return COMPOSITIONS[h % COMPOSITIONS.length];
}

const LOCAL_SERVICE_RE =
  /clinic|dental|dentist|medical|physician|doctor|health|pharma|therap|real ?estate|realt|brokerage|immigration|law\b|legal|lawyer|venue|event|restaurant|caf[eé]|bakery|salon|spa\b|fitness|gym|retail|store|shop|builder|construction|renovat|home|architect|hotel|travel|school|tutor|universit|academ|accounting|insurance|mortgage/i;
const TECH_RE = /software|saas|b2b|platform|tech|\bai\b|automation|marketing|agency|analytics|fintech|app\b|cloud|data/i;

/** Photo for local services, illustration for software/B2B; photo when unknown. */
export function styleForIndustry(industry: string | null | undefined): ImageStyle {
  const text = String(industry ?? '');
  if (LOCAL_SERVICE_RE.test(text)) return 'photo';
  if (TECH_RE.test(text)) return 'illustration';
  return 'photo';
}

const STYLE_LINE: Record<ImageStyle, string> = {
  photo:
    'A natural editorial photograph: a real place, available light, candid and unposed, shallow depth of field, true-to-life colour. Not glossy stock photography.',
  illustration:
    'A clean editorial illustration of real, recognisable things (people, objects, places from the post), flat colour with a limited palette and simple shading. Concrete, not abstract shapes.',
  abstract:
    'An abstract editorial illustration: simple shapes and a limited palette that stand for the post’s idea.',
};

export function readBrand(brandSummary: unknown): { industry: string | null; audience: string | null } {
  const b = (brandSummary ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
  return { industry: str(b.industry), audience: str(b.targetAudience) ?? str(b.audience) };
}

export function buildBriefPrompt(ctx: BriefContext, feedback?: string): string {
  return `Art-direct one picture for this social post. The picture must be about THIS post: someone who reads the post and then sees the picture should recognise the topic at once.

Industry: ${ctx.industry ?? 'business services'}
Audience: ${ctx.audience ?? 'the business’s customers'}
Post topic: ${ctx.topic}
Post: """${ctx.body.slice(0, 1500)}"""

Step 1. Pick the most concrete, specific thing in the post that can be photographed or drawn: a person doing the task the post is about, the object it is about, the place it happens. Literal beats metaphor. If the post is about a problem, show the situation in which the problem happens.
Step 2. Write the image prompt in English, in this look:
${STYLE_LINE[ctx.style]}
Framing: ${ctx.composition ?? COMPOSITIONS[0]}. Do not default to a person sitting at a desk with a laptop; use that only when the post is specifically about desk work and the framing allows it.

Hard rules for the image prompt:
- Name the concrete subject and the setting explicitly.
- People are welcome when they fit: real-looking, candid, mid-task, not smiling at the camera.
- No text, letters, numbers, words, signs, logos or readable screens anywhere in the picture (screens, papers and signs are blank or out of focus).
- No AI clichés: no robots, glowing brains, holograms, circuit boards, handshakes, thumbs-up, light bulbs, rocket ships, chess pieces.
- No abstract shapes or geometric compositions${ctx.style === 'abstract' ? ' unless they stand for the post’s idea' : ''}.
- One scene, one focal point, square framing. Under 70 words.

Also write alt text: one factual sentence describing what the picture shows, for a screen reader.
${feedback ? `\nYour previous brief was rejected: ${feedback}. Write a new one that names a concrete subject from the post.\n` : ''}
Return JSON only: {"subject": "the concrete thing shown, 2-6 words", "setting": "where, 2-6 words", "prompt": "...", "alt": "..."}`;
}

const GENERIC_RE =
  /\b(abstract|geometric|geometry|shapes?|metaphor(ical)?|minimal(ist)?|gradient|nodes?|swirl(s|ing)?|bauhaus|circles?|triangles?|squares?|polygons?|ascending line|network of lines|concept(ual)? art)\b/i;

const STOP = new Set(
  'about after again also among because before being between could doesn every first from have having into itself just less like make many more most much need never only other over really same should since some still such than that their them then there these they thing things this those through very want what when where which while with without would your yours youre'.split(' '),
);

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{5,}/g) ?? [];
  return new Set(words.filter((w) => !STOP.has(w)));
}

/**
 * Null when the brief is concrete enough; otherwise why not. Cheap and local:
 * no extra model call unless it fails.
 */
export function briefProblem(brief: BriefJson | undefined, ctx: BriefContext): string | null {
  const prompt = String(brief?.prompt ?? '').trim();
  const subject = String(brief?.subject ?? '').trim();
  if (prompt.length < 30) return 'it was empty or too short';
  if (!subject) return 'it named no concrete subject';
  if (ctx.style !== 'abstract') {
    const generic = `${subject} ${prompt}`.match(GENERIC_RE);
    if (generic) return `it was abstract ("${generic[0]}") instead of showing something from the post`;
  }
  // Relevance by shared words, only when the post is in a Latin script (the
  // brief is always English; a Persian post shares no words with it).
  const postText = `${ctx.topic} ${ctx.body}`;
  const latin = (postText.match(/[A-Za-z]/g) ?? []).length;
  const nonLatin = (postText.match(/[؀-ۿ֐-׿]/g) ?? []).length;
  if (latin > nonLatin) {
    const post = contentWords(postText);
    if (post.size === 0) return null; // nothing to compare against
    const shared = [...contentWords(`${subject} ${String(brief?.setting ?? '')} ${prompt}`)].filter((w) => post.has(w));
    if (shared.length === 0) return 'it shared no subject with the post';
  }
  return null;
}

const FALLBACK_SCENE: Record<ImageStyle, string> = {
  photo: 'Natural editorial photograph, real setting, available light, candid',
  illustration: 'Clean editorial illustration of real objects and people, flat colour, limited palette',
  abstract: 'Abstract editorial illustration, simple shapes, limited palette',
};

/**
 * Used when the model fails twice or is down. Built from the post's own
 * subject (the model's `subject`/`setting` when it gave them, else the topic)
 * so even the fallback is about the post, never a neutral house picture.
 */
export function fallbackBrief(ctx: BriefContext, brief?: BriefJson): { prompt: string; altText: string } {
  const clean = (v: unknown) =>
    String(v ?? '')
      .replace(/["“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  const subject = clean(brief?.subject) && !GENERIC_RE.test(clean(brief?.subject)) ? clean(brief?.subject) : clean(ctx.topic);
  const setting = clean(brief?.setting) || (ctx.industry ? `a typical ${clean(ctx.industry).toLowerCase()} setting` : 'a real workplace');
  return {
    prompt: `${FALLBACK_SCENE[ctx.style]}: ${subject}, in ${setting}. One focal point, square framing. No text, no letters, no numbers, no logos, no readable screens.`,
    altText: `Picture of ${subject}, in ${setting}`,
  };
}
