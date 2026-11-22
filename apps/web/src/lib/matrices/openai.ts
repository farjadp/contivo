import { runAiTask, type AiTask } from '@/lib/ai';
import { tokensFromUsage } from '@/lib/competitors/queries';
import { describeAiFailure } from '@/lib/competitors/run-errors';

/**
 * `tokens` is set when the provider answered but the answer was unusable, so
 * the pipeline can still count the spend. `null` means unknown, never zero.
 *
 * When no provider could answer, the message starts with `AI_UNAVAILABLE:`
 * (see `describeAiFailure`), which the matrix run stores as its error and
 * `classifyRunError` maps to the aiUnavailable copy.
 */
export class MatrixAiError extends Error {
  readonly tokens: number | null;

  constructor(message: string, tokens: number | null = null) {
    super(message);
    this.name = 'MatrixAiError';
    this.tokens = tokens;
  }
}

/** Wall-clock bound on one matrix call (per provider attempt), so a hung call cannot outlive the reaper. */
export const MATRIX_REQUEST_TIMEOUT_MS = 90_000;

/** Which failover-layer task each structured matrix call is. */
export const MATRIX_TASK_BY_SCHEMA_NAME: Readonly<Record<string, AiTask>> = {
  market_axis_candidates: 'matrix_propose_axes',
  chart_scores: 'matrix_score_chart',
  chart_summary: 'matrix_summarise',
  cross_chart_summary: 'matrix_summarise',
};

export async function callStructured<T>(args: {
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
}): Promise<{ data: T; tokens: number | null }> {
  const task = MATRIX_TASK_BY_SCHEMA_NAME[args.name];
  if (!task) {
    throw new MatrixAiError(`Matrix AI call "${args.name}" has no AI task`);
  }

  let result: Awaited<ReturnType<typeof runAiTask>>;
  try {
    // Usage is recorded by the layer under `task` and the provider that answered.
    result = await runAiTask(task, {
      system: args.system,
      prompt: args.user,
      output: { kind: 'json_schema', name: args.name, schema: args.schema },
      temperature: 0.2,
      timeoutMs: MATRIX_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    throw new MatrixAiError(`Matrix AI request threw: ${(error as Error).message}`);
  }

  if (!result.ok) {
    throw new MatrixAiError(describeAiFailure(`Matrix AI call ${args.name} failed`, result));
  }

  const tokens = tokensFromUsage(result.usage);
  if (result.json !== undefined) return { data: result.json as T, tokens };

  if (!result.text) {
    throw new MatrixAiError('Matrix AI returned no content', tokens);
  }
  try {
    return { data: JSON.parse(result.text) as T, tokens };
  } catch (error) {
    throw new MatrixAiError(`Matrix AI returned invalid JSON: ${(error as Error).message}`, tokens);
  }
}
