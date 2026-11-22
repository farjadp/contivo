/**
 * Compare — how Contivo differs from the tools a small business would
 * otherwise use, and where it does not measure up yet.
 *
 * By category, not head to head: AI writing tools, social schedulers, SEO
 * platforms, general assistants used by hand, and AI agents. Named examples
 * appear only where the fact was read on the vendor's own page, and the page
 * says on which date. The "behind" and "pick something else" sections are not
 * a courtesy: the rest of the site claims only what works, and a comparison
 * that hid the gaps would undo that.
 *
 * Facts: lib/comparison.ts. Copy: the `compare` namespace.
 */

import type { Metadata } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Reveal } from '@/components/marketing/home-interactions';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link } from '@/i18n/navigation';
import {
  BEHIND,
  CHECKED_ON,
  COLUMNS,
  ELSEWHERE,
  ROWS,
  SOURCES,
  UNIQUE,
  type Status,
} from '@/lib/comparison';
import { pageAlternates } from '@/lib/page-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'compare.meta' });
  return { title: t('title'), description: t('description'), alternates: pageAlternates(locale, '/compare') };
}

const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

/** A shape, not a colour alone, so the verdict survives greyscale and colour blindness. */
function StatusMark({ status, label }: { status: Status; label: string }) {
  const shape =
    status === 'yes'
      ? 'bg-moss border-moss'
      : status === 'partial'
        ? 'border-moss bg-[linear-gradient(90deg,#17201B_50%,transparent_50%)] rtl:bg-[linear-gradient(270deg,#17201B_50%,transparent_50%)]'
        : status === 'no'
          ? 'border-rule-strong bg-transparent'
          : '';
  return (
    <span className="inline-flex items-center gap-1.5">
      {status === 'unlisted' ? (
        <span aria-hidden className="inline-block h-px w-2.5 bg-moss-muted" />
      ) : (
        <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${shape}`} />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default function ComparePage() {
  const t = useTranslations('compare');
  const format = useFormatter();
  const checked = format.dateTime(new Date(`${CHECKED_ON}T12:00:00Z`), { dateStyle: 'long' });

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />

      <header className="mx-auto max-w-[90rem] px-5 pb-10 pt-12 md:px-16 md:pt-20">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted rtl:tracking-normal">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow')}
        </p>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-end">
          <h1 className="font-display text-[clamp(2.4rem,5.6vw,4.6rem)] font-extrabold leading-[1] tracking-[-0.03em] motion-safe:animate-rise">
            {t.rich('headline', { accent })}
          </h1>
          <p className="text-[17px] leading-[1.65] text-moss-muted motion-safe:animate-rise motion-safe:[animation-delay:120ms]">
            {t('intro', { date: checked })}
          </p>
        </div>
      </header>

      {/* What only this does */}
      <section className="mx-auto max-w-[90rem] px-5 py-10 md:px-16">
        <h2 className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('uniqueTitle')}</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {UNIQUE.map((id, i) => (
            <Reveal key={id} delay={(i % 3) * 80} className="h-full">
              <article className="flex h-full flex-col rounded-2xl border border-rule bg-chalk-raised p-6">
                <h3 className="font-display text-[18px] font-bold leading-snug">{t(`unique.${id}.title`)}</h3>
                <p className="mt-2.5 text-[15px] leading-[1.65] text-moss-muted">{t(`unique.${id}.body`)}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* The table */}
      <section className="mx-auto max-w-[90rem] px-5 py-10 md:px-16" aria-labelledby="table-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="table-title" className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">
            {t('tableTitle')}
          </h2>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-moss-muted">
            {(['yes', 'partial', 'no', 'unlisted'] as const).map((s) => (
              <li key={s} className="inline-flex items-center gap-2">
                <StatusMark status={s} label="" />
                {t(`status.${s}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-[14px] text-moss-muted md:hidden">{t('swipe')}</p>

        {/* The table scrolls inside its own box on a phone; the page never does. */}
        <div className="mt-5 overflow-x-auto rounded-2xl border border-rule bg-chalk-raised">
          <table className="w-full min-w-[60rem] border-collapse text-start text-[14px]">
            <caption className="sr-only">{t('tableTitle')}</caption>
            <thead>
              <tr className="border-b border-rule align-bottom">
                <th scope="col" className="sticky start-0 z-10 w-[13rem] bg-chalk-raised p-4 text-start font-semibold">
                  <span className="sr-only">{t('capability')}</span>
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className={`p-4 text-start align-bottom ${c === 'contivo' ? 'bg-forest text-chalk' : ''}`}
                  >
                    <span className="block font-display text-[15px] font-bold">{t(`columns.${c}.name`)}</span>
                    <span className={`mt-1 block text-[12.5px] font-normal ${c === 'contivo' ? 'text-forest-muted' : 'text-moss-muted'}`}>
                      {t(`columns.${c}.examples`)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.id} className="border-b border-rule last:border-b-0 align-top">
                  <th scope="row" className="sticky start-0 z-10 bg-chalk-raised p-4 text-start font-semibold leading-snug">
                    {t(`rows.${row.id}.label`)}
                  </th>
                  {COLUMNS.map((c) => {
                    const status = row.status[c];
                    return (
                      <td
                        key={c}
                        className={`p-4 leading-snug ${c === 'contivo' ? 'bg-forest/[0.06] font-medium' : 'text-moss-muted'}`}
                      >
                        <span className="flex items-start gap-2">
                          {status ? (
                            <span className="mt-[0.3em]">
                              <StatusMark status={status} label={t(`status.${status}`)} />
                            </span>
                          ) : null}
                          <span>{t(`rows.${row.id}.${c}`)}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-moss-muted">{t('tableNote', { date: checked })}</p>
      </section>

      {/* Where it is behind */}
      <section className="px-5 py-10 md:px-16">
        <div className="mx-auto grid max-w-[90rem] gap-8 rounded-3xl bg-forest px-6 py-12 text-chalk md:px-12 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12">
          <div>
            <h2 className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('behindTitle')}</h2>
            <p className="mt-3 text-[15.5px] leading-[1.65] text-forest-muted">{t('behindIntro')}</p>
          </div>
          <ul className="border-b border-forest-line">
            {BEHIND.map((id) => (
              <li key={id} className="border-t border-forest-line py-4">
                <p className="text-[16px] font-semibold">{t(`behind.${id}.title`)}</p>
                <p className="mt-1 text-[15px] leading-[1.65] text-forest-muted">{t(`behind.${id}.body`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pick something else if */}
      <section className="mx-auto grid max-w-[90rem] gap-8 px-5 py-12 md:px-16 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12">
        <h2 className="font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1]">{t('elsewhereTitle')}</h2>
        <dl className="border-b border-rule">
          {ELSEWHERE.map((id, i) => (
            <div key={id} className={`border-t py-5 ${i === 0 ? 'border-moss' : 'border-rule'}`}>
              <dt className="text-[17px] font-semibold">{t(`elsewhere.${id}.if`)}</dt>
              <dd className="mt-1.5 max-w-[62ch] text-[15.5px] leading-[1.7] text-moss-muted">{t(`elsewhere.${id}.then`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Sources */}
      <section className="mx-auto max-w-[90rem] px-5 pb-12 md:px-16">
        <details className="rounded-2xl border border-rule px-5 py-4">
          <summary className="cursor-pointer text-[15px] font-semibold">{t('sourcesTitle', { date: checked })}</summary>
          <ul className="mt-4 grid gap-x-8 gap-y-2 text-[14px] sm:grid-cols-2" dir="ltr">
            {SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url} rel="noopener noreferrer nofollow" target="_blank" className="underline decoration-rule-strong underline-offset-4 hover:decoration-saffron">
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        </details>
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
