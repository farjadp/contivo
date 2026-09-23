/**
 * Setup warnings recorded on a workspace during first extraction.
 *
 * Lives outside the server-action file because a `'use server'` module may only
 * export async functions.
 */

/**
 * The one setup warning later work can resolve on its own: discovery can be
 * re-run from Market Matrices, and once competitors exist the warning is stale.
 *
 * Stored as a code rather than a sentence. These warnings are written into the
 * workspace row at extraction time and read back days later, so a translated
 * sentence would freeze the language to whichever one was active when the
 * extraction happened — and stay wrong for a reader who has since switched.
 * The code is language-free; `growth/[id]/page.tsx` turns it into words at the
 * moment someone looks at it.
 */
export const COMPETITOR_DISCOVERY_WARNING = 'competitorDiscoveryEmpty';

/**
 * The sentence this warning used to be stored as.
 *
 * Rows written before warnings became codes still hold the English text, and
 * they are not migrated: this is display-only data on a JSON column, and a
 * migration to rewrite it would be more risk than reading both forms. Anything
 * unrecognised is passed through as-is, so a warning from an older build still
 * shows its own words rather than vanishing.
 */
const LEGACY_COMPETITOR_DISCOVERY_WARNING =
  'Competitor discovery came back empty — the AI provider was unavailable. You can retry it from Market Matrices.';

/** Codes this build knows how to render; anything else is shown verbatim. */
export const SETUP_WARNING_CODES = [COMPETITOR_DISCOVERY_WARNING] as const;
export type SetupWarningCode = (typeof SETUP_WARNING_CODES)[number];

export function isSetupWarningCode(value: string): value is SetupWarningCode {
  return (SETUP_WARNING_CODES as readonly string[]).includes(value);
}

/**
 * Drops warnings that the workspace has since outgrown, so the banner reflects
 * what is true now rather than what was true during the first extraction.
 */
export function activeSetupWarnings(
  warnings: unknown,
  facts: { competitorCount: number },
): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .filter((w): w is string => typeof w === 'string')
    // Normalise the legacy sentence to its code, so the resolved-by-progress
    // rule below and the translation lookup both see one value.
    .map((w) => (w === LEGACY_COMPETITOR_DISCOVERY_WARNING ? COMPETITOR_DISCOVERY_WARNING : w))
    .filter((w) => !(w === COMPETITOR_DISCOVERY_WARNING && facts.competitorCount > 0));
}
