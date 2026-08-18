import Link from 'next/link';
import type { Route } from 'next';

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-700/60 bg-ink-950">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 bg-signal" />
            <span className="font-display text-[15px] font-bold text-white">Contivo</span>
          </div>
          <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-ink-300">
            Turns your website into brand memory and competitive intelligence, then writes,
            reviews and publishes on a schedule you set.
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-widest text-ink-400">
            Built and run first for its own founder&apos;s sites.
          </p>
        </div>

        <FooterCol
          title="Product"
          links={[
            ['/#how', 'How it works'],
            ['/#autopilot', 'Autopilot'],
            ['/#intelligence', 'Intelligence'],
            ['/pricing', 'Pricing'],
          ]}
        />
        <FooterCol
          title="Publish to"
          links={[
            ['/#channels', 'LinkedIn'],
            ['/#channels', 'X'],
            ['/#channels', 'Your website'],
            ['/#channels', 'Instagram · TikTok · Facebook'],
          ]}
        />
        <FooterCol
          title="Account"
          links={[
            ['/sign-in', 'Sign in'],
            ['/sign-up', 'Create account'],
          ]}
        />
      </div>
      <div className="border-t border-ink-700/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-4 font-mono text-[11px] text-ink-400">
          <span>© {new Date().getFullYear()} Contivo</span>
          <span>Every post passes a quality gate before it goes out.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[Route, string]> }) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-ink-400">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map(([href, label]) => (
          <li key={label}>
            <Link href={href} className="text-[13px] text-ink-200 hover:text-white">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
