'use client';

/**
 * The page's one authored moment: Contivo's only input, set at display scale.
 *
 * The product takes a single thing — a website address — so the hero does not
 * describe that, it hands it over. Typing here and submitting carries the
 * address into sign-up, so the first screen after the page is already filled in.
 */

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';

export function UrlIntake() {
  const t = useTranslations('intake');
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) {
      setError(t('errorEmpty'));
      return;
    }
    let host: string;
    try {
      host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
      if (!host.includes('.')) throw new Error('no tld');
    } catch {
      setError(t('errorInvalid'));
      return;
    }
    setError(null);
    setPending(true);
    router.push({ pathname: '/sign-up', query: { site: raw } });
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <label
        htmlFor="site"
        className="block font-display text-[clamp(1.05rem,1.7vw,1.3rem)] font-medium tracking-[-0.02em] text-carbon-80"
      >
        {t('label')}
      </label>

      <div className="mt-4 flex items-baseline gap-3 border-b-2 border-carbon/25 pb-3 transition-colors duration-300 focus-within:border-brick">
        {/* `dir="ltr"` is load-bearing, not decoration: inside the Persian
            page this scheme renders as "//:https" without it, because bidi
            reorders the trailing punctuation around a neutral run. */}
        <span
          aria-hidden
          dir="ltr"
          className="hidden select-none font-display text-[clamp(1.5rem,2.9vw,2.5rem)] font-medium leading-none tracking-[-0.04em] text-carbon-40 sm:block"
        >
          https://
        </span>
        <input
          id="site"
          name="site"
          type="text"
          inputMode="url"
          dir="ltr"
          autoComplete="url"
          spellCheck={false}
          placeholder={t('placeholder')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'site-error' : undefined}
          className="w-full min-w-0 bg-transparent font-display text-[clamp(1.5rem,2.9vw,2.5rem)] font-medium leading-none tracking-[-0.04em] text-carbon outline-none placeholder:text-carbon-40"
        />
      </div>

      {/* Submit sits under the field rather than inside it: at display scale an
          inline button was clipping the placeholder's top-level domain. */}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <button
          type="submit"
          disabled={pending}
          className="group bg-carbon px-7 py-4 text-[14.5px] font-semibold text-paper-warm transition-colors duration-300 hover:bg-brick disabled:opacity-60"
        >
          {pending ? t('submitting') : t('submit')}
          <span
            aria-hidden
            className="ms-3 inline-block transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180"
          >
            &rarr;
          </span>
        </button>

        <p
          id="site-error"
          role="alert"
          className={`text-[14px] text-brick-deep transition-opacity duration-200 ${
            error ? 'opacity-100' : 'select-none opacity-0'
          }`}
        >
          {error ?? ' '}
        </p>
      </div>
    </form>
  );
}
