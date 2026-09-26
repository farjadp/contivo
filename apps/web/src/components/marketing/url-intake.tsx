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
  const [shaking, setShaking] = useState(false);

  function fail(message: string) {
    setError(message);
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) {
      fail(t('errorEmpty'));
      return;
    }
    let host: string;
    try {
      host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
      if (!host.includes('.')) throw new Error('no tld');
    } catch {
      fail(t('errorInvalid'));
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
        className="block font-plexmono text-[13px] text-moss-muted"
      >
        {t('label')}
      </label>

      <div
        onAnimationEnd={() => setShaking(false)}
        className={`mt-3 flex items-center gap-2 rounded-2xl border-2 bg-chalk-raised py-1.5 pe-1.5 ps-4 transition-shadow duration-200 focus-within:shadow-[0_0_0_4px_rgba(227,162,26,.45)] ${
          error ? 'border-red-700' : 'border-moss'
        } ${shaking ? 'motion-safe:animate-shake' : ''}`}
      >
        {/* `dir="ltr"` is load-bearing, not decoration: inside the Persian
            page this scheme renders as "//:https" without it, because bidi
            reorders the trailing punctuation around a neutral run. */}
        <span
          aria-hidden
          dir="ltr"
          className="hidden select-none font-plexmono text-[17px] text-moss-muted/70 sm:block"
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
          className="h-12 w-full min-w-0 bg-transparent font-plex text-[clamp(1.05rem,1.6vw,1.2rem)] text-moss outline-none placeholder:text-moss-muted/60"
        />
        {/* Inside the field now that it is body-size: the old display-scale
            field clipped the placeholder when the button sat inline. */}
        <button
          type="submit"
          disabled={pending}
          className="group inline-flex h-12 shrink-0 items-center rounded-xl bg-saffron px-5 text-[15px] font-semibold text-moss transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-60"
        >
          {pending ? t('submitting') : t('submit')}
          <span
            aria-hidden
            className="ms-3 inline-block transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
          >
            &rarr;
          </span>
        </button>
      </div>

      <div className="mt-2 min-h-[1.5rem]">
        <p
          id="site-error"
          role="alert"
          className={`text-[14px] text-red-700 transition-opacity duration-200 ${
            error ? 'opacity-100' : 'select-none opacity-0'
          }`}
        >
          {error ?? ' '}
        </p>
      </div>
    </form>
  );
}
