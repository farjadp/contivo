/**
 * Pricing.
 *
 * Was the last public page still on the dark "control room" system — which
 * also made the cream SiteNav sit invisibly on a near-black ground. Rebuilt in
 * the editorial world from apps/web/DESIGN.md. Every fact is unchanged: the
 * tiers, the numbers and the early-access notice all say exactly what they
 * said before, because billing still is not wired and the page must not
 * pretend otherwise.
 *
 * Plans are laid out as columns divided by rules rather than as cards. A
 * comparison genuinely needs parallel columns, but the card container is the
 * thing this world does not use, and the rules do the separating.
 */

import Link from 'next/link';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';

export const metadata = { title: 'Pricing — Contivo' };

// Billing is not wired yet; these are the intended tiers so the page tells
// the truth about the shape of the offer without pretending to charge.
const PLANS = [
  {
    name: 'Solo',
    price: '$0',
    period: 'while in early access',
    tagline: 'One brand, on autopilot.',
    features: [
      '1 workspace',
      'Brand memory + competitive map',
      'A narrative every post has to advance',
      'Autopilot: up to 3 posts / week',
      'LinkedIn + your website',
      'Quality gate on every post',
    ],
    cta: 'Start free',
    href: '/sign-up',
    highlighted: false,
  },
  {
    name: 'Founder',
    price: '$49',
    period: 'per month, coming soon',
    tagline: 'All your properties, one autopilot.',
    features: [
      '3 workspaces',
      'Everything in Solo',
      'Autopilot: up to 14 posts / week each',
      'LinkedIn · X · Instagram · websites',
      'Strategic PDF report, 5 / month',
      'Weekly digest of what was published',
    ],
    cta: 'Join the list',
    href: '/sign-up',
    highlighted: true,
  },
  {
    name: 'Agency',
    price: '$149',
    period: 'per month, coming soon',
    tagline: 'Run marketing for clients, hands-off.',
    features: [
      '10 workspaces',
      'Everything in Founder',
      'Per-client publish windows and steering',
      'Content API keys per client site',
      'Priority support',
    ],
    cta: 'Talk to us',
    href: '/sign-up',
    highlighted: false,
  },
] as const;

const FAQ: Array<[string, string]> = [
  [
    'What counts as a post?',
    'One published item on one channel. A LinkedIn post and a blog article from the same idea are two.',
  ],
  [
    'Can I approve before it publishes?',
    'Yes — turn Autopilot off and everything stays in the pipeline for you to review. Or leave it on and let the quality gate be the reviewer.',
  ],
  [
    'What if the AI is down?',
    'The post waits. Contivo never publishes something the gate could not review.',
  ],
];

export default function PricingPage() {
  return (
    <div className="theme-editorial min-h-screen bg-paper-warm font-sans text-carbon">
      <SiteNav />

      <section className="border-b border-carbon/10">
        <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-24">
          <h1 className="max-w-[16ch] font-display text-[clamp(2.6rem,6.4vw,5.4rem)] font-semibold leading-[0.96] tracking-[-0.045em]">
            Priced by how much runs{' '}
            <span className="font-accent font-normal italic tracking-[-0.02em] text-carbon-60">
              without
            </span>{' '}
            you.
          </h1>
          <p className="mt-7 max-w-xl text-[17px] leading-[1.65] text-carbon-80">
            Workspaces × posts per week × channels. No per-seat fees — the point is that there is
            nobody sitting in the seat.
          </p>
          <p className="mt-8 inline-block border-l-2 border-brick py-1 pl-4 text-[14px] leading-relaxed text-carbon-80">
            Early access — billing is not live yet. Everything is free while we run it on our own
            sites first.
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="border-b border-carbon/10 bg-paper-light">
        <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-20">
          <div className="grid gap-x-12 gap-y-14 md:grid-cols-3 md:divide-x md:divide-carbon/15">
            {PLANS.map((p) => (
              <div key={p.name} className="flex flex-col md:px-8 md:first:pl-0 md:last:pr-0">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold tracking-[-0.03em]">
                    {p.name}
                  </h2>
                  {p.highlighted && (
                    <span className="shrink-0 bg-brick px-2.5 py-1 text-[11px] font-semibold text-brick-ink">
                      Most useful
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[14.5px] text-carbon-60">{p.tagline}</p>

                <div className="mt-7 flex items-baseline gap-2.5">
                  <span className="tnum font-display text-[clamp(2.6rem,4.4vw,3.4rem)] font-semibold leading-none tracking-[-0.045em]">
                    {p.price}
                  </span>
                  <span className="text-[13px] leading-snug text-carbon-60">{p.period}</span>
                </div>

                <ul className="mt-8 flex-1 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-3.5 text-[15px] leading-[1.55] text-carbon-80">
                      <span aria-hidden className="mt-[0.62em] h-px w-4 shrink-0 bg-brick" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={p.href}
                  className={`group mt-10 inline-flex items-center justify-between gap-3 px-6 py-4 text-[14.5px] font-semibold transition-colors duration-300 ${
                    p.highlighted
                      ? 'bg-carbon text-paper-warm hover:bg-brick'
                      : 'border border-carbon/25 text-carbon hover:border-carbon hover:bg-carbon hover:text-paper-warm'
                  }`}
                >
                  {p.cta}
                  <span
                    aria-hidden
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  >
                    &rarr;
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Questions */}
      <section className="border-b border-carbon/10">
        <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-20">
          <h2 className="max-w-[18ch] font-display text-[clamp(1.9rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
            Before you ask.
          </h2>
          <dl className="mt-10 divide-y divide-carbon/15 border-y border-carbon/15">
            {FAQ.map(([q, a]) => (
              <div key={q} className="grid gap-2 py-6 md:grid-cols-[22rem_1fr] md:gap-12">
                <dt className="font-display text-[16.5px] font-semibold tracking-[-0.02em]">{q}</dt>
                <dd className="max-w-[62ch] text-[15.5px] leading-[1.7] text-carbon-80">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Close */}
      <section className="bg-carbon text-paper-warm">
        <div className="mx-auto max-w-[92rem] px-6 py-20 md:px-12 md:py-28">
          <h2 className="max-w-[17ch] font-display text-[clamp(2.2rem,5.4vw,4.4rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
            Nothing to decide yet. It is{' '}
            <span className="font-accent font-normal italic tracking-[-0.02em] text-paper-warm/60">
              free
            </span>{' '}
            while we prove it.
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/sign-up"
              className="group inline-flex items-center gap-4 bg-brick px-8 py-5 text-[15px] font-semibold text-brick-ink transition-colors duration-300 hover:bg-paper-warm hover:text-carbon"
            >
              Start with your website
              <span
                aria-hidden
                className="transition-transform duration-300 group-hover:translate-x-1.5"
              >
                &rarr;
              </span>
            </Link>
            <Link
              href="/docs/site-api"
              className="text-[15px] text-paper-warm/70 underline decoration-paper-warm/30 underline-offset-[6px] transition-colors hover:text-paper-warm hover:decoration-brick"
            >
              Read the developer docs
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
