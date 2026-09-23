#!/usr/bin/env node
/**
 * Guards the two message catalogues against the ways they rot.
 *
 * A missing translation does not throw at build time. It throws — or worse,
 * renders the key path as visible text — on one page, in one language, for
 * whoever happens to open it. This runs in CI instead.
 *
 * Four checks, each one something that actually went wrong while the Persian
 * catalogue was being written:
 *
 * 1. Every namespace listed in src/i18n/request.ts has a file in every locale.
 *    A namespace added for one language throws at request time for the other.
 * 2. Every file parses and is non-empty. request.ts imports messages by a
 *    dynamic path, so webpack pulls in every JSON in those directories: one
 *    zero-byte file takes down every route, not just the one that reads it.
 * 3. The key sets match exactly. A key present in English and missing in
 *    Persian is the untranslated string nobody notices.
 * 4. The ICU placeholders inside each message match across locales. A message
 *    translated without its {count} still renders — it just silently drops the
 *    number, which is the hardest version of this bug to see.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'fa'];

/** The namespace list, read from the source of truth rather than duplicated. */
function namespaces() {
  const src = readFileSync(join(root, 'src/i18n/request.ts'), 'utf8');
  const block = src.match(/const NAMESPACES = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error('Could not find NAMESPACES in src/i18n/request.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Flattens to dotted paths so two catalogues can be compared key by key. */
function flatten(value, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, path, out);
    else out.set(path, String(v));
  }
  return out;
}

/**
 * The ICU argument names in a message. Deliberately ignores rich-text tags
 * (<accent>…</accent>) — those are supplied by the component and a translator
 * may legitimately drop one.
 */
function placeholders(message) {
  return new Set([...message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)].map((m) => m[1]));
}

const problems = [];

for (const ns of namespaces()) {
  const loaded = {};

  for (const locale of LOCALES) {
    const file = join(root, 'messages', locale, `${ns}.json`);
    const rel = `messages/${locale}/${ns}.json`;

    if (!existsSync(file)) {
      problems.push(`${rel} is missing — the '${ns}' namespace exists for the other locale`);
      continue;
    }
    const raw = readFileSync(file, 'utf8');
    if (!raw.trim()) {
      problems.push(`${rel} is empty — this breaks every route, not just the one that reads it`);
      continue;
    }
    try {
      loaded[locale] = flatten(JSON.parse(raw));
    } catch (error) {
      problems.push(`${rel} is not valid JSON: ${error.message}`);
    }
  }

  if (Object.keys(loaded).length !== LOCALES.length) continue;

  const [a, b] = LOCALES;
  for (const key of loaded[a].keys()) {
    if (!loaded[b].has(key)) problems.push(`${ns}: '${key}' is in ${a} but missing from ${b}`);
  }
  for (const key of loaded[b].keys()) {
    if (!loaded[a].has(key)) problems.push(`${ns}: '${key}' is in ${b} but missing from ${a}`);
  }

  for (const [key, message] of loaded[a]) {
    const other = loaded[b].get(key);
    if (other === undefined) continue;
    const mine = placeholders(message);
    const theirs = placeholders(other);
    for (const p of mine) {
      if (!theirs.has(p)) problems.push(`${ns}: '${key}' uses {${p}} in ${a} but not in ${b}`);
    }
    for (const p of theirs) {
      if (!mine.has(p)) problems.push(`${ns}: '${key}' uses {${p}} in ${b} but not in ${a}`);
    }
  }
}

if (problems.length) {
  console.error(`i18n check failed with ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`i18n check passed: ${namespaces().length} namespaces, ${LOCALES.join(' / ')} in sync.`);
