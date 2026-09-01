'use client';

/**
 * The page's one authored moment: Contivo's only input, set at display scale.
 *
 * The product takes a single thing — a website address — so the hero does not
 * describe that, it hands it over. Typing here and submitting carries the
 * address into sign-up, so the first screen after the page is already filled in.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function UrlIntake() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) {
      setError('Type the address of the site you want read.');
      return;
    }
    let host: string;
    try {
      host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
      if (!host.includes('.')) throw new Error('no tld');
    } catch {
      setError('That does not look like a website address.');
      return;
    }
    setError(null);
    setPending(true);
    router.push(`/sign-up?site=${encodeURIComponent(raw)}`);
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-3xl">
      <label
        htmlFor="site"
        className="block font-display text-[clamp(1.05rem,1.7vw,1.3rem)] font-medium tracking-[-0.02em] text-carbon-80"
      >
        Start with the only thing it needs
      </label>

      <div className="mt-4 flex items-baseline gap-3 border-b-2 border-carbon/25 pb-3 transition-colors duration-300 focus-within:border-brick">
        <span
          aria-hidden
          className="hidden select-none font-display text-[clamp(1.5rem,2.9vw,2.5rem)] font-medium leading-none tracking-[-0.04em] text-carbon-40 sm:block"
        >
          https://
        </span>
        <input
          id="site"
          name="site"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="your-company.com"
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
          {pending ? 'Opening…' : 'Read my site'}
          <span
            aria-hidden
            className="ml-3 inline-block transition-transform duration-300 group-hover:translate-x-1"
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
