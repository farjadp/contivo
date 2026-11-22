import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { OAUTH_ERROR_CODES } from '@/lib/oauth/errors';

const ROOT = path.resolve(__dirname, '../../messages');
const APP = ['en', 'fa', 'it', 'es', 'he'] as const;
// sign-in and sign-up are served in all eight locales (auth is a site namespace)
const ALL = [...APP, 'fr', 'ar', 'zh'] as const;

const load = (loc: string, file: string) => JSON.parse(readFileSync(path.join(ROOT, loc, `${file}.json`), 'utf8'));

describe('social sign-in copy: auth.json', () => {
  it.each(ALL)('%s has a message for every error code and no extras', (loc) => {
    const { oauthErrors } = load(loc, 'auth').auth;
    expect(Object.keys(oauthErrors).sort()).toEqual([...OAUTH_ERROR_CODES].sort());
    for (const v of Object.values(oauthErrors)) expect(String(v).trim().length).toBeGreaterThan(10);
  });

  it.each(ALL)('%s has the button, divider and fine-print keys, with both link tags', (loc) => {
    const { social } = load(loc, 'auth').auth;
    expect(Object.keys(social).sort()).toEqual(['divider', 'fineprint', 'github', 'google', 'label']);
    expect(social.google).toContain('Google');
    expect(social.github).toContain('GitHub');
    expect(social.fineprint).toMatch(/<terms>.+<\/terms>/);
    expect(social.fineprint).toMatch(/<privacy>.+<\/privacy>/);
  });

  it.each(ALL)('%s email_in_use links the contact page', (loc) => {
    expect(load(loc, 'auth').auth.oauthErrors.email_in_use).toMatch(/<contact>.+<\/contact>/);
  });

  it('Persian copy has no Latin digits and no Arabic ي / ك', () => {
    const { social, oauthErrors } = load('fa', 'auth').auth;
    for (const v of [...Object.values(social), ...Object.values(oauthErrors)] as string[]) {
      expect(v).not.toMatch(/[0-9]/);
      expect(v).not.toMatch(/[يك]/);
    }
  });
});

describe('social sign-in copy: legal.json', () => {
  it.each(ALL)('%s Privacy has the delete-account section after retention, and a cookie entry', (loc) => {
    const { privacy, terms } = load(loc, 'legal').legal;
    const ids = privacy.sections.map((s: { id: string }) => s.id);
    expect(ids.indexOf('delete-account')).toBe(ids.indexOf('retention') + 1);
    const del = privacy.sections[ids.indexOf('delete-account')];
    expect(del.blocks).toHaveLength(6);
    expect(del.blocks.some((b: unknown) => typeof b === 'string' && b.includes('{email}'))).toBe(true);
    const cookies = privacy.sections.find((s: { id: string }) => s.id === 'cookies');
    expect(cookies.blocks[1]).toHaveLength(4);
    expect(cookies.blocks[1][3]).toContain('__Host-oauth_tx');
    expect(privacy.summary).toHaveLength(5);
    expect(terms.sections.find((s: { id: string }) => s.id === 'account').blocks).toHaveLength(2);
  });

  it.each(ALL)('%s legal text does not mention Facebook or Meta (out of v1)', (loc) => {
    const values: string[] = [];
    JSON.stringify(load(loc, 'legal'), (_k, v) => (typeof v === 'string' ? (values.push(v), v) : v));
    const text = values.join('\n');
    expect(text).not.toMatch(/facebook|\bmeta\b|فیسبوک|فيسبوك|פייסבוק|脸书|臉書/i);
  });

  it('English meta description no longer says "three cookies"', () => {
    expect(load('en', 'legal').legal.privacy.meta.description).not.toMatch(/three/);
  });
});
