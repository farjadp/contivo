import { beforeEach, describe, expect, it } from 'vitest';

import {
  BREADCRUMB_CAP,
  CONSOLE_CAP,
  CONSOLE_MESSAGE_MAX,
  buildClientContext,
  pushBreadcrumb,
  pushConsole,
  resetBuffers,
  sanitizeConsoleMessage,
} from './client-buffer';

const base = { route: '/growth/[id]', locale: 'en', viewport: { w: 375, h: 700 }, viewedIds: {} };

beforeEach(() => resetBuffers());

describe('breadcrumbs', () => {
  it('keeps only the last 20, oldest dropped', () => {
    for (let i = 0; i < 25; i++) pushBreadcrumb({ kind: 'route', label: `/p${i}`, t: i });
    const ctx = buildClientContext(base);
    expect(ctx.breadcrumbs).toHaveLength(BREADCRUMB_CAP);
    expect(ctx.breadcrumbs[0].label).toBe('/p5');
    expect(ctx.breadcrumbs.at(-1)?.label).toBe('/p24');
  });

  it('keeps code and ref on action_failed and ignores empty or secret labels', () => {
    pushBreadcrumb({ kind: 'action_failed', label: 'createMatrix', code: 'PROVIDER_OUT_OF_CREDIT', ref: 'CTV-7F3K' });
    pushBreadcrumb({ kind: 'click', label: '' });
    pushBreadcrumb({ kind: 'click', label: 'Bearer abcdef123456' });
    const { breadcrumbs } = buildClientContext(base);
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0]).toMatchObject({ code: 'PROVIDER_OUT_OF_CREDIT', ref: 'CTV-7F3K' });
  });
});

describe('console buffer', () => {
  it('keeps the last 10', () => {
    for (let i = 0; i < 14; i++) pushConsole('error', `boom ${i}`);
    const { consoleErrors } = buildClientContext(base);
    expect(consoleErrors).toHaveLength(CONSOLE_CAP);
    expect(consoleErrors[0].message).toBe('boom 4');
  });

  it('truncates to 200 chars', () => {
    expect(sanitizeConsoleMessage('x '.repeat(300))?.length).toBeLessThanOrEqual(CONSOLE_MESSAGE_MAX);
  });

  it('reduces URLs to their path (no host, query or hash)', () => {
    const out = sanitizeConsoleMessage('Failed to fetch https://www.contivo.app/api/x/y?email=a@b.c&z=1#frag now');
    expect(out).toBe('Failed to fetch /api/x/y now');
  });

  it.each([
    ['jwt', 'bad token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc'],
    ['openai key', 'Incorrect API key sk-proj-abcdEFGH12345678'],
    ['bearer', 'Authorization: Bearer abc.def.ghi'],
    ['hex', 'session 3f9a1c2b4d5e6f708192a3b4c5d6e7f80a1b2c3d'],
    ['base64', 'blob QWxhZGRpbjpvcGVuIHNlc2FtZVRoaXNJc0FMb25nQmFzZTY0U3RyaW5nMTIzNA=='],
    ['cookie', 'auth-token=abc'],
  ])('drops an entry that looks like a %s', (_n, msg) => {
    expect(sanitizeConsoleMessage(msg)).toBeNull();
    pushConsole('error', msg);
    expect(buildClientContext(base).consoleErrors).toHaveLength(0);
  });

  it('accepts Error objects and drops unusable values', () => {
    expect(sanitizeConsoleMessage(new Error('plain failure'))).toBe('plain failure');
    expect(sanitizeConsoleMessage('   ')).toBeNull();
  });
});

describe('buildClientContext', () => {
  it('strips query and hash from the route and rounds the viewport', () => {
    const ctx = buildClientContext({ ...base, route: '/growth/abc?x=1#h', viewport: { w: 375.4, h: 667.6 } });
    expect(ctx.route).toBe('/growth/abc');
    expect(ctx.viewport).toEqual({ w: 375, h: 668 });
  });

  it('keeps only well-formed ids', () => {
    const ctx = buildClientContext({
      ...base,
      viewedIds: { workspaceId: 'cmabc123', matrixRunId: '<script>alert(1)</script>', contentItemId: 'x'.repeat(80) },
    });
    expect(ctx.viewedIds).toEqual({ workspaceId: 'cmabc123' });
  });

  it('returns copies so later pushes do not mutate a built context', () => {
    pushBreadcrumb({ kind: 'route', label: '/a' });
    const ctx = buildClientContext(base);
    pushBreadcrumb({ kind: 'route', label: '/b' });
    expect(ctx.breadcrumbs).toHaveLength(1);
  });
});

describe('path', () => {
  it('sends the real pathname next to the route template, query stripped', () => {
    const ctx = buildClientContext({ ...base, path: '/growth/clx1/matrices?x=1#h' });
    expect(ctx.route).toBe('/growth/[id]');
    expect(ctx.path).toBe('/growth/clx1/matrices');
  });

  it('omits path when none is given', () => {
    expect(buildClientContext(base).path).toBeUndefined();
  });
});
