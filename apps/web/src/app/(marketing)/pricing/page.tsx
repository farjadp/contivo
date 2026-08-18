import Link from 'next/link';
import { Check } from 'lucide-react';

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

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-white">
      <SiteNav />

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 md:pt-24">
        <p className="font-mono text-[11px] uppercase tracking-widest text-signal">Pricing</p>
        <h1 className="mt-3 max-w-2xl font-display text-[36px] font-bold leading-tight tracking-tight sm:text-[48px]">
          Priced by how much runs without you.
        </h1>
        <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-ink-300">
          Workspaces × posts per week × channels. No per-seat fees — the point is that there is
          nobody sitting in the seat.
        </p>
        <p className="mt-6 inline-flex items-center gap-2 border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-amber-200">
          Early access — billing is not live yet. Everything is free while we run it on our own sites first.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-px bg-ink-700/60 md:grid-cols-3">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={`flex flex-col p-8 ${p.highlighted ? 'bg-ink-800' : 'bg-ink-950'}`}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-[20px] font-semibold">{p.name}</h2>
                {p.highlighted && (
                  <span className="bg-signal px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal-ink">
                    Most useful
                  </span>
                )}
              </div>
              <p className="mt-1 text-[13px] text-ink-300">{p.tagline}</p>
              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-[40px] font-bold leading-none">{p.price}</span>
                <span className="font-mono text-[11px] uppercase tracking-widest text-ink-400">{p.period}</span>
              </div>
              <ul className="mt-6 flex-1 space-y-2.5">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[14px] text-ink-100">
                    <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={p.href}
                className={`mt-8 inline-flex items-center justify-center px-4 py-3 text-[14px] font-semibold ${
                  p.highlighted
                    ? 'bg-signal text-signal-ink hover:bg-white'
                    : 'border border-ink-600 text-ink-100 hover:border-ink-400 hover:text-white'
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-px bg-ink-700/60 md:grid-cols-3">
          {[
            ['What counts as a post?', 'One published item on one channel. A LinkedIn post and a blog article from the same idea are two.'],
            ['Can I approve before it publishes?', 'Yes — turn Autopilot off and everything stays in the pipeline for you to review. Or leave it on and let the quality gate be the reviewer.'],
            ['What if the AI is down?', 'The post waits. Contivo never publishes something the gate could not review.'],
          ].map(([q, a]) => (
            <div key={q} className="bg-ink-950 p-7">
              <h3 className="font-display text-[15px] font-semibold">{q}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-300">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
