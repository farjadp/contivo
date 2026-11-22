import { useLocale, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { isSiteOnly } from '@/i18n/routing';

import { LocaleSwitcher } from './locale-switcher';

/*
  Hashes travel as their own field rather than glued onto the pathname: the
  locale-aware Link builds `/fa/#how` from these parts, where a literal
  '/#how' would have to be re-parsed to know which half is the route.
*/
/* The real pages, not anchors into the home page: the home page no longer has
   the six chapter sections the old links pointed at (22 Nov 2026). */
const LINKS = [
  { href: { pathname: '/product' }, key: 'product' },
  { href: { pathname: '/why' }, key: 'why' },
  { href: { pathname: '/compare' }, key: 'compare' },
  { href: { pathname: '/pricing' }, key: 'pricing' },
  { href: { pathname: '/blog' }, key: 'blog' },
] as const;

export function SiteNav() {
  const t = useTranslations('nav');
  const locale = useLocale();

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-chalk/[.92] backdrop-blur-sm">
      {/* Below sm everything is a little tighter: at 320-375px the wordmark,
          the switcher and the sign-up button did not fit in Italian, Spanish
          or French and pushed the page sideways. From sm up nothing changes. */}
      <div className="mx-auto flex h-16 max-w-[92rem] items-center justify-between gap-3 px-4 sm:px-6 md:px-12">
        <Link href="/" className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* The saffron diamond the app's own top bar carries. */}
          <span aria-hidden className="inline-block h-3 w-3 rotate-45 bg-saffron" />
          {/* The wordmark stays Latin in both languages — it is the brand's
              name, not a word to translate — and `bdi` stops the surrounding
              Persian from reordering it. */}
          <bdi className="font-display text-[20px] font-bold lowercase tracking-tight text-moss sm:text-[22px]">
            Contivo
          </bdi>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex xl:gap-9">
          {LINKS.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className="whitespace-nowrap text-[14px] text-moss-muted underline decoration-transparent underline-offset-[7px] transition-colors duration-200 hover:text-moss hover:decoration-saffron"
            >
              {t(l.key)}
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 items-center gap-2 sm:gap-5">
          <LocaleSwitcher />
          {/* Hidden on phones, where it pushed the header past the screen in
              Spanish; the sign-up page links to sign-in. */}
          <Link
            href="/sign-in"
            className="hidden whitespace-nowrap text-[14px] text-moss-muted transition-colors hover:text-moss sm:inline"
          >
            {t('signIn')}
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center whitespace-nowrap rounded-lg bg-moss px-3.5 text-[13.5px] font-semibold text-chalk transition-colors duration-200 hover:bg-moss-700 sm:h-11 sm:px-5 sm:text-[14px]"
          >
            {t('startFree')}
          </Link>
        </div>
      </div>
      {/* Site-only locales: the site is translated, the product's writing is not.
          Said on every page, under the nav, so nobody signs up expecting it. */}
      {isSiteOnly(locale) && (
        <p className="border-t border-rule bg-saffron/15 px-4 py-2 text-center text-[13.5px] leading-snug text-moss sm:px-6 md:px-12">
          {t('siteOnlyNotice')}
        </p>
      )}
    </header>
  );
}
