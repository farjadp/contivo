import Link from 'next/link';
import type { Route } from 'next';

export function SiteFooter() {
  return (
    <footer className="border-t border-carbon/12 bg-paper-warm text-carbon">
      <div className="mx-auto grid max-w-[92rem] gap-12 px-6 py-16 md:grid-cols-[1.6fr_1fr_1fr_1fr] md:px-12 md:py-20">
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden className="inline-block h-3.5 w-3.5 bg-brick" />
            <span className="font-display text-[19px] font-semibold tracking-[-0.035em]">
              Contivo
            </span>
          </div>
          <p className="mt-5 max-w-xs text-[14.5px] leading-[1.65] text-carbon-80">
            Reads your website into brand memory and a competitive map, then writes,
            reviews and publishes on a schedule you set.
          </p>
          <p className="mt-7 max-w-xs text-[13px] leading-relaxed text-carbon-60">
            Built and run first on its founder&apos;s own sites. No customers to name yet,
            so nothing here claims otherwise.
          </p>
        </div>

        <FooterCol
          title="The product"
          links={[
            ['/#intelligence', 'Intelligence'],
            ['/#how', 'The quality gate'],
            ['/#autopilot', 'Autopilot'],
            ['/pricing', 'Pricing'],
          ]}
        />
        <FooterCol
          title="Publishes to"
          links={[
            ['/#channels', 'LinkedIn'],
            ['/#channels', 'X'],
            ['/#channels', 'Your own website'],
            ['/#channels', 'Instagram · TikTok · Facebook'],
          ]}
        />
        <FooterCol
          title="Account"
          links={[
            ['/sign-in', 'Sign in'],
            ['/sign-up', 'Create a workspace'],
          ]}
        />
      </div>

      <div className="border-t border-carbon/12">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-3 px-6 py-5 text-[13px] text-carbon-60 md:px-12">
          <span>© {new Date().getFullYear()} Contivo</span>
          <span>Nothing goes out that the quality gate would not stand behind.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[Route, string]> }) {
  return (
    <div>
      <h2 className="font-display text-[15px] font-semibold tracking-[-0.02em]">{title}</h2>
      <ul className="mt-5 space-y-3">
        {links.map(([href, label]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-[14.5px] text-carbon-80 underline decoration-transparent underline-offset-[6px] transition-colors duration-200 hover:text-carbon hover:decoration-brick"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
