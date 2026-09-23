'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useTransition } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { locales } from '@/i18n/routing';

/**
 * The switch between English and Persian.
 *
 * It links rather than pushes, for two reasons that are easy to lose: a real
 * `<a href="/fa/...">` is what tells a crawler the other language exists, and
 * it is what lets someone open the other version in a new tab. It also keeps
 * the visitor on the page they are already reading instead of dropping them on
 * the home page of the other language, which is the most common way a language
 * toggle wastes someone's place.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const t = useTranslations('localeSwitcher');
  const [isPending] = useTransition();

  return (
    <nav aria-label={t('label')} className={className}>
      <ul className="flex items-center gap-2 text-[13.5px]">
        {locales.map((locale) => {
          const isActive = locale === active;
          return (
            <li key={locale} className="flex items-center gap-2">
              <Link
                /*
                  `pathname` here is the un-prefixed route (e.g. '/growth/[id]'),
                  and `params` carries the values for its dynamic segments —
                  passing both is what keeps a switch on a workspace page landing
                  on the same workspace rather than at '/growth/[id]' literally.
                */
                href={{ pathname, params } as never}
                locale={locale}
                hrefLang={locale}
                aria-current={isActive ? 'true' : undefined}
                className={
                  isActive
                    ? 'font-semibold text-carbon underline decoration-brick underline-offset-[6px]'
                    : 'text-carbon-60 transition-colors hover:text-carbon'
                }
                aria-disabled={isPending || undefined}
              >
                {/* Each language is written in itself — nobody looking for
                    Persian is helped by the word "Persian" in English. */}
                {t(locale)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
