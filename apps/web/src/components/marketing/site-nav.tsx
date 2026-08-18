import Link from 'next/link';

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#autopilot', label: 'Autopilot' },
  { href: '/#intelligence', label: 'Intelligence' },
  { href: '/pricing', label: 'Pricing' },
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 bg-signal shadow-[0_0_12px_rgba(61,255,143,0.8)]" />
          <span className="font-display text-[15px] font-bold tracking-tight text-white">Contivo</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[13px] text-ink-200 transition-colors hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden px-3 py-1.5 text-[13px] text-ink-200 hover:text-white sm:inline-block"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="bg-signal px-3.5 py-1.5 text-[13px] font-semibold text-signal-ink transition-colors hover:bg-white"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
