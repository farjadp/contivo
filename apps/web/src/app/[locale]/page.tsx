/**
 * Landing page — three acts: intake, refusal, output.
 *
 * The old page put a simulated terminal, a JSON card and a code block on a
 * near-black ground with one neon accent. Three of its four visuals were fake
 * developer chrome for a product that makes marketing. Everything shown here is
 * a capture of the running app, and the middle act — the refusal — gets the
 * whole viewport, because refusing is the part worth paying for.
 */

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';

import { SiteFooter } from '@/components/marketing/site-footer';
import { ProductReel } from '@/components/marketing/product-reel';
import { SiteNav } from '@/components/marketing/site-nav';
import { UrlIntake } from '@/components/marketing/url-intake';

/**
 * The one italic accent word each headline carries.
 *
 * Persian gets the same emphasis without the italic: `globals.css` forces
 * `font-style: normal` under [lang='fa'] because slanting Persian glyphs
 * breaks the joins that make the script readable, so on that side the accent
 * reads as a tone shift in weight and colour instead of a slope. Passing it as
 * rich text rather than splitting the sentence in JSX is what lets a
 * translator move the emphasised words to wherever the Persian sentence
 * actually wants them.
 */
const accent = (chunks: React.ReactNode) => (
  <span className="font-accent font-normal italic tracking-[-0.02em] text-carbon-60">{chunks}</span>
);

export default function HomePage() {
  return (
    <div className="theme-editorial min-h-screen bg-paper-warm font-sans text-carbon">
      <SiteNav />

      <ActOne />
      <Reel />
      <Intelligence />
      <ActTwo />
      <ActThree />
      <Channels />
      <Close />

      <SiteFooter />
    </div>
  );
}

/* ─── Act I · Intake ─────────────────────────────────────────────────────── */

function ActOne() {
  const t = useTranslations('home');

  return (
    <section className="relative overflow-hidden border-b border-carbon/10">
      <PaperGrain />
      <div className="relative mx-auto max-w-[92rem] px-6 pb-20 pt-16 md:px-12 md:pb-28 md:pt-24">
        <h1 className="max-w-[19ch] font-display text-[clamp(3rem,8.4vw,7.5rem)] font-semibold leading-[0.92] tracking-[-0.045em]">
          {t.rich('actOne.headline', { accent })}
        </h1>

        <div className="mt-12 grid gap-14 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
          <UrlIntake />

          <p className="max-w-md text-[17px] leading-[1.65] text-carbon-80">
            {t('actOne.body')}
          </p>
        </div>

        <Evidence />
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
    carry words as well as numbers, and Persian writes its digits ۰-۹. Running
    them through a number formatter would localise the digits and leave the
    words English.
  */
  const rows: Array<[string, string]> = [
    [t('readTime'), t('readTimeValue')],
    [t('readCost'), t('readCostValue')],
    [t('competitors'), t('competitorsValue')],
    [t('charts'), t('chartsValue')],
  ];
  return (
    <dl className="mt-20 grid max-w-4xl grid-cols-2 gap-x-10 gap-y-8 border-t border-carbon/15 pt-8 md:grid-cols-4">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[13px] leading-snug text-carbon-60">{k}</dt>
          <dd className="tnum mt-1.5 text-balance font-display text-[clamp(1.3rem,2.1vw,1.7rem)] font-medium leading-[1.15] tracking-[-0.03em]">
            {v}
          </dd>
        </div>
      ))}
      <p className="col-span-2 text-[12.5px] leading-relaxed text-carbon-60 md:col-span-4">
        {t('note')}
      </p>
    </dl>
  );
}

/* ─── The reel ───────────────────────────────────────────────────────────── */

function Reel() {
  const t = useTranslations('home.reel');

  return (
    <section className="border-b border-carbon/10 bg-paper-light">
      <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-24">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[16ch] font-display text-[clamp(1.9rem,4vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
            {t('headline')}
          </h2>
          <p className="max-w-sm text-[15px] leading-relaxed text-carbon-80">
            {t('body')}
          </p>
        </div>

        <ProductReel />
      </div>
    </section>
  );
}

/* ─── Intelligence ───────────────────────────────────────────────────────── */

function Intelligence() {
  const t = useTranslations('home.intelligence');

  return (
    <section id="intelligence" className="border-b border-carbon/10">
      <div className="mx-auto max-w-[92rem] px-6 py-20 md:px-12 md:py-28">
        <h2 className="max-w-[20ch] font-display text-[clamp(2.1rem,5vw,4.2rem)] font-semibold leading-[1] tracking-[-0.04em]">
          {t.rich('headline', { accent })}
        </h2>

        <div className="mt-16 grid gap-16 lg:grid-cols-2 lg:gap-20">
          <Spread
            n={t('brandTitle')}
            body={t('brandBody')}
            src="/marketing/brand-memory.webp"
            alt={t('brandAlt')}
            w={1800}
            h={1212}
          />
          <Spread
            n={t('marketTitle')}
            body={t('marketBody')}
            src="/marketing/market-map.webp"
            alt={t('marketAlt')}
            w={1800}
            h={1074}
          />
        </div>
      </div>
    </section>
  );
}

function Spread({
  n,
  body,
  src,
  alt,
  w,
  h,
}: {
  n: string;
  body: string;
  src: string;
  alt: string;
  w: number;
  h: number;
}) {
  return (
    <figure className="flex flex-col">
      <h3 className="max-w-[18ch] font-display text-[clamp(1.5rem,2.6vw,2.1rem)] font-semibold leading-[1.08] tracking-[-0.035em]">
        {n}
      </h3>
      <p className="mt-4 max-w-prose text-[15.5px] leading-[1.7] text-carbon-80">{body}</p>
      <div className="mt-8 overflow-hidden border border-carbon/15 bg-paper-light">
        <Image
          src={src}
          alt={alt}
          width={w}
          height={h}
          className="h-auto w-full"
          sizes="(min-width: 1024px) 44vw, 92vw"
        />
      </div>
    </figure>
  );
}

/* ─── Act II · Refusal ───────────────────────────────────────────────────── */

function ActTwo() {
  const t = useTranslations('home.actTwo');

  return (
    <section
      id="how"
      className="relative overflow-hidden bg-brick text-brick-ink"
      // The generated ink texture multiplies over the exact brand red, so the
      // net on-screen colour stays #C04C36 while the field gains its print grain.
      style={{
        backgroundImage: 'url(/marketing/tex-ink.webp)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundBlendMode: 'multiply',
      }}
    >
      <div className="mx-auto max-w-[92rem] px-6 py-24 md:px-12 md:py-36">
        <h2 className="max-w-[15ch] font-display text-[clamp(2.8rem,8vw,7rem)] font-semibold leading-[0.94] tracking-[-0.045em]">
          {/* The accent on this field is ink-on-ink, so it takes the red
              field's own foreground rather than the carbon one. */}
          {t.rich('headline', {
            accent: (chunks) => (
              <span className="font-accent font-normal italic tracking-[-0.02em]">{chunks}</span>
            ),
          })}
        </h2>

        <p className="mt-10 max-w-2xl text-[clamp(1.05rem,1.6vw,1.35rem)] leading-[1.6] text-brick-ink">
          {t('body')}
        </p>

        <figure className="mt-14">
          <Image
            src="/marketing/setup-chain.webp"
            alt={t('chainAlt')}
            width={1800}
            height={400}
            className="h-auto w-full border border-brick-ink/25"
            sizes="(min-width: 768px) 88vw, 94vw"
          />
          <figcaption className="mt-3 text-[13px] text-brick-ink">
            {t('chainCaption')}
          </figcaption>
        </figure>

        <div className="mt-20 grid gap-x-16 gap-y-12 border-t border-brick-ink/25 pt-12 md:grid-cols-2">
          <Refusal
            title={t('checksTitle')}
            items={[
              t('checks.limits'),
              t('checks.scaffolding'),
              t('checks.blocklist'),
              t('checks.duplicates'),
            ]}
          />
          <Refusal
            title={t('judgeTitle')}
            items={[
              t('judge.scores'),
              t('judge.strictest'),
              t('judge.vetoes'),
              t('judge.held'),
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function Refusal({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-display text-[clamp(1.3rem,2.2vw,1.75rem)] font-semibold leading-[1.1] tracking-[-0.03em]">
        {title}
      </h3>
      <ul className="mt-6 space-y-4">
        {items.map((t) => (
          <li key={t} className="flex gap-4 text-[15.5px] leading-[1.6] text-brick-ink">
            <span aria-hidden className="mt-[0.62em] h-px w-6 shrink-0 bg-brick-ink/50" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Act III · Output ───────────────────────────────────────────────────── */

function ActThree() {
  const t = useTranslations('home.actThree');

  return (
    <section id="autopilot" className="border-b border-carbon/10 bg-paper-light">
      <div className="mx-auto grid max-w-[92rem] gap-14 px-6 py-20 md:px-12 md:py-28 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-20">
        <div>
          <h2 className="max-w-[16ch] font-display text-[clamp(2.1rem,5vw,4.2rem)] font-semibold leading-[1] tracking-[-0.04em]">
            {t.rich('headline', { accent })}
          </h2>
          <p className="mt-6 max-w-md text-[16.5px] leading-[1.7] text-carbon-80">
            {t('body')}
          </p>

          <dl className="mt-12 divide-y divide-carbon/15 border-y border-carbon/15">
            {(
              [
                [t('cadence'), t('cadenceValue')],
                [t('channels'), t('channelsValue')],
                [t('window'), t('windowValue')],
                [t('steering'), t('steeringValue')],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-6 py-4">
                <dt className="text-[14px] text-carbon-60">{k}</dt>
                <dd className="text-[15px] leading-snug">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <figure>
          <div className="border border-carbon/15 bg-paper-warm">
            <Image
              src="/marketing/generated-post.webp"
              alt={t('postAlt')}
              width={1400}
              height={1114}
              className="h-auto w-full"
              sizes="(min-width: 1024px) 48vw, 92vw"
            />
          </div>
          <figcaption className="mt-3 text-[12.5px] text-carbon-60">
            {t('postCaption')}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ─── Channels ───────────────────────────────────────────────────────────── */

function Channels() {
  const t = useTranslations('home.channels');

  return (
    <section id="channels" className="border-b border-carbon/10">
      <div className="mx-auto max-w-[92rem] px-6 py-20 md:px-12 md:py-28">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
          <div>
            <h2 className="max-w-[17ch] font-display text-[clamp(1.9rem,4.2vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
              {t('headline')}
            </h2>
            <p className="mt-6 max-w-lg text-[16px] leading-[1.7] text-carbon-80">
              {t('body')}
            </p>
          </div>

          <ol className="divide-y divide-carbon/15 border-y border-carbon/15">
            {(
              [
                [t('connect'), t('connectBody')],
                [t('schedule'), t('scheduleBody')],
                [t('publish'), t('publishBody')],
                [t('record'), t('recordBody')],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <li key={k} className="grid grid-cols-[6.5rem_1fr] gap-6 py-5">
                <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">
                  {k}
                </span>
                <span className="text-[15px] leading-relaxed text-carbon-80">{v}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ─── Close ──────────────────────────────────────────────────────────────── */

function Close() {
  const t = useTranslations('home.close');

  return (
    <section className="bg-carbon text-paper-warm">
      <div className="mx-auto max-w-[92rem] px-6 py-24 md:px-12 md:py-32">
        <h2 className="max-w-[17ch] font-display text-[clamp(2.4rem,6.4vw,5.5rem)] font-semibold leading-[0.96] tracking-[-0.045em]">
          {/* Carbon field, so the accent lifts off the paper tone instead. */}
          {t.rich('headline', {
            accent: (chunks) => (
              <span className="font-accent font-normal italic tracking-[-0.02em] text-paper-warm/60">
                {chunks}
              </span>
            ),
          })}
        </h2>
        <p className="mt-8 max-w-xl text-[17px] leading-[1.65] text-paper-warm/75">
          {t('body')}
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link
            href="/sign-up"
            className="group inline-flex items-center gap-4 bg-brick px-8 py-5 text-[15px] font-semibold tracking-[0.01em] text-brick-ink transition-colors duration-300 hover:bg-paper-warm hover:text-carbon"
          >
            {t('cta')}
            <span
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-x-1.5 rtl:rotate-180"
            >
              &rarr;
            </span>
          </Link>
          <Link
            href="/pricing"
            className="text-[15px] text-paper-warm/70 underline decoration-paper-warm/30 underline-offset-[6px] transition-colors hover:text-paper-warm hover:decoration-brick"
          >
            {t('pricing')}
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────────────── */

/** Scanned paper grain over the cream ground, so the ground is a material. */
function PaperGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.55] mix-blend-multiply"
      style={{
        backgroundImage: 'url(/marketing/tex-paper.webp)',
        backgroundSize: '620px',
      }}
    />
  );
}
