/**
 * Landing page — the Loop, drawn.
 *
 * The site now speaks the app's own language (Chalk & Saffron) and is built on
 * the app's own structure: six stages, walked in order. The hero hands over the
 * only input the product takes and draws the loop beside it; the page then
 * scrolls stage by stage, and stage 03 — the refusal — gets the full-bleed
 * dark field, because refusing is the part worth paying for.
 *
 * Every picture is a capture of the running app. The moving parts
 * (home-interactions.tsx) demonstrate behaviour; none of them invents results.
 */

import { useFormatter, useTranslations } from 'next-intl';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

import { SiteFooter } from '@/components/marketing/site-footer';
import { ProductReel } from '@/components/marketing/product-reel';
import { SiteNav } from '@/components/marketing/site-nav';
import { UrlIntake } from '@/components/marketing/url-intake';
import {
  CadenceWeek,
  IntakeSteps,
  LoopRing,
  Reveal,
  RunLog,
  TryTheLock,
} from '@/components/marketing/home-interactions';

/**
 * The emphasised words of each headline: a saffron marker stroke that sweeps
 * in under them. It replaces the old italic accent, and unlike italics it
 * works in Persian, whose letter joins break when slanted.
 */
const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

export default function HomePage() {
  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />
      <Hero />
      <Reel />
      <Know />
      <Watch />
      <Think />
      <MakeShip />
      <Learn />
      <Close />
      <SiteFooter />
    </div>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */

function Hero() {
  const t = useTranslations('home');

  return (
    <section className="mx-auto grid max-w-[90rem] gap-14 px-5 pb-20 pt-10 md:px-16 md:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,40rem)] lg:gap-12">
      <div className="flex flex-col gap-7">
        <h1 className="font-display text-[clamp(2.6rem,6.4vw,5rem)] font-extrabold leading-[0.98] tracking-[-0.03em] motion-safe:animate-rise">
          {t.rich('actOne.headline', { accent })}
        </h1>
        <p className="max-w-[36rem] text-[clamp(1.05rem,1.4vw,1.2rem)] leading-[1.6] text-moss-muted motion-safe:animate-rise motion-safe:[animation-delay:120ms]">
          {t('actOne.body')}
        </p>
        <div className="motion-safe:animate-rise motion-safe:[animation-delay:240ms]">
          <UrlIntake />
        </div>
        <div className="motion-safe:animate-rise motion-safe:[animation-delay:360ms]">
          <IntakeSteps />
        </div>
        <Evidence />
      </div>

      <div className="motion-safe:animate-fade-in lg:pt-4">
        <LoopRing />
      </div>
    </section>
  );
}

/**
 * Real numbers from a real workspace. Nothing here is a claim about outcomes,
 * because there are none to make yet — it is the cost of the machine running.
 */
function Evidence() {
  const t = useTranslations('home.actOne.evidence');
  /*
    The values are translated, not formatted: '5 of 9 kept' and '≈ 20 sec'
    carry words as well as numbers, and Persian writes its digits ۰-۹.
  */
  const rows: Array<[string, string]> = [
    [t('readTime'), t('readTimeValue')],
    [t('readCost'), t('readCostValue')],
    [t('competitors'), t('competitorsValue')],
    [t('charts'), t('chartsValue')],
  ];
  return (
    <div className="motion-safe:animate-rise motion-safe:[animation-delay:480ms]">
      <dl className="grid grid-cols-2 border-t border-moss md:grid-cols-4">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            className={`flex flex-col-reverse gap-1 py-3.5 pe-4 ${i % 2 ? 'ps-4 border-s border-rule' : ''} ${i === 2 ? 'md:border-s md:ps-4' : ''}`}
          >
            <dt className="text-[13px] leading-snug text-moss-muted">{k}</dt>
            <dd className="tnum font-plexmono text-[clamp(1.05rem,1.4vw,1.3rem)] font-medium leading-tight">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 max-w-[40rem] text-[13px] leading-relaxed text-moss-muted">{t('note')}</p>
    </div>
  );
}

/* ─── The reel ───────────────────────────────────────────────────────────── */

function Reel() {
  const t = useTranslations('home.reel');

  return (
    <section className="border-t border-moss bg-chalk-raised">
      <Reveal className="mx-auto max-w-[90rem] px-5 py-16 md:px-16 md:py-20">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[16ch] font-display text-[clamp(1.9rem,3.6vw,3rem)] font-bold leading-[1.02] tracking-[-0.02em]">
            {t('headline')}
          </h2>
          <p className="max-w-sm text-[15px] leading-relaxed text-moss-muted">{t('body')}</p>
        </div>
        <ProductReel />
      </Reveal>
    </section>
  );
}

/* ─── Chapters ───────────────────────────────────────────────────────────── */

function Chapter({
  id,
  num,
  label,
  title,
  children,
  aside,
  first,
}: {
  id: string;
  num: number;
  label: string;
  title: ReactNode;
  children: ReactNode;
  aside: ReactNode;
  first?: boolean;
}) {
  const format = useFormatter();
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-20 border-t ${first ? 'border-moss' : 'border-rule'}`}
    >
      <div className="mx-auto grid max-w-[90rem] gap-10 px-5 py-16 md:px-16 md:py-24 lg:grid-cols-[8rem_minmax(0,1fr)_minmax(0,38rem)] lg:gap-12">
        <Reveal>
          <span aria-hidden className="font-plexmono text-[clamp(2.5rem,4.4vw,4rem)] font-medium leading-none text-rule-strong">
            {format.number(num, { minimumIntegerDigits: 2 })}
          </span>
        </Reveal>
        <Reveal delay={80} className="flex flex-col gap-4">
          <span className="font-plexmono text-[13px] uppercase tracking-widest text-saffron-ink">{label}</span>
          <h2 id={`${id}-title`} className="font-display text-[clamp(1.9rem,3.4vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.02em]">
            {title}
          </h2>
          {children}
        </Reveal>
        <Reveal delay={160}>{aside}</Reveal>
      </div>
    </section>
  );
}

function Shot({ src, alt, w, h, caption }: { src: string; alt: string; w: number; h: number; caption?: string }) {
  return (
    <figure className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-rule bg-chalk-raised transition-transform duration-500 ease-[cubic-bezier(.2,.7,.2,1)] hover:-translate-y-1">
        <Image src={src} alt={alt} width={w} height={h} className="h-auto w-full" sizes="(min-width: 1024px) 38rem, 92vw" />
      </div>
      {caption && <figcaption className="text-[13px] text-moss-muted">{caption}</figcaption>}
    </figure>
  );
}

function Know() {
  const t = useTranslations('home');
  return (
    <Chapter
      id="know"
      num={1}
      first
      label={t('loop.stages.know.name')}
      title={t('intelligence.brandTitle')}
      aside={<Shot src="/marketing/brand-memory.webp" alt={t('intelligence.brandAlt')} w={1800} h={1212} />}
    >
      <p className="text-[17px] leading-[1.65] text-moss-muted">{t('intelligence.brandBody')}</p>
    </Chapter>
  );
}

function Watch() {
  const t = useTranslations('home');
  return (
    <Chapter
      id="watch"
      num={2}
      label={t('loop.stages.watch.name')}
      title={t('intelligence.marketTitle')}
      aside={<Shot src="/marketing/market-map.webp" alt={t('intelligence.marketAlt')} w={1800} h={1074} />}
    >
      <p className="text-[17px] leading-[1.65] text-moss-muted">{t('intelligence.marketBody')}</p>
      <p className="max-w-[34rem] font-display text-[clamp(1.2rem,1.8vw,1.45rem)] font-semibold leading-snug">
        {t.rich('intelligence.headline', { accent })}
      </p>
    </Chapter>
  );
}

/* ─── 03 · The refusal ───────────────────────────────────────────────────── */

function Think() {
  const t = useTranslations('home');
  const format = useFormatter();

  return (
    <section id="refusal" aria-labelledby="refusal-title" className="scroll-mt-16 bg-forest text-chalk">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-14 px-5 py-20 md:px-16 md:py-28">
        <div className="grid gap-10 lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-12">
          <span aria-hidden className="self-start font-plexmono text-[clamp(2.5rem,4.4vw,4rem)] font-medium leading-none text-saffron">
            {format.number(3, { minimumIntegerDigits: 2 })}
          </span>
          <Reveal className="flex flex-col gap-5">
            <span className="font-plexmono text-[13px] uppercase tracking-widest text-saffron">{t('chapters.thinkLabel')}</span>
            <h2 id="refusal-title" className="font-display text-[clamp(3rem,8.4vw,7rem)] font-extrabold leading-[0.95] tracking-[-0.035em]">
              {t.rich('actTwo.headline', {
                accent: (chunks) => <span className="text-saffron">{chunks}</span>,
              })}
            </h2>
            <p className="max-w-[44rem] text-[clamp(1.05rem,1.5vw,1.25rem)] leading-[1.6] text-forest-muted">{t('actTwo.body')}</p>
          </Reveal>
        </div>

        <div className="lg:ps-[10rem]">
          <TryTheLock />
        </div>

        <Reveal className="lg:ps-[10rem]">
          <figure className="flex flex-col gap-3">
            <Image
              src="/marketing/setup-chain.webp"
              alt={t('actTwo.chainAlt')}
              width={1800}
              height={400}
              className="h-auto w-full rounded-xl border border-forest-line"
              sizes="(min-width: 1024px) 80rem, 92vw"
            />
            <figcaption className="text-[13px] text-forest-muted">{t('actTwo.chainCaption')}</figcaption>
          </figure>
        </Reveal>

        <div className="grid gap-12 md:grid-cols-2 lg:ps-[10rem]">
          <Reveal>
            <RefusalList
              title={t('actTwo.checksTitle')}
              items={[t('actTwo.checks.limits'), t('actTwo.checks.scaffolding'), t('actTwo.checks.blocklist'), t('actTwo.checks.duplicates')]}
            />
          </Reveal>
          <Reveal delay={120}>
            <RefusalList
              title={t('actTwo.judgeTitle')}
              items={[t('actTwo.judge.scores'), t('actTwo.judge.strictest'), t('actTwo.judge.vetoes'), t('actTwo.judge.held')]}
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function RefusalList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-display text-[clamp(1.3rem,2vw,1.65rem)] font-bold">{title}</h3>
      <ul className="border-b border-forest-line">
        {items.map((item) => (
          <li key={item} className="border-t border-forest-line py-3 text-[16px] leading-relaxed">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── 04 · 05 ────────────────────────────────────────────────────────────── */

function MakeShip() {
  const t = useTranslations('home');
  const rows: Array<[string, string]> = [
    [t('actThree.cadence'), t('actThree.cadenceValue')],
    [t('actThree.channels'), t('actThree.channelsValue')],
    [t('actThree.window'), t('actThree.windowValue')],
    [t('actThree.steering'), t('actThree.steeringValue')],
  ];
  return (
    <Chapter
      id="ship"
      num={4}
      label={t('chapters.makeShip')}
      title={t.rich('actThree.headline', { accent })}
      aside={
        <div className="flex flex-col gap-6">
          <CadenceWeek />
          <Shot src="/marketing/generated-post.webp" alt={t('actThree.postAlt')} w={1400} h={1114} caption={t('actThree.postCaption')} />
        </div>
      }
    >
      <p className="text-[17px] leading-[1.65] text-moss-muted">{t('actThree.body')}</p>
      <dl className="mt-2 grid grid-cols-[7.5rem_minmax(0,1fr)] border-b border-rule text-[15px]">
        {rows.map(([k, v], i) => (
          <div key={k} className="contents">
            <dt className={`border-t py-3 font-plexmono text-[13px] text-moss-muted ${i === 0 ? 'border-moss' : 'border-rule'}`}>{k}</dt>
            <dd className={`border-t py-3 ${i === 0 ? 'border-moss' : 'border-rule'}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </Chapter>
  );
}

/* ─── 06 ─────────────────────────────────────────────────────────────────── */

function Learn() {
  const t = useTranslations('home');
  const steps: Array<[string, string]> = [
    [t('channels.connect'), t('channels.connectBody')],
    [t('channels.schedule'), t('channels.scheduleBody')],
    [t('channels.publish'), t('channels.publishBody')],
    [t('channels.record'), t('channels.recordBody')],
  ];
  return (
    <Chapter id="learn" num={6} label={t('loop.stages.learn.name')} title={t('channels.headline')} aside={<RunLog />}>
      <p className="text-[17px] leading-[1.65] text-moss-muted">{t('channels.body')}</p>
      <ol className="mt-2 grid gap-0 border-t border-moss sm:grid-cols-2">
        {steps.map(([k, v], i) => (
          <li key={k} className={`flex flex-col gap-1.5 border-b border-rule py-4 ${i % 2 ? 'sm:border-s sm:ps-5' : 'sm:pe-5'}`}>
            <strong className="text-[17px]">{k}</strong>
            <span className="text-[15px] leading-relaxed text-moss-muted">{v}</span>
          </li>
        ))}
      </ol>
    </Chapter>
  );
}

/* ─── Close ──────────────────────────────────────────────────────────────── */

function Close() {
  const t = useTranslations('home.close');

  return (
    <section className="px-5 pb-16 md:px-16">
      <Reveal className="mx-auto grid max-w-[90rem] gap-10 rounded-3xl bg-saffron px-6 py-14 text-moss md:px-16 md:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-end">
        <div className="flex flex-col gap-5">
          <h2 className="font-display text-[clamp(2.4rem,5.6vw,4.5rem)] font-extrabold leading-[1] tracking-[-0.03em]">
            {t.rich('headline', { accent: (chunks) => <span className="underline decoration-moss decoration-[6px] underline-offset-[10px]">{chunks}</span> })}
          </h2>
          <p className="max-w-[38rem] text-[18px] leading-[1.6]">{t('body')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link
            href="/sign-up"
            className="group inline-flex h-14 items-center gap-3 rounded-xl bg-moss px-7 text-[16px] font-semibold text-chalk transition-transform duration-200 hover:-translate-y-0.5"
          >
            {t('cta')}
            <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1">
              &rarr;
            </span>
          </Link>
          <Link href="/pricing" className="text-[16px] font-semibold underline decoration-2 underline-offset-[6px]">
            {t('pricing')}
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
