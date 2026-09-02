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

import Link from 'next/link';

export function AuthShell({
  eyebrow,
  title,
  accent,
  titleTail,
  blurb,
  children,
  footer,
}: {
  /** Small line above the headline; the only place a label is allowed here. */
  eyebrow: string;
  title: string;
  /** The one italic word, carried over from onboarding. */
  accent: string;
  titleTail?: string;
  blurb: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="theme-editorial flex min-h-screen w-full flex-col bg-paper-warm font-sans text-carbon lg:flex-row">
      {/* Left: who you are about to be */}
      <div className="flex w-full flex-col justify-between border-b border-carbon/10 bg-paper-warm p-8 md:p-12 lg:w-[45%] lg:border-b-0 lg:border-r xl:p-20">
        <Link href="/" className="flex items-center gap-3">
          <span aria-hidden className="inline-block h-4 w-4 bg-brick" />
          <span className="font-display text-2xl font-semibold tracking-[-0.035em]">Contivo</span>
        </Link>

        <div className="mt-16 lg:mt-0">
          <p className="text-[13px] font-medium text-carbon-60">{eyebrow}</p>
          <h1 className="mt-4 max-w-[14ch] font-display text-[clamp(2.6rem,5.2vw,4.4rem)] font-semibold leading-[0.96] tracking-[-0.045em]">
            {title}{' '}
            <span className="font-accent font-normal italic tracking-[-0.02em] text-carbon-60">
              {accent}
            </span>
            {titleTail ? ` ${titleTail}` : '.'}
          </h1>
          <p className="mt-7 max-w-sm text-[16.5px] leading-[1.65] text-carbon-80">{blurb}</p>
        </div>

        <p className="mt-16 hidden text-[13px] text-carbon-60 lg:block">
          Nothing publishes until the quality gate has read it.
        </p>
      </div>

      {/* Right: the form */}
      <div className="flex w-full flex-col justify-center bg-paper-light p-8 md:p-12 lg:w-[55%] xl:p-24">
        <div className="mx-auto w-full max-w-md">
          {children}
          <div className="mt-10 border-t border-carbon/15 pt-6 text-[14.5px] text-carbon-80">
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A field in the editorial world: a rule that turns brick on focus, no box. */
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
        className="block text-[12.5px] font-semibold uppercase tracking-wide text-carbon-60"
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
        className="mt-2 w-full border-0 border-b-2 border-carbon/25 bg-transparent px-0 py-3 font-display text-[20px] tracking-[-0.02em] text-carbon outline-none transition-colors duration-300 placeholder:text-carbon-40 focus:border-brick"
      />
    </div>
  );
}
