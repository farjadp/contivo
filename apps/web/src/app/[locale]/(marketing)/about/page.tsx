/**
 * About.
 *
 * Nothing here is a mission statement. The principles are decisions already
 * in the product, each dated to the commit that made it; the timeline is the
 * repository's own history; and "where it stands" says early access, free and
 * no customers to name, because that is the truth and the rest of the site
 * already says so.
 */

import type { Metadata } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { Reveal } from '@/components/marketing/home-interactions';
import { SiteFooter } from '@/components/marketing/site-footer';
import { ScrollLine, Spotlight } from '@/components/marketing/site-motion';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link } from '@/i18n/navigation';
import { pageAlternates } from '@/lib/page-metadata';
import { siteIdentity } from '@/lib/site-identity';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'company.about.meta' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: pageAlternates(locale, '/about'),
  };
}

type Dated = { title: string; body: string; date: string };

const accent = (chunks: React.ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

export default function AboutPage() {
  const t = useTranslations('company.about');
  const format = useFormatter();

  const principles = t.raw('principles') as Dated[];
  const timeline = t.raw('timeline') as Dated[];
  const stands = t.raw('stands') as string[];
  const num = (i: number) => format.number(i + 1, { minimumIntegerDigits: 2 });
  const day = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'long', timeZone: 'UTC' });
  const month = (iso: string) =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), { year: 'numeric', month: 'long', timeZone: 'UTC' });

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />

      <header className="mx-auto max-w-[90rem] px-5 pb-16 pt-12 md:px-16 md:pt-20">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted motion-safe:animate-blur-rise">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow')}
        </p>
        <h1 className="mt-6 max-w-[15ch] font-display text-[clamp(2.6rem,6.6vw,5.6rem)] font-extrabold leading-[0.98] tracking-[-0.035em] motion-safe:animate-blur-rise motion-safe:[animation-delay:80ms]">
          {t.rich('headline', { accent })}
        </h1>
        <p className="mt-8 max-w-[42rem] text-[19px] leading-[1.65] text-moss-muted motion-safe:animate-blur-rise motion-safe:[animation-delay:160ms]">
          {t('intro', { entity: siteIdentity.entity })}
        </p>
      </header>

      {/* Principles, each dated to the change that made it true */}
      <section className="border-y border-rule bg-chalk-raised" aria-labelledby="principles">
        <div className="mx-auto max-w-[90rem] px-5 py-20 md:px-16 md:py-28">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-end">
            <h2 id="principles" className="font-display text-[clamp(1.9rem,3.6vw,2.8rem)] font-bold leading-tight tracking-[-0.02em]">
              {t('principlesTitle')}
            </h2>
            <p className="text-[16px] leading-relaxed text-moss-muted">{t('principlesIntro')}</p>
          </div>

          <ol className="mt-12 grid gap-4 md:grid-cols-2">
            {principles.map((p, i) => (
              <li key={p.title}>
                <Reveal delay={(i % 2) * 90} className="h-full">
                  <Spotlight className="flex h-full flex-col rounded-2xl border border-rule bg-chalk p-7 transition-colors duration-300 hover:border-rule-strong md:p-9">
                    <span className="tnum font-plexmono text-[13px] text-saffron-ink">{num(i)}</span>
                    <h3 className="mt-4 font-display text-[clamp(1.4rem,2.2vw,1.75rem)] font-bold leading-snug tracking-[-0.01em]">
                      {p.title}
                    </h3>
                    <p className="mt-3 text-[16px] leading-[1.7] text-moss-muted">{p.body}</p>
                    <p className="mt-auto pt-6 font-plexmono text-[12px] text-moss-muted">
                      <span className="me-2 inline-block h-1.5 w-1.5 rotate-45 bg-saffron align-middle" aria-hidden />
                      {t('since', { date: day(p.date) })}
                    </p>
                  </Spotlight>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Timeline */}
      <section className="mx-auto grid max-w-[90rem] gap-12 px-5 py-20 md:px-16 md:py-28 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-20" aria-labelledby="timeline">
        <div>
          <h2 id="timeline" className="font-display text-[clamp(1.9rem,3.6vw,2.8rem)] font-bold leading-tight tracking-[-0.02em] lg:sticky lg:top-28">
            {t('timelineTitle')}
          </h2>
        </div>

        <div className="relative">
          <ScrollLine className="bottom-2 start-[5px] top-2" />
          <ol className="space-y-12">
            {timeline.map((e, i) => (
              <li key={`${e.date}-${i}`} className="relative ps-12">
                <Reveal>
                  <span
                    aria-hidden
                    className="absolute start-0 top-[0.35rem] h-3 w-3 rotate-45 border-2 border-saffron bg-chalk"
                  />
                  <p className="font-plexmono text-[12px] uppercase tracking-[0.12em] text-moss-muted">{month(e.date)}</p>
                  <h3 className="mt-2 font-display text-[24px] font-bold leading-snug">{e.title}</h3>
                  <p className="mt-2 max-w-[40rem] text-[16px] leading-[1.7] text-moss-muted">{e.body}</p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Where it honestly stands */}
      <section className="mx-auto max-w-[90rem] px-5 md:px-16" aria-labelledby="stands">
        <div className="rounded-2xl bg-forest p-7 text-chalk md:p-12">
          <h2 id="stands" className="font-plexmono text-[12px] uppercase tracking-[0.14em] text-forest-muted">
            {t('standsTitle')}
          </h2>
          <ul className="mt-8 grid gap-7 md:grid-cols-3">
            {stands.map((line, i) => (
              <li key={i} className="border-t border-forest-line pt-5">
                <Reveal delay={i * 90}>
                  <p className="text-[17px] leading-[1.6]">{line}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Next step */}
      <section className="mx-auto flex max-w-[90rem] flex-col items-start gap-8 px-5 py-24 md:px-16 lg:flex-row lg:items-end lg:justify-between">
        <h2 className="max-w-[18ch] font-display text-[clamp(2rem,4.4vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.03em]">
          {t('ctaTitle')}
        </h2>
        <div className="flex flex-wrap items-center gap-6">
          <Link
            href="/sign-up"
            className="inline-flex h-14 items-center rounded-xl bg-saffron px-7 text-[16px] font-semibold text-moss transition-colors duration-200 hover:bg-saffron-soft"
          >
            {t('ctaStart')}
          </Link>
          <Link href="/contact" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
            {t('ctaContact')}
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
