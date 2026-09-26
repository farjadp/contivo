import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

import { LocaleSwitcher } from './locale-switcher';

/*
  Hashes travel as their own field rather than glued onto the pathname: the
  locale-aware Link builds `/fa/#how` from these parts, where a literal
  '/#how' would have to be re-parsed to know which half is the route.
*/
const LINKS = [
  { href: { pathname: '/', hash: 'know' }, key: 'intelligence' },
  { href: { pathname: '/', hash: 'refusal' }, key: 'refusal' },
  { href: { pathname: '/', hash: 'ship' }, key: 'autopilot' },
  { href: { pathname: '/pricing' }, key: 'pricing' },
] as const;

export function SiteNav() {
  const t = useTranslations('nav');

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-chalk/92 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[92rem] items-center justify-between px-6 md:px-12">
        <Link href="/" className="flex items-center gap-3">
          {/* The saffron diamond the app's own top bar carries. */}
          <span aria-hidden className="inline-block h-3 w-3 rotate-45 bg-saffron" />
          {/* The wordmark stays Latin in both languages — it is the brand's
              name, not a word to translate — and `bdi` stops the surrounding
              Persian from reordering it. */}
          <bdi className="font-display text-[22px] font-bold lowercase tracking-tight text-moss">
            Contivo
          </bdi>
        </Link>

        <nav className="hidden items-center gap-9 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className="text-[14px] text-moss-muted underline decoration-transparent underline-offset-[7px] transition-colors duration-200 hover:text-moss hover:decoration-saffron"
            >
              {t(l.key)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4 sm:gap-5">
          <LocaleSwitcher className="hidden sm:block" />
          <Link
            href="/sign-in"
            className="text-[14px] text-moss-muted transition-colors hover:text-moss"
          >
            {t('signIn')}
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center rounded-lg bg-moss px-5 text-[14px] font-semibold text-chalk transition-colors duration-200 hover:bg-moss-700"
          >
            {t('startFree')}
          </Link>
        </div>
      </div>
    </header>
  );
}
