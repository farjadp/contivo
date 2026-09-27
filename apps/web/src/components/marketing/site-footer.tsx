import { useFormatter, useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';

import { Link } from '@/i18n/navigation';
import { siteIdentity } from '@/lib/site-identity';

import { LocaleSwitcher } from './locale-switcher';
import { Wordmark } from './site-motion';

/*
  The footer's link targets, typed off the locale-aware Link itself rather than
  off Next's `Route`. Under /[locale] a Next `Route` is '/[locale]/pricing',
  which no column in this footer will ever write — taking the type from the
  component that has to accept it keeps the two from drifting.
*/
type FooterHref = ComponentProps<typeof Link>['href'];
type FooterLink = { href: FooterHref; label: string; soon?: boolean };

/**
 * The site's closing field: forest, like the refusal chapter, so every page
 * ends on the same dark ground whatever colour its last section was.
 *
 * Four even columns of links, the address a person answers, then the name
 * set large enough to be the last thing on the page.
 */
export function SiteFooter() {
  const t = useTranslations('footer');
  const format = useFormatter();

  const columns: ReadonlyArray<{ title: string; links: FooterLink[] }> = [
    {
      title: t('productTitle'),
      links: [
        { href: { pathname: '/', hash: 'know' }, label: t('intelligence') },
        { href: { pathname: '/', hash: 'refusal' }, label: t('qualityGate') },
        { href: { pathname: '/', hash: 'ship' }, label: t('autopilot') },
        { href: { pathname: '/pricing' }, label: t('pricing') },
      ],
    },
    {
      title: t('publishesTitle'),
      links: [
        /* Network names are proper nouns and stay Latin in both languages,
           except where Persian has a settled spelling of its own — which the
           message catalogue decides, not this file. */
        { href: { pathname: '/', hash: 'learn' }, label: 'LinkedIn' },
        { href: { pathname: '/', hash: 'learn' }, label: 'X' },
        { href: { pathname: '/', hash: 'learn' }, label: t('ownSite') },
        { href: { pathname: '/', hash: 'learn' }, label: t('socialSoon'), soon: true },
      ],
    },
    {
      title: t('companyTitle'),
      links: [
        { href: { pathname: '/about' }, label: t('about') },
        { href: { pathname: '/contact' }, label: t('contact') },
        { href: { pathname: '/privacy' }, label: t('privacy') },
        { href: { pathname: '/terms' }, label: t('terms') },
      ],
    },
    {
      title: t('accountTitle'),
      links: [
        { href: { pathname: '/sign-in' }, label: t('signIn') },
        { href: { pathname: '/sign-up' }, label: t('createWorkspace') },
      ],
    },
  ];

  return (
    <footer className="bg-forest font-plex text-chalk">
      <div className="mx-auto max-w-[92rem] px-6 pt-20 md:px-12 md:pt-24">
        {/* What it is, and who answers */}
        <div className="grid gap-10 border-b border-forest-line pb-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-[36rem]">
            <div className="flex items-center gap-3">
              <span aria-hidden className="inline-block h-3 w-3 rotate-45 bg-saffron" />
              <bdi className="font-display text-[22px] font-bold lowercase tracking-tight">Contivo</bdi>
            </div>
            <p className="mt-5 text-[17px] leading-[1.65] text-forest-muted">{t('blurb')}</p>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <span className="font-plexmono text-[11px] uppercase tracking-[0.14em] text-forest-muted">
              {t('writeTo')}
            </span>
            <a
              href={`mailto:${siteIdentity.email}`}
              className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-[length:0%_2px] bg-bottom bg-no-repeat pb-1 font-display text-[clamp(1.3rem,2.4vw,1.75rem)] font-bold transition-[background-size] duration-500 ease-[cubic-bezier(.22,1,.36,1)] hover:bg-[length:100%_2px]"
            >
              <bdi>{siteIdentity.email}</bdi>
            </a>
          </div>
        </div>

        {/* Links */}
        <nav aria-label={t('navLabel')} className="grid grid-cols-2 gap-x-6 gap-y-12 py-14 md:grid-cols-4">
          {columns.map((col) => (
            <div key={col.title}>
              <h2 className="font-plexmono text-[11px] uppercase tracking-[0.14em] text-forest-muted">{col.title}</h2>
              <ul className="mt-5 space-y-3.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="group/link inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-snug text-chalk/85 transition-colors duration-200 hover:text-chalk"
                    >
                      <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-[length:0%_1.5px] bg-[position:0_100%] bg-no-repeat pb-0.5 transition-[background-size] duration-300 ease-[cubic-bezier(.22,1,.36,1)] group-hover/link:bg-[length:100%_1.5px] rtl:bg-[position:100%_100%]">
                        {l.label}
                      </span>
                      {l.soon && (
                        <span className="rounded-full border border-forest-line px-2 py-0.5 font-plexmono text-[10px] uppercase tracking-[0.1em] text-forest-muted">
                          {t('soon')}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Small print */}
        <div className="flex flex-col gap-5 border-t border-forest-line py-7 text-[13px] text-forest-muted md:flex-row md:items-center md:justify-between">
          <p className="max-w-[46rem] leading-relaxed">{t('provenance')}</p>
          <div className="flex shrink-0 items-center gap-6">
            <LocaleSwitcher className="[&_a]:!text-forest-muted [&_a:hover]:!text-chalk [&_a[aria-current]]:!text-chalk" />
            <span>
              {t('copyright', {
                /* A year is a label, not a quantity: no thousands separator,
                   and Persian digits on the Persian side. */
                year: format.number(new Date().getFullYear(), { useGrouping: false }),
              })}
            </span>
          </div>
        </div>
      </div>

      {/* The name, last */}
      <div className="overflow-hidden">
        <Wordmark
          text="contivo"
          className="mx-auto -mb-[0.2em] max-w-[92rem] justify-center px-4 font-display text-[clamp(5.5rem,24vw,23rem)] font-extrabold leading-[0.9] tracking-[-0.05em] text-forest-line md:px-10"
        />
      </div>
    </footer>
  );
}
