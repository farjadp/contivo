/**
 * Setup warnings recorded on a workspace during first extraction.
 *
 * Lives outside the server-action file because a `'use server'` module may only
 * export async functions.
 */

/**
 * The one setup warning later work can resolve on its own: discovery can be
 * re-run from Market Matrices, and once competitors exist the warning is stale.
 */
export const COMPETITOR_DISCOVERY_WARNING =
  'Competitor discovery came back empty — the AI provider was unavailable. You can retry it from Market Matrices.';

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
    .filter((w) => !(w === COMPETITOR_DISCOVERY_WARNING && facts.competitorCount > 0));
}
