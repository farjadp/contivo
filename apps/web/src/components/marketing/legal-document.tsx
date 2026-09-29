/**
 * The shell every legal page is poured into: privacy, terms.
 *
 * Content lives in `messages/<locale>/legal.json` as data — sections of
 * paragraphs and lists — because the Persian text is written as Persian, not
 * translated line by line, and the two languages will not have the same
 * sentences in the same places. This file owns only the layout: a plain
 * summary first, then the full text with a contents rail that tracks the
 * reader.
 */

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { fillIdentity, siteIdentity } from '@/lib/site-identity';

import { Reveal } from './home-interactions';
import { SiteFooter } from './site-footer';
import { ContentsRail, ReadingProgress, Spotlight, type TocItem } from './site-motion';
import { SiteNav } from './site-nav';

/** A paragraph, or a bulleted list when the block is an array. */
type Block = string | string[];
type Section = { id: string; title: string; blocks: Block[] };

export type LegalDoc = 'privacy' | 'terms';

/** When each document last changed in substance. Shown, and used by the sitemap. */
export const LEGAL_UPDATED: Record<LegalDoc, Date> = {
  privacy: new Date('2026-09-27T00:00:00Z'),
  terms: new Date('2026-09-27T00:00:00Z'),
};

const RELATED: Record<LegalDoc, ReadonlyArray<'privacy' | 'terms' | 'contact'>> = {
  privacy: ['terms', 'contact'],
  terms: ['privacy', 'contact'],
};

const accent = (chunks: React.ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

/**
 * Turns the contact address inside a sentence into a link. Every legal text
 * names it in several places, and each one should be clickable.
 */
function Linkified({ text }: { text: string }) {
  const parts = fillIdentity(text).split(siteIdentity.email);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <a
              href={`mailto:${siteIdentity.email}`}
              className="font-medium text-moss underline decoration-saffron decoration-2 underline-offset-4 transition-colors hover:decoration-moss"
            >
              <bdi>{siteIdentity.email}</bdi>
            </a>
          )}
        </span>
      ))}
    </>
  );
}

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const t = useTranslations('legal');
  const format = useFormatter();

  const sections = t.raw(`${doc}.sections`) as Section[];
  const summary = t.raw(`${doc}.summary`) as string[];
  const num = (i: number) => format.number(i + 1, { minimumIntegerDigits: 2 });
  const toc: TocItem[] = sections.map((s, i) => ({ id: s.id, label: s.title, num: num(i) }));

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />
      <ReadingProgress targetId="document" />

      {/* Heading */}
      <header className="mx-auto max-w-[90rem] px-5 pb-12 pt-12 md:px-16 md:pt-20">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted motion-safe:animate-blur-rise">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('common.eyebrow')}
          <span aria-hidden className="h-px w-10 bg-rule-strong" />
          {t(`${doc}.eyebrow`)}
        </p>
        <h1 className="mt-6 max-w-[16ch] font-display text-[clamp(2.6rem,6.4vw,5.4rem)] font-extrabold leading-[0.98] tracking-[-0.035em] motion-safe:animate-blur-rise motion-safe:[animation-delay:80ms]">
          {t.rich(`${doc}.headline`, { accent })}
        </h1>
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,40rem)_1fr] lg:items-end">
          <p className="text-[18px] leading-[1.65] text-moss-muted motion-safe:animate-blur-rise motion-safe:[animation-delay:160ms]">
            {t(`${doc}.intro`, { entity: siteIdentity.entity })}
          </p>
          <p className="font-plexmono text-[13px] text-moss-muted motion-safe:animate-blur-rise motion-safe:[animation-delay:240ms] lg:text-end">
            {t('common.updated', {
              date: format.dateTime(LEGAL_UPDATED[doc], { dateStyle: 'long', timeZone: 'UTC' }),
            })}
          </p>
        </div>
      </header>

      {/* The short version: what a reader who stops here should still know */}
      <section className="mx-auto max-w-[90rem] px-5 md:px-16" aria-labelledby="short-version">
        <div className="rounded-2xl bg-forest p-7 text-chalk md:p-12">
          <h2 id="short-version" className="font-plexmono text-[12px] uppercase tracking-[0.14em] text-forest-muted">
            {t('common.shortVersion')}
          </h2>
          <ul className="mt-8 grid gap-x-10 gap-y-7 md:grid-cols-2">
            {summary.map((line, i) => (
              <li
                key={i}
                style={{ animationDelay: `${320 + i * 90}ms` }}
                className="flex gap-4 border-t border-forest-line pt-5 motion-safe:animate-blur-rise"
              >
                <span className="tnum font-plexmono text-[13px] leading-[1.9] text-saffron">{num(i)}</span>
                <p className="text-[17px] leading-[1.6]">{fillIdentity(line)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Full text */}
      <div className="mx-auto grid max-w-[90rem] gap-12 px-5 py-16 md:px-16 lg:grid-cols-[15rem_minmax(0,46rem)] lg:gap-20 lg:py-24">
        <aside className="hidden lg:block">
          <div className="sticky top-28">
            <ContentsRail items={toc} title={t('common.contents')} />
          </div>
        </aside>

        {/* On a phone the rail becomes a list you can open. */}
        <details className="group rounded-xl border border-rule bg-chalk-raised lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted">
            {t('common.contents')}
            <span aria-hidden className="text-[18px] leading-none transition-transform duration-300 group-open:rotate-45">
              +
            </span>
          </summary>
          <ol className="border-t border-rule px-5 py-3 text-[15px]">
            {toc.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="flex gap-3 py-2 text-moss-muted hover:text-moss">
                  <span className="tnum font-plexmono text-[12px] leading-[1.9]">{item.num}</span>
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </details>

        <article id="document" className="min-w-0">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-28 border-t border-rule pb-12 pt-8 first:border-t-0 first:pt-0">
              <Reveal>
                <div className="flex items-baseline gap-4">
                  <span className="tnum font-plexmono text-[13px] text-saffron-ink">{num(i)}</span>
                  <h2 className="font-display text-[clamp(1.5rem,2.4vw,1.9rem)] font-bold leading-tight tracking-[-0.015em]">
                    {s.title}
                  </h2>
                </div>
                <div className="mt-5 space-y-4 text-[16.5px] leading-[1.75] text-moss/90">
                  {s.blocks.map((b, j) =>
                    Array.isArray(b) ? (
                      <ul key={j} className="space-y-2.5">
                        {b.map((item, k) => (
                          <li key={k} className="flex gap-3">
                            <span aria-hidden className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rotate-45 bg-saffron" />
                            <span>
                              <Linkified text={item} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p key={j}>
                        <Linkified text={b} />
                      </p>
                    ),
                  )}
                </div>
              </Reveal>
            </section>
          ))}
        </article>
      </div>

      {/* Where to go next */}
      <section className="mx-auto max-w-[90rem] px-5 pb-24 md:px-16" aria-labelledby="related">
        <h2 id="related" className="mb-5 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted">
          {t('common.related')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {RELATED[doc].map((key, i) => (
            <Reveal key={key} delay={i * 90}>
              <Spotlight className="rounded-2xl border border-rule bg-chalk-raised transition-colors duration-300 hover:border-rule-strong">
                <Link href={`/${key}`} className="flex items-end justify-between gap-6 p-7">
                  <span>
                    <span className="block font-display text-[24px] font-bold">{t(`common.links.${key}.title`)}</span>
                    <span className="mt-1.5 block text-[15px] leading-relaxed text-moss-muted">
                      {t(`common.links.${key}.body`)}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="text-[22px] transition-transform duration-300 ease-[cubic-bezier(.22,1,.36,1)] group-hover/spot:translate-x-1 rtl:-scale-x-100 rtl:group-hover/spot:-translate-x-1"
                  >
                    →
                  </span>
                </Link>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
