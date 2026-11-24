/**
 * `String.prototype.slice(0, max)` counts UTF-16 units, so a cut can land
 * between the two halves of an emoji (🇨🇦) and leave a lone surrogate. Postgres
 * JSON rejects that ("unexpected end of hex escape"). This is the same cut with
 * a dangling high surrogate dropped, so the result is never longer than `max`.
 */
export function safeSlice(value: string, max: number): string {
  const out = value.slice(0, Math.max(0, max));
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}
