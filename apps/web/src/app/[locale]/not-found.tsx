/**
 * 404 inside the locale layout.
 *
 * The root layout renders no <html> (the [locale] layout does), so a
 * notFound() thrown under [locale] — an unknown blog slug, for one — needs a
 * not-found boundary at this level, or Next has nothing to render and answers
 * with a 500 instead of a 404.
 */

import { getTranslations } from 'next-intl/server';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link } from '@/i18n/navigation';

export default async function LocaleNotFound() {
  const t = await getTranslations('shell.notFound');

  return (
    <div className="theme-chalk flex min-h-screen flex-col bg-chalk font-plex text-moss">
      <SiteNav />

      <main className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col justify-center px-5 py-24">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow', { code: 404 })}
        </p>
        <h1 className="mt-6 font-display text-[clamp(2.1rem,4.6vw,3.4rem)] font-extrabold leading-[1.08] tracking-[-0.025em]">
          {t('title')}
        </h1>
        <p className="mt-5 max-w-[36rem] text-[17px] leading-relaxed text-moss-muted">{t('body')}</p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-full bg-moss px-6 text-sm font-semibold text-chalk transition-colors hover:bg-moss-700"
          >
            {t('home')}
          </Link>
          <Link
            href="/blog"
            className="inline-flex h-11 items-center rounded-full border border-rule-strong px-6 text-sm font-semibold text-moss transition-colors hover:border-moss hover:bg-chalk-sunk"
          >
            {t('blog')}
          </Link>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
