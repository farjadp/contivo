import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { LocaleSwitcher } from './locale-switcher';

/*
  Hashes travel as their own field rather than glued onto the pathname: the
  locale-aware Link builds `/fa/#how` from these parts, where a literal
  '/#how' would have to be re-parsed to know which half is the route.
*/
const LINKS = [
  { href: { pathname: '/', hash: 'how' }, key: 'refusal' },
  { href: { pathname: '/', hash: 'intelligence' }, key: 'intelligence' },
  { href: { pathname: '/', hash: 'autopilot' }, key: 'autopilot' },
  { href: { pathname: '/pricing' }, key: 'pricing' },
] as const;

export function SiteNav() {
  const t = useTranslations('nav');

  return (
    <header className="sticky top-0 z-40 border-b border-carbon/12 bg-paper-warm/92 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[92rem] items-center justify-between px-6 md:px-12">
        <Link href="/" className="flex items-center gap-3">
          {/* The Bauhaus square the onboarding screens already carry. */}
          <span aria-hidden className="inline-block h-3.5 w-3.5 bg-brick" />
          {/* The wordmark stays Latin in both languages — it is the brand's
              name, not a word to translate — and `bdi` stops the surrounding
              Persian from reordering it. */}
          <bdi className="font-display text-[19px] font-semibold tracking-[-0.035em] text-carbon">
            Contivo
          </bdi>
        </Link>

        <nav className="hidden items-center gap-9 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className="text-[14px] text-carbon-80 underline decoration-transparent underline-offset-[7px] transition-colors duration-200 hover:text-carbon hover:decoration-brick"
            >
              {t(l.key)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4 sm:gap-5">
          <LocaleSwitcher className="hidden sm:block" />
          <Link
            href="/sign-in"
            className="text-[14px] text-carbon-80 transition-colors hover:text-carbon"
          >
            {t('signIn')}
          </Link>
          <Link
            href="/sign-up"
            className="bg-carbon px-5 py-2.5 text-[13.5px] font-semibold text-paper-warm transition-colors duration-300 hover:bg-brick"
          >
            {t('startFree')}
          </Link>
        </div>
      </div>
    </header>
  );
}
