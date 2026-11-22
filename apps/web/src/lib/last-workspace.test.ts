import { afterEach, describe, expect, it, vi } from 'vitest';

import { routing } from '@/i18n/routing';

import {
  LAST_WORKSPACE_COOKIE,
  isPlausibleWorkspaceId,
  rememberWorkspace,
  workspaceIdFromPath,
  workspaceIdFromRoute,
} from './last-workspace';

describe('workspaceIdFromPath', () => {
  it('reads the workspace from a workspace page', () => {
    expect(workspaceIdFromPath('/growth/cm3abc')).toBe('cm3abc');
    expect(workspaceIdFromPath('/growth/cm3abc/')).toBe('cm3abc');
    expect(workspaceIdFromPath('/growth/cm3abc/review')).toBe('cm3abc');
  });

  it('ignores pages that are not inside a workspace', () => {
    expect(workspaceIdFromPath('/growth')).toBeNull();
    expect(workspaceIdFromPath('/growth/new')).toBeNull();
    expect(workspaceIdFromPath('/growth/analyzing')).toBeNull();
    expect(workspaceIdFromPath('/connections')).toBeNull();
    expect(workspaceIdFromPath('/dashboard')).toBeNull();
    expect(workspaceIdFromPath('/growth/%E0%A4%A')).toBeNull();
  });
});

describe('workspaceIdFromRoute', () => {
  // next-intl's usePathname returns these template keys, not the real path.
  const workspaceTemplates = Object.keys(routing.pathnames ?? {}).filter((k) => k.startsWith('/growth/[id]'));

  it('the real routing config still has a workspace template', () => {
    expect(workspaceTemplates).toContain('/growth/[id]');
  });

  it.each(workspaceTemplates)('takes the id from params on %s', (template) => {
    expect(workspaceIdFromRoute(template, { locale: 'en', id: 'cm3abc' })).toBe('cm3abc');
  });

  it('never remembers the literal template', () => {
    expect(workspaceIdFromRoute('/growth/[id]', { locale: 'en' })).toBeNull();
    expect(workspaceIdFromRoute('/growth/[id]', null)).toBeNull();
    expect(workspaceIdFromPath('/growth/[id]')).toBe('[id]');
    expect(workspaceIdFromRoute('/growth/[id]', { id: 'a;b' })).toBeNull();
  });

  it('ignores non-workspace templates and still accepts a real path', () => {
    for (const key of Object.keys(routing.pathnames ?? {}).filter((k) => !k.startsWith('/growth/[id]'))) {
      expect(workspaceIdFromRoute(key, { id: 'cm3abc' })).toBeNull();
    }
    expect(workspaceIdFromRoute('/growth/cm3abc', {})).toBe('cm3abc');
  });
});

describe('isPlausibleWorkspaceId', () => {
  it('accepts id-shaped values only', () => {
    expect(isPlausibleWorkspaceId('cm3abc_1-x')).toBe(true);
    expect(isPlausibleWorkspaceId('')).toBe(false);
    expect(isPlausibleWorkspaceId(undefined)).toBe(false);
    expect(isPlausibleWorkspaceId('a;b=c')).toBe(false);
    expect(isPlausibleWorkspaceId('x'.repeat(65))).toBe(false);
  });
});

describe('rememberWorkspace', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes a Lax, site-wide cookie, Secure on https', () => {
    const doc = { cookie: '' };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    rememberWorkspace('ws-1');
    expect(doc.cookie).toMatch(new RegExp(`^${LAST_WORKSPACE_COOKIE}=ws-1; Path=/; Max-Age=\\d+; SameSite=Lax; Secure$`));
  });

  it('refuses values that could inject cookie attributes', () => {
    const doc = { cookie: '' };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { location: { protocol: 'http:' } });
    rememberWorkspace('ws; Domain=evil.test');
    expect(doc.cookie).toBe('');
  });

  it('does not throw when cookies are blocked', () => {
    vi.stubGlobal('document', {
      set cookie(_v: string) {
        throw new Error('SecurityError');
      },
    });
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(() => rememberWorkspace('ws-1')).not.toThrow();
  });
});
