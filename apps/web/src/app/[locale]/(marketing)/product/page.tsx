/**
 * Product — how it works, start to finish.
 *
 * The concrete path a new customer walks, in the order the app makes them
 * walk it, taken from the code on 22 Nov 2026 (register → /onboarding →
 * /growth/new → analysing → the workspace tabs → /connections → Autopilot).
 * Each step says what you do and what Contivo does, so nobody signs up
 * expecting a different product. The "good to know" list carries the parts
 * that are not effortless: confirming competitors, the 60-day LinkedIn
 * reconnect, and the one-time developer step for publishing to your site.
 *
 * Recipes and their defaults mirror lib/autopilot/recipes.ts.
 * Copy: the `product` namespace.
 */

import type { Metadata } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Reveal } from '@/components/marketing/home-interactions';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link } from '@/i18n/navigation';
import { pageAlternates } from '@/lib/page-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'product.meta' });
  return { title: t('title'), description: t('description'), alternates: pageAlternates(locale, '/product') };
}

const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

const STEPS = ['signUp', 'website', 'competitors', 'narrative', 'connect', 'autopilot', 'running'] as const;

/** Autopilot starting points, with the defaults from lib/autopilot/recipes.ts. */
const RECIPES = [
  { id: 'linkedinVoice', perWeek: 3 },
  { id: 'blogWriter', perWeek: 1 },
  { id: 'thoughtLeader', perWeek: 2 },
  { id: 'productOffers', perWeek: 2 },
  { id: 'custom', perWeek: 3 },
] as const;

const NEED = ['website', 'linkedin', 'developer'] as const;
const KNOW = ['confirm', 'review', 'reconnect', 'estimates', 'languages'] as const;

export default function ProductPage() {
  const t = useTranslations('product');
  const format = useFormatter();
  const num = (i: number) => format.number(i, { minimumIntegerDigits: 2, useGrouping: false });

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />

      <header className="mx-auto max-w-[90rem] px-5 pb-12 pt-12 md:px-16 md:pt-20">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted rtl:tracking-normal">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow')}
        </p>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-end">
          <h1 className="font-display text-[clamp(2.4rem,5.6vw,4.6rem)] font-extrabold leading-[1] tracking-[-0.03em] motion-safe:animate-rise">
            {t.rich('headline', { accent })}
          </h1>
          <p className="text-[17px] leading-[1.65] text-moss-muted motion-safe:animate-rise motion-safe:[animation-delay:120ms]">
            {t('intro')}
          </p>
        </div>
      </header>

      {/* The steps */}
      <section className="mx-auto max-w-[90rem] px-5 py-6 md:px-16" aria-labelledby="steps-title">
        <h2 id="steps-title" className="sr-only">
          {t('stepsTitle')}
        </h2>
        <ol className="border-b border-rule">
          {STEPS.map((id, i) => (
            <li key={id} className="grid gap-4 border-t border-rule py-8 md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
              <p className="font-plexmono text-[13px] font-medium tracking-widest text-saffron-ink rtl:tracking-normal">
                <bdi>{num(i + 1)}</bdi>
              </p>
              <div>
                <h3 className="font-display text-[clamp(1.3rem,2.2vw,1.7rem)] font-bold leading-[1.15]">{t(`steps.${id}.title`)}</h3>
                <p className="mt-2 text-[15.5px] leading-[1.7] text-moss-muted">{t(`steps.${id}.you`)}</p>
              </div>
              <div className="rounded-xl bg-chalk-raised p-5">
                <p className="font-plexmono text-[11.5px] uppercase tracking-[0.12em] text-moss-muted rtl:tracking-normal">{t('itDoes')}</p>
                <p className="mt-2 text-[15px] leading-[1.7]">{t(`steps.${id}.it`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Recipes */}
      <section className="mx-auto max-w-[90rem] px-5 py-12 md:px-16">
        <h2 className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('recipesTitle')}</h2>
        <p className="mt-3 max-w-[62ch] text-[16px] leading-[1.7] text-moss-muted">{t('recipesIntro')}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPES.map((r, i) => (
            <Reveal key={r.id} delay={(i % 3) * 80} className="h-full">
              <article className="flex h-full flex-col rounded-2xl border border-rule bg-chalk-raised p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-[18px] font-bold leading-snug">{t(`recipes.${r.id}.name`)}</h3>
                  <span className="shrink-0 text-[13px] text-moss-muted">{t('perWeek', { count: r.perWeek })}</span>
                </div>
                <p className="mt-2.5 text-[15px] leading-[1.65] text-moss-muted">{t(`recipes.${r.id}.body`)}</p>
                <p className="mt-auto border-t border-rule pt-3 text-[13.5px] text-moss-muted">{t(`recipes.${r.id}.when`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* What you need + good to know */}
      <section className="mx-auto grid max-w-[90rem] gap-6 px-5 py-6 md:grid-cols-2 md:px-16">
        <div className="rounded-2xl border border-rule bg-chalk-raised p-7">
          <h2 className="font-display text-[clamp(1.5rem,2.6vw,1.9rem)] font-bold leading-[1.1]">{t('needTitle')}</h2>
          <ul className="mt-5 space-y-4">
            {NEED.map((id) => (
              <li key={id} className="flex gap-3">
                <span aria-hidden className="mt-[0.55em] h-2 w-2 shrink-0 rotate-45 bg-saffron" />
                <span>
                  <span className="block text-[16px] font-semibold">{t(`need.${id}.title`)}</span>
                  <span className="mt-1 block text-[15px] leading-[1.65] text-moss-muted">{t(`need.${id}.body`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-dashed border-rule-strong p-7">
          <h2 className="font-display text-[clamp(1.5rem,2.6vw,1.9rem)] font-bold leading-[1.1]">{t('knowTitle')}</h2>
          <ul className="mt-5 space-y-4">
            {KNOW.map((id) => (
              <li key={id} className="flex gap-3">
                <span aria-hidden className="mt-[0.55em] h-2 w-2 shrink-0 rotate-45 border border-moss-muted" />
                <span>
                  <span className="block text-[16px] font-semibold">{t(`know.${id}.title`)}</span>
                  <span className="mt-1 block text-[15px] leading-[1.65] text-moss-muted">{t(`know.${id}.body`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <p className="mx-auto max-w-[90rem] px-5 pb-10 pt-4 text-[15px] md:px-16">
        <Link href="/features" className="font-semibold underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
          {t('featuresLink')}
        </Link>
      </p>

      <section className="px-5 pb-16 md:px-16">
        <Reveal className="mx-auto flex max-w-[90rem] flex-col gap-8 rounded-3xl bg-saffron px-6 py-14 text-moss md:px-16 md:py-16 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-[18ch] font-display text-[clamp(2.2rem,4.8vw,3.6rem)] font-extrabold leading-[1] tracking-[-0.03em]">
            {t('closeHeadline')}
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/sign-up"
              className="inline-flex h-14 items-center rounded-xl bg-moss px-7 text-[16px] font-semibold text-chalk transition-transform duration-200 hover:-translate-y-0.5"
            >
              {t('closeCta')}
            </Link>
            <Link href="/why" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px]">
              {t('closeWhy')}
            </Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
