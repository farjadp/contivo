import { readTokenUsage } from '@/lib/competitors/queries';
import { sanitizeUpstreamText } from '@/lib/competitors/redact';

/**
 * `tokens` is set when the provider answered (HTTP 200) but the answer was
 * unusable, so the pipeline can still count the spend. `null` means unknown,
 * never zero.
 */
export class MatrixAiError extends Error {
  readonly tokens: number | null;

  constructor(message: string, tokens: number | null = null) {
    super(message);
    this.name = 'MatrixAiError';
    this.tokens = tokens;
  }
}

/** Wall-clock bound on one matrix call, so a hung call cannot outlive the reaper. */
export const MATRIX_REQUEST_TIMEOUT_MS = 90_000;

export async function callStructured<T>(args: {
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
}): Promise<{ data: T; tokens: number | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new MatrixAiError('OPENAI_API_KEY is not set');
  }
  const model = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1';

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(MATRIX_REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: { name: args.name, strict: true, schema: args.schema },
        },
        messages: [
          { role: 'system', content: args.system },
          { role: 'user', content: args.user },
        ],
      }),
    });
  } catch (error) {
    throw new MatrixAiError(
      `Matrix AI request failed: ${sanitizeUpstreamText((error as Error).message) ?? 'network error'}`,
    );
  }

  if (!res.ok) {
    const reason = sanitizeUpstreamText(await res.text().catch(() => ''), 200);
    throw new MatrixAiError(`Matrix AI call failed: ${res.status}${reason ? ` ${reason}` : ''}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MatrixAiError('Matrix AI returned an unreadable response');
  }
  const tokens = readTokenUsage(body);

  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new MatrixAiError('Matrix AI returned no content', tokens);
  }

  try {
    return { data: JSON.parse(content) as T, tokens };
  } catch (error) {
    throw new MatrixAiError(`Matrix AI returned invalid JSON: ${(error as Error).message}`, tokens);
  }
}
