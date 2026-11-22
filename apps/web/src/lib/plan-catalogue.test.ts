import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FEATURES } from './features';
import { IMAGE_PACK, PLAN_OFFERS, lowestPlanWith, usd } from './plan-catalogue';

const LOCALES = ['en', 'fa', 'it'] as const;

function messages(locale: string, file: string): Record<string, unknown> {
  const p = path.join(__dirname, '..', '..', 'messages', locale, file);
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function get(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

describe('plan catalogue', () => {
  it('matches the decided prices and quotas', () => {
    expect(PLAN_OFFERS.map((p) => [p.id, p.monthlyUsd, p.postsPerMonth, p.imagesPerMonth, p.reportsPerMonth, p.brands])).toEqual([
      ['founder', 55, 34, 13, 1, 1],
      ['growth', 89, 89, 34, 3, 1],
      ['agency', 233, 233, 144, 13, 5],
    ]);
    expect(IMAGE_PACK).toEqual({ credits: 55, usd: 34 });
  });

  it('prices a year at ten months', () => {
    for (const p of PLAN_OFFERS) expect(p.annualUsd).toBe(p.monthlyUsd * 10);
  });

  it('lets only Agency add brands', () => {
    expect(PLAN_OFFERS.filter((p) => p.extraBrandUsd !== null).map((p) => p.id)).toEqual(['agency']);
  });

  it('recommends exactly one plan', () => {
    expect(PLAN_OFFERS.filter((p) => p.highlighted)).toHaveLength(1);
  });

  it('formats a price tag with Latin digits', () => {
    expect(usd(2330)).toBe('$2,330');
  });
});

describe('pricing and features agree', () => {
  it('tags each plan-limited feature with the lowest plan the pricing page gives it', () => {
    for (const f of FEATURES) {
      if (!f.plan || f.id === 'brands') continue;
      expect(lowestPlanWith(f.id as Parameters<typeof lowestPlanWith>[0])).toBe(f.plan);
    }
  });

  it('never sells a feature as included that the features page calls soon', () => {
    const soonIds = new Set(FEATURES.filter((f) => f.status === 'soon').map((f) => f.id));
    for (const p of PLAN_OFFERS) for (const perk of p.soon) {
      if (perk === 'videoScripts' || perk === 'templateVideos') expect(soonIds.has('video')).toBe(true);
      else expect(soonIds.has(perk)).toBe(true);
    }
  });
});

describe.each(LOCALES)('%s copy', (locale) => {
  const pricing = messages(locale, 'pricing.json');
  const features = messages(locale, 'features.json');

  it('has every pricing key the page reads', () => {
    const keys = [
      'meta.title', 'meta.description', 'earlyAccess.lead', 'earlyAccess.body', 'perMonth', 'annual', 'cta', 'soonTitle',
      'included.brands', 'included.posts', 'included.images', 'included.reports', 'included.loop', 'included.channels',
      'included.extraBrand', 'addOns.title', 'addOns.imagePack.name', 'addOns.imagePack.body', 'addOns.extraBrand.name',
      'addOns.extraBrand.body',
      ...PLAN_OFFERS.flatMap((p) => [`plans.${p.id}.name`, `plans.${p.id}.tagline`, ...p.soon.map((s) => `soon.${s}`)]),
      ...['post', 'image', 'runOut', 'approve', 'down', 'cancel', 'pay'].flatMap((k) => [`faq.${k}.q`, `faq.${k}.a`]),
    ];
    for (const k of keys) expect(typeof get(pricing, `pricing.${k}`), k).toBe('string');
  });

  it('has an item for every feature and a tag for every plan it names', () => {
    for (const f of FEATURES) {
      expect(typeof get(features, `features.items.${f.id}.name`), f.id).toBe('string');
      if (f.plan) expect(typeof get(features, `features.planTag.${f.plan}`), f.plan).toBe('string');
    }
  });

  it('does not hardcode a price in the copy', () => {
    const text = JSON.stringify(get(pricing, 'pricing.plans'));
    expect(text).not.toMatch(/\$\d/);
  });
});
