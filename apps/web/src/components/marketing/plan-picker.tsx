'use client';

/**
 * "How much do you want to publish?" on the home page's pricing strip.
 *
 * The visitor sets posts a week and how many brands; the plan that covers it
 * turns dark. Nothing here is invented: the allowances and prices are
 * PLAN_OFFERS (lib/plan-catalogue.ts), the same numbers the pricing page
 * shows, and 1 to 14 posts a week per brand is the product's own range.
 * A month is counted as 52/12 weeks and the result says "about".
 *
 * The server renders the default (5 a week, one brand), so the cards and the
 * answer are there without script.
 */

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { PLAN_OFFERS, usd } from '@/lib/plan-catalogue';
import { cn } from '@/lib/utils';

const WEEKS_PER_MONTH = 52 / 12;
const MAX_BRANDS = Math.max(...PLAN_OFFERS.map((p) => p.brands));
const BRAND_CHOICES = Array.from({ length: MAX_BRANDS }, (_, i) => i + 1);

export function PlanPicker() {
  const t = useTranslations('home.v2.pricing.picker');
  const tc = useTranslations('home.cadence');
  const tp = useTranslations('pricing');
  const format = useFormatter();
  const [perWeek, setPerWeek] = useState(5);
  const [brands, setBrands] = useState(1);

  const perMonth = Math.ceil(perWeek * brands * WEEKS_PER_MONTH);
  const fit = PLAN_OFFERS.find((p) => p.brands >= brands && p.postsPerMonth >= perMonth) ?? null;
  const largest = PLAN_OFFERS[PLAN_OFFERS.length - 1];

  return (
    <div className="mt-6 flex flex-col gap-5 md:mt-8">
      <div className="grid gap-5 rounded-2xl border border-rule bg-chalk-raised p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-10 md:p-6">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <label htmlFor="plan-posts" className="font-plexmono text-[11px] uppercase tracking-widest text-moss-muted rtl:tracking-normal">
              {t('postsLabel')}
            </label>
            <output htmlFor="plan-posts" className="font-display text-[22px] font-bold">
              {tc('value', { count: perWeek })}
            </output>
          </div>
          <input
            id="plan-posts"
            type="range"
            min={1}
            max={14}
            value={perWeek}
            onChange={(e) => setPerWeek(Number(e.target.value))}
            className="h-11 w-full accent-moss"
          />
        </div>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="font-plexmono text-[11px] uppercase tracking-widest text-moss-muted rtl:tracking-normal">
            {t('brandsLabel')}
          </legend>
          <div className="mt-2 flex gap-1.5">
            {BRAND_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={n === brands}
                onClick={() => setBrands(n)}
                className={cn(
                  'h-11 w-11 rounded-lg border font-plexmono text-[15px] font-medium transition-colors',
                  n === brands ? 'border-moss bg-moss text-chalk' : 'border-rule-strong text-moss hover:border-moss',
                )}
              >
                {format.number(n)}
              </button>
            ))}
          </div>
        </fieldset>

        {/* The answer, announced politely when the controls move. */}
        <p aria-live="polite" className="text-[16px] leading-[1.6] md:col-span-2">
          {fit
            ? t.rich('result', {
                count: perMonth,
                plan: tp(`plans.${fit.id}.name`),
                b: (chunks) => <strong className="font-semibold">{chunks}</strong>,
              })
            : t('over', { count: perMonth, limit: largest.postsPerMonth, plan: tp(`plans.${largest.id}.name`) })}
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-3 md:gap-4">
        {PLAN_OFFERS.map((p) => {
          const on = fit?.id === p.id;
          return (
            <li
              key={p.id}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 rounded-2xl border p-5 transition-colors duration-300 md:flex md:flex-col md:gap-2 md:p-6',
                on ? 'border-forest bg-forest text-chalk' : 'border-rule bg-chalk-raised',
              )}
            >
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-[22px] font-bold">
                <bdi>{tp(`plans.${p.id}.name`)}</bdi>
                {on && (
                  <span className="rounded-full bg-saffron px-2.5 py-0.5 font-plex text-[12px] font-semibold text-moss motion-safe:animate-pop">
                    {t('fits')}
                  </span>
                )}
              </p>
              <p className="flex items-baseline gap-2">
                <bdi className="tnum font-plexmono text-[2rem] font-medium leading-none">{usd(p.monthlyUsd)}</bdi>
                <span className={cn('text-[14px]', on ? 'text-forest-muted' : 'text-moss-muted')}>{tp('perMonth')}</span>
              </p>
              <p className={cn('col-span-2 text-[15px]', on ? 'text-forest-muted' : 'text-moss-muted')}>
                {tp('included.brands', { count: p.brands })} · {tp('included.posts', { count: p.postsPerMonth })}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
