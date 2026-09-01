/**
 * Landing page — three acts: intake, refusal, output.
 *
 * The old page put a simulated terminal, a JSON card and a code block on a
 * near-black ground with one neon accent. Three of its four visuals were fake
 * developer chrome for a product that makes marketing. Everything shown here is
 * a capture of the running app, and the middle act — the refusal — gets the
 * whole viewport, because refusing is the part worth paying for.
 */

import Image from 'next/image';
import Link from 'next/link';

import { SiteFooter } from '@/components/marketing/site-footer';
import { ProductReel } from '@/components/marketing/product-reel';
import { SiteNav } from '@/components/marketing/site-nav';
import { UrlIntake } from '@/components/marketing/url-intake';

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
  return (
    <section className="relative overflow-hidden border-b border-carbon/10">
      <PaperGrain />
      <div className="relative mx-auto max-w-[92rem] px-6 pb-20 pt-16 md:px-12 md:pb-28 md:pt-24">
        <h1 className="max-w-[19ch] font-display text-[clamp(3rem,8.4vw,7.5rem)] font-semibold leading-[0.92] tracking-[-0.045em]">
          Give it your website.
          <br />
          <span className="font-accent font-normal italic tracking-[-0.02em] text-carbon-60">
            Keep
          </span>{' '}
          the rest of your day.
        </h1>

        <div className="mt-12 grid gap-14 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
          <UrlIntake />

          <p className="max-w-md text-[17px] leading-[1.65] text-carbon-80">
            Contivo reads your site into a brand memory, maps the competitors you
            actually have, and works out which keywords they leave open. Only then does
            it write — and only what survives a quality gate built to reject it.
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
  const rows: Array<[string, string]> = [
    ['Time to read a site', '≈ 20 sec'],
    ['AI cost of that read', '$0.03'],
    ['Competitors mapped', '5 of 9 kept'],
    ['Positioning charts built', '5'],
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
        Measured on an example workspace built from a public website while writing this
        page. Contivo has no customers yet — its only live deployment is its founder&apos;s.
      </p>
    </dl>
  );
}

/* ─── The reel ───────────────────────────────────────────────────────────── */

function Reel() {
  return (
    <section className="border-b border-carbon/10 bg-paper-light">
      <div className="mx-auto max-w-[92rem] px-6 py-16 md:px-12 md:py-24">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[16ch] font-display text-[clamp(1.9rem,4vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
            This is the actual software.
          </h2>
          <p className="max-w-sm text-[15px] leading-relaxed text-carbon-80">
            Twelve seconds, four screens, no mockups: brand memory, the market map, the
            steps still locked, and a post it wrote.
          </p>
        </div>

        <ProductReel />
      </div>
    </section>
  );
}

/* ─── Intelligence ───────────────────────────────────────────────────────── */

function Intelligence() {
  return (
    <section id="intelligence" className="border-b border-carbon/10">
      <div className="mx-auto max-w-[92rem] px-6 py-20 md:px-12 md:py-28">
        <h2 className="max-w-[20ch] font-display text-[clamp(2.1rem,5vw,4.2rem)] font-semibold leading-[1] tracking-[-0.04em]">
          Most tools start from a blank prompt.{' '}
          <span className="font-accent font-normal italic tracking-[-0.02em] text-carbon-60">
            That
          </span>{' '}
          is why they read like one.
        </h2>

        <div className="mt-16 grid gap-16 lg:grid-cols-2 lg:gap-20">
          <Spread
            n="Your brand, read back to you"
            body="Paste a URL. Contivo pulls out the business summary, the value proposition, the audience it is actually written for and the tone it is written in — then lets you correct all of it. Every draft afterwards is built from this, not from your prompt."
            src="/marketing/brand-memory.webp"
            alt="Contivo's Brand Memory screen showing an extracted business summary, value proposition, target audience persona and brand tone tags."
            w={1800}
            h={1212}
          />
          <Spread
            n="The market, with you on it"
            body="It finds competitors at your scale, checks they exist, and lets you throw out the ones that are not really yours. What survives gets scored on five positioning charts — and you are plotted among them, not described in a paragraph."
            src="/marketing/market-map.webp"
            alt="Contivo's competitive landscape chart plotting the customer's brand among discovered competitors by audience size and product sophistication."
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
          It will not write
          <br />
          <span className="font-accent font-normal italic tracking-[-0.02em]">yet</span>.
        </h2>

        <p className="mt-10 max-w-2xl text-[clamp(1.05rem,1.6vw,1.35rem)] leading-[1.6] text-brick-ink">
          Ideation is locked until the intelligence underneath it exists. You cannot talk
          your way past this, and neither can the model. It is the whole reason the
          output is worth reading.
        </p>

        <figure className="mt-14">
          <Image
            src="/marketing/setup-chain.webp"
            alt="Contivo's setup chain: brand memory and market map complete, keyword analysis next, and Autopilot locked with the note 'Needs the intelligence steps above'."
            width={1800}
            height={400}
            className="h-auto w-full border border-brick-ink/25"
            sizes="(min-width: 768px) 88vw, 94vw"
          />
          <figcaption className="mt-3 text-[13px] text-brick-ink">
            The real lock, in the real product. Autopilot cannot be switched on above it.
          </figcaption>
        </figure>

        <div className="mt-20 grid gap-x-16 gap-y-12 border-t border-brick-ink/25 pt-12 md:grid-cols-2">
          <Refusal
            title="Checks that cannot be argued with"
            items={[
              'Platform limits and the word range you set',
              'Leaked scaffolding, placeholders, “as an AI…”',
              'Your never-write-about list, in the body and not just the title',
              'Near-duplicates of anything already published',
            ]}
          />
          <Refusal
            title="A judge that can veto"
            items={[
              'Scores brand fit, factual safety and clarity out of ten',
              'Factual safety is the strictest threshold of the three',
              'Vetoes invented statistics, named studies and client anecdotes',
              'Both providers down? The post is held. Never published unreviewed.',
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
  return (
    <section id="autopilot" className="border-b border-carbon/10 bg-paper-light">
      <div className="mx-auto grid max-w-[92rem] gap-14 px-6 py-20 md:px-12 md:py-28 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-20">
        <div>
          <h2 className="max-w-[16ch] font-display text-[clamp(2.1rem,5vw,4.2rem)] font-semibold leading-[1] tracking-[-0.04em]">
            Then it writes, and it{' '}
            <span className="font-accent font-normal italic tracking-[-0.02em] text-carbon-60">
              posts
            </span>
            .
          </h2>
          <p className="mt-6 max-w-md text-[16.5px] leading-[1.7] text-carbon-80">
            You set a cadence, the channels, and the hours it is allowed to publish in.
            It keeps the coming week full, spreads posts across your window, avoids
            repeating itself, and retries when the queue runs low. Nobody approves
            anything unless you want to.
          </p>

          <dl className="mt-12 divide-y divide-carbon/15 border-y border-carbon/15">
            {(
              [
                ['Cadence', '1–14 posts a week, kept full 7 days ahead'],
                ['Channels', 'LinkedIn · X · Instagram · your own site'],
                ['Window', 'The days and local hours you choose'],
                ['Steering', 'A goal, themes to lean into, topics to never touch'],
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
              alt="A LinkedIn post generated by Contivo about treating a changelog as a marketing channel, with hashtags and the credits consumed shown underneath."
              width={1400}
              height={1114}
              className="h-auto w-full"
              sizes="(min-width: 1024px) 48vw, 92vw"
            />
          </div>
          <figcaption className="mt-3 text-[12.5px] text-carbon-60">
            Generated while building this page, on the topic in the field above it.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/* ─── Channels ───────────────────────────────────────────────────────────── */

function Channels() {
  return (
    <section id="channels" className="border-b border-carbon/10">
      <div className="mx-auto max-w-[92rem] px-6 py-20 md:px-12 md:py-28">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
          <div>
            <h2 className="max-w-[17ch] font-display text-[clamp(1.9rem,4.2vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
              Social through OAuth. Your own site through one key.
            </h2>
            <p className="mt-6 max-w-lg text-[16px] leading-[1.7] text-carbon-80">
              Connect LinkedIn, X, Instagram, Facebook or TikTok once and Contivo posts to
              them on your behalf. For your own website — any stack, any host — you get an
              API key and your site reads its posts. Nothing is ever pushed into your
              codebase, and no plugin is installed.
            </p>
          </div>

          <ol className="divide-y divide-carbon/15 border-y border-carbon/15">
            {(
              [
                ['Connect', 'One OAuth pass per network, or one key for your site.'],
                ['Schedule', 'Contivo picks slots inside the window you allowed.'],
                ['Publish', 'A scheduler fires every minute and posts what is due.'],
                ['Record', 'Every run is logged, step by step, including what it rejected.'],
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
  return (
    <section className="bg-carbon text-paper-warm">
      <div className="mx-auto max-w-[92rem] px-6 py-24 md:px-12 md:py-32">
        <h2 className="max-w-[17ch] font-display text-[clamp(2.4rem,6.4vw,5.5rem)] font-semibold leading-[0.96] tracking-[-0.045em]">
          Paste a URL and go back to{' '}
          <span className="font-accent font-normal italic tracking-[-0.02em] text-paper-warm/60">
            work
          </span>
          .
        </h2>
        <p className="mt-8 max-w-xl text-[17px] leading-[1.65] text-paper-warm/75">
          In under a minute you have a brand memory and a competitive map. From there the
          queue fills itself, and the only thing it will not do is publish something it
          could not stand behind.
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link
            href="/sign-up"
            className="group inline-flex items-center gap-4 bg-brick px-8 py-5 text-[15px] font-semibold tracking-[0.01em] text-brick-ink transition-colors duration-300 hover:bg-paper-warm hover:text-carbon"
          >
            Create your workspace
            <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1.5">
              &rarr;
            </span>
          </Link>
          <Link
            href="/pricing"
            className="text-[15px] text-paper-warm/70 underline decoration-paper-warm/30 underline-offset-[6px] transition-colors hover:text-paper-warm hover:decoration-brick"
          >
            See pricing
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
