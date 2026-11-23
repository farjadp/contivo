/**
 * OpenAI image generation with an ordered model list, coded causes and loud
 * failures (B19).
 *
 * Why this exists: content-image.ts hardcoded `gpt-image-1`. OpenAI shut that
 * model down on 2026-10-23 and answered every call with 400 "The model
 * 'gpt-image-1' does not exist". The caller turned that into `null`, so for
 * two months every Autopilot and Ideation post shipped without its picture and
 * nothing anywhere said so.
 *
 * Images do not go through runAiTask: there is one provider (Gemini image has
 * no quota on this project, Claude makes no images), and the endpoint, body
 * and usage shape differ. What this module shares with the text layer:
 *  - the error classifier (classifyOpenAi), refined for the image endpoint;
 *  - ai_provider_events rows, one per failed attempt (task `content_image`);
 *  - the retirement check (warnIfRetiring, MODEL_SHUTDOWNS);
 *  - Sentry, once per process per cause.
 *
 * Model list: OPENAI_IMAGE_MODEL (one model) first, then
 * OPENAI_IMAGE_FALLBACK_MODELS (comma list) or the defaults below. A model that
 * is gone, or a transient failure, moves to the next model. Billing, auth and a
 * rejected prompt stop at once: another model on the same key or with the same
 * prompt would fail the same way.
 */

import * as Sentry from '@sentry/nextjs';

import { classifyOpenAi, sanitizeAiMessage } from './errors';
import { warnIfRetiring } from './retirements';
import type { AiErrorClass } from './types';

/**
 * Default, chosen by the live eval of 22 Nov on the production key
 * (docs/evals/2026-11-22-openai-image-model.md). No shutdown is announced.
 */
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare';

/**
 * Tried in order after the default. None has an announced shutdown (22 Nov).
 * 2.6-flare first: a newer generation, so it outlives a 2.5 shutdown.
 */
export const DEFAULT_OPENAI_IMAGE_FALLBACKS: readonly string[] = ['gpt-image-2.6-flare', 'gpt-image-2.5-sunburst'];

export const IMAGE_TASK = 'content_image';
export const IMAGE_SIZE = '1024x1024';
export const IMAGE_QUALITY = 'medium';
export const IMAGE_TIMEOUT_MS = 180_000;

/** Why a post has no picture. Written to run logs, activity logs and ai_provider_events. */
export const IMAGE_CAUSES = [
  'IMAGE_MODEL_UNAVAILABLE', // every model in the list is gone or not allowed for this org
  'IMAGE_PROVIDER_OUT_OF_CREDIT', // OpenAI billing / quota
  'IMAGE_PROVIDER_AUTH', // bad key, or org not verified for image models
  'IMAGE_RATE_LIMITED',
  'IMAGE_TIMEOUT',
  'IMAGE_PROVIDER_UNAVAILABLE', // 5xx, overloaded, network
  'IMAGE_REJECTED', // the prompt was refused (moderation) or the request was invalid
  'IMAGE_EMPTY_RESPONSE', // 200 with no image bytes
  'IMAGE_NOT_CONFIGURED', // OPENAI_API_KEY unset
  'IMAGE_STORE_FAILED', // generated, but saving it failed
] as const;
export type ImageCause = (typeof IMAGE_CAUSES)[number];

const CAUSE_BY_CLASS: Record<AiErrorClass, ImageCause> = {
  billing: 'IMAGE_PROVIDER_OUT_OF_CREDIT',
  auth: 'IMAGE_PROVIDER_AUTH',
  model_gone: 'IMAGE_MODEL_UNAVAILABLE',
  rate_limit: 'IMAGE_RATE_LIMITED',
  timeout: 'IMAGE_TIMEOUT',
  overloaded: 'IMAGE_PROVIDER_UNAVAILABLE',
  server: 'IMAGE_PROVIDER_UNAVAILABLE',
  network: 'IMAGE_PROVIDER_UNAVAILABLE',
  bad_request: 'IMAGE_REJECTED',
  refusal: 'IMAGE_REJECTED',
  invalid_output: 'IMAGE_EMPTY_RESPONSE',
};

/** Classes after which the next model is worth a try. */
const TRY_NEXT: ReadonlySet<AiErrorClass> = new Set<AiErrorClass>([
  'model_gone',
  'rate_limit',
  'timeout',
  'overloaded',
  'server',
  'network',
  'invalid_output',
]);

type Env = Record<string, string | undefined>;

/** OPENAI_IMAGE_MODEL first, then the fallback list; trimmed, de-duplicated. */
export function imageModelChain(env: Env = process.env): string[] {
  const primary = env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_OPENAI_IMAGE_MODEL;
  const rawFallbacks = env.OPENAI_IMAGE_FALLBACK_MODELS;
  const fallbacks =
    rawFallbacks !== undefined && rawFallbacks.trim() !== ''
      ? rawFallbacks.split(',').map((m) => m.trim()).filter(Boolean)
      : [...DEFAULT_OPENAI_IMAGE_FALLBACKS];
  return [...new Set([primary, ...fallbacks])];
}

// The image endpoint reports a missing model as 400 image_generation_user_error
// (live, 23 Nov), not 404 model_not_found, so classifyOpenAi calls it a bad
// request. These patterns move it to the right class.
const MODEL_GONE_RE = /model\b[^.]{0,80}\b(does not exist|not found|has been (deprecated|shut ?down|retired)|is not (available|supported))/i;
const ORG_VERIFICATION_RE = /organi[sz]ation[^.]{0,60}verif|must be verified/i;
const MODERATION_RE = /moderation_blocked|content_policy_violation|safety system|rejected by (the )?safety/i;

export function classifyImageError(status: number, body: unknown): { errorClass: AiErrorClass; message: string } {
  const base = classifyOpenAi(status, body);
  let errorClass = base.errorClass;
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  if (errorClass === 'bad_request' || errorClass === 'auth') {
    if (ORG_VERIFICATION_RE.test(text)) errorClass = 'auth';
    else if (MODEL_GONE_RE.test(text)) errorClass = 'model_gone';
    else if (MODERATION_RE.test(text)) errorClass = 'refusal';
  }
  return { errorClass, message: base.message };
}

export type ImageAttempt = { model: string; errorClass: AiErrorClass; status?: number; message: string; ms: number };

export type ImageResult =
  | { ok: true; b64: string; model: string; body: unknown; attempts: ImageAttempt[]; ms: number }
  | { ok: false; cause: ImageCause; model: string | null; attempts: ImageAttempt[]; message: string };

export type ImageEventRow = {
  provider: string;
  task: string;
  errorClass: string;
  status: number | null;
  message: string | null;
  failedOverTo: string | null;
  eventType: string;
  workspaceId: string | null;
  userId: string | null;
};

export type ImageDeps = {
  env?: Env;
  fetch?: typeof fetch;
  insertEvent?: (row: ImageEventRow) => Promise<void>;
  capture?: (message: string, level: 'error' | 'fatal' | 'warning', cause: ImageCause) => void;
  log?: (line: string) => void;
  now?: () => number;
};

async function prismaInsert(row: ImageEventRow): Promise<void> {
  const { prisma } = await import('@/lib/db');
  await prisma.aiProviderEvent.create({ data: row });
}

const captured = new Set<string>();
function sentryOnce(message: string, level: 'error' | 'fatal' | 'warning', cause: ImageCause): void {
  if (captured.has(cause)) return;
  captured.add(cause);
  try {
    Sentry.captureMessage(message, {
      level,
      tags: { 'ai.task': IMAGE_TASK, 'ai.provider': 'openai', 'ai.image_cause': cause },
      fingerprint: ['ai-image', cause],
    });
  } catch {
    // Alerting never breaks generation.
  }
}

/** Test hook. */
export function resetImageAlerts(): void {
  captured.clear();
}

/** The cause a whole failed run is reported as: the attempt that ended it. */
function finalCause(attempts: ImageAttempt[]): ImageCause {
  if (attempts.some((a) => a.errorClass === 'billing')) return 'IMAGE_PROVIDER_OUT_OF_CREDIT';
  if (attempts.every((a) => a.errorClass === 'model_gone')) return 'IMAGE_MODEL_UNAVAILABLE';
  return CAUSE_BY_CLASS[attempts[attempts.length - 1].errorClass];
}

const FATAL: ReadonlySet<ImageCause> = new Set<ImageCause>([
  'IMAGE_MODEL_UNAVAILABLE',
  'IMAGE_PROVIDER_OUT_OF_CREDIT',
  'IMAGE_PROVIDER_AUTH',
  'IMAGE_NOT_CONFIGURED',
]);

/**
 * One picture. Never throws. Every failed attempt is a provider event; the
 * final failure is a console error and (once per cause per process) Sentry.
 */
export async function generateOpenAiImage(
  input: { prompt: string; size?: string; quality?: string; workspaceId?: string | null; userId?: string | null },
  deps: ImageDeps = {},
): Promise<ImageResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const insertEvent = deps.insertEvent ?? prismaInsert;
  const capture = deps.capture ?? sentryOnce;
  const log = deps.log ?? ((line: string) => console.error(line));
  const now = deps.now ?? Date.now;

  const fail = (cause: ImageCause, model: string | null, attempts: ImageAttempt[], message: string): ImageResult => {
    const line = `[ai] image ${cause}${model ? ` (last model ${model})` : ''}: post goes out text only — ${message}`;
    try {
      log(line);
    } catch {
      // ignore
    }
    capture(line, FATAL.has(cause) ? 'fatal' : 'error', cause);
    return { ok: false, cause, model, attempts, message };
  };

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fail('IMAGE_NOT_CONFIGURED', null, [], 'OPENAI_API_KEY is not set');

  const chain = imageModelChain(env);
  const attempts: ImageAttempt[] = [];

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const next = chain[i + 1] ?? null;
    warnIfRetiring(model);
    const started = now();
    let attempt: ImageAttempt | null = null;
    try {
      const res = await doFetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          size: input.size ?? IMAGE_SIZE,
          quality: input.quality ?? IMAGE_QUALITY,
          n: 1,
        }),
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep the raw text
      }
      if (res.ok) {
        const b64 = (body as { data?: Array<{ b64_json?: unknown }> } | null)?.data?.[0]?.b64_json;
        if (typeof b64 === 'string' && b64) return { ok: true, b64, model, body, attempts, ms: now() - started };
        attempt = { model, errorClass: 'invalid_output', status: res.status, message: 'no b64_json in the response', ms: now() - started };
      } else {
        const { errorClass, message } = classifyImageError(res.status, body);
        attempt = { model, errorClass, status: res.status, message, ms: now() - started };
      }
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
      attempt = {
        model,
        errorClass: timedOut ? 'timeout' : 'network',
        message: sanitizeAiMessage(error instanceof Error ? error.message : String(error)),
        ms: now() - started,
      };
    }

    attempts.push(attempt);
    const goOn = TRY_NEXT.has(attempt.errorClass) && next !== null;
    try {
      await insertEvent({
        provider: 'openai',
        task: IMAGE_TASK,
        errorClass: attempt.errorClass,
        status: attempt.status ?? null,
        message: sanitizeAiMessage(`${CAUSE_BY_CLASS[attempt.errorClass]} ${model}: ${attempt.message}`),
        failedOverTo: goOn ? `openai:${next}` : null,
        eventType: 'attempt_failed',
        workspaceId: input.workspaceId ?? null,
        userId: input.userId ?? null,
      });
    } catch (error) {
      try {
        log(`[ai] image provider event not stored: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // ignore
      }
    }
    if (!goOn) break;
  }

  const last = attempts[attempts.length - 1];
  return fail(finalCause(attempts), last.model, attempts, `${last.model}: ${last.errorClass}${last.status ? ` ${last.status}` : ''} — ${last.message}`);
}
