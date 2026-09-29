import { describe, expect, it } from 'vitest';

import { redactSecrets, sanitizeUpstreamText, truncateText, MAX_UPSTREAM_TEXT_LENGTH } from './redact';

describe('redactSecrets', () => {
  it('redacts an OpenAI-shaped API key', () => {
    expect(redactSecrets('error: invalid key sk-abc123DEF456ghi')).toBe('error: invalid key [redacted]');
  });

  it('redacts a whole Bearer token, not just the word "Bearer"', () => {
    const result = redactSecrets('sent Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result).toBe('sent Authorization: [redacted]');
    expect(result).not.toContain('eyJhbGci');
  });

  it('redacts a JSON-shaped authorization field without leaking the value after it', () => {
    const result = redactSecrets('{"authorization":"Bearer secret-value-here"}');
    expect(result).toBe('{"authorization":"[redacted]"}');
    expect(result).not.toContain('secret-value-here');
  });

  it('leaves ordinary error text alone', () => {
    const text = 'Judge batch failed: 429 rate limit exceeded, please retry later';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('truncateText', () => {
  it('leaves short text untouched', () => {
    expect(truncateText('short')).toBe('short');
  });

  it('caps long text at the default length and appends an ellipsis', () => {
    const long = 'x'.repeat(MAX_UPSTREAM_TEXT_LENGTH + 200);
    const result = truncateText(long);
    expect(result.length).toBe(MAX_UPSTREAM_TEXT_LENGTH + 1); // +1 for the ellipsis char
    expect(result.endsWith('…')).toBe(true);
  });

  it('respects a custom max length', () => {
    expect(truncateText('abcdefghij', 5)).toBe('abcde…');
  });
});

describe('sanitizeUpstreamText', () => {
  it('returns null for null, undefined and empty string', () => {
    expect(sanitizeUpstreamText(null)).toBeNull();
    expect(sanitizeUpstreamText(undefined)).toBeNull();
    expect(sanitizeUpstreamText('')).toBeNull();
  });

  it('redacts and then truncates a raw upstream body in one pass', () => {
    const body = `Bearer sk-liveSECRETKEY1234567890 ${'a'.repeat(600)}`;
    const result = sanitizeUpstreamText(body);
    expect(result).not.toBeNull();
    expect(result).not.toContain('sk-liveSECRETKEY1234567890');
    expect((result as string).length).toBeLessThanOrEqual(MAX_UPSTREAM_TEXT_LENGTH + 1);
  });
});
