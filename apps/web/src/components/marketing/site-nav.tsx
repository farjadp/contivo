import Link from 'next/link';

const LINKS = [
  { href: '/#how', label: 'The refusal' },
  { href: '/#intelligence', label: 'Intelligence' },
  { href: '/#autopilot', label: 'Autopilot' },
  { href: '/pricing', label: 'Pricing' },
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-carbon/12 bg-paper-warm/92 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[92rem] items-center justify-between px-6 md:px-12">
        <Link href="/" className="flex items-center gap-3">
          {/* The Bauhaus square the onboarding screens already carry. */}
          <span aria-hidden className="inline-block h-3.5 w-3.5 bg-brick" />
          <span className="font-display text-[19px] font-semibold tracking-[-0.035em] text-carbon">
            Contivo
          </span>
        </Link>

        <nav className="hidden items-center gap-9 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-[14px] text-carbon-80 underline decoration-transparent underline-offset-[7px] transition-colors duration-200 hover:text-carbon hover:decoration-brick"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-4 sm:gap-5">
          <Link
            href="/sign-in"
            className="text-[14px] text-carbon-80 transition-colors hover:text-carbon"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="bg-carbon px-5 py-2.5 text-[13.5px] font-semibold text-paper-warm transition-colors duration-300 hover:bg-brick"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
