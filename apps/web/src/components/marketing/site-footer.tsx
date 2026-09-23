import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';

import { Link } from '@/i18n/navigation';

/*
  The footer's link targets, typed off the locale-aware Link itself rather than
  off Next's `Route`. Under /[locale] a Next `Route` is '/[locale]/pricing',
  which no column in this footer will ever write — taking the type from the
  component that has to accept it keeps the two from drifting.
*/
type FooterHref = ComponentProps<typeof Link>['href'];

export function SiteFooter() {
  const t = useTranslations('footer');

  return (
    <footer className="border-t border-carbon/12 bg-paper-warm text-carbon">
      <div className="mx-auto grid max-w-[92rem] gap-12 px-6 py-16 md:grid-cols-[1.6fr_1fr_1fr_1fr] md:px-12 md:py-20">
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden className="inline-block h-3.5 w-3.5 bg-brick" />
            <bdi className="font-display text-[19px] font-semibold tracking-[-0.035em]">
              Contivo
            </bdi>
          </div>
          <p className="mt-5 max-w-xs text-[14.5px] leading-[1.65] text-carbon-80">
            {t('blurb')}
          </p>
          <p className="mt-7 max-w-xs text-[13px] leading-relaxed text-carbon-60">
            {t('provenance')}
          </p>
        </div>

        <FooterCol
          title={t('productTitle')}
          links={[
            [{ pathname: '/', hash: 'intelligence' }, t('intelligence')],
            [{ pathname: '/', hash: 'how' }, t('qualityGate')],
            [{ pathname: '/', hash: 'autopilot' }, t('autopilot')],
            [{ pathname: '/pricing' }, t('pricing')],
          ]}
        />
        <FooterCol
          title={t('publishesTitle')}
          links={[
            /* Network names are proper nouns and stay Latin in both
               languages, except where Persian has a settled spelling of its
               own — which the message catalogue decides, not this file. */
            [{ pathname: '/', hash: 'channels' }, 'LinkedIn'],
            [{ pathname: '/', hash: 'channels' }, 'X'],
            [{ pathname: '/', hash: 'channels' }, t('ownSite')],
            [{ pathname: '/', hash: 'channels' }, t('socialCluster')],
          ]}
        />
        <FooterCol
          title={t('accountTitle')}
          links={[
            [{ pathname: '/sign-in' }, t('signIn')],
            [{ pathname: '/sign-up' }, t('createWorkspace')],
          ]}
        />
      </div>

      <div className="border-t border-carbon/12">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-3 px-6 py-5 text-[13px] text-carbon-60 md:px-12">
          <span>{t('copyright', { year: new Date().getFullYear() })}</span>
          <span>{t('standBehind')}</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: ReadonlyArray<readonly [FooterHref, string]> }) {
  return (
    <div>
      <h2 className="font-display text-[15px] font-semibold tracking-[-0.02em]">{title}</h2>
      <ul className="mt-5 space-y-3">
        {links.map(([href, label]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-[14.5px] text-carbon-80 underline decoration-transparent underline-offset-[6px] transition-colors duration-200 hover:text-carbon hover:decoration-brick"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
