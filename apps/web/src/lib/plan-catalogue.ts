/**
 * plan-catalogue.ts — the plans as the public site shows them.
 *
 * The numbers are the decided catalogue (docs/superpowers/specs/
 * 2026-09-26-pricing-packages-design.md, mirrored in `lib/plans.ts` on the
 * `pricing-packages` branch). When billing ships and plans live in the
 * database, the pricing page reads them from there and this file goes away.
 *
 * Billing is not live: nothing here is charged today, and the pricing page
 * says so. What a plan *will* include is split in two on purpose:
 *   included — built, and usable now during early access
 *   soon     — designed, not built. Shown with a "soon" badge and no quota,
 *              because a quota on something that does not exist is a sale.
 */

export type PlanId = 'founder' | 'growth' | 'agency';

/** Plan features that are not built yet. Copy lives under `pricing.soon.<id>`. */
export type SoonPerk =
  | 'monitoring'
  | 'imageQuality'
  | 'videoScripts'
  | 'templateVideos'
  | 'whiteLabel'
  | 'shareLinks';

export interface PlanOffer {
  id: PlanId;
  monthlyUsd: number;
  /** Two months free: ten times the monthly price. */
  annualUsd: number;
  brands: number;
  postsPerMonth: number;
  imagesPerMonth: number;
  reportsPerMonth: number;
  /** Per extra brand per month; null where the plan cannot add brands. */
  extraBrandUsd: number | null;
  highlighted: boolean;
  soon: readonly SoonPerk[];
}

export const PLAN_OFFERS: readonly PlanOffer[] = [
  {
    id: 'founder',
    monthlyUsd: 55,
    annualUsd: 550,
    brands: 1,
    postsPerMonth: 34,
    imagesPerMonth: 13,
    reportsPerMonth: 1,
    extraBrandUsd: null,
    highlighted: false,
    soon: ['videoScripts', 'templateVideos'],
  },
  {
    id: 'growth',
    monthlyUsd: 89,
    annualUsd: 890,
    brands: 1,
    postsPerMonth: 89,
    imagesPerMonth: 34,
    reportsPerMonth: 3,
    extraBrandUsd: null,
    highlighted: true,
    soon: ['monitoring', 'imageQuality', 'videoScripts', 'templateVideos'],
  },
  {
    id: 'agency',
    monthlyUsd: 233,
    annualUsd: 2330,
    brands: 5,
    postsPerMonth: 233,
    imagesPerMonth: 144,
    reportsPerMonth: 13,
    extraBrandUsd: 34,
    highlighted: false,
    soon: ['monitoring', 'imageQuality', 'videoScripts', 'templateVideos', 'whiteLabel', 'shareLinks'],
  },
];

/** One-off pack of image credits, spent only after the monthly allowance. */
export const IMAGE_PACK = { credits: 55, usd: 34 } as const;

/** The lowest plan that carries a feature, for features not on every plan. */
export function lowestPlanWith(perk: SoonPerk): PlanId | null {
  return PLAN_OFFERS.find((p) => p.soon.includes(perk))?.id ?? null;
}

/** "$55" — a price tag keeps its currency and Latin digits in every locale. */
export function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}
