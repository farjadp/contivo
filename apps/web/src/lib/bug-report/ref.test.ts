import { describe, expect, it } from 'vitest';

import { generateRef, isRef, refFromDigest } from './ref';
import { REF_PATTERN } from './types';

describe('generateRef', () => {
  it('always matches REF_PATTERN', () => {
    for (let i = 0; i < 500; i++) expect(generateRef()).toMatch(REF_PATTERN);
  });
  it('is not constant', () => {
    expect(new Set(Array.from({ length: 50 }, generateRef)).size).toBeGreaterThan(40);
  });
});

describe('isRef', () => {
  it('accepts refs and rejects everything else', () => {
    expect(isRef('CTV-7F3K')).toBe(true);
    expect(isRef('CTV-7F3O')).toBe(false); // O not in alphabet
    expect(isRef('CTV-7F3')).toBe(false);
    expect(isRef('ctv-7f3k')).toBe(false);
    expect(isRef(null)).toBe(false);
    expect(isRef(42)).toBe(false);
  });
});

describe('refFromDigest', () => {
  it('is deterministic and matches the pattern', () => {
    expect(refFromDigest('1234567890')).toBe(refFromDigest('1234567890'));
    for (const d of ['', '0', 'abc', '2087613456', 'é'.repeat(50)]) expect(refFromDigest(d)).toMatch(REF_PATTERN);
  });
  it('differs for different digests (spread check)', () => {
    const refs = new Set(Array.from({ length: 200 }, (_, i) => refFromDigest(String(1000000 + i * 7919))));
    expect(refs.size).toBeGreaterThan(190);
  });
  it('has a fixed value for a known digest (server/browser parity guard)', () => {
    // Pinned: if this changes, the ref a user sees in the browser no longer matches the server log.
    expect(refFromDigest('abc')).toBe('CTV-H4GF');
    expect(refFromDigest('2087613456')).toBe('CTV-K5ZD');
  });
});
