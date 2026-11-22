import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '../../../../../../messages/en/admin.json';
import fa from '../../../../../../messages/fa/admin.json';
import it_ from '../../../../../../messages/it/admin.json';

// This vitest setup cannot render JSX (tsconfig keeps jsx: preserve for
// Next), so the card is checked through its source: every key it asks for
// must exist in every locale, and the locales must carry the same keys.

const source = readFileSync(path.join(__dirname, 'AiProvidersCard.tsx'), 'utf8');

function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

const STATES = ['healthy', 'coolingDown', 'notConfigured', 'unknown'];

function keysUsed(): string[] {
  const literal = Array.from(source.matchAll(/\bt\('([A-Za-z.]+)'/g), (m) => m[1]);
  // `t(\`state.${state}\`)` expands to the four ProviderState values.
  expect(source).toContain('t(`state.${state}`)');
  return [...literal, ...STATES.map((s) => `state.${s}`)];
}

const locales = { en, fa, it: it_ } as Record<string, { admin: { aiProviders: Record<string, unknown> } }>;

describe('AiProvidersCard copy', () => {
  it.each(Object.keys(locales))('%s has every key the card uses', (locale) => {
    const available = new Set(flatten(locales[locale].admin.aiProviders));
    for (const key of keysUsed()) expect(available.has(key), `${locale}: ${key}`).toBe(true);
  });

  it('carries the same keys in en, fa and it', () => {
    const enKeys = flatten(en.admin.aiProviders).sort();
    expect(flatten(fa.admin.aiProviders).sort()).toEqual(enKeys);
    expect(flatten(it_.admin.aiProviders).sort()).toEqual(enKeys);
  });

  it('writes no Latin digits in Persian prose', () => {
    // Identifiers such as ai_provider_events stay Latin; digits never do.
    for (const text of flatten(fa.admin.aiProviders).map((k) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], fa.admin.aiProviders))) {
      expect(String(text).replace(/\{[^}]*\}/g, '')).not.toMatch(/[0-9]/);
    }
  });
});
