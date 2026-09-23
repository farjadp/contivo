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

import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing.meta' });
  return { title: t('title') };
}

/**
 * The one accent word each headline carries. Persian gets the same emphasis
 * without the slope — `globals.css` forces `font-style: normal` under
 * [lang='fa'] — which is why the emphasis travels as rich text rather than as
 * a sentence split across JSX.
 */
const accent = (chunks: React.ReactNode) => (
  <span className="font-accent font-normal italic tracking-[-0.02em] text-carbon-60">{chunks}</span>
);

/*
  Billing is not wired yet; these are the intended tiers so the page tells the
  truth about the shape of the offer without pretending to charge. The plan ids
  index into the `pricing.plans` namespace — the tier names, taglines, periods
  and feature lines all live in the message catalogue, including the prices:
  the amount stays in its original currency ("$49") in both languages, because
  it is a figure on a price tag rather than a sentence.
*/
const PLANS = [
  {
    id: 'solo',
    features: ['workspaces', 'memory', 'narrative', 'autopilot', 'channels', 'gate'],
    href: '/sign-up',
    highlighted: false,
  },
  {
    id: 'founder',
    features: ['workspaces', 'everything', 'autopilot', 'channels', 'report', 'digest'],
    href: '/sign-up',
    highlighted: true,
  },
  {
    id: 'agency',
    features: ['workspaces', 'everything', 'windows', 'keys', 'support'],
    href: '/sign-up',
    highlighted: false,
  },
] as const;

const FAQ = ['post', 'approve', 'down'] as const;

export default function PricingPage() {
  const t = useTranslations('pricing');

  return (
    <div className="theme-editorial min-h-screen bg-paper-warm font-sans text-carbon">
      <SiteNav />

      <section className="border-b border-carbon/10">
        <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-24">
          <h1 className="max-w-[16ch] font-display text-[clamp(2.6rem,6.4vw,5.4rem)] font-semibold leading-[0.96] tracking-[-0.045em]">
            {t.rich('headline', { accent })}
          </h1>
          <p className="mt-7 max-w-xl text-[17px] leading-[1.65] text-carbon-80">{t('intro')}</p>
          <p className="mt-8 inline-block border-s-2 border-brick py-1 ps-4 text-[14px] leading-relaxed text-carbon-80">
            {t('earlyAccess')}
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="border-b border-carbon/10 bg-paper-light">
        <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-20">
          <div className="grid gap-x-12 gap-y-14 md:grid-cols-3 md:divide-x md:divide-carbon/15">
            {PLANS.map((p) => (
              <div key={p.id} className="flex flex-col md:px-8 md:first:ps-0 md:last:pe-0">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-[clamp(1.5rem,2.4vw,2rem)] font-semibold tracking-[-0.03em]">
                    <bdi>{t(`plans.${p.id}.name`)}</bdi>
                  </h2>
                  {p.highlighted && (
                    <span className="shrink-0 bg-brick px-2.5 py-1 text-[11px] font-semibold text-brick-ink">
                      {t('mostUseful')}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[14.5px] text-carbon-60">{t(`plans.${p.id}.tagline`)}</p>

                <div className="mt-7 flex items-baseline gap-2.5">
                  {/* The amount is a figure, not prose: it keeps its currency
                      and its Latin digits on both sides, and `bdi` stops the
                      Persian around it from reordering the "$". */}
                  <bdi className="tnum font-display text-[clamp(2.6rem,4.4vw,3.4rem)] font-semibold leading-none tracking-[-0.045em]">
                    {t(`plans.${p.id}.price`)}
                  </bdi>
                  <span className="text-[13px] leading-snug text-carbon-60">
                    {t(`plans.${p.id}.period`)}
                  </span>
                </div>

                <ul className="mt-8 flex-1 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-3.5 text-[15px] leading-[1.55] text-carbon-80">
                      <span aria-hidden className="mt-[0.62em] h-px w-4 shrink-0 bg-brick" />
                      <span>{t(`plans.${p.id}.features.${f}`)}</span>
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
                  {t(`plans.${p.id}.cta`)}
                  <span
                    aria-hidden
                    className="transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180"
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
            {t('faqTitle')}
          </h2>
          <dl className="mt-10 divide-y divide-carbon/15 border-y border-carbon/15">
            {FAQ.map((k) => (
              <div key={k} className="grid gap-2 py-6 md:grid-cols-[22rem_1fr] md:gap-12">
                <dt className="font-display text-[16.5px] font-semibold tracking-[-0.02em]">
                  {t(`faq.${k}.q`)}
                </dt>
                <dd className="max-w-[62ch] text-[15.5px] leading-[1.7] text-carbon-80">
                  {t(`faq.${k}.a`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Close */}
      <section className="bg-carbon text-paper-warm">
        <div className="mx-auto max-w-[92rem] px-6 py-20 md:px-12 md:py-28">
          <h2 className="max-w-[17ch] font-display text-[clamp(2.2rem,5.4vw,4.4rem)] font-semibold leading-[0.98] tracking-[-0.045em]">
            {/* Carbon field, so the accent lifts off the paper tone instead. */}
            {t.rich('closeHeadline', {
              accent: (chunks) => (
                <span className="font-accent font-normal italic tracking-[-0.02em] text-paper-warm/60">
                  {chunks}
                </span>
              ),
            })}
          </h2>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Link
              href="/sign-up"
              className="group inline-flex items-center gap-4 bg-brick px-8 py-5 text-[15px] font-semibold text-brick-ink transition-colors duration-300 hover:bg-paper-warm hover:text-carbon"
            >
              {t('closeCta')}
              <span
                aria-hidden
                className="transition-transform duration-300 group-hover:translate-x-1.5 rtl:rotate-180"
              >
                &rarr;
              </span>
            </Link>
            <Link
              href="/docs/site-api"
              className="text-[15px] text-paper-warm/70 underline decoration-paper-warm/30 underline-offset-[6px] transition-colors hover:text-paper-warm hover:decoration-brick"
            >
              {t('closeDocs')}
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
