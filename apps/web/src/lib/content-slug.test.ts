import { describe, expect, it } from 'vitest';

import {
  normalizeSlugInput,
  validatePostBody,
  validatePostSlug,
  validatePostTitle,
} from './content-slug';

describe('validatePostTitle', () => {
  it('accepts a normal title, including Persian', () => {
    expect(validatePostTitle('How we plan content')).toBeNull();
    expect(validatePostTitle('چطور محتوا برنامه‌ریزی می‌کنیم')).toBeNull();
  });
  it('requires a non-blank title', () => {
    expect(validatePostTitle('')).toBe('title_required');
    expect(validatePostTitle('   ')).toBe('title_required');
  });
  it('limits the trimmed title to 200 characters', () => {
    expect(validatePostTitle(`  ${'a'.repeat(200)}  `)).toBeNull();
    expect(validatePostTitle('a'.repeat(201))).toBe('title_too_long');
  });
});

describe('validatePostBody', () => {
  it('requires a non-blank body', () => {
    expect(validatePostBody('')).toBe('body_required');
    expect(validatePostBody('\n\n  ')).toBe('body_required');
    expect(validatePostBody('# Hi\n\ntext')).toBeNull();
  });
  it('limits the trimmed body to 100000 characters', () => {
    expect(validatePostBody('a'.repeat(100000))).toBeNull();
    expect(validatePostBody('a'.repeat(100001))).toBe('body_too_long');
  });
});

describe('validatePostSlug', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    expect(validatePostSlug('content-plan-2026')).toBeNull();
    expect(validatePostSlug('a')).toBeNull();
    expect(validatePostSlug('a'.repeat(80))).toBeNull();
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'Upper', 'two  words', 'a--b', '-a', 'a-', 'a_b', 'سلام', 'a/b', 'a'.repeat(81)]) {
      expect(validatePostSlug(bad)).toBe('slug_invalid');
    }
  });
});

describe('normalizeSlugInput', () => {
  it('trims and lowercases only', () => {
    expect(normalizeSlugInput('  My-Post ')).toBe('my-post');
  });
  it('does not rewrite invalid characters', () => {
    expect(normalizeSlugInput('My Post!')).toBe('my post!');
    expect(validatePostSlug(normalizeSlugInput('My Post!'))).toBe('slug_invalid');
  });
});
