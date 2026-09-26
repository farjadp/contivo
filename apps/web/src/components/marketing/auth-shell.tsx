/**
 * The frame both auth screens sit in.
 *
 * Sign-in and sign-up were generic centred cards on a cold grey ground — no
 * display type, no accent, nothing that placed them in this product. They are
 * the first screen after the landing page, so they now inherit the same
 * editorial world and, deliberately, the same two-column composition as the
 * onboarding and workspace-creation screens: this is the same moment in the
 * journey and should not look like a different application.
 */

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export function AuthShell({
  eyebrow,
  title,
  blurb,
  children,
  footer,
}: {
  /** Small line above the headline; the only place a label is allowed here. */
  eyebrow: string;
  /*
    The whole headline, already rendered by the caller through `t.rich` with
    its one italic word marked up inside the sentence. It used to arrive as
    three props (lead / accent / tail) concatenated here, which pinned the
    emphasis to English word order — Persian puts it somewhere else entirely.
  */
  title: React.ReactNode;
  blurb: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const t = useTranslations('auth');

  return (
    <div className="theme-chalk font-plex flex min-h-screen w-full flex-col bg-chalk font-sans text-moss lg:flex-row">
      {/* Left: who you are about to be */}
      <div className="flex w-full flex-col justify-between border-b border-moss/10 bg-chalk p-8 md:p-12 lg:w-[45%] lg:border-b-0 lg:border-e xl:p-20">
        <Link href="/" className="flex items-center gap-3">
          <span aria-hidden className="inline-block h-3.5 w-3.5 rotate-45 bg-saffron" />
          {/* The wordmark stays Latin in both languages; `bdi` keeps the
              surrounding Persian from reordering it. */}
          <bdi className="font-display text-2xl font-semibold tracking-[-0.035em]">Contivo</bdi>
        </Link>

        <div className="mt-16 lg:mt-0">
          <p className="text-[13px] font-medium text-moss-muted">{eyebrow}</p>
          <h1 className="mt-4 max-w-[14ch] font-display text-[clamp(2.6rem,5.2vw,4.4rem)] font-semibold leading-[0.96] tracking-[-0.045em]">
            {title}
          </h1>
          <p className="mt-7 max-w-sm text-[16.5px] leading-[1.65] text-moss-muted">{blurb}</p>
        </div>

        <p className="mt-16 hidden text-[13px] text-moss-muted lg:block">{t('note')}</p>
      </div>

      {/* Right: the form */}
      <div className="flex w-full flex-col justify-center bg-chalk-raised p-8 md:p-12 lg:w-[55%] xl:p-24">
        <div className="mx-auto w-full max-w-md">
          {children}
          <div className="mt-10 border-t border-moss/15 pt-6 text-[14.5px] text-moss-muted">
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The italic word inside an auth headline, passed to `t.rich`. */
export function authAccent(chunks: React.ReactNode) {
  return (
    <span className="font-display font-extrabold tracking-[-0.02em] text-moss-muted">
      {chunks}
    </span>
  );
}

/** A field: a rule that turns saffron on focus, no box. */
export function AuthField({
  id,
  label,
  type,
  placeholder,
  autoComplete,
  required = true,
}: {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[12.5px] font-semibold uppercase tracking-wide text-moss-muted"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="mt-2 w-full border-0 border-b-2 border-moss/25 bg-transparent px-0 py-3 font-display text-[20px] tracking-[-0.02em] text-moss outline-none transition-colors duration-300 placeholder:text-moss-muted focus:border-saffron"
      />
    </div>
  );
}
