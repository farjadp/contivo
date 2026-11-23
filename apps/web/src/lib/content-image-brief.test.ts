import { describe, expect, it } from 'vitest';

import { briefProblem, buildBriefPrompt, COMPOSITIONS, compositionFor, fallbackBrief, readBrand, styleForIndustry, type BriefContext } from './content-image-brief';

const POST =
  'AI content that gets details wrong ruins credibility. Founders face this every time they hand drafts to a tool that invents prices and names. Review takes longer than writing.';

const ctx = (over: Partial<BriefContext> = {}): BriefContext => ({
  topic: 'AI drafts that get details wrong',
  body: POST,
  industry: 'B2B SaaS / Marketing Automation',
  audience: 'Founders',
  style: 'illustration',
  ...over,
});

describe('styleForIndustry', () => {
  it('photo for local services, illustration for software, photo when unknown', () => {
    for (const i of ['Medical clinic', 'Dental clinic', 'Real estate agent', 'Immigration consultancy', 'Event venue', 'Architect-led home builder']) {
      expect(styleForIndustry(i), i).toBe('photo');
    }
    for (const i of ['B2B SaaS / Marketing Automation', 'B2B software (currency exchange)', 'Digital marketing agency']) {
      expect(styleForIndustry(i), i).toBe('illustration');
    }
    expect(styleForIndustry(null)).toBe('photo');
  });
});

describe('buildBriefPrompt', () => {
  it('asks for the concrete subject of the post and no longer for an abstract metaphor', () => {
    const p = buildBriefPrompt(ctx());
    expect(p).toMatch(/concrete/);
    expect(p).toMatch(/Literal beats metaphor/);
    expect(p).not.toMatch(/abstract illustration that represents the post's core idea as a visual metaphor/);
    expect(p).toMatch(/No text, letters, numbers/);
    expect(p).toContain(POST);
  });
  it('photo look for a clinic, and the rejection reason on a rewrite', () => {
    const p = buildBriefPrompt(ctx({ style: 'photo', industry: 'Medical clinic' }), 'it was abstract');
    expect(p).toMatch(/natural editorial photograph/i);
    expect(p).toMatch(/previous brief was rejected: it was abstract/);
  });
});

describe('briefProblem (relevance guard)', () => {
  it('accepts a concrete brief that shares a subject with the post', () => {
    expect(
      briefProblem(
        { subject: 'founder reviewing drafts', setting: 'small office', prompt: 'A founder at a desk frowning at printed drafts with prices circled in red pen, late evening office.' },
        ctx(),
      ),
    ).toBeNull();
  });
  it('rejects the Bauhaus-funnel kind of brief Farjad saw', () => {
    expect(
      briefProblem(
        { subject: 'geometric funnel', prompt: 'Bauhaus-style geometric funnel of circles and triangles with coloured bars, navy background.' },
        ctx(),
      ),
    ).toMatch(/abstract/);
  });
  it('rejects a brief with no subject, or one unrelated to the post', () => {
    expect(briefProblem({ prompt: 'A calm lake at sunrise with mountains reflected in still water, soft light.' }, ctx())).toMatch(/no concrete subject/);
    expect(
      briefProblem({ subject: 'lake at sunrise', prompt: 'A calm lake at sunrise with mountains reflected in still water, soft light.' }, ctx()),
    ).toMatch(/shared no subject/);
  });
  it('skips the word-overlap check for a Persian post (the brief is English)', () => {
    const fa = ctx({ body: 'پیش از دادن پیشنهاد خرید، در بازدید از خانه این موارد را بررسی کنید.', topic: 'بازدید خانه', style: 'photo' });
    expect(briefProblem({ subject: 'family touring a house', prompt: 'A young family walking through a sunlit living room during an open house, checking the windows.' }, fa)).toBeNull();
  });
  it('skips the overlap check when the post has no content words to compare', () => {
    expect(briefProblem({ subject: 'baker', prompt: 'A baker shaping dough on a floured counter, morning light.' }, ctx({ topic: 't', body: 'b' }))).toBeNull();
  });
  it('lets an explicit abstract style through', () => {
    expect(briefProblem({ subject: 'drafts', prompt: 'Abstract shapes standing for drafts that get details wrong, limited palette.' }, ctx({ style: 'abstract' }))).toBeNull();
  });
});

describe('fallbackBrief', () => {
  it('is built from the post, never the old navy-and-green house picture', () => {
    const f = fallbackBrief(ctx());
    expect(f.prompt).toContain('AI drafts that get details wrong');
    expect(f.prompt).toMatch(/No text/);
    expect(f.prompt).not.toMatch(/navy|green ascending line/);
  });
  it("uses the model's own subject and setting when they were concrete", () => {
    const f = fallbackBrief(ctx({ style: 'photo' }), { subject: 'nurse giving a flu shot', setting: 'clinic exam room' });
    expect(f.prompt).toMatch(/^Natural editorial photograph.*: nurse giving a flu shot, in clinic exam room\./);
  });
});

describe('readBrand', () => {
  it('reads industry and audience, tolerates junk', () => {
    expect(readBrand({ industry: 'Dental clinic', audience: 'Families' })).toEqual({ industry: 'Dental clinic', audience: 'Families' });
    expect(readBrand(null)).toEqual({ industry: null, audience: null });
  });
});

describe('compositionFor', () => {
  it('is stable per post and spreads across posts', () => {
    expect(compositionFor('item-1')).toBe(compositionFor('item-1'));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => compositionFor(`item-${i}`)));
    expect(seen.size).toBeGreaterThanOrEqual(4);
    for (const c of seen) expect(COMPOSITIONS).toContain(c);
  });
  it('the prompt carries the framing and steers away from the desk-and-laptop default', () => {
    const p = buildBriefPrompt({ ...ctx(), composition: COMPOSITIONS[3] });
    expect(p).toContain(`Framing: ${COMPOSITIONS[3]}`);
    expect(p).toMatch(/Do not default to a person sitting at a desk/);
  });
});
