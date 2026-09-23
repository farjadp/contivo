/**
 * What language a workspace writes in, and what the model has to be told to
 * actually write it.
 *
 * "Write in Persian" on its own does not produce Persian anyone wants to read.
 * The models default to an inflated, bureaucratic register — می‌باشد, لازم به
 * ذکر است, در راستای — that reads as machine-written to any Iranian, and they
 * reach for Latin digits, em dashes and Arabic ي/ك, all of which mark the text
 * as foreign at a glance. The instructions below are the difference between
 * Persian output and English output with Persian words in it, so they live in
 * one place instead of being half-remembered at each of the nine call sites
 * that build a prompt.
 */

/** Mirrors the `ContentLanguage` enum in the Prisma schema. */
export type ContentLanguage = 'EN' | 'FA';

export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = 'EN';

/** How the language is named to a model, and to a person. */
const NAMES: Record<ContentLanguage, { english: string; native: string }> = {
  EN: { english: 'English', native: 'English' },
  FA: { english: 'Persian (Farsi)', native: 'فارسی' },
};

export function contentLanguageName(language: ContentLanguage): string {
  return NAMES[language].english;
}

export function contentLanguageNativeName(language: ContentLanguage): string {
  return NAMES[language].native;
}

/** Persian is written right to left; the exports that build documents need it. */
export function isRtlContentLanguage(language: ContentLanguage): boolean {
  return language === 'FA';
}

/**
 * Narrows whatever came back from the database or a form into a language the
 * engines actually have instructions for. An unrecognised value falls back to
 * English rather than being passed through, because passing it through means
 * the model silently writes English anyway and nobody finds out until a
 * customer reads the post.
 */
export function asContentLanguage(value: unknown): ContentLanguage {
  return value === 'FA' || value === 'EN' ? value : DEFAULT_CONTENT_LANGUAGE;
}

/** Maps a UI locale to the language a workspace created from it should write in. */
export function contentLanguageForLocale(locale: string): ContentLanguage {
  return locale === 'fa' ? 'FA' : DEFAULT_CONTENT_LANGUAGE;
}

const PERSIAN_INSTRUCTIONS = `
LANGUAGE: Write every word of the output in Persian (Farsi). This is not a
translation of an English draft — think and write in Persian from the start.

Register: professional but human. Write the way a capable Iranian professional
writes, not the way an official form does.
- Use است، شد، کرد. Never می‌باشد، گردید، به عمل آورد.
- Banned as bureaucratic filler: لازم به ذکر است، در راستای، از اهمیت ویژه‌ای
  برخوردار است، نقش بسزایی ایفا می‌کند، در دنیای امروز، در نهایت می‌توان گفت.
- Banned as machine tells: rule-of-three flourishes like «سریع، آسان و مطمئن»،
  «نه تنها ... بلکه»، clauses tacked on as «که نشان‌دهندهٔ ... است»، and vague
  attributions like «کارشناسان معتقدند».
- Short sentences, one idea each. Address the reader with شما and let the verb
  carry it rather than repeating the pronoun.
- Vary sentence length. Prose where every sentence runs 15 to 20 words reads as
  machine-generated even when each sentence is correct.

Mechanics, all of which mark the text as foreign if you get them wrong:
- Persian digits ۰۱۲۳۴۵۶۷۸۹ in prose. Latin digits only inside URLs, emails,
  version numbers and code.
- Persian letters only: ی not ي، ک not ك.
- Use the zero-width non-joiner (نیم‌فاصله) correctly: می‌شود، کتاب‌ها، به‌عنوان.
- Persian punctuation: ، and ؛ and ؟، and «گیومه» for quotation marks.
- Never use em dashes or en dashes. Use ، or ؛ or restructure the sentence.
- Never write the ezafe kasre as ـه. «کتابِ من» is correct; «کتابه من» is not.

Keep Latin: brand names, product names, network names (LinkedIn, Instagram),
technical terms that Iranian professionals use in Latin, URLs and hashtags.
Do not invent Persian equivalents for terms people say in English.
`.trim();

const ENGLISH_INSTRUCTIONS = 'LANGUAGE: Write the output in English.';

/**
 * The block to paste into a prompt. Returns the English line for EN rather
 * than an empty string on purpose: the prompts around it list their rules
 * explicitly, and a language that is stated is a language a later edit cannot
 * accidentally drop.
 */
export function languageInstructions(language: ContentLanguage): string {
  return language === 'FA' ? PERSIAN_INSTRUCTIONS : ENGLISH_INSTRUCTIONS;
}

/**
 * Words in Persian are separated by spaces as in English, so a whitespace
 * count is the right measure for both — but Persian says the same thing in
 * noticeably fewer words than English, largely because it carries subject and
 * object agreement on the verb and drops pronouns. Holding Persian output to
 * an English word range makes the model pad, and padding is exactly what the
 * quality gate is built to reject.
 *
 * The ratio is a working estimate, not a measurement, and it is applied in one
 * place so it can be corrected once when real data exists.
 */
const WORD_COUNT_RATIO: Record<ContentLanguage, number> = {
  EN: 1,
  FA: 0.85,
};

export function adjustWordCountForLanguage(count: number, language: ContentLanguage): number {
  if (!Number.isFinite(count) || count <= 0) return count;
  return Math.round(count * WORD_COUNT_RATIO[language]);
}
