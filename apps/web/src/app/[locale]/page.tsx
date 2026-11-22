/**
 * Landing page — result first (direction A, Farjad, 22 Nov 2026).
 *
 * The page now says what the customer gets before how it works: posts on
 * their LinkedIn and articles on their own site, every week. The mechanism
 * (the lock, the gate) is one section, condensed, because it answers the doubt
 * "won't it read like AI?" rather than leading the page. Spec:
 * docs/superpowers/specs/2026-11-22-home-result-first-design.md
 *
 * Every picture is a capture of the running app; nothing here invents output.
 * The for / not-for lists and the plan names reuse the `why` and `pricing`
 * namespaces so this page cannot disagree with those pages.
 */

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

import { SiteFooter } from '@/components/marketing/site-footer';
import { ProductReel } from '@/components/marketing/product-reel';
import { SiteNav } from '@/components/marketing/site-nav';
import { UrlIntake } from '@/components/marketing/url-intake';
import { Reveal } from '@/components/marketing/home-interactions';
import { LoopExplorer } from '@/components/marketing/loop-explorer';
import { GateDemo, LiveWeek } from '@/components/marketing/hero-live';
import { PLAN_OFFERS, usd } from '@/lib/plan-catalogue';

/**
 * The emphasised words of each headline: a saffron marker stroke that sweeps
 * in under them. It works in Persian, whose letter joins break when slanted.
 */
const accent = (chunks: ReactNode) => (
  <span className="bg-[linear-gradient(#E3A21A,#E3A21A)] bg-no-repeat [background-position:0_88%] [background-size:100%_34%] motion-safe:animate-sweep">
    {chunks}
  </span>
);

const SECTION = 'mx-auto max-w-[90rem] px-5 md:px-16';
const H2 = 'font-display text-[clamp(1.9rem,3.4vw,2.75rem)] font-bold leading-[1.05] tracking-[-0.02em]';

export default function HomePage() {
  return (
    <div className="theme-chalk min-h-screen bg-chalk font-plex text-moss">
      <SiteNav />
      <Hero />
      <Loop />
      <NotLikeAi />
      <Reel />
      <ForNotFor />
      <PricingBrief />
      <Faq />
      <Close />
      <SiteFooter />
    </div>
  );
}

/* ─── Hero ───────────────────────────────────────────────────────────────── */

function Hero() {
  const t = useTranslations('home.v2.hero');

  /* One column below xl, two from xl (see #47: a fixed side column at lg left
     the headline 193px wide). The visual is the real pipeline capture. */
  return (
    <section className={`${SECTION} grid gap-12 pb-12 pt-8 md:pb-16 md:pt-14 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:items-center xl:gap-14`}>
      <div className="flex flex-col gap-6">
        <p className="flex items-center gap-3 font-plexmono text-[12px] uppercase tracking-[0.14em] text-moss-muted rtl:tracking-normal">
          <span aria-hidden className="inline-block h-2 w-2 rotate-45 bg-saffron" />
          {t('eyebrow')}
        </p>
        <h1 className="font-display text-[clamp(2.5rem,6vw,4.75rem)] font-extrabold leading-[1] tracking-[-0.03em] motion-safe:animate-rise xl:text-[clamp(2.5rem,4.2vw,4.25rem)]">
          {t.rich('headline', { accent })}
        </h1>
        <p className="max-w-[38rem] text-[clamp(1.05rem,1.4vw,1.2rem)] leading-[1.6] text-moss-muted motion-safe:animate-rise motion-safe:[animation-delay:120ms]">
          {t('body')}
        </p>
        <div className="motion-safe:animate-rise motion-safe:[animation-delay:200ms]">
          <UrlIntake />
        </div>
      </div>
      {/* The visitor's own address goes in, a week comes out: the result,
          moving. The real capture is in step 3 below. */}
      {/* Painted at full opacity from the first frame: a fade from 0 left it
          near-invisible for seconds on a busy tab (same trap as the H1, #34).
          `rise` only moves it. */}
      <div className="motion-safe:animate-rise motion-safe:[animation-delay:280ms]">
        <LiveWeek />
      </div>
    </section>
  );
}

/* ─── The Loop ───────────────────────────────────────────────────────────── */

/**
 * One section where there were two ("What a week looks like" and "How it
 * works"): the hero's live week already shows the week, so this shows the
 * whole loop instead, one stage at a time, each with its own evidence.
 */
function Loop() {
  const t = useTranslations('home.v2.steps');
  return (
    <section className="border-t border-moss bg-chalk-raised">
      <div className={`${SECTION} py-12 md:py-20`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className={H2}>{t('title')}</h2>
          <Link href="/product" className="text-[15px] font-semibold underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
            {t('link')}
          </Link>
        </div>
        <Reveal className="mt-8 md:mt-10">
          <LoopExplorer />
        </Reveal>
      </div>
    </section>
  );
}

/* ─── Why it won't read like AI ──────────────────────────────────────────── */

function NotLikeAi() {
  const t = useTranslations('home');
  return (
    <section id="refusal" aria-labelledby="refusal-title" className="scroll-mt-16 bg-forest text-chalk">
      <div className={`${SECTION} flex flex-col gap-8 py-12 md:gap-12 md:py-24`}>
        <Reveal className="flex max-w-[48rem] flex-col gap-5">
          <h2 id="refusal-title" className="font-display text-[clamp(2rem,4.4vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-0.03em]">
            {t('v2.notAi.title')}
          </h2>
          <p className="text-[clamp(1.05rem,1.5vw,1.2rem)] leading-[1.6] text-forest-muted">{t('v2.notAi.body')}</p>
        </Reveal>
        <Reveal>
          <GateDemo />
        </Reveal>
        {/* The full lists from md up; on a phone the demo makes the point and
            /why carries the lists. */}
        <div className="grid gap-8 max-md:hidden md:grid-cols-2 md:gap-12">
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
        <p className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
          <Link href="/why" className="font-semibold underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
            {t('v2.notAi.whyLink')}
          </Link>
          <Link href="/compare" className="font-semibold underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
            {t('v2.notAi.compareLink')}
          </Link>
        </p>
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

/* ─── The 22-second film ─────────────────────────────────────────────────── */

function Reel() {
  const t = useTranslations('home.reel');

  return (
    <section className="border-b border-rule bg-chalk-raised">
      <Reveal className={`${SECTION} py-12 md:py-20`}>
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

/* ─── For / not for ──────────────────────────────────────────────────────── */

const FOR = ['noTeam', 'founder', 'persian', 'agency'] as const;
const NOT_FOR = ['channels', 'languages', 'everyWord', 'analytics'] as const;

function ForNotFor() {
  const t = useTranslations('why');
  return (
    <section className={`${SECTION} grid gap-6 py-16 md:grid-cols-2 md:py-20`}>
      <div className="rounded-2xl border border-rule bg-chalk-raised p-6 md:p-7">
        <h2 className="font-display text-[clamp(1.5rem,2.6vw,1.9rem)] font-bold leading-[1.1]">{t('forTitle')}</h2>
        <ul className="mt-5 space-y-3 md:space-y-4">
          {FOR.map((id) => (
            <li key={id} className="flex gap-3">
              <span aria-hidden className="mt-[0.55em] h-2 w-2 shrink-0 rotate-45 bg-saffron" />
              <span>
                <span className="block text-[16px] font-semibold">{t(`for.${id}.title`)}</span>
                <span className="mt-1 block text-[15px] leading-[1.65] text-moss-muted max-md:hidden">{t(`for.${id}.body`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-dashed border-rule-strong p-6 md:p-7">
        <h2 className="font-display text-[clamp(1.5rem,2.6vw,1.9rem)] font-bold leading-[1.1]">{t('notForTitle')}</h2>
        <ul className="mt-5 space-y-3 md:space-y-4">
          {NOT_FOR.map((id) => (
            <li key={id} className="flex gap-3">
              <span aria-hidden className="mt-[0.55em] h-2 w-2 shrink-0 rotate-45 border border-moss-muted" />
              <span>
                <span className="block text-[16px] font-semibold">{t(`notFor.${id}.title`)}</span>
                <span className="mt-1 block text-[15px] leading-[1.65] text-moss-muted max-md:hidden">{t(`notFor.${id}.body`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─── Pricing in brief ───────────────────────────────────────────────────── */

function PricingBrief() {
  const t = useTranslations('home.v2.pricing');
  const tp = useTranslations('pricing');
  return (
    <section className="border-t border-rule">
      <div className={`${SECTION} py-12 md:py-20`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-[40rem]">
            <h2 className={H2}>{t('title')}</h2>
            <p className="mt-3 text-[16px] leading-[1.65] text-moss-muted">{t('body')}</p>
          </div>
          <Link href="/pricing" className="text-[15px] font-semibold underline decoration-2 underline-offset-[6px] hover:decoration-saffron">
            {t('link')}
          </Link>
        </div>
        <ul className="mt-6 grid gap-3 md:mt-8 md:grid-cols-3 md:gap-4">
          {PLAN_OFFERS.map((p) => (
            <li
              key={p.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 rounded-2xl p-5 md:flex md:flex-col md:gap-2 md:p-6 ${p.highlighted ? 'bg-forest text-chalk' : 'border border-rule bg-chalk-raised'}`}
            >
              <p className="font-display text-[22px] font-bold">
                <bdi>{tp(`plans.${p.id}.name`)}</bdi>
              </p>
              <p className="flex items-baseline gap-2">
                <bdi className="tnum font-plexmono text-[2rem] font-medium leading-none">{usd(p.monthlyUsd)}</bdi>
                <span className={`text-[14px] ${p.highlighted ? 'text-forest-muted' : 'text-moss-muted'}`}>{tp('perMonth')}</span>
              </p>
              <p className={`col-span-2 text-[15px] ${p.highlighted ? 'text-forest-muted' : 'text-moss-muted'}`}>{tp(`plans.${p.id}.tagline`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─── FAQ ────────────────────────────────────────────────────────────────── */

const FAQ = ['publish', 'channels', 'languages', 'cost', 'need'] as const;

function Faq() {
  const t = useTranslations('home.v2.faq');
  return (
    <section className={`${SECTION} grid gap-8 pb-12 pt-2 md:pb-24 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-12`}>
      <h2 className={H2}>{t('title')}</h2>
      {/* Native disclosure: no script, keyboard and screen readers get it for
          free, and the answers stay in the HTML for search and AI answers. */}
      <div className="border-b border-rule">
        {FAQ.map((k, i) => (
          <details key={k} open={i === 0} className={`group border-t ${i === 0 ? 'border-moss' : 'border-rule'}`}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
              {t(`${k}.q`)}
              <span aria-hidden className="shrink-0 font-plexmono text-[20px] leading-none text-moss-muted transition-transform duration-200 group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="-mt-1.5 max-w-[62ch] pb-5 text-[15.5px] leading-[1.7] text-moss-muted">{t(`${k}.a`)}</p>
          </details>
        ))}
      </div>
    </section>
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
