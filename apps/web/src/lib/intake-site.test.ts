import { describe, expect, it } from 'vitest';

import { normalizeIntakeSite } from './intake-site';

describe('normalizeIntakeSite', () => {
  it('adds a scheme and shows the bare host', () => {
    expect(normalizeIntakeSite('acme.com')).toEqual({ url: 'https://acme.com', host: 'acme.com' });
    expect(normalizeIntakeSite('  www.acme.co.uk ')).toEqual({ url: 'https://www.acme.co.uk', host: 'acme.co.uk' });
  });

  it('keeps an explicit scheme and a path', () => {
    expect(normalizeIntakeSite('http://acme.com/fa/')).toEqual({ url: 'http://acme.com/fa/', host: 'acme.com' });
  });

  it('drops query strings and fragments', () => {
    expect(normalizeIntakeSite('https://acme.com/?utm=x#top')?.url).toBe('https://acme.com');
  });

  it('rejects what the hero rejects', () => {
    for (const bad of ['', '   ', 'localhost', 'not a site', 'javascript:alert(1)', 'ftp://acme.com', 'acme.', 'x'.repeat(201) + '.com', null, undefined, ['acme.com']]) {
      expect(normalizeIntakeSite(bad), String(bad)).toBeNull();
    }
  });
});
