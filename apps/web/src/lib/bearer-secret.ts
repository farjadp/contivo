import { timingSafeEqual } from 'crypto';

/**
 * True when `Authorization: Bearer <secret>` carries exactly `secret`.
 * Compares bytes, not characters: timingSafeEqual throws on buffers of
 * different byte length, and a non-ASCII header can have the secret's
 * character length but not its byte length (a 500 instead of a 401).
 * The length check leaks nothing the sender does not already know.
 */
export function bearerMatches(header: string | null, secret: string): boolean {
  const value = header ?? '';
  const provided = Buffer.from(value.startsWith('Bearer ') ? value.slice(7) : '');
  const expected = Buffer.from(secret);
  if (provided.length === 0 || provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
