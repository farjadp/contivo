'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/routing';

/**
 * The switch between Contivo's languages.
 *
 * It links rather than pushes, for two reasons that are easy to lose: a real
 * `<a href="/fa/...">` is what tells a crawler the other language exists, and
 * it is what lets someone open the other version in a new tab. It also keeps
 * the visitor on the page they are already reading instead of dropping them on
 * the home page of the other language, which is the most common way a language
 * toggle wastes someone's place.
 *
 * Two shapes: `menu` (headers) is one flag-and-name button that opens the list,
 * flag only on a phone; `inline` (footer) lays every language out in a row.
 */

/**
 * One flag per language, chosen by Farjad. Persian carries the Lion and Sun,
 * not the flag of the Islamic Republic. Files live in /public/flags.
 */
const FLAG_SRC: Partial<Record<Locale, string>> = {
  en: '/flags/en.svg',
  fa: '/flags/fa.png',
  it: '/flags/it.svg',
  es: '/flags/es.svg',
  he: '/flags/he.svg',
  fr: '/flags/fr.svg',
};

/*
  Arabic and Chinese have no flag yet: each is spoken in more than one country,
  so which flag (if any) is Farjad's call. Until he makes it they show a
  neutral badge with the language code.
*/
function Flag({ locale }: { locale: Locale }) {
  const src = FLAG_SRC[locale];
  if (!src) {
    return (
      <span
        aria-hidden
        className="inline-flex h-[14px] w-5 shrink-0 items-center justify-center rounded-[3px] bg-moss/10 font-plexmono text-[8.5px] font-semibold uppercase text-moss ring-1 ring-black/10"
      >
        {locale}
      </span>
    );
  }
  return (
    // A decoration next to the language's own name, so it carries no alt text.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      width={20}
      height={14}
      className="h-[14px] w-5 shrink-0 rounded-[3px] object-cover ring-1 ring-black/10"
    />
  );
}

function useLocaleHref() {
  const pathname = usePathname();
  const params = useParams();
  /*
    `pathname` is the un-prefixed route (e.g. '/growth/[id]'), and `params`
    carries its dynamic segments — passing both keeps a switch on a workspace
    page on the same workspace rather than at '/growth/[id]' literally.
  */
  return { pathname, params } as never;
}

function InlineSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const href = useLocaleHref();
  const t = useTranslations('localeSwitcher');

  return (
    <nav aria-label={t('label')} className={className}>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px]">
        {locales.map((locale) => {
          const isActive = locale === active;
          return (
            <li key={locale}>
              <Link
                href={href}
                locale={locale}
                hrefLang={locale}
                aria-current={isActive ? 'true' : undefined}
                className={`inline-flex items-center gap-2 ${
                  isActive
                    ? 'font-semibold text-moss underline decoration-saffron decoration-2 underline-offset-[6px]'
                    : 'text-moss-muted transition-colors hover:text-moss'
                }`}
              >
                <Flag locale={locale} />
                {/* Each language is written in itself — nobody looking for
                    Persian is helped by the word "Persian" in English. */}
                <span lang={locale}>{t(locale)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function MenuSwitcher({ className }: { className?: string }) {
  const active = useLocale() as Locale;
  const href = useLocaleHref();
  const t = useTranslations('localeSwitcher');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${t('label')}: ${t(active)}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-[13.5px] font-medium text-moss transition-colors hover:bg-moss/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-saffron"
      >
        <Flag locale={active} />
        <span lang={active} className="hidden sm:inline">
          {t(active)}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 10 6"
          className={`h-1.5 w-2.5 text-moss-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <nav
        id={menuId}
        aria-label={t('label')}
        hidden={!open}
        className="absolute end-0 top-full z-50 mt-2 min-w-[11rem] rounded-xl border border-rule bg-chalk-raised p-1.5 shadow-[0_12px_32px_-12px_rgba(23,32,27,.35)]"
      >
        <ul>
          {locales.map((locale) => {
            const isActive = locale === active;
            return (
              <li key={locale}>
                <Link
                  href={href}
                  locale={locale}
                  hrefLang={locale}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                    isActive ? 'bg-moss/5 font-semibold text-moss' : 'text-moss hover:bg-moss/5'
                  }`}
                >
                  <Flag locale={locale} />
                  <span lang={locale}>{t(locale)}</span>
                  {isActive && (
                    <span aria-hidden className="ms-auto h-1.5 w-1.5 rotate-45 bg-saffron" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function LocaleSwitcher({
  className,
  variant = 'menu',
}: {
  className?: string;
  variant?: 'menu' | 'inline';
}) {
  return variant === 'inline' ? <InlineSwitcher className={className} /> : <MenuSwitcher className={className} />;
}
