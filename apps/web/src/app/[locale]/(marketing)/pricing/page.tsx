/**
 * Pricing.
 *
 * Chalk & Saffron, like the rest of the site and the app. Every fact is
 * unchanged: the tiers, the numbers and the early-access notice say exactly
 * what they said before, because billing still is not wired and the page must
 * not pretend otherwise. The plan worth recommending sits on the dark field.
 */

import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteNav } from '@/components/marketing/site-nav';
import { Reveal } from '@/components/marketing/home-interactions';

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
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
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
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />

      <section className="mx-auto grid max-w-[90rem] gap-8 px-5 pb-10 pt-12 md:px-16 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-end">
        <h1 className="font-display text-[clamp(2.4rem,5.6vw,4.5rem)] font-extrabold leading-[1] tracking-[-0.03em] motion-safe:animate-rise">
          {t.rich('headline', { accent })}
        </h1>
        <p className="text-[17px] leading-[1.6] text-moss-muted motion-safe:animate-rise motion-safe:[animation-delay:120ms]">
          {t('intro')}
        </p>
      </section>

      <div className="mx-auto max-w-[90rem] px-5 md:px-16">
        <p className="rounded-xl border border-dashed border-rule-strong px-5 py-3.5 text-[15px] leading-relaxed">
          {t('earlyAccess')}
        </p>
      </div>

      {/* Plans */}
      <section className="mx-auto grid max-w-[90rem] gap-5 px-5 py-10 md:grid-cols-3 md:px-16">
        {PLANS.map((p, i) => (
          <Reveal key={p.id} delay={i * 100} className="h-full">
            <article
              className={`flex h-full flex-col gap-5 rounded-2xl p-7 transition-transform duration-300 hover:-translate-y-1 ${
                p.highlighted ? 'bg-forest text-chalk' : 'border border-rule bg-chalk-raised'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-[26px] font-bold">
                    <bdi>{t(`plans.${p.id}.name`)}</bdi>
                  </h2>
                  <p className={`mt-1 text-[15px] ${p.highlighted ? 'text-forest-muted' : 'text-moss-muted'}`}>
                    {t(`plans.${p.id}.tagline`)}
                  </p>
                </div>
                {p.highlighted && (
                  <span className="shrink-0 rounded bg-saffron px-2 py-1 font-plexmono text-[11px] uppercase tracking-widest text-moss">
                    {t('mostUseful')}
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-2.5">
                {/* The amount is a figure, not prose: it keeps its currency
                    and its Latin digits on both sides, and `bdi` stops the
                    Persian around it from reordering the "$". */}
                <bdi className="tnum font-plexmono text-[clamp(2.4rem,3.6vw,3rem)] font-medium leading-none">
                  {t(`plans.${p.id}.price`)}
                </bdi>
                <span className={`text-[14px] leading-snug ${p.highlighted ? 'text-forest-muted' : 'text-moss-muted'}`}>
                  {t(`plans.${p.id}.period`)}
                </span>
              </div>

              <Link
                href={p.href}
                className={`inline-flex h-12 items-center justify-center rounded-xl text-[15px] font-semibold transition-colors duration-200 ${
                  p.id === 'solo'
                    ? 'bg-saffron text-moss hover:bg-saffron-soft'
                    : p.highlighted
                      ? 'bg-chalk text-moss hover:bg-chalk-sunk'
                      : 'bg-moss text-chalk hover:bg-moss-700'
                }`}
              >
                {t(`plans.${p.id}.cta`)}
              </Link>

              <ul className={`border-b text-[15px] ${p.highlighted ? 'border-forest-line' : 'border-rule'}`}>
                {p.features.map((f) => (
                  <li key={f} className={`border-t py-2.5 leading-snug ${p.highlighted ? 'border-forest-line' : 'border-rule'}`}>
                    {t(`plans.${p.id}.features.${f}`)}
                  </li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
      </section>

      {/* Questions */}
      <section className="mx-auto grid max-w-[90rem] gap-8 px-5 py-12 md:px-16 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12">
        <h2 className="font-display text-[clamp(1.9rem,3.4vw,2.6rem)] font-bold leading-[1.05]">{t('faqTitle')}</h2>
        <dl className="border-b border-rule">
          {FAQ.map((k, i) => (
            <div key={k} className={`border-t py-5 ${i === 0 ? 'border-moss' : 'border-rule'}`}>
              <dt className="text-[17px] font-semibold">{t(`faq.${k}.q`)}</dt>
              <dd className="mt-1.5 max-w-[62ch] text-[15.5px] leading-[1.7] text-moss-muted">{t(`faq.${k}.a`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Close */}
      <section className="px-5 pb-16 md:px-16">
        <Reveal className="mx-auto flex max-w-[90rem] flex-col gap-8 rounded-3xl bg-saffron px-6 py-14 text-moss md:px-16 md:py-16">
          <h2 className="max-w-[18ch] font-display text-[clamp(2.2rem,4.8vw,3.8rem)] font-extrabold leading-[1] tracking-[-0.03em]">
            {t.rich('closeHeadline', {
              accent: (chunks) => <span className="underline decoration-moss decoration-[6px] underline-offset-[10px]">{chunks}</span>,
            })}
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/sign-up"
              className="inline-flex h-14 items-center rounded-xl bg-moss px-7 text-[16px] font-semibold text-chalk transition-transform duration-200 hover:-translate-y-0.5"
            >
              {t('closeCta')}
            </Link>
            <Link href="/docs/site-api" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px]">
              {t('closeDocs')}
            </Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
