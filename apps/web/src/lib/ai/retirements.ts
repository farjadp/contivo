/**
 * Announced shutdown dates for models this code can call. When a model shuts
 * down its calls fail, and a default that is past its date breaks a feature
 * for every customer. So this fails loudly twice:
 *  - CI: retirements.test.ts fails once any default model is within
 *    RETIREMENT_WARNING_DAYS of its shutdown date;
 *  - runtime: the first call to a model within that window, or past its date,
 *    logs `[ai] model ... retires/retired ...` and raises a Sentry warning,
 *    once per model per process.
 *
 * Sources (UTC dates):
 *  - OpenAI: https://developers.openai.com/api/docs/deprecations (read 2026-11-22)
 *  - gpt-4.1: shutdown 2027-01-14 (same page, recorded in the failover spec)
 * Add a row when a provider announces a shutdown. A model that is not listed
 * here has no announced date.
 */

import * as Sentry from '@sentry/nextjs';

export const MODEL_SHUTDOWNS: Readonly<Record<string, { shutdown: string; replacement?: string }>> = {
  'gpt-5-mini': { shutdown: '2026-12-11', replacement: 'gpt-6.1-terra' },
  'gpt-5.4-nano': { shutdown: '2027-04-01', replacement: 'gpt-6-luna' },
  'gpt-4.1': { shutdown: '2027-01-14' },
  // Images (same page). Listed so a misconfigured OPENAI_IMAGE_MODEL alerts.
  'gpt-image-1': { shutdown: '2026-10-23', replacement: 'gpt-image-2.5-flare' },
  'gpt-image-1.5': { shutdown: '2026-12-01', replacement: 'gpt-image-2.6-flare' },
  'gpt-image-1-mini': { shutdown: '2026-12-01', replacement: 'gpt-image-2.6-flare' },
  'chatgpt-image-latest': { shutdown: '2026-12-01', replacement: 'gpt-image-2.6-flare' },
  'gpt-image-2': { shutdown: '2027-02-10', replacement: 'gpt-image-2.6-flare' },
};

export const RETIREMENT_WARNING_DAYS = 14;

const DAY_MS = 86_400_000;
const DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

export type RetirementStatus =
  | { status: 'ok' }
  | { status: 'retiring' | 'retired'; shutdown: string; daysLeft: number; replacement?: string };

/** `gpt-5-mini-2025-08-07` and `gpt-5-mini` share one shutdown row. */
export function retirementStatus(model: string, now: Date = new Date()): RetirementStatus {
  const id = model.trim().replace(/^models\//, '');
  const row = MODEL_SHUTDOWNS[id] ?? MODEL_SHUTDOWNS[id.replace(DATE_SUFFIX, '')];
  if (!row) return { status: 'ok' };
  const daysLeft = Math.ceil((Date.parse(`${row.shutdown}T00:00:00Z`) - now.getTime()) / DAY_MS);
  if (daysLeft > RETIREMENT_WARNING_DAYS) return { status: 'ok' };
  return {
    status: daysLeft <= 0 ? 'retired' : 'retiring',
    shutdown: row.shutdown,
    daysLeft,
    ...(row.replacement ? { replacement: row.replacement } : {}),
  };
}

const warned = new Set<string>();

/** Runtime check, once per model per process. Never throws. */
export function warnIfRetiring(model: string, now: Date = new Date()): RetirementStatus {
  const result = retirementStatus(model, now);
  if (result.status === 'ok' || warned.has(model)) return result;
  warned.add(model);
  const message =
    result.status === 'retired'
      ? `[ai] model ${model} RETIRED on ${result.shutdown}; its calls will fail${result.replacement ? ` (replacement: ${result.replacement})` : ''}`
      : `[ai] model ${model} retires on ${result.shutdown} (${result.daysLeft} days)${result.replacement ? `; replacement: ${result.replacement}` : ''}`;
  console.error(message);
  try {
    Sentry.captureMessage(message, {
      level: result.status === 'retired' ? 'fatal' : 'warning',
      tags: { 'ai.model': model, 'ai.retirement': result.status },
      fingerprint: ['ai-model-retirement', model],
    });
  } catch {
    // Alerting must never break a model call.
  }
  return result;
}

/** Test hook. */
export function resetRetirementWarnings(): void {
  warned.clear();
}
