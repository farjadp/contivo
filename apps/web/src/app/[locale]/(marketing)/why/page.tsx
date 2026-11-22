/**
 * Why Contivo — the argument, for someone deciding whether to try it.
 *
 * Home shows the loop, /features lists everything, /compare puts it next to
 * other tools. This page answers the question before all of those: why would
 * a small business pick this over the usual ways of getting content done, and
 * who should not. The "not for you" section is load-bearing, not modesty: the
 * site claims only what works, and saying who it is wrong for is part of that.
 *
 * Copy: the `why` namespace. No numbers here that are not elsewhere on the site.
 */

import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
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
  const t = await getTranslations({ locale, namespace: 'why.meta' });
  return { title: t('title'), description: t('description'), alternates: pageAlternates(locale, '/why') };
}

const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

/** The usual ways a small business gets content done, and what each leaves on the owner's desk. */
const USUAL = ['agency', 'freelancer', 'assistant', 'scheduler'] as const;
/** What Contivo does instead. */
const INSTEAD = ['research', 'refuse', 'runs', 'persian'] as const;
const FOR = ['noTeam', 'founder', 'persian', 'agency'] as const;
const NOT_FOR = ['channels', 'languages', 'everyWord', 'analytics'] as const;

export default function WhyPage() {
  const t = useTranslations('why');

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

      {/* The usual answers */}
      <section className="mx-auto max-w-[90rem] px-5 py-10 md:px-16">
        <h2 className="max-w-[28ch] font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('usualTitle')}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {USUAL.map((id, i) => (
            <Reveal key={id} delay={(i % 2) * 80} className="h-full">
              <article className="flex h-full flex-col rounded-2xl border border-rule bg-chalk-raised p-6">
                <h3 className="font-display text-[19px] font-bold leading-snug">{t(`usual.${id}.title`)}</h3>
                <p className="mt-2.5 text-[15px] leading-[1.65] text-moss-muted">{t(`usual.${id}.good`)}</p>
                <p className="mt-auto border-t border-rule pt-3.5 text-[15px] leading-[1.6]">
                  <span className="font-semibold">{t('leftWithYou')} </span>
                  {t(`usual.${id}.left`)}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
        <p className="mt-5 text-[15px]">
          <Link href="/compare" className="font-semibold underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
            {t('compareLink')}
          </Link>
        </p>
      </section>

      {/* What it does instead */}
      <section className="px-5 py-10 md:px-16">
        <div className="mx-auto grid max-w-[90rem] gap-8 rounded-3xl bg-forest px-6 py-12 text-chalk md:px-12 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12">
          <h2 className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('insteadTitle')}</h2>
          <ol className="border-b border-forest-line">
            {INSTEAD.map((id) => (
              <li key={id} className="border-t border-forest-line py-5">
                <p className="text-[17px] font-semibold">{t(`instead.${id}.title`)}</p>
                <p className="mt-1.5 max-w-[62ch] text-[15.5px] leading-[1.7] text-forest-muted">{t(`instead.${id}.body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* For / not for */}
      <section className="mx-auto grid max-w-[90rem] gap-6 px-5 py-12 md:grid-cols-2 md:px-16">
        <div className="rounded-2xl border border-rule bg-chalk-raised p-7">
          <h2 className="font-display text-[clamp(1.5rem,2.6vw,1.9rem)] font-bold leading-[1.1]">{t('forTitle')}</h2>
          <ul className="mt-5 space-y-4">
            {FOR.map((id) => (
              <li key={id} className="flex gap-3">
                <span aria-hidden className="mt-[0.55em] h-2 w-2 shrink-0 rotate-45 bg-saffron" />
                <span>
                  <span className="block text-[16px] font-semibold">{t(`for.${id}.title`)}</span>
                  <span className="mt-1 block text-[15px] leading-[1.65] text-moss-muted">{t(`for.${id}.body`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-dashed border-rule-strong p-7">
          <h2 className="font-display text-[clamp(1.5rem,2.6vw,1.9rem)] font-bold leading-[1.1]">{t('notForTitle')}</h2>
          <ul className="mt-5 space-y-4">
            {NOT_FOR.map((id) => (
              <li key={id} className="flex gap-3">
                <span aria-hidden className="mt-[0.55em] h-2 w-2 shrink-0 rotate-45 border border-moss-muted" />
                <span>
                  <span className="block text-[16px] font-semibold">{t(`notFor.${id}.title`)}</span>
                  <span className="mt-1 block text-[15px] leading-[1.65] text-moss-muted">{t(`notFor.${id}.body`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Who is behind it */}
      <section className="mx-auto grid max-w-[90rem] gap-6 px-5 pb-12 md:px-16 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12">
        <h2 className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('behindTitle')}</h2>
        <div className="max-w-[62ch] text-[16px] leading-[1.75] text-moss-muted">
          <p>{t('behindBody')}</p>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/team" className="font-semibold text-moss underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
              {t('teamLink')}
            </Link>
            <Link href="/about" className="font-semibold text-moss underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
              {t('aboutLink')}
            </Link>
          </p>
        </div>
      </section>

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
            <Link href="/product" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px]">
              {t('closeProduct')}
            </Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
