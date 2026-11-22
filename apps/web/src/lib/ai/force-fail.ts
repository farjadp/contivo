/**
 * Dev-only failure injection: AI_FORCE_FAIL=openai:billing,gemini:rate_limit
 * makes that provider's attempt fail with that class WITHOUT a network call.
 * The forced failure still goes through classification, health, events and
 * Sentry, so a local run shows exactly what production would.
 *
 * Ignored completely when NODE_ENV === 'production'.
 */

import { AI_ERROR_CLASSES, PROVIDER_IDS, type AiErrorClass, type ProviderId } from './types';

type Env = Record<string, string | undefined>;

const warned = new Set<string>();

export function parseForceFail(raw: string | undefined): Map<ProviderId, AiErrorClass> {
  const out = new Map<ProviderId, AiErrorClass>();
  if (!raw?.trim()) return out;
  for (const entry of raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const [provider, errorClass] = entry.split(':').map((s) => s.trim());
    if (
      (PROVIDER_IDS as readonly string[]).includes(provider) &&
      (AI_ERROR_CLASSES as readonly string[]).includes(errorClass)
    ) {
      out.set(provider as ProviderId, errorClass as AiErrorClass);
    } else if (!warned.has(entry)) {
      warned.add(entry);
      console.error(`[ai] AI_FORCE_FAIL entry "${entry}" is not provider:class — ignored`);
    }
  }
  return out;
}

export function forcedFailure(provider: ProviderId, env: Env = process.env): AiErrorClass | null {
  if (env.NODE_ENV === 'production') return null;
  return parseForceFail(env.AI_FORCE_FAIL).get(provider) ?? null;
}
