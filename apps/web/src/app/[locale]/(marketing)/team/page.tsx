/**
 * Team — the founders, confirmed by Farjad on 22 Nov 2026.
 *
 * Names, roles and LinkedIn links only; no bios were supplied, so none are
 * written. Initials stand in for photos until a file is added under
 * public/founders/ and named in lib/team.ts.
 *
 * Copy: the `team` namespace.
 */

import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { Reveal } from '@/components/marketing/home-interactions';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link } from '@/i18n/navigation';
import { pageAlternates } from '@/lib/page-metadata';
import { FOUNDERS, initials } from '@/lib/team';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'team.meta' });
  return { title: t('title'), description: t('description'), alternates: pageAlternates(locale, '/team') };
}

const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

export default function TeamPage() {
  const t = useTranslations('team');

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

      <section className="mx-auto max-w-[90rem] px-5 pb-14 md:px-16" aria-label={t('foundersTitle')}>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FOUNDERS.map((f, i) => {
            const name = t(`founders.${f.key}.name`);
            return (
              <li key={f.key}>
                <Reveal delay={i * 80} className="h-full">
                  <article className="flex h-full flex-col rounded-2xl border border-rule bg-chalk-raised p-6">
                    {f.photo ? (
                      <Image
                        src={`/founders/${f.photo}`}
                        alt={name}
                        width={96}
                        height={96}
                        className="h-20 w-20 rounded-full object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-20 w-20 items-center justify-center rounded-full bg-forest font-display text-[24px] font-bold text-chalk"
                      >
                        {initials(name)}
                      </span>
                    )}
                    <h2 className="mt-5 font-display text-[19px] font-bold leading-snug">{name}</h2>
                    <p className="mt-1 text-[15px] text-moss-muted">{t(`founders.${f.key}.role`)}</p>
                    {f.linkedin ? (
                      <a
                        href={f.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t('linkedin', { name })}
                        className="mt-auto pt-5 text-[14px] font-semibold underline decoration-rule-strong underline-offset-4 hover:decoration-saffron"
                      >
                        LinkedIn
                      </a>
                    ) : null}
                  </article>
                </Reveal>
              </li>
            );
          })}
        </ul>
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
            <Link href="/about" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px]">
              {t('closeAbout')}
            </Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
