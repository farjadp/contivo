import { describe, expect, it } from 'vitest';
import { isExcludedDomain, normalizeCandidateDomain, normalizeEvidenceUrl } from './domains';

describe('normalizeCandidateDomain', () => {
  it('lowercases and strips protocol, www and path', () => {
    expect(normalizeCandidateDomain('https://WWW.Hesabshop.com/pricing?a=1')).toBe('hesabshop.com');
  });

  it('reduces a subdomain to its registrable domain', () => {
    expect(normalizeCandidateDomain('https://docs.surferseo.com/guide')).toBe('surferseo.com');
    expect(normalizeCandidateDomain('https://blog.hubspot.com/marketing')).toBe('hubspot.com');
  });

  it('keeps a multi-part public suffix intact', () => {
    // 24talk.ir must not collapse to talk.ir
    expect(normalizeCandidateDomain('https://edu.24talk.ir')).toBe('24talk.ir');
    expect(normalizeCandidateDomain('https://ir.linkedin.com/in/x')).toBe(null); // excluded below
  });

  it('unwraps stat-mirror hosts to the real company domain', () => {
    expect(normalizeCandidateDomain('https://sazito.com.atlaq.com')).toBe('sazito.com');
    expect(normalizeCandidateDomain('https://shopfa.com.atlaq.com')).toBe('shopfa.com');
    expect(normalizeCandidateDomain('https://kamva.ir.usitestat.com')).toBe('kamva.ir');
    expect(normalizeCandidateDomain('https://bahooosh.com.cutestat.com')).toBe('bahooosh.com');
    expect(normalizeCandidateDomain('https://spooler.ir.clearwebstats.com')).toBe('spooler.ir');
  });

  it('rejects messengers, social networks, wikis, code hosts and stat sites', () => {
    for (const url of [
      'https://t.me/somechannel',
      'https://telegram.me/x',
      'https://www.linkedin.com/company/x',
      'https://en.wikipedia.org/wiki/X',
      'https://hub.docker.com/r/x',
      'https://trends.builtwith.com/x',
      'https://hypestat.com/info/x',
      'https://www.reddit.com/r/x',
      'https://www.youtube.com/watch?v=x',
    ]) {
      expect(normalizeCandidateDomain(url)).toBe(null);
    }
  });

  it('rejects junk input', () => {
    expect(normalizeCandidateDomain('')).toBe(null);
    expect(normalizeCandidateDomain('not a url')).toBe(null);
    expect(normalizeCandidateDomain('https://192.168.0.1/x')).toBe(null);
  });

  it('keeps ordinary company domains', () => {
    expect(normalizeCandidateDomain('https://futurpreneur.ca/en/')).toBe('futurpreneur.ca');
    expect(normalizeCandidateDomain('cerp.ir')).toBe('cerp.ir');
  });
});

describe('isExcludedDomain', () => {
  it('matches the never-a-company list on the registrable domain', () => {
    expect(isExcludedDomain('wikipedia.org')).toBe(true);
    expect(isExcludedDomain('hesabshop.com')).toBe(false);
  });
});

describe('normalizeEvidenceUrl', () => {
  it('lowercases the host', () => {
    expect(normalizeEvidenceUrl('https://Example.com/a')).toBe('example.com/a');
    expect(normalizeEvidenceUrl('https://EXAMPLE.COM/A')).toBe('example.com/A');
  });

  it('drops the fragment', () => {
    expect(normalizeEvidenceUrl('https://example.com/a#section')).toBe('example.com/a');
  });

  it('drops a trailing slash from the path', () => {
    expect(normalizeEvidenceUrl('https://example.com/a/')).toBe('example.com/a');
    // The bare root path is left as "/", not stripped to "".
    expect(normalizeEvidenceUrl('https://example.com/')).toBe('example.com/');
  });

  it('produces the same string for the case/fragment/trailing-slash example from the brief', () => {
    expect(normalizeEvidenceUrl('https://Example.com/a/')).toBe(normalizeEvidenceUrl('http://example.com/a#x'));
    expect(normalizeEvidenceUrl('https://Example.com/a/')).toBe('example.com/a');
  });

  it('preserves the query string', () => {
    expect(normalizeEvidenceUrl('https://example.com/a?x=1&y=2')).toBe('example.com/a?x=1&y=2');
  });

  it('does not apply the exclusion list', () => {
    // Unlike normalizeCandidateDomain, an excluded host is still normalized, not rejected.
    expect(normalizeEvidenceUrl('https://www.linkedin.com/company/x')).toBe('www.linkedin.com/company/x');
  });

  it('returns the trimmed original input unchanged for unparseable input', () => {
    // Documented behaviour: when the input cannot be parsed as a URL (even after
    // assuming a protocol), normalizeEvidenceUrl returns the trimmed input as-is.
    expect(normalizeEvidenceUrl('not a url')).toBe('not a url');
    expect(normalizeEvidenceUrl('  not a url  ')).toBe('not a url');
    expect(normalizeEvidenceUrl('')).toBe('');
  });
});
