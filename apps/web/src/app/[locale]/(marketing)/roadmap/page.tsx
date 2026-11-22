/**
 * Roadmap — what is being built, in order, and what already shipped.
 *
 * Now / Next / Later without dates (Farjad's call, 22 Nov 2026): order is a
 * plan, a date would be a promise. "Recently shipped" carries real merge
 * dates so the page can be checked against the product. When something on
 * the plan ships it moves down, with its date.
 *
 * Facts: lib/roadmap.ts. Copy: the `roadmap` namespace.
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
import { HORIZONS, PLANNED, SHIPPED } from '@/lib/roadmap';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'roadmap.meta' });
  return { title: t('title'), description: t('description'), alternates: pageAlternates(locale, '/roadmap') };
}

const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

export default function RoadmapPage() {
  const t = useTranslations('roadmap');
  const format = useFormatter();
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium' });

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

      {/* Now / Next / Later */}
      <section className="mx-auto grid max-w-[90rem] gap-5 px-5 py-6 md:grid-cols-3 md:px-16">
        {HORIZONS.map((h, i) => (
          <Reveal key={h} delay={i * 100} className="h-full">
            <div
              className={`flex h-full flex-col rounded-2xl p-6 ${
                h === 'now' ? 'bg-forest text-chalk' : 'border border-rule bg-chalk-raised'
              }`}
            >
              <h2 className="font-display text-[24px] font-bold">{t(`horizons.${h}.title`)}</h2>
              <p className={`mt-1 text-[14.5px] ${h === 'now' ? 'text-forest-muted' : 'text-moss-muted'}`}>
                {t(`horizons.${h}.body`)}
              </p>
              <ul className={`mt-5 border-b ${h === 'now' ? 'border-forest-line' : 'border-rule'}`}>
                {PLANNED[h].map((id) => (
                  <li key={id} className={`border-t py-4 ${h === 'now' ? 'border-forest-line' : 'border-rule'}`}>
                    <p className="text-[16px] font-semibold">{t(`items.${id}.title`)}</p>
                    <p className={`mt-1 text-[14.5px] leading-[1.65] ${h === 'now' ? 'text-forest-muted' : 'text-moss-muted'}`}>
                      {t(`items.${id}.body`)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </section>
      <p className="mx-auto max-w-[90rem] px-5 pt-2 text-[14px] text-moss-muted md:px-16">{t('note')}</p>

      {/* Shipped */}
      <section className="mx-auto grid max-w-[90rem] gap-8 px-5 py-14 md:px-16 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12">
        <div>
          <h2 className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('shippedTitle')}</h2>
          <p className="mt-3 text-[15.5px] leading-[1.65] text-moss-muted">{t('shippedIntro')}</p>
        </div>
        <ol className="border-b border-rule">
          {SHIPPED.map((s, i) => (
            <li
              key={s.id}
              className={`grid gap-1 border-t py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6 ${i === 0 ? 'border-moss' : 'border-rule'}`}
            >
              <time dateTime={s.date} className="text-[14px] text-moss-muted">
                {day(s.date)}
              </time>
              <div>
                <p className="text-[16px] font-semibold">{t(`shipped.${s.id}.title`)}</p>
                <p className="mt-1 text-[15px] leading-[1.65] text-moss-muted">{t(`shipped.${s.id}.body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="px-5 pb-16 md:px-16">
        <Reveal className="mx-auto flex max-w-[90rem] flex-col gap-8 rounded-3xl bg-saffron px-6 py-14 text-moss md:px-16 md:py-16 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-[18ch] font-display text-[clamp(2.2rem,4.8vw,3.6rem)] font-extrabold leading-[1] tracking-[-0.03em]">
            {t('closeHeadline')}
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/contact"
              className="inline-flex h-14 items-center rounded-xl bg-moss px-7 text-[16px] font-semibold text-chalk transition-transform duration-200 hover:-translate-y-0.5"
            >
              {t('closeCta')}
            </Link>
            <Link href="/features" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px]">
              {t('closeFeatures')}
            </Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
