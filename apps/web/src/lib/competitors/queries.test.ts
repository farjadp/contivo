import { describe, expect, it } from 'vitest';
import { buildBrandBrief } from './queries';

describe('buildBrandBrief', () => {
  it('survives a brandSummary missing every field', () => {
    const brief = buildBrandBrief({
      workspace: {
        name: 'Acme Co',
        websiteUrl: 'https://acme.example.com',
        brandSummary: {},
        targetCountry: null,
        targetLanguage: 'en',
      },
      competitors: [],
    });

    expect(brief.companyName).toBe('Acme Co');
    expect(brief.ownDomain).toBe('acme.example.com');
    expect(brief.summary).toBe('');
    expect(brief.valueProposition).toBe('');
    expect(brief.industry).toBe('');
    expect(brief.audience).toBe('');
    expect(brief.market).toEqual({ country: null, language: 'en' });
    expect(brief.acceptedCompetitors).toEqual([]);
    expect(brief.rejectedCompetitors).toEqual([]);
    expect(brief.knownDomains).toEqual([]);
  });

  it('tolerates brandSummary being null or a non-object value', () => {
    const brief = buildBrandBrief({
      workspace: {
        name: 'Acme Co',
        websiteUrl: null,
        brandSummary: null,
        targetCountry: 'IR',
        targetLanguage: 'fa',
      },
      competitors: [],
    });

    expect(brief.ownDomain).toBeNull();
    expect(brief.summary).toBe('');
    expect(brief.market).toEqual({ country: 'IR', language: 'fa' });
  });

  it('pulls summary fields defensively out of untyped brandSummary JSON', () => {
    const brief = buildBrandBrief({
      workspace: {
        name: 'Sazito',
        websiteUrl: 'https://sazito.com',
        brandSummary: {
          businessSummary: 'An online store builder for Iranian merchants.',
          valueProposition: 'Launch a store in minutes.',
          industry: 'E-commerce platforms',
          audience: 'Small business owners in Iran',
        },
        targetCountry: 'IR',
        targetLanguage: 'fa',
      },
      competitors: [],
    });

    expect(brief.summary).toBe('An online store builder for Iranian merchants.');
    expect(brief.valueProposition).toBe('Launch a store in minutes.');
    expect(brief.industry).toBe('E-commerce platforms');
    expect(brief.audience).toBe('Small business owners in Iran');
  });

  it('falls back to heroMessage for summary when businessSummary is absent', () => {
    const brief = buildBrandBrief({
      workspace: {
        name: 'Acme',
        websiteUrl: null,
        brandSummary: { heroMessage: 'Ship faster.' },
        targetCountry: null,
        targetLanguage: 'en',
      },
      competitors: [],
    });

    expect(brief.summary).toBe('Ship faster.');
  });

  it('trims summary fields to 500 chars', () => {
    const long = 'a'.repeat(600);
    const brief = buildBrandBrief({
      workspace: {
        name: 'Acme',
        websiteUrl: null,
        brandSummary: {
          businessSummary: long,
          valueProposition: long,
          industry: long,
          audience: long,
        },
        targetCountry: null,
        targetLanguage: 'en',
      },
      competitors: [],
    });

    expect(brief.summary).toHaveLength(500);
    expect(brief.valueProposition).toHaveLength(500);
    expect(brief.industry).toHaveLength(500);
    expect(brief.audience).toHaveLength(500);
  });

  it('splits competitors by userDecision into accepted and rejected, keeping the rejection reason', () => {
    const brief = buildBrandBrief({
      workspace: {
        name: 'Acme',
        websiteUrl: null,
        brandSummary: {},
        targetCountry: null,
        targetLanguage: 'en',
      },
      competitors: [
        { name: 'Rival One', domain: 'rivalone.com', userDecision: 'ACCEPTED', rejectionReason: null },
        {
          name: 'Not A Rival',
          domain: 'notarival.com',
          userDecision: 'REJECTED',
          rejectionReason: 'Different market segment',
        },
        { name: 'Pending Co', domain: 'pendingco.com', userDecision: 'PENDING', rejectionReason: null },
        { name: 'No Decision Co', domain: 'nodecision.com', userDecision: null, rejectionReason: null },
      ],
    });

    expect(brief.acceptedCompetitors).toEqual([{ name: 'Rival One', domain: 'rivalone.com' }]);
    expect(brief.rejectedCompetitors).toEqual([
      { name: 'Not A Rival', domain: 'notarival.com', reason: 'Different market segment' },
    ]);
  });

  it('collects every non-null competitor domain into knownDomains, regardless of decision', () => {
    const brief = buildBrandBrief({
      workspace: {
        name: 'Acme',
        websiteUrl: null,
        brandSummary: {},
        targetCountry: null,
        targetLanguage: 'en',
      },
      competitors: [
        { name: 'A', domain: 'a.com', userDecision: 'ACCEPTED', rejectionReason: null },
        { name: 'B', domain: null, userDecision: 'REJECTED', rejectionReason: 'no domain' },
        { name: 'C', domain: 'c.com', userDecision: 'PENDING', rejectionReason: null },
      ],
    });

    expect(brief.knownDomains).toEqual(['a.com', 'c.com']);
  });
});
