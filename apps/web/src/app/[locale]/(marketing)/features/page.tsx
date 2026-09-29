/**
 * Features — everything the product does, stage by stage.
 *
 * The pricing page answers "how much"; this one answers "for what". It is laid
 * out on the same six stages as the app and the home page, because that is the
 * order a customer meets the product in.
 *
 * Every entry comes from `lib/features.ts`, and anything not built is marked
 * "soon" rather than listed as included. Which plan each feature is on is
 * deliberately absent: billing is not live, and the pricing page says
 * everything is free during early access. The two pages must not disagree.
 */

import type { Metadata } from 'next';
import { useFormatter, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { Reveal } from '@/components/marketing/home-interactions';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SectionTabs, Spotlight } from '@/components/marketing/site-motion';
import { SiteNav } from '@/components/marketing/site-nav';
import { Link } from '@/i18n/navigation';
import { FEATURES, STAGES, featuresForStage, type FeatureEntry, type Stage } from '@/lib/features';
import { pageAlternates } from '@/lib/page-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'features.meta' });
  return { title: t('title'), description: t('description'), alternates: pageAlternates(locale, '/features') };
}

const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

/** The product captures that belong to a stage. Real screenshots, not mockups. */
const STAGE_SHOT: Partial<Record<Stage, { src: string; w: number; h: number }>> = {
  know: { src: '/marketing/brand-memory.webp', w: 1800, h: 1212 },
  watch: { src: '/marketing/market-map.webp', w: 1800, h: 1074 },
  think: { src: '/marketing/setup-chain.webp', w: 1800, h: 400 },
  make: { src: '/marketing/generated-post.webp', w: 1400, h: 1114 },
};

function FeatureCard({ entry }: { entry: FeatureEntry }) {
  const t = useTranslations('features');
  const soon = entry.status === 'soon';

  return (
    <Spotlight
      className={`flex h-full flex-col rounded-2xl border p-6 transition-[border-color,transform] duration-300 hover:-translate-y-0.5 ${
        soon ? 'border-dashed border-rule-strong bg-chalk' : 'border-rule bg-chalk-raised hover:border-rule-strong'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-[18px] font-bold leading-snug">{t(`items.${entry.id}.name`)}</h3>
        {soon && (
          <span className="shrink-0 rounded-full border border-rule-strong px-2 py-0.5 font-plexmono text-[10.5px] uppercase tracking-[0.1em] text-moss-muted">
            {t('soon')}
          </span>
        )}
      </div>
      <p className="mt-2.5 text-[15px] leading-[1.65] text-moss-muted">{t(`items.${entry.id}.body`)}</p>
      <p className="mt-auto border-t border-rule pt-3.5 text-[14px] leading-[1.6]">
        <span className="font-semibold">{t('youGet')} </span>
        {t(`items.${entry.id}.get`)}
      </p>
      {entry.note ? (
        <p className="mt-2.5 flex gap-2 text-[13px] leading-[1.6] text-moss-muted">
          <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rotate-45 bg-saffron" />
          {t(`notes.${entry.note}`)}
        </p>
      ) : null}
    </Spotlight>
  );
}

function StageSection({ stage, index }: { stage: Stage; index: number }) {
  const t = useTranslations('features');
  const tm = useTranslations('home');
  const format = useFormatter();
  const shot = STAGE_SHOT[stage];

  return (
    <section id={stage} className="scroll-mt-32 border-t border-rule py-14 first:border-t-0 md:py-20">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-14">
        <div className="lg:sticky lg:top-36 lg:self-start">
          <p className="font-plexmono text-[13px] font-medium tracking-widest text-saffron-ink">
            {/* Formatted, not padded by hand: a literal "01" stays Latin on the Persian page. */}
            <bdi>{format.number(index + 1, { minimumIntegerDigits: 2, useGrouping: false })}</bdi> ·{' '}
            {tm(`loop.stages.${stage}.name`)}
          </p>
          <h2 className="mt-2 font-display text-[clamp(1.7rem,3vw,2.3rem)] font-bold leading-[1.1] tracking-[-0.02em]">
            {t(`stages.${stage}.title`)}
          </h2>
          <p className="mt-3 max-w-[46ch] text-[16px] leading-[1.7] text-moss-muted">{t(`stages.${stage}.body`)}</p>
          {shot ? (
            <figure className="mt-6 hidden overflow-hidden rounded-2xl border border-rule bg-chalk-raised lg:block">
              <Image
                src={shot.src}
                alt={t(`stages.${stage}.alt`)}
                width={shot.w}
                height={shot.h}
                className="h-auto w-full"
                sizes="22rem"
              />
            </figure>
          ) : null}
        </div>

        {/* Each card reveals on its own: a whole stage is taller than the
            viewport, so revealing the grid as one block would never trigger. */}
        <div className="grid gap-4 sm:grid-cols-2">
          {featuresForStage(stage).map((entry, i) => (
            <Reveal key={entry.id} delay={(i % 2) * 80} className="h-full">
              <FeatureCard entry={entry} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function FeaturesPage() {
  const t = useTranslations('features');
  const tm = useTranslations('home');
  const format = useFormatter();
  const live = FEATURES.filter((f) => f.status === 'live').length;
  const soon = FEATURES.length - live;
  const num = (i: number) => format.number(i + 1, { minimumIntegerDigits: 2, useGrouping: false });

  const stats = [
    { value: live, label: t('stats.live') },
    { value: soon, label: t('stats.soon') },
    { value: STAGES.length, label: t('stats.stages') },
  ];

  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />

      <header className="mx-auto max-w-[90rem] px-5 pb-12 pt-12 md:px-16 md:pt-20">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted motion-safe:animate-blur-rise">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow')}
        </p>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-end">
          <h1 className="font-display text-[clamp(2.6rem,6vw,5rem)] font-extrabold leading-[0.98] tracking-[-0.035em] motion-safe:animate-blur-rise motion-safe:[animation-delay:80ms]">
            {t.rich('headline', { accent })}
          </h1>
          <p className="text-[17px] leading-[1.65] text-moss-muted motion-safe:animate-blur-rise motion-safe:[animation-delay:160ms]">
            {t('intro', { count: live })}
          </p>
        </div>

        <dl className="mt-12 grid grid-cols-3 border-y border-rule">
          {stats.map((s, i) => (
            <div
              key={s.label}
              style={{ animationDelay: `${240 + i * 90}ms` }}
              className="flex flex-col-reverse border-rule py-5 motion-safe:animate-blur-rise [&:not(:first-child)]:border-s [&:not(:first-child)]:ps-5 md:py-7 md:[&:not(:first-child)]:ps-8"
            >
              <dt className="mt-1 text-[13px] text-moss-muted md:text-[14px]">{s.label}</dt>
              <dd className="tnum font-display text-[clamp(2rem,4.4vw,3.4rem)] font-extrabold leading-none tracking-[-0.03em]">
                {format.number(s.value)}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <SectionTabs
        label={t('jumpLabel')}
        items={STAGES.map((stage, i) => ({ id: stage, label: tm(`loop.stages.${stage}.name`), num: num(i) }))}
      />

      <main className="mx-auto max-w-[90rem] px-5 md:px-16">
        {STAGES.map((stage, i) => (
          <StageSection key={stage} stage={stage} index={i} />
        ))}
      </main>

      <section className="px-5 pb-16 pt-6 md:px-16">
        <Reveal className="mx-auto flex max-w-[90rem] flex-col gap-8 rounded-3xl bg-saffron px-6 py-14 text-moss md:px-16 md:py-16 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-[18ch] font-display text-[clamp(2.2rem,4.8vw,3.8rem)] font-extrabold leading-[1] tracking-[-0.03em]">
            {t.rich('close.headline', {
              accent: (chunks) => (
                <span className="underline decoration-moss decoration-[6px] underline-offset-[10px]">{chunks}</span>
              ),
            })}
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/sign-up"
              className="inline-flex h-14 items-center rounded-xl bg-moss px-7 text-[16px] font-semibold text-chalk transition-transform duration-200 hover:-translate-y-0.5"
            >
              {t('close.cta')}
            </Link>
            <Link href="/pricing" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px]">
              {t('close.pricing')}
            </Link>
          </div>
        </Reveal>
      </section>

      <SiteFooter />
    </div>
  );
}
