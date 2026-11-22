import { describe, expect, it } from 'vitest';

import { redactText, sanitizeClientContext } from './redact';

// All fake. Shapes only.
const FAKE_SK = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJjMTIzIn0.abcDEF123_-xyz';

describe('redactText', () => {
  it('removes api keys, JWTs, bearer strings, cookies and emails', () => {
    const out = redactText(
      `failed with ${FAKE_SK} and ${FAKE_JWT} Authorization: Bearer abc123def456ghi cookie: auth-token=xyz; other=1 mail me at a.b@example.com`,
      1000,
    );
    expect(out).not.toContain('sk-proj');
    expect(out).not.toContain('eyJ');
    expect(out).not.toContain('abc123def456ghi');
    expect(out).not.toContain('auth-token=xyz');
    expect(out).not.toContain('example.com');
    expect(out).toContain('[redacted]');
  });

  it('removes name=value credentials in a query-like string', () => {
    const out = redactText('GET /x api_key=ZZZ999 access_token=QQQ111', 500);
    expect(out).not.toContain('ZZZ999');
    expect(out).not.toContain('QQQ111');
  });

  it('reduces URLs to their path and drops query and hash', () => {
    expect(redactText('fetch https://api.example.com/v1/items?token=abc#frag failed', 200)).toBe(
      'fetch /v1/items failed',
    );
    expect(redactText('see https://example.com', 200)).toBe('see /');
  });

  it('removes long hex and mixed-case base64 runs but keeps slugs and cuids', () => {
    const hex = 'a'.repeat(16) + '0123456789abcdef';
    const b64 = 'QWxhZGRpbjpvcGVuIHNlc2FtZQ0123456789ABCdef';
    const out = redactText(`${hex} ${b64} /blog/a-long-lowercase-slug-for-an-article-page clxyz0123456789abcdefghij`, 500);
    expect(out).not.toContain(hex);
    expect(out).not.toContain(b64);
    expect(out).toContain('/blog/a-long-lowercase-slug-for-an-article-page');
    expect(out).toContain('clxyz0123456789abcdefghij');
  });

  it('trims to max and tolerates non-strings', () => {
    expect(redactText('x'.repeat(500), 200)).toHaveLength(200);
    expect(redactText(undefined as unknown as string, 10)).toBe('');
  });
});

const CUID = 'clxyz0123456789abcdefghij';

describe('sanitizeClientContext', () => {
  it('falls back to empty on garbage and never throws', () => {
    for (const bad of [null, undefined, 42, 'x', [], { breadcrumbs: 'no' }]) {
      const out = sanitizeClientContext(bad);
      expect(out.breadcrumbs).toEqual([]);
      expect(out.consoleErrors).toEqual([]);
      expect(out.viewedIds).toEqual({});
    }
  });

  it('caps breadcrumbs at 20 (newest kept) and console errors at 10 with 200-char messages', () => {
    const breadcrumbs = Array.from({ length: 50 }, (_, i) => ({ t: i, kind: 'route', label: `/p${i}` }));
    const consoleErrors = Array.from({ length: 30 }, (_, i) => ({ t: i, kind: 'error', message: 'e'.repeat(900) + i }));
    const out = sanitizeClientContext({ route: '/x', locale: 'en', viewport: { w: 1, h: 2 }, breadcrumbs, consoleErrors });
    expect(out.breadcrumbs).toHaveLength(20);
    expect(out.breadcrumbs[19].t).toBe(49);
    expect(out.consoleErrors).toHaveLength(10);
    expect(out.consoleErrors.every((c) => c.message.length <= 200)).toBe(true);
  });

  it('keeps only the pathname of the route', () => {
    expect(sanitizeClientContext({ route: 'https://www.contivo.app/en/growth/abc?token=1#x' }).route).toBe('/en/growth/abc');
    expect(sanitizeClientContext({ route: '/en/dashboard?x=1' }).route).toBe('/en/dashboard');
    expect(sanitizeClientContext({ route: 'javascript:alert(1)' }).route).toBe('');
  });

  it('keeps only cuid-shaped viewed ids and drops unknown fields', () => {
    const out = sanitizeClientContext({
      viewedIds: { workspaceId: CUID, matrixRunId: 'not-a-cuid', evil: CUID, contentItemId: "c'; DROP TABLE x;--" },
      extra: 'dropped',
    });
    expect(out.viewedIds).toEqual({ workspaceId: CUID });
    expect(out).not.toHaveProperty('extra');
  });

  it('redacts secrets in breadcrumbs and console errors, drops malformed items', () => {
    const out = sanitizeClientContext({
      breadcrumbs: [
        { t: 1, kind: 'click', label: `x ${FAKE_SK}` },
        { t: 'bad', kind: 'route', label: '/a' },
        { t: 2, kind: 'weird', label: '/a' },
        { t: 3, kind: 'action_failed', label: 'startMatrixRun', code: 'PROVIDER_OUT_OF_CREDIT', ref: 'CTV-7F3K' },
        { t: 4, kind: 'action_failed', label: 'a', code: 'MADE_UP', ref: 'nope' },
      ],
      consoleErrors: [{ t: 1, kind: 'error', message: `Bearer abcdef123456 ${FAKE_JWT} a@b.co` }],
    });
    expect(JSON.stringify(out)).not.toContain('sk-proj');
    expect(JSON.stringify(out)).not.toContain('eyJ');
    expect(JSON.stringify(out)).not.toContain('a@b.co');
    expect(out.breadcrumbs).toHaveLength(3);
    expect(out.breadcrumbs[1]).toMatchObject({ code: 'PROVIDER_OUT_OF_CREDIT', ref: 'CTV-7F3K' });
    expect(out.breadcrumbs[2].code).toBeUndefined();
    expect(out.breadcrumbs[2].ref).toBeUndefined();
  });
});
