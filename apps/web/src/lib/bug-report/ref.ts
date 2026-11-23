/**
 * Reference codes (CTV-7F3K) that join a user's complaint to our logs.
 *
 * Client-safe: no node imports, no server imports. Error boundaries in the
 * browser use refFromDigest, and the server (instrumentation.ts) must compute
 * the SAME ref for the same render error, so refFromDigest is deterministic
 * and uses no crypto.
 */

import { REF_PATTERN } from './types';

/** No 0 O 1 I L. 31 symbols. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PREFIX = 'CTV-';
const LENGTH = 4;
/** Largest multiple of ALPHABET.length that fits in a byte: bytes at or above it are rejected (no modulo bias). */
const BYTE_LIMIT = 256 - (256 % ALPHABET.length);

export function generateRef(): string {
  const out: string[] = [];
  while (out.length < LENGTH) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= BYTE_LIMIT) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === LENGTH) break;
    }
  }
  return PREFIX + out.join('');
}

export function isRef(s: unknown): s is string {
  return typeof s === 'string' && REF_PATTERN.test(s);
}

/** 32-bit FNV-1a over UTF-16 code units. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Deterministic ref for a Next error digest: same digest, same ref, on server and in the browser. */
export function refFromDigest(digest: string): string {
  let value = fnv1a(String(digest));
  const out: string[] = [];
  for (let i = 0; i < LENGTH; i++) {
    out.push(ALPHABET[value % ALPHABET.length]);
    value = Math.floor(value / ALPHABET.length);
  }
  return PREFIX + out.join('');
}
