/**
 * The matrices' share of the workspace's "AI runs" and "AI tokens" figures.
 *
 * The rebuilt pipeline records tokens per run on MatrixRun, and the saved blob
 * only carries the latest run's count. Presenting that one number as a
 * lifetime total (with runs: 1) understated both figures after the second run,
 * so the page sums the workspace's runs instead. A workspace whose matrices
 * predate the rebuild still has the old lifetime object on its blob.
 */

type LegacyTokenUsage = Record<string, unknown>;

export type MatricesTokenUsage = { runs: number; lifetime_total_tokens: number } | LegacyTokenUsage | null;

export function matricesTokenUsage(
  runs: { runs: number; tokens: number },
  matrices: unknown,
): MatricesTokenUsage {
  if (runs.runs > 0) return { runs: runs.runs, lifetime_total_tokens: runs.tokens };
  const blob = matrices && typeof matrices === 'object' && !Array.isArray(matrices) ? (matrices as Record<string, unknown>) : null;
  const legacy = blob?.token_usage;
  return legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? (legacy as LegacyTokenUsage) : null;
}
